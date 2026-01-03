import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authServer'
import { supabaseAdmin } from '@/lib/supabaseServer'
import { getOrCreateProfile } from '@/lib/creditsServer'

export const runtime = 'nodejs'

function pickFreeExpiry(p: any): string | null {
  // támogat többféle oszlopnevet, mert nálad kavart a séma
  const v =
    p?.free_window_end ??
    p?.free_expires_at ??
    p?.free_window_start_end ?? // just in case, harmless
    null

  return v ? String(v) : null
}

function isFreeActive(p: any): boolean {
  const exp = pickFreeExpiry(p)
  if (!exp) return false
  const t = new Date(exp).getTime()
  return Number.isFinite(t) && t > Date.now()
}

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const sb = supabaseAdmin()

    // Ensure profile exists (prevents null id insert issues)
    let profile = await getOrCreateProfile(user.id)

    // Reload robustly (user_id first, then id fallback)
    const { data: p1, error: e1 } = await sb
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    if (e1) throw e1

    if (p1) {
      profile = p1 as any
    } else {
      const { data: p2, error: e2 } = await sb
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

      if (e2) throw e2
      if (p2) profile = p2 as any
    }

    const p: any = profile

    const credits = Number(p?.credits ?? 0)
    const freeActive = isFreeActive(p)
    const entitlementOk = credits > 0 || freeActive

    return NextResponse.json({
      user: { id: user.id, email: user.email },
      profile,
      entitlement: {
        ok: entitlementOk,
        credits,
        freeActive,
        freeUsed: Number(p?.free_used ?? 0),
        freeExpiresAt: pickFreeExpiry(p),
      },
    })
  } catch (e: any) {
    const status = e?.status ?? 500
    return NextResponse.json({ error: e?.message ?? 'Error' }, { status })
  }
}
