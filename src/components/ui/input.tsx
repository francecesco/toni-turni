import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/**
 * Alto 44 px per default, non 32: l app è mobile-first, quindi il valore di
 * partenza è quello del pollice. I rari casi fitti da desktop passano una
 * `className` che sovrascrive l'altezza con quella dei controlli desktop di
 * `Button` (`size="default"`).
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // Il riempimento da disabilitato usa --muted, non --input: --input è ora un
        // bordo blu-grigio ben visibile (3:1, WCAG 1.4.11), e usarlo anche come sfondo
        // farebbe risaltare un campo disabilitato più di uno attivo. --muted è la
        // superficie de-enfatizzata giusta per quel caso.
        "h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-muted/60 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
