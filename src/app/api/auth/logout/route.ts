import { NextResponse } from 'next/server'
import { requireEnv } from '@/lib/env'
import { closeSessionCookie } from '@/modules/auth'

export async function POST() {
  await closeSessionCookie()
  return NextResponse.redirect(`${requireEnv('APP_URL')}/login`)
}
