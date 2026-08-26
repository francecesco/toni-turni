import { prisma } from '@/lib/db'
import type { ShiftCodeDef, ShiftKind } from './types'

type Row = {
  code: string
  label: string
  kind: string
  startTime: string | null
  endTime: string | null
  crossesMidnight: boolean
  location: string | null
  color: string | null
  needsReview: boolean
}

const KINDS: ShiftKind[] = ['work', 'absence', 'info', 'unknown']

function toDef(row: Row): ShiftCodeDef {
  const kind = KINDS.includes(row.kind as ShiftKind) ? (row.kind as ShiftKind) : 'unknown'
  return {
    code: row.code,
    label: row.label,
    kind,
    startTime: row.startTime,
    endTime: row.endTime,
    crossesMidnight: row.crossesMidnight,
    location: row.location,
    color: row.color,
    needsReview: row.needsReview,
  }
}

export async function listShiftCodes(): Promise<ShiftCodeDef[]> {
  const rows = await prisma.shiftCode.findMany({ orderBy: { code: 'asc' } })
  return rows.map(toDef)
}

export async function upsertShiftCode(def: ShiftCodeDef): Promise<ShiftCodeDef> {
  const data = {
    label: def.label,
    kind: def.kind,
    startTime: def.startTime,
    endTime: def.endTime,
    crossesMidnight: def.crossesMidnight,
    location: def.location,
    color: def.color,
    needsReview: def.needsReview,
  }
  const row = await prisma.shiftCode.upsert({
    where: { code: def.code },
    create: { code: def.code, ...data },
    update: data,
  })
  return toDef(row)
}

export async function deleteShiftCode(code: string): Promise<void> {
  await prisma.shiftCode.delete({ where: { code } })
}
