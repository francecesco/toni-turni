/**
 * Gli origin in più che il dev server di Next può servire.
 *
 * Next, in sviluppo, blocca come cross-origin i chunk JavaScript chiesti da un host
 * diverso da quello con cui è partito (`localhost`): la pagina arriva, gli script
 * rispondono 403 e niente si idrata. Dal telefono si vede una pagina che non
 * reagisce a nessun tocco, senza un errore da nessuna parte.
 *
 * L'host si prende da `APP_URL`, che per il percorso dal telefono deve già puntare
 * all'IP di rete (l'accesso di prova fa un redirect proprio lì): una variabile sola
 * invece di due da tenere allineate. In produzione `allowedDevOrigins` è ignorato.
 *
 * Questo file non importa niente: lo carica `next.config.ts`, fuori dal runtime.
 */
export function devOriginsFrom(appUrl: string | undefined): string[] {
  if (!appUrl) return []
  try {
    return [new URL(appUrl).hostname]
  } catch {
    return []
  }
}
