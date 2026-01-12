import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authServer'
import { clearPlans, listPlans } from '@/app/api/plan/store'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const user = await requireUser(req)
  return NextResponse.json({ items: listPlans(user.id) })
}

export async function DELETE(req: Request) {
  const user = await requireUser(req)
  clearPlans(user.id)
  return NextResponse.json({ ok: true })
}
