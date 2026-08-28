'use client'

import { useFormStatus } from 'react-dom'

/**
 * Il bottone che manda i turni confermati sul calendario.
 *
 * Vive in un componente a sé per un motivo solo: `useFormStatus` legge lo stato del
 * `<form>` che lo contiene, e un sync è una serie di chiamate HTTP a Google — decine
 * di secondi su un mese pieno. Senza un segnale di lavoro in corso l utente premerebbe
 * di nuovo, e un doppio invio su una scrittura è la cosa che meno si vuole qui.
 */
export function SyncButton({ shifts }: { shifts: number }) {
  const { pending } = useFormStatus()

  return (
    <>
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="w-full rounded-xl border-2 border-primary bg-background px-4 py-4 text-base font-medium text-primary shadow-lg disabled:opacity-70"
      >
        {pending
          ? 'Sto scrivendo sul calendario…'
          : `Manda sul mio calendario i ${shifts} turni confermati`}
      </button>
      <p aria-live="polite" className="text-center text-xs text-muted-foreground">
        {pending
          ? 'Un evento per volta: può volerci un minuto. Non chiudere la pagina.'
          : 'Scrive solo sul calendario "Turni" creato dall app, e solo i turni che hai confermato.'}
      </p>
    </>
  )
}
