import { ChevronDownIcon, ChevronLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { AppMenu } from '@/components/app-menu'
import type { MenuItem } from '@/modules/auth'

/**
 * L intestazione di ogni schermata. Il titolo è **il mese**, non una didascalia:
 * a inizio mese l atterraggio può cadere sul mese scorso, e chi guarda deve
 * capire subito quale sta guardando.
 *
 * `backHref` vince su `pickerHref`: una sotto-pagina ha una freccia indietro, non
 * un selettore di mesi.
 */
export function AppHeader({
  title,
  subtitle,
  pickerHref,
  backHref,
  // `columns`, `upload`, `settings/codes`, `settings/users` non passano
  // `menuItems`: **di proposito**, non per dimenticanza. Sono sotto-pagine con
  // `backHref` (la freccia indietro), e il loro ⋯ porta solo «Esci», che c è
  // su ogni schermata.
  menuItems = [],
}: {
  title: string
  subtitle?: string
  pickerHref?: string
  backHref?: string
  menuItems?: MenuItem[]
}) {
  return (
    <header className="mx-auto flex w-full max-w-2xl items-start justify-between gap-3 px-4 pt-safe pb-3">
      <div className="min-w-0">
        {backHref ? (
          <Link href={backHref} className="text-muted-foreground -ml-1 flex h-11 items-center gap-1 text-sm">
            <ChevronLeftIcon className="size-4" />
            Indietro
          </Link>
        ) : null}

        {!backHref && pickerHref ? (
          <Link href={pickerHref} className="flex min-h-11 items-center gap-1.5">
            <h1 className="truncate text-2xl font-extrabold tracking-tight first-letter:uppercase">{title}</h1>
            <ChevronDownIcon className="text-muted-foreground size-5 shrink-0" />
          </Link>
        ) : (
          <h1 className="truncate text-2xl font-extrabold tracking-tight first-letter:uppercase">{title}</h1>
        )}

        {subtitle && <p className="text-muted-foreground mt-0.5 truncate text-sm">{subtitle}</p>}
      </div>

      <div className="shrink-0 pt-1">
        <AppMenu items={menuItems} />
      </div>
    </header>
  )
}
