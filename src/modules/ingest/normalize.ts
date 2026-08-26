import sharp from 'sharp'

export interface NormalizedImage {
  data: Buffer
  width: number
  height: number
  bytes: number
}

const DEFAULT_MAX_EDGE = 2000
const DEFAULT_QUALITY = 85

/**
 * Prepara la foto per il modello vision: applica l orientamento EXIF (le foto da
 * telefono arrivano ruotate e il modello leggerebbe la tabella di traverso), riduce
 * il lato lungo e ricomprime in JPEG.
 */
export async function normalizeRosterPhoto(
  input: Buffer,
  options: { maxEdge?: number; quality?: number } = {},
): Promise<NormalizedImage> {
  const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE
  const quality = options.quality ?? DEFAULT_QUALITY

  try {
    const { data, info } = await sharp(input)
      .rotate() // senza argomenti applica l orientamento EXIF
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })

    return { data, width: info.width, height: info.height, bytes: data.byteLength }
  } catch (cause) {
    throw new Error("Il file caricato non è un immagine leggibile", { cause })
  }
}
