import type React from 'react'
import { cn } from '@/lib/utils'

export type BannerVariant = 'ok' | 'warn' | 'error' | 'info'

const CLASSI: Record<BannerVariant, string> = {
  ok: 'bg-ok-soft text-ok-soft-foreground',
  warn: 'bg-warn-soft text-warn-soft-foreground',
  error: 'bg-destructive-soft text-destructive-soft-foreground',
  info: 'bg-muted text-muted-foreground',
}

/** Estratta perché è la decisione, e una decisione si prova. */
export function bannerClasses(variant: BannerVariant): string {
  return CLASSI[variant]
}

/**
 * Un solo riquadro d avviso per tutta l app. Prima ce n erano quattro, stilati a
 * mano in quattro modi diversi: erano tre quinti dei colori letterali del
 * progetto.
 *
 * `role="alert"` solo sull errore: un lettore di schermo che annuncia ogni
 * conferma riuscita interrompe la lettura per niente.
 */
export function Banner({
  variant,
  title,
  children,
  className,
}: {
  variant: BannerVariant
  title?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      role={variant === 'error' ? 'alert' : undefined}
      className={cn('rounded-xl px-4 py-3 text-sm', bannerClasses(variant), className)}
    >
      {title && <p className="mb-1 font-semibold">{title}</p>}
      {children}
    </div>
  )
}
