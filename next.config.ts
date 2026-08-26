import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Necessario per l immagine Docker: Next copia solo il runtime che serve.
  output: 'standalone',
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

