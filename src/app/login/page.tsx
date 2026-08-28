import { devLoginEmails } from '@/modules/auth'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  // Accesso di prova senza Google: elenco vuoto in produzione e senza la variabile
  // d ambiente, quindi qui non c è nessun secondo controllo da tenere allineato.
  const devEmails = devLoginEmails()

  const messages: Record<string, string> = {
    state: 'Sessione di accesso scaduta. Riprova.',
    not_invited: 'Questo indirizzo non è stato invitato. Chiedi alla referente di aggiungerti.',
    denied: 'Accesso annullato.',
    google: 'Accesso con Google non riuscito. Riprova.',
    email_not_verified:
      'Questo indirizzo Google non risulta verificato: usa un account verificato o contatta la referente.',
    retry: 'Accesso non riuscito, riprova.',
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Turni</h1>
      <p className="text-sm text-gray-600">
        Accedi con l&apos;account Google su cui vuoi ricevere i turni.
      </p>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {messages[error] ?? 'Accesso non riuscito.'}
        </p>
      )}

      <a
        href="/api/auth/google/start"
        className="rounded-md bg-black px-4 py-2 text-center text-white"
      >
        Accedi con Google
      </a>

      {devEmails.length > 0 && (
        <section className="rounded-md border border-dashed border-amber-500 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            Accesso di prova, attivo solo in sviluppo
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Entra senza Google come uno degli account qui sotto. Il collegamento con Google
            resta da autorizzare: il sync lo chiederà.
          </p>
          <div className="mt-3 grid gap-2">
            {devEmails.map((email) => (
              <form key={email} action="/api/auth/dev-login" method="post">
                <input type="hidden" name="email" value={email} />
                <button
                  type="submit"
                  className="w-full rounded-md border border-amber-600 bg-white px-3 py-2 text-sm text-amber-900"
                >
                  Entra come {email}
                </button>
              </form>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
