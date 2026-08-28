import sharp from 'sharp'

/**
 * Ritaglio della foto in "bande": colonna dei giorni + una fetta di colonne.
 *
 * Il perché sta in CLAUDE.md: la tabella intera in una sola chiamata dà 18,5% di
 * celle corrette, lo stesso modello su un ritaglio di poche colonne le legge tutte.
 * La geometria è dichiarata dalla referente (quante colonne, quanto è larga la
 * colonna dei giorni, quale porzione della foto è la tabella) e le viene mostrata
 * disegnata sulla foto prima di autorizzare l invio al provider AI: nessuna
 * scoperta automatica dei bordi, nessuna magia da indovinare.
 */

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface BandArea {
  /** Frazioni di larghezza/altezza della foto: 0,0,1,1 significa "tutta la foto". */
  left: number
  top: number
  right: number
  bottom: number
}

export interface BandGeometry {
  width: number
  height: number
  /** Colonne della tabella dopo quella dei giorni, comprese TOT M / AIUTO POM. */
  columns: number
  columnsPerBand?: number
  dayColumnFraction?: number
  /** Quota di colonna aggiunta ai lati della fetta, per non perdere una colonna al taglio. */
  overlapFraction?: number
  area?: BandArea
}

export interface BandPlan {
  index: number
  /** Prima colonna coperta, 0-based. */
  columnFrom: number
  /** Ultima colonna coperta, esclusa. */
  columnTo: number
  dayStrip: Rect
  slice: Rect
  /** Confini della fetta senza sovrapposizione: la griglia che l anteprima disegna. */
  nominalLeft: number
  nominalRight: number
}

export interface BandImage {
  index: number
  data: Buffer
  width: number
  height: number
  columnFrom: number
  columnTo: number
}

export const DEFAULT_COLUMNS_PER_BAND = 1
export const DEFAULT_DAY_COLUMN_FRACTION = 0.1
export const DEFAULT_OVERLAP_FRACTION = 0.35
const FULL_AREA: BandArea = { left: 0, top: 0, right: 1, bottom: 1 }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Dimensioni della foto normalizzata: servono a pianificare le bande in pixel. */
export async function imageDimensions(image: Buffer): Promise<{ width: number; height: number }> {
  let meta
  try {
    meta = await sharp(image).metadata()
  } catch (cause) {
    throw new Error("Il file salvato non è un'immagine leggibile", { cause })
  }
  if (!meta.width || !meta.height) {
    throw new Error("L'immagine della tabella non ha dimensioni leggibili")
  }
  return { width: meta.width, height: meta.height }
}

export function planBands(geometry: BandGeometry): BandPlan[] {
  const columnsPerBand = geometry.columnsPerBand ?? DEFAULT_COLUMNS_PER_BAND
  const dayColumnFraction = geometry.dayColumnFraction ?? DEFAULT_DAY_COLUMN_FRACTION
  const overlapFraction = geometry.overlapFraction ?? DEFAULT_OVERLAP_FRACTION
  const area = geometry.area ?? FULL_AREA

  if (!Number.isInteger(geometry.columns) || geometry.columns < 1) {
    throw new Error('Il numero di colonne della tabella deve essere almeno 1')
  }
  if (!Number.isInteger(columnsPerBand) || columnsPerBand < 1) {
    throw new Error('Il numero di colonne per banda deve essere almeno 1')
  }
  if (dayColumnFraction <= 0 || dayColumnFraction >= 1) {
    throw new Error('La larghezza della colonna dei giorni deve stare fra 0 e 1 esclusi')
  }
  if (overlapFraction < 0) {
    throw new Error('La sovrapposizione fra bande non può essere negativa')
  }
  if (area.right <= area.left || area.bottom <= area.top) {
    throw new Error("L'area della tabella è vuota: destra e basso devono superare sinistra e alto")
  }

  const areaLeft = Math.round(area.left * geometry.width)
  const areaRight = Math.round(area.right * geometry.width)
  const areaTop = Math.round(area.top * geometry.height)
  const areaBottom = Math.round(area.bottom * geometry.height)
  const areaWidth = areaRight - areaLeft
  const areaHeight = areaBottom - areaTop

  const dayWidth = Math.max(1, Math.round(dayColumnFraction * areaWidth))
  const columnsLeft = areaLeft + dayWidth
  const columnWidth = (areaRight - columnsLeft) / geometry.columns
  if (columnWidth < 1) {
    throw new Error('Le colonne risultano più strette di un pixel: rivedi area e numero di colonne')
  }

  const dayStrip: Rect = { left: areaLeft, top: areaTop, width: dayWidth, height: areaHeight }
  const bandCount = Math.ceil(geometry.columns / columnsPerBand)

  const plans: BandPlan[] = []
  for (let index = 0; index < bandCount; index += 1) {
    const columnFrom = index * columnsPerBand
    const columnTo = Math.min(geometry.columns, columnFrom + columnsPerBand)

    const nominalLeft = Math.round(columnsLeft + columnFrom * columnWidth)
    const nominalRight = Math.round(columnsLeft + columnTo * columnWidth)

    const left = Math.round(
      clamp(columnsLeft + (columnFrom - overlapFraction) * columnWidth, columnsLeft, areaRight),
    )
    const right = Math.round(
      clamp(columnsLeft + (columnTo + overlapFraction) * columnWidth, columnsLeft, areaRight),
    )

    plans.push({
      index,
      columnFrom,
      columnTo,
      dayStrip,
      slice: { left, top: areaTop, width: Math.max(1, right - left), height: areaHeight },
      nominalLeft,
      nominalRight,
    })
  }

  return plans
}

