// `devLogin` invece della facciata `@/modules/auth` di proposito: questo file viene
// caricato all avvio del server (e anche nel runtime edge), mentre la facciata tira
// dentro il client Prisma e `next/headers`. `devLogin` non dipende da nulla.
import { devLoginStartupWarning } from '@/modules/auth/devLogin'

/**
 * Girata una volta sola a ogni avvio del server, prima che accetti richieste.
 * Serve a fare rumore sull accesso di prova senza Google: un bypass silenzioso è
 * un bypass che si dimentica addosso.
 */
export function register(): void {
  const warning = devLoginStartupWarning()
  if (warning) console.warn(warning)
}
