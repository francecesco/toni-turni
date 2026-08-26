export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

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
    </main>
  )
}
