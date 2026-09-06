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
/**
 * Il testo del bottone e della nota sotto, a seconda di quanto è già sul
 * calendario. Funzione pura ed esportata per essere provata senza un `<form>`.
 */
export function syncButtonCopy({
  shifts,
  synced,
  pending,
}: {
  shifts: number
  synced: number
  pending: boolean
}): { label: string; note: string } {
  if (pending) {
    return {
      label: 'Sto scrivendo sul calendario…',
      note: 'Un evento per volta: può volerci un minuto. Non chiudere la pagina.',
    }
  }
  if (synced >= shifts) {
    return {
      label: 'Aggiorna il calendario',
      note: `I ${shifts} turni confermati sono già sul calendario «Turni Toniolo». Rimandare aggiorna solo quello che è cambiato e non duplica niente.`,
    }
  }
  if (synced === 0) {
    return {
      label: `Manda sul mio calendario i ${shifts} turni confermati`,
      note: 'Scrive solo sul calendario «Turni Toniolo» creato dall’app, e solo i turni che hai confermato.',
    }
  }
  return {
    label: `Manda sul calendario i ${shifts - synced} turni che mancano`,
    note: `${synced} dei ${shifts} turni confermati sono già sul calendario «Turni Toniolo»: gli altri si aggiungono senza duplicare niente.`,
  }
}

export function SyncButton({ shifts, synced = 0 }: { shifts: number; synced?: number }) {
  const { pending } = useFormStatus()
  const copia = syncButtonCopy({ shifts, synced, pending })

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
        {copia.label}
      </Button>
      <p aria-live="polite" className="text-muted-foreground text-center text-xs">
        {copia.note}
      </p>
    </>
  )
}
