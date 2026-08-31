'use client'

import { Drawer } from '@base-ui/react/drawer'
import { EllipsisIcon } from 'lucide-react'
import Link from 'next/link'
import type { MenuItem } from '@/modules/auth'

/**
 * Il menu della referente, come foglio dal basso e non come tendina: su un
 * telefono il basso è dove arriva il pollice. Base UI dà chiusura con Esc, clic
 * fuori e trappola del focus senza scriverli.
 *
 * Con l elenco vuoto **non disegna niente**, nemmeno il bottone: chi non è
 * referente non deve vedere un ⋯ che apre un foglio vuoto.
 */
export function AppMenu({ items }: { items: MenuItem[] }) {
  if (items.length === 0) return null

  return (
    <Drawer.Root>
      <Drawer.Trigger
        aria-label="Altro"
        className="text-muted-foreground bg-muted flex size-11 items-center justify-center rounded-full"
      >
        <EllipsisIcon className="size-5" />
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 bg-overlay" />
        <Drawer.Popup className="bg-card fixed inset-x-0 bottom-0 z-50 rounded-t-3xl px-4 pt-3 pb-safe">
          <div className="bg-border mx-auto mb-4 h-1 w-10 rounded-full" />
          <nav className="flex flex-col gap-1">
            {items.map((voce) => (
              <Drawer.Close
                key={voce.href}
                render={<Link href={voce.href} />}
                className="hover:bg-muted flex h-12 items-center rounded-xl px-3 text-base font-medium"
              >
                {voce.label}
              </Drawer.Close>
            ))}
          </nav>
        </Drawer.Popup>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
