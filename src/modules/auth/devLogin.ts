import { normalizeEmail } from './policy'

/**
 * Accesso di prova per il solo sviluppo: un modo di aprire una sessione per un
 * utente **già esistente** senza passare da Google, finché le credenziali OAuth
 * reali non sono configurate.
 *
 * È un bypass dell autenticazione in un progetto che gira dietro un tunnel
 * raggiungibile da Internet, quindi il cancello è chiuso a tripla mandata e
 * ogni mandata è necessaria:
 *
 * 1. `NODE_ENV` diverso da `production` — in produzione il codice è inerte e la
 *    route risponde 404, non 401: non deve nemmeno rivelare di esistere.
 * 2. `DEV_LOGIN_EMAILS` presente e non vuota. L assenza è il default: chi non la
 *    mette non ha il bypass. La variabile è insieme l interruttore **e** l elenco
 *    chiuso delle identità raggiungibili, così non esiste una configurazione che
 *    accenda il bypass senza dire per chi.
 * 3. L email deve essere anche presente nel database (controllo nella route).
 *
 * Perché sia l elenco sia il database, e non uno solo dei due: con il solo elenco
 * la route dovrebbe creare l utente, e un bypass che fabbrica identità in un
 * database che può essere quello vero è una cosa diversa (e peggiore) da un bypass
 * che entra in un identità esistente; con il solo database, chiunque riuscisse ad
 * accendere la variabile entrerebbe come qualunque infermiera registrata. Insieme,
 * il bypass raggiunge soltanto identità che il proprietario ha nominato a mano e
 * che esistono già.
 */
export const DEV_LOGIN_ENV = 'DEV_LOGIN_EMAILS'

type Env = Record<string, string | undefined>

/**
 * Le email ammesse dall accesso di prova, normalizzate. Elenco vuoto = bypass
 * spento, ed è il caso di gran lunga più comune: nessuna variabile, nessun accesso.
 */
export function devLoginEmails(env: Env = process.env): string[] {
  if (env.NODE_ENV === 'production') return []

  const raw = env[DEV_LOGIN_ENV]
  if (raw === undefined) return []

  const emails = raw
    .split(',')
    .map((entry) => normalizeEmail(entry))
    .filter((entry) => entry !== '')

  return [...new Set(emails)]
}

/** Vero solo se il bypass è utilizzabile: ambiente non di produzione ed elenco non vuoto. */
export function isDevLoginEnabled(env: Env = process.env): boolean {
  return devLoginEmails(env).length > 0
}

/** Vero se questa email è fra quelle nominate nell elenco chiuso. */
export function devLoginAllows(email: string, env: Env = process.env): boolean {
  return devLoginEmails(env).includes(normalizeEmail(email))
}

/**
 * L avviso da stampare all avvio. Un bypass silenzioso è un bypass che si
 * dimentica, quindi il caso «acceso» fa rumore; e anche il caso «variabile
 * impostata in produzione» lo fa, perché chi l ha messa deve sapere che è
 * ignorata invece di credere di avere un accesso che non ha.
 */
export function devLoginStartupWarning(env: Env = process.env): string | null {
  const configured = env[DEV_LOGIN_ENV] !== undefined && env[DEV_LOGIN_ENV]?.trim() !== ''

  if (env.NODE_ENV === 'production') {
    return configured
      ? `${DEV_LOGIN_ENV} è impostata ma l ambiente è di produzione: l accesso di prova è IGNORATO e /api/auth/dev-login risponde 404. Rimuovi la variabile.`
      : null
  }

  const emails = devLoginEmails(env)
  if (emails.length === 0) return null

  return [
    '',
    '  ============================================================',
    '   ATTENZIONE: accesso di prova SENZA Google attivo.',
    `   Chiunque raggiunga ${'/api/auth/dev-login'} può entrare come:`,
    ...emails.map((email) => `     - ${email}`),
    `   Vale solo fuori dalla produzione. Togli ${DEV_LOGIN_ENV} quando`,
    '   hai finito di provare l interfaccia.',
    '  ============================================================',
    '',
  ].join('\n')
}
