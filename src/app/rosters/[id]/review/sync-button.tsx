'use client'

import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'

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
      <Button
        type="submit"
        size="touch"
        variant="outline"
        disabled={pending}
        aria-busy={pending}
        className="w-full whitespace-normal h-auto min-h-12 py-3 leading-tight"
      >
        {pending
          ? 'Sto scrivendo sul calendario…'
          : `Manda sul mio calendario i ${shifts} turni confermati`}
      </Button>
      <p aria-live="polite" className="text-muted-foreground text-center text-xs">
        {pending
          ? 'Un evento per volta: può volerci un minuto. Non chiudere la pagina.'
          : 'Scrive solo sul calendario "Turni" creato dall’app, e solo i turni che hai confermato.'}
      </p>
    </>
  )
}
