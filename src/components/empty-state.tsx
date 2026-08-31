import Link from 'next/link'
import type React from 'react'
import { Button } from '@/components/ui/button'

/** Uno stato vuoto dice cosa manca **e** cosa si può fare, o non serve a niente. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children?: React.ReactNode
  action?: { href: string; label: string }
}) {
  return (
    <div className="bg-card border-border mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border px-6 py-10 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="text-muted-foreground text-sm">{children}</div>}
      {action && (
        <Button size="touch" render={<Link href={action.href} />} className="mt-2 w-full">
          {action.label}
        </Button>
      )}
    </div>
  )
}
