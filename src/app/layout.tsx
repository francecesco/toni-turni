import type { Metadata, Viewport } from 'next'
import { Figtree } from 'next/font/google'
import './globals.css'

const figtree = Figtree({
  variable: '--font-figtree',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Turni',
  description: 'I tuoi turni, dalla tabella del reparto al calendario.',
  applicationName: 'Turni',
  // Senza questo iOS apre il collegamento in Safari invece che a schermo intero.
  appleWebApp: { capable: true, title: 'Turni', statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Il contenuto arriva sotto il notch: da qui in poi le safe-area sono
  // obbligatorie, o il bottone in fondo finisce sotto la barra dei gesti.
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F2F6F9' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1620' },
  ],
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="it" className={`${figtree.variable} h-full antialiased`}>
      <body className="bg-background text-foreground flex min-h-full flex-col">{children}</body>
    </html>
  )
}
