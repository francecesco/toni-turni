'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { deleteShiftCode, parseShiftCodeForm, upsertShiftCode } from '@/modules/codes'
import { requireReferente } from '@/modules/auth'

function text(form: FormData, field: string): string {
  const value = form.get(field)
  return typeof value === 'string' ? value.trim() : ''
}

export async function saveShiftCode(form: FormData): Promise<{ errors: string[] }> {
  await requireReferente()

  const parsed = parseShiftCodeForm(form)
  if (!parsed.ok) return { errors: parsed.errors }

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
