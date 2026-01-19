import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authServer'
import { supabaseAdmin } from '@/lib/supabaseServer'
import { entitlementSnapshot, getOrCreateProfile } from '@/lib/creditsServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const sb = supabaseAdmin()

    // Ensure profile exists
    let profile = await getOrCreateProfile(user.id)

    // Reload robustly (user_id first, then id fallback)
    const { data: p1, error: e1 } = await sb.from('profiles').select('*').eq('user_id', user.id).maybeSingle()
    if (e1) throw e1

    if (p1) profile = p1 as any
    else {
      const { data: p2, error: e2 } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle()
      if (e2) throw e2
      if (p2) profile = p2 as any
    }

    const ent = entitlementSnapshot(profile as any)

    return NextResponse.json(
      {
        user: { id: user.id, email: user.email },
        profile,
        entitlement: {
          ok: !!ent.ok,
          credits: Number(ent.credits ?? 0),
          freeActive: !!ent.freeActive,
          freeRemaining: Number(ent.freeRemaining ?? 0),
          freeUsed: Number(ent.freeUsed ?? 0),
          freeExpiresAt: ent.freeExpiresAt ?? null,
          freeWindowStart: (profile as any)?.free_window_start ?? null,
        },
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      }
    )
  } catch (e: any) {
    const status = e?.status ?? 500
    return NextResponse.json(
      { error: e?.message ?? 'Error' },
      {
        status,
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
      }
    )
  }
}
