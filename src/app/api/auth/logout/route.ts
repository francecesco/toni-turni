import { NextResponse } from 'next/server'
import { requireEnv } from '@/lib/env'
import { closeSessionCookie } from '@/modules/auth'

export async function POST() {
  await closeSessionCookie()
  // 303 (invece del 307 di default) fa sì che il browser esegua un GET su /login
  // invece di ripetere il POST del logout.
  return NextResponse.redirect(`${requireEnv('APP_URL')}/login`, { status: 303 })
}
