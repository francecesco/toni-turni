import sharp from 'sharp'
import { deskewRoster, type DeskewedRoster } from './crop'
import { planBands, pruneColumnBoundaries } from './layout'

/**
 * L'anteprima dei tagli: il riquadro raddrizzato con i confini di colonna
 * rilevati e la cucitura fra le due metà del mese disegnati sopra.
 *
 * È il controllo umano che sta **fra** il rilevamento della griglia e venti
 * minuti di chiamate al provider. Il rilevamento non fallisce in modo rumoroso
 * quando sbaglia di poco: produce ritagli spostati, cioè turni attribuiti al
 * giorno o alla persona sbagliata, che dal risultato non si distinguono da una
 * lettura sfortunata. Guardare una volta dove cadono i tagli costa dieci secondi
 * alla referente e li vede tutti.
 */

/** Un colore per ruolo, perché i tre tipi di taglio si giudicano diversamente. */
const COLORE = {
  bordo: '#2563eb',
  giorni: '#2563eb',
  colonna: '#dc2626',
  cucitura: '#059669',
} as const

export interface PreviewGeometry {
  width: number
  height: number
  /** Confini di colonna in frazione della larghezza, come li rileva `deskewRoster`. */
  columns: readonly number[]
  daysInMonth: number
  columnsPerBand?: number
}

/**
 * L'SVG da sovrapporre al riquadro raddrizzato. Funzione pura: le coordinate si
 * possono verificare senza decodificare un JPEG.
 *
 * Le linee **non** sono frazioni fisse: vengono da `planBands`, cioè dagli stessi
 * numeri che taglieranno le bande. Se questa anteprima e i ritagli potessero
 * divergere, l'anteprima non sarebbe una verifica di niente.
 */
export function previewOverlaySvg(geometry: PreviewGeometry): string {
  const { width, height } = geometry
  const specifiche = planBands(geometry.columns, {
    daysInMonth: geometry.daysInMonth,
    columnsPerBand: geometry.columnsPerBand,
  })

  // I confini **ripuliti**: sono quelli su cui si taglia davvero. Disegnare anche
  // i filetti spuri farebbe giudicare a occhio dei tagli che non esistono.
  const bordi = pruneColumnBoundaries(geometry.columns)

  const px = (valore: number) => Math.round(valore * width)
  const py = (valore: number) => Math.round(valore * height)
  const fontSize = Math.max(12, Math.round(height / 40))

  const righe: string[] = [
    `<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="${COLORE.bordo}" stroke-width="3" data-ruolo="bordo" />`,
  ]

  // I confini di colonna rilevati. Il primo dopo il lato sinistro è la fine del
  // blocco dei giorni, che entra in **ogni** banda: si distingue perché è il
  // taglio il cui errore si paga su tutte le letture insieme.
  const finGiorni = bordi[1]
  for (const confine of bordi) {
    const ruolo = confine === finGiorni ? 'giorni' : 'colonna'
    const colore = ruolo === 'giorni' ? COLORE.giorni : COLORE.colonna
    const spessore = ruolo === 'giorni' ? 3 : 2
    righe.push(
      `<line x1="${px(confine)}" y1="0" x2="${px(confine)}" y2="${height}" stroke="${colore}" stroke-width="${spessore}" data-ruolo="${ruolo}" />`,
    )
  }

  // La cucitura fra le due metà del mese: due linee, non una, perché le bande si
  // sovrappongono di proposito e la fascia fra le due è la tolleranza che regge
  // un errore nella previsione del filetto di metà mese.
  const cuciture = new Set<number>()
  for (const spec of specifiche) {
    if (spec.crop.top > 0) cuciture.add(spec.crop.top)
    const basso = spec.crop.top + spec.crop.height
    if (basso < 1) cuciture.add(basso)
  }
  for (const y of [...cuciture].sort((a, b) => a - b)) {
    righe.push(
      `<line x1="0" y1="${py(y)}" x2="${width}" y2="${py(y)}" stroke="${COLORE.cucitura}" stroke-width="2" stroke-dasharray="10 8" data-ruolo="cucitura" />`,
    )
  }

  // Il numero del gruppo di colonne: una lettura per ogni gruppo e per ogni metà
  // del mese, quindi il gruppo è ciò che si riconosce a occhio sulla foto.
  const gruppi = new Map<string, { left: number; right: number }>()
  for (const spec of specifiche) {
    const chiave = spec.columns.join('-')
    if (!gruppi.has(chiave)) {
      gruppi.set(chiave, { left: spec.crop.left, right: spec.crop.left + spec.crop.width })
    }
  }
  let numero = 0
  for (const gruppo of gruppi.values()) {
    numero += 1
    const centro = px((gruppo.left + gruppo.right) / 2)
    righe.push(
      `<text x="${centro}" y="${fontSize + 4}" font-size="${fontSize}" font-family="sans-serif" text-anchor="middle" fill="${COLORE.colonna}" data-ruolo="gruppo">${numero}</text>`,
    )
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">\n${righe.join('\n')}\n</svg>`
}

/**
 * Il JPEG dell'anteprima: il riquadro raddrizzato con l'SVG sopra.
 *
 * `deskew` è iniettabile perché un test non deve rilevare una griglia vera per
 * verificare che l'anteprima si componga.
 */
export async function renderRosterPreview(
  image: Buffer,
  options: {
    daysInMonth: number
    columnsPerBand?: number
    deskew?: (image: Buffer) => Promise<DeskewedRoster>
  },
): Promise<Buffer> {
  const raddrizzato = await (options.deskew ?? deskewRoster)(image)
  const svg = previewOverlaySvg({
    width: raddrizzato.width,
    height: raddrizzato.height,
    columns: raddrizzato.columns,
    daysInMonth: options.daysInMonth,
    columnsPerBand: options.columnsPerBand,
  })

  return sharp(raddrizzato.data)
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .jpeg({ quality: 80 })
    .toBuffer()
}
