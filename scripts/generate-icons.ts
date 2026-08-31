/**
 * Genera le cinque icone della PWA da un SVG, una volta sola: l esito si
 * committa. Su una ZimaBoard un icona prodotta da una route è CPU spesa a ogni
 * richiesta per un immagine che non cambia mai.
 *
 *   npx tsx scripts/generate-icons.ts
 *
 * Il segno: la tabella turni con un turno confermato — una griglia di caselle
 * bianche 4 colonne × 5 righe su fondo blu, tutte al 40% tranne una piena.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const BLU = '#1A6FD4'
const COLONNE = 4
const RIGHE = 5
/** La casella piena: riga 2, colonna 3 (contate da 1). */
const PIENA = { riga: 2, colonna: 3 }

/**
 * @param lato   lato dell immagine in pixel
 * @param scala  quanta parte del lato occupa la griglia (il resto è margine)
 * @param raggio angolo del fondo; 0 per le icone che il sistema ritaglia da sé
 */
function svg(lato: number, scala: number, raggio: number): string {
  const area = lato * scala
  const margineX = (lato - area) / 2
  const margineY = (lato - area) / 2
  const passoX = area / COLONNE
  const passoY = area / RIGHE
  // Casella quadrata sul più piccolo dei due passi: 4 colonne e 5 righe in un
  // quadrato non danno passi uguali, e caselle rettangolari sembrerebbero un errore.
  const casella = Math.min(passoX, passoY) * 0.62
  const arrotonda = casella * 0.28

  let celle = ''
  for (let riga = 0; riga < RIGHE; riga += 1) {
    for (let colonna = 0; colonna < COLONNE; colonna += 1) {
      const piena = riga + 1 === PIENA.riga && colonna + 1 === PIENA.colonna
      const x = margineX + colonna * passoX + (passoX - casella) / 2
      const y = margineY + riga * passoY + (passoY - casella) / 2
      celle +=
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" ` +
        `width="${casella.toFixed(2)}" height="${casella.toFixed(2)}" ` +
        `rx="${arrotonda.toFixed(2)}" fill="#FFFFFF" fill-opacity="${piena ? '1' : '0.4'}"/>`
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${lato}" height="${lato}" ` +
    `viewBox="0 0 ${lato} ${lato}">` +
    `<rect width="${lato}" height="${lato}" rx="${raggio.toFixed(2)}" fill="${BLU}"/>` +
    `${celle}</svg>`
  )
}

interface Icona {
  file: string
  lato: number
  scala: number
  raggio: number
  perche: string
}

const ICONE: readonly Icona[] = [
  {
    file: 'src/app/icon.png',
    lato: 512,
    scala: 0.66,
    raggio: 512 * 0.22,
    perche: 'scheda del browser: Next genera il <link> dal nome del file',
  },
  {
    file: 'src/app/apple-icon.png',
    lato: 180,
    scala: 0.62,
    raggio: 0,
    perche: 'schermata Home di iOS: iOS arrotonda da sé, quindi il fondo va a filo',
  },
  { file: 'public/icon-192.png', lato: 192, scala: 0.66, raggio: 192 * 0.22, perche: 'manifest' },
  { file: 'public/icon-512.png', lato: 512, scala: 0.66, raggio: 512 * 0.22, perche: 'manifest, splash' },
  {
    file: 'public/icon-maskable-512.png',
    lato: 512,
    // La zona sicura di un icona mascherabile è il cerchio interno: la griglia
    // sta al 55% del lato, il blu arriva ai bordi.
    scala: 0.55,
    raggio: 0,
    perche: 'manifest, purpose: maskable',
  },
]

const radice = path.join(import.meta.dirname, '..')

async function main(): Promise<void> {
  for (const icona of ICONE) {
    const destinazione = path.join(radice, icona.file)
    mkdirSync(path.dirname(destinazione), { recursive: true })
    const png = await sharp(Buffer.from(svg(icona.lato, icona.scala, icona.raggio)))
      .png({ compressionLevel: 9 })
      .toBuffer()
    writeFileSync(destinazione, png)
    console.log(`${icona.file.padEnd(32)} ${icona.lato}px  ${icona.perche}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
