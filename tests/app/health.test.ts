import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: { $queryRaw: vi.fn() },
}))

const { prisma } = await import('@/lib/db')
const { GET } = await import('@/app/api/health/route')

describe('GET /api/health', () => {
  it('risponde ok quando il database risponde', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ 1: 1 }])

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', database: true })
  })

  it('risponde degraded con codice 503 quando il database non risponde', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error('database chiuso'))

    const response = await GET()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'degraded', database: false })
  })
})
