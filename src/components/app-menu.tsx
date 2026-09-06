'use client'

import { Drawer } from '@base-ui/react/drawer'
import { EllipsisIcon } from 'lucide-react'
import Link from 'next/link'
import { LogoutForm } from '@/components/logout-form'
import type { MenuItem } from '@/modules/auth'

/**
 * Il menu della referente, come foglio dal basso e non come tendina: su un
 * telefono il basso è dove arriva il pollice. Base UI dà chiusura con Esc, clic
 * fuori e trappola del focus senza scriverli.
 *
 * È anche il menu dell **account**: in fondo c è sempre «Esci», per tutti. Per
 * questo si disegna anche con l elenco vuoto — chi non è referente vede un foglio
 * con la sola uscita, e prima non aveva nessun modo di uscire.
 */
export function AppMenu({ items }: { items: MenuItem[] }) {
  return (
    <Drawer.Root>
      <Drawer.Trigger
        aria-label="Altro"
        className="text-muted-foreground bg-muted flex size-11 items-center justify-center rounded-full"
      >
        <EllipsisIcon className="size-5" />
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 z-50 bg-overlay" />
        <Drawer.Viewport className="fixed inset-0 z-50 flex items-end justify-center">
          <Drawer.Popup className="bg-card w-full rounded-t-3xl px-4 pt-3 pb-safe">
            <div className="bg-border mx-auto mb-4 h-1 w-10 rounded-full" />
            <Drawer.Title className="sr-only">Altro</Drawer.Title>
            <nav className="flex flex-col gap-1">
              {items.map((voce) => (
                <Drawer.Close
                  key={voce.href}
                  render={<Link href={voce.href} />}
                  nativeButton={false}
                  className="hover:bg-muted flex h-12 items-center rounded-xl px-3 text-base font-medium"
                >
                  {voce.label}
                </Drawer.Close>
              ))}
              {items.length > 0 ? <div className="bg-border my-1 h-px" role="separator" /> : null}
              <LogoutForm />
            </nav>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
