'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * L avanzamento mentre si aspetta. Leggere una tabella e una chiamata al modello
 * (o una per banda, con `AI_STRATEGY=bands`): la
 * pagina si aggiorna da sola invece di chiedere all utente di ricaricare.
 *
 * Interroga l avanzamento e ridisegna solo i numeri; quando lo **stato** cambia
 * (l estrazione finisce, o si scopre interrotta) chiede a Next di rifare la
 * pagina, perché a quel punto cambia tutto il resto. Interrogare l avanzamento
 * sveglia anche il worker lato server, quindi questa pagina è anche ciò che fa
 * riprendere un estrazione dopo un riavvio del processo.
 */

interface Progresso {
  status: string
  bandsTotal: number
  bandsDone: number
  bandsFailed: number
  missingBands: number[]
}

const IN_CORSO = ['extracting', 'interrupted']

export function ExtractionProgress({
  rosterId,
  initial,
  intervalMs = 6000,
}: {
  rosterId: string
  initial: Progresso
  intervalMs?: number
}) {
  const router = useRouter()
  const [progresso, setProgresso] = useState(initial)

  useEffect(() => {
    if (!IN_CORSO.includes(progresso.status)) return

    let annullato = false
    const timer = setInterval(async () => {
      try {
        const risposta = await fetch(`/api/rosters/${rosterId}/progress`, { cache: 'no-store' })
        if (!risposta.ok || annullato) return
        const nuovo = (await risposta.json()) as Progresso
        if (annullato) return
        setProgresso(nuovo)
        if (nuovo.status !== progresso.status) router.refresh()
      } catch {
        // Rete ballerina o server che riparte: al giro dopo si riprova.
      }
    }, intervalMs)

    return () => {
      annullato = true
      clearInterval(timer)
    }
  }, [rosterId, intervalMs, progresso.status, router])

  const totale = progresso.bandsTotal
  const fatte = progresso.bandsDone
  const percentuale = totale === 0 ? 0 : Math.round((fatte / totale) * 100)

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">
          {fatte} di {totale} letture completate
        </span>
        <span className="text-muted-foreground">{percentuale}%</span>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full transition-all"
          style={{ width: `${percentuale}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {progresso.status === 'interrupted'
          ? "L'estrazione si era interrotta: riprende dalle letture che mancano."
          : 'Puoi chiudere questa pagina e tornare dopo: la lettura va avanti da sé.'}
      </p>
    </div>
  )
}
