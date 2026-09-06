import type { NextConfig } from 'next'
import { devOriginsFrom } from './src/lib/dev-origins'

const nextConfig: NextConfig = {
  // Necessario per l immagine Docker: Next copia solo il runtime che serve.
  output: 'standalone',
  // Dal telefono in rete locale i chunk arriverebbero 403: vedi `src/lib/dev-origins.ts`.
  allowedDevOrigins: devOriginsFrom(process.env.APP_URL),
  async headers() {
    // Solo header a costo zero: niente CSP con script-src, romperebbe Next senza nonce.
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ]
  },
}

export default nextConfig

