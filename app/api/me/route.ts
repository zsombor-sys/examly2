import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authServer'
import { supabaseAdmin } from '@/lib/supabaseServer'
import { getOrCreateProfile } from '@/lib/creditsServer'

export const runtime = 'nodejs'

function isFreeActive(p: any) {
  const candidates = [
    p?.free_window_end,
    p?.free_expires_at,
  ].filter(Boolean)

  for (const v of candidates) {
    const t = new Date(v).getTime()
    if (Number.isFinite(t) && t > Date.now()) return true
  }
  return false
}

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const sb = supabaseAdmin()

    // ensure profile exists (also fixes null-id creation issues)
    let profile = await getOrCreateProfile(user.id)

    // reload profile robustly (in case triggers updated)
    const { data: p1 } = await sb.from('profiles').select('*').eq('user_id', user.id).maybeSingle()
    if (p1) profile = p1 as any
    else {
      const { data: p2 } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle()
      if (p2) profile = p2 as any
    }

    const credits = Number(profile?.credits ?? 0)
    const freeActive = isFreeActive(profile)

    // if freeActive but credits 0, that is still entitlement ok (free uses free_used internally)
    const entitlementOk = credits > 0 || freeActive

    return NextResponse.json({
      user: { id: user.id, email: user.email },
      profile,
      entitlement: {
        ok: entitlementOk,
        credits,
        freeActive,
        freeUsed: Number(profile?.free_used ?? 0),
        freeExpiresAt: profile?.free_window_end ?? profile?.free_expires_at ?? null,
      },
    })
  } catch (e: any) {
    const status = e?.status ?? 500
    return NextResponse.json({ error: e?.message ?? 'Error' }, { status })
  }
}
