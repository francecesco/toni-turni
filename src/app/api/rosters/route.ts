import { authorizeApi } from '@/modules/auth'
import {
  normalizeRosterPhoto,
  pruneOldImages,
  retentionDays,
  saveRosterImage,
} from '@/modules/ingest'
import { createRoster, parseUploadForm, setRosterImagePath } from '@/modules/roster'

/**
 * Caricamento della foto. Solo la referente (regola invariante 7), controllata
 * **qui** e non solo nell interfaccia.
 *
 * Una route e non una server action perché una foto da telefono pesa più del
 * limite di 1MB che Next impone al corpo di una server action.
 *
 * Risponde subito: normalizza l immagine, la salva sul volume e crea la `Roster`
 * in stato `uploaded`. **Nessuna chiamata al provider AI**: quella parte solo dopo
 * che la referente ha guardato l anteprima dei tagli e ha premuto "Estrai".
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await authorizeApi({ referente: true })
  if (!auth.ok) return auth.response

  const back = (message: string) =>
    Response.redirect(
      new URL(`/rosters/upload?error=${encodeURIComponent(message)}`, request.url),
      303,
    )

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return back('Il caricamento non è arrivato completo: riprova')
  }

  const parsed = parseUploadForm(form)
  if (!parsed.ok) return back(parsed.errors.join('; '))

  const photo = form.get('photo')
  if (!(photo instanceof File) || photo.size === 0) {
    return back('Scegli la foto della tabella')
  }

  let normalized
  try {
    normalized = await normalizeRosterPhoto(Buffer.from(await photo.arrayBuffer()))
  } catch {
    return back('Il file caricato non è una foto leggibile (JPEG, PNG o HEIC)')
  }

  const roster = await createRoster({
    year: parsed.value.year,
    month: parsed.value.month,
    ward: parsed.value.ward,
    imagePath: '',
  })

  // Il percorso della foto contiene l id della tabella, quindi la riga nasce prima
  // e il percorso viene scritto subito dopo il salvataggio.
  await setRosterImagePath(roster.id, await saveRosterImage(roster.id, normalized.data))

  // Le foto sono dati personali di terzi: qui è il momento naturale per far
  // scadere quelle vecchie, una volta al mese, senza un job dedicato.
  try {
    await pruneOldImages(retentionDays(), new Date())
  } catch (error) {
    console.error('Pulizia delle foto scadute non riuscita:', error)
  }

  return Response.redirect(new URL(`/rosters/${roster.id}`, request.url), 303)
}
