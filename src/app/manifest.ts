import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Turni',
    short_name: 'Turni',
    description: 'I tuoi turni, dalla tabella del reparto al calendario.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'it',
    // Uguali a `--background` chiaro: la barra di stato si fonde col fondo
    // invece di disegnare una riga in cima allo schermo.
    background_color: '#F2F6F9',
    theme_color: '#F2F6F9',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
