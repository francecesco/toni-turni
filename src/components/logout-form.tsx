import { LogOutIcon } from 'lucide-react'

/**
 * La voce «Esci» del menu. È un `<form method="post">` e non un link perché la
 * route di logout accetta solo POST, di proposito: un GET si attiverebbe anche
 * da un `<img src>` su una pagina qualsiasi. Vive in un componente a sé per
 * essere provabile con un rendering statico, cosa che il popup del drawer non
 * permette.
 */
export function LogoutForm() {
  return (
    <form action="/api/auth/logout" method="post">
      <button
        type="submit"
        className="hover:bg-muted text-muted-foreground flex h-12 w-full items-center gap-2 rounded-xl px-3 text-base font-medium"
      >
        <LogOutIcon className="size-4" aria-hidden="true" />
        Esci
      </button>
    </form>
  )
}
