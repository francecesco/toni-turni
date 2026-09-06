import { Banner } from '@/components/banner'
import type { VersionChange } from '@/modules/review'

/** `5 (M → P)`, `12 nuovo (M)`, `20 tolto (era M)`. */
export function describeChange(change: VersionChange): string {
  if (change.kind === 'changed') return `${change.day} (${change.before} → ${change.after})`
  if (change.kind === 'added') return `${change.day} nuovo (${change.after})`
  return `${change.day} tolto (era ${change.before})`
}

/**
 * Il riquadro «rispetto alla foto precedente». Solo i giorni cambiati della colonna
 * (decisione del proprietario), e **solo se ce ne sono**: un avviso che compare su
 * ogni tabella insegna a ignorarlo. Le righe corrispondenti portano il badge.
 */
export function ChangesBox({ changes }: { changes: VersionChange[] }) {
  if (changes.length === 0) return null
  const n = changes.length
  return (
    <Banner variant="warn" title={`Rispetto alla foto precedente ${n === 1 ? 'è cambiato 1 giorno' : `sono cambiati ${n} giorni`}`}>
      <p className="tabular">{changes.map(describeChange).join(' · ')}</p>
      <p className="mt-1 text-xs">
        Un turno cambiato che avevi già confermato resta sul calendario com’era finché non lo
        riconfermi. Un turno tolto resta finché non premi «Togli dal calendario».
      </p>
    </Banner>
  )
}
