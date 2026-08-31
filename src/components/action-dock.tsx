import type React from 'react'

/**
 * Le azioni fisse in fondo, dove arriva il pollice, ferme mentre la lista scorre.
 *
 * `pb-safe` non è decorazione: con `viewport-fit: cover` il contenuto arriva
 * sotto la barra dei gesti, e senza quel margine il bottone non si tocca.
 */
export function ActionDock({
  children,
  note,
}: {
  children: React.ReactNode
  note?: string
}) {
  return (
    <div className="bg-card border-border sticky bottom-0 z-10 border-t px-4 pt-3 pb-safe">
      <div className="mx-auto flex max-w-2xl flex-col gap-2">
        {children}
        {note && <p className="text-muted-foreground text-center text-xs">{note}</p>}
      </div>
    </div>
  )
}