/** Affianca la colonna dei giorni e la fetta di colonne in una sola immagine. */
async function cropBand(image: Buffer, plan: BandPlan): Promise<BandImage> {
  const [day, slice] = await Promise.all([
    sharp(image).extract(plan.dayStrip).toBuffer(),
    sharp(image).extract(plan.slice).toBuffer(),
  ])

  const width = plan.dayStrip.width + plan.slice.width
  const height = plan.dayStrip.height

  const data = await sharp({
    create: { width, height, channels: 3, background: '#ffffff' },
  })
    .composite([
      { input: day, left: 0, top: 0 },
      { input: slice, left: plan.dayStrip.width, top: 0 },
    ])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()

  return {
    index: plan.index,
    data,
    width,
    height,
    columnFrom: plan.columnFrom,
    columnTo: plan.columnTo,
  }
}

export async function cropRosterBands(image: Buffer, plans: BandPlan[]): Promise<BandImage[]> {
  const bande: BandImage[] = []
  // In sequenza e non in parallelo: su una ZimaBoard quattro decodifiche JPEG
  // simultanee da 2000px costano più memoria di quanta convenga risparmiare.
  for (const plan of plans) {
    bande.push(await cropBand(image, plan))
  }
  return bande
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => {
    switch (char) {
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '&':
        return '&amp;'
      case '"':
        return '&quot;'
      default:
        return '&apos;'
    }
  })
}

/**
 * Disegna sulla foto la colonna dei giorni e i confini delle bande: è quello che
 * la referente guarda per capire se i tagli cadono sulle righe della tabella,
 * prima di autorizzare l invio al provider AI.
 */
export async function renderBandPreview(image: Buffer, plans: BandPlan[]): Promise<Buffer> {
  const { width, height } = await imageDimensions(image)

  const primo = plans[0]
  const top = primo.dayStrip.top
  const bottom = top + primo.dayStrip.height
  const fontSize = Math.max(12, Math.round(height / 40))

  const linee: string[] = []

  // Bordo dell area della tabella.
  const areaLeft = primo.dayStrip.left
  const areaRight = plans[plans.length - 1].nominalRight
  linee.push(
    `<rect x="${areaLeft}" y="${top}" width="${areaRight - areaLeft}" height="${bottom - top}" fill="none" stroke="#2563eb" stroke-width="3" />`,
  )

  // Fine della colonna dei giorni.
  const dayEnd = primo.dayStrip.left + primo.dayStrip.width
  linee.push(
    `<line x1="${dayEnd}" y1="${top}" x2="${dayEnd}" y2="${bottom}" stroke="#2563eb" stroke-width="3" />`,
  )

  for (const plan of plans) {
    linee.push(
      `<line x1="${plan.nominalRight}" y1="${top}" x2="${plan.nominalRight}" y2="${bottom}" stroke="#dc2626" stroke-width="2" />`,
    )
    const centro = Math.round((plan.nominalLeft + plan.nominalRight) / 2)
    linee.push(
      `<text x="${centro}" y="${top + fontSize + 4}" font-size="${fontSize}" font-family="sans-serif" text-anchor="middle" fill="#dc2626">${escapeXml(String(plan.index + 1))}</text>`,
    )
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${linee.join('')}</svg>`

  return sharp(image)
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .jpeg({ quality: 80 })
    .toBuffer()
}
