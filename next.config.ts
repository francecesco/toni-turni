import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Necessario per l immagine Docker: Next copia solo il runtime che serve.
  output: 'standalone',
}

export default nextConfig

