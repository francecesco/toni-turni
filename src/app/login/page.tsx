import { Banner } from '@/components/banner'
import { Button, buttonVariants } from '@/components/ui/button'
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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-safe">
      <h1 className="text-2xl font-semibold">Turni</h1>
      <p className="text-muted-foreground text-sm">
        Accedi con l&apos;account Google su cui vuoi ricevere i turni.
      </p>

      {error && <Banner variant="error">{messages[error] ?? 'Accesso non riuscito.'}</Banner>}

      {/* Un ancora vera, non `Button render={<a/>}`: qui il testo del collegamento
          deve restare leggibile nell albero JSX così com è (vedi
          `tests/app/login-page.test.ts`), e `buttonVariants` dà la stessa veste
          senza indirezione. */}
      <a href="/api/auth/google/start" className={buttonVariants({ size: 'touch', className: 'w-full' })}>
        Accedi con Google
      </a>

      {devEmails.length > 0 && (
        <Banner
          variant="warn"
          title="Accesso di prova, attivo solo in sviluppo"
          className="border border-dashed"
        >
          <p>
            Entra senza Google come uno degli account qui sotto. Il collegamento con Google resta
            da autorizzare: il sync lo chiederà.
          </p>
          <div className="mt-3 grid gap-2">
            {devEmails.map((email) => (
              <form key={email} action="/api/auth/dev-login" method="post">
                <input type="hidden" name="email" value={email} />
                <Button
                  type="submit"
                  size="touch"
                  variant="outline"
                  className="h-auto min-h-12 w-full py-3 leading-tight whitespace-normal"
                >
                  Entra come {email}
                </Button>
              </form>
            ))}
          </div>
        </Banner>
      )}
    </main>
  )
}
