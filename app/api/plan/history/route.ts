import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authServer'
import { clearPlans, listPlans } from '@/app/api/plan/store'
import { supabaseAdmin } from '@/lib/supabaseServer'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const user = await requireUser(req)
  return NextResponse.json({ items: listPlans(user.id) })
}

export async function DELETE(req: Request) {
  const user = await requireUser(req)
  clearPlans(user.id)

  // best-effort clear current plan in Supabase (ignore errors)
  try {
    const sb = supabaseAdmin()
    await sb.from('plan_current').delete().eq('user_id', user.id)
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true })
}
