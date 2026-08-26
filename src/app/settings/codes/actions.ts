'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  compactCode,
  deleteShiftCode,
  listShiftCodes,
  parseShiftCodeForm,
  upsertShiftCode,
} from '@/modules/codes'
import { requireReferente } from '@/modules/auth'

function text(form: FormData, field: string): string {
  const value = form.get(field)
  return typeof value === 'string' ? value.trim() : ''
}

function failWith(message: string): never {
  redirect(`/settings/codes?error=${encodeURIComponent(message)}`)
}

export async function saveShiftCode(form: FormData): Promise<{ errors: string[] }> {
  await requireReferente()

  const parsed = parseShiftCodeForm(form)
  if (!parsed.ok) failWith(parsed.errors.join('; '))

  // Due codici la cui forma compatta coincide (es. "M" e "m1°p" vs "M1°P") sono
  // indistinguibili per matchCode: senza questo controllo la seconda riga salvata
  // rende la prima permanentemente irraggiungibile.
  const existing = await listShiftCodes()
  const collision = existing.find(
    (def) => def.code !== parsed.value.code && compactCode(def.code) === compactCode(parsed.value.code),
  )
  if (collision) {
    failWith(`Il codice equivale già a "${collision.code}": usa lo stesso codice per modificarlo`)
  }

  await upsertShiftCode(parsed.value)
  revalidatePath('/settings/codes')
  return { errors: [] }
}

export async function removeShiftCode(form: FormData): Promise<void> {
  await requireReferente()
  const code = text(form, 'code')
  if (code === '') return

  try {
    await deleteShiftCode(code)
  } catch (error) {
    // P2025: la riga non esiste più (es. due schede aperte, doppio clic su Elimina).
    // Non è un errore per chi usa l app: la lista viene semplicemente ricaricata.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')) {
      throw error
    }
  }
  revalidatePath('/settings/codes')
}
