import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authServer'
import { supabaseAdmin } from '@/lib/supabaseServer'

export const runtime = 'nodejs'

/**
 * GET  /api/plan/current  -> { id: string|null }
 * POST /api/plan/current  body: { id: string|null } -> { ok: true }
 *
 * If Supabase table doesn't exist, returns ok but id=null (client uses localStorage fallback).
 */

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const sb = supabaseAdmin()

    const { data, error } = await sb
      .from('plan_current')
      .select('plan_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) {
      // Table missing / permissions etc -> fallback mode
      return NextResponse.json({ id: null, fallback: true })
    }

    return NextResponse.json({ id: data?.plan_id ?? null })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: e?.status ?? 400 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = await req.json().catch(() => ({} as any))
    const id = body?.id ? String(body.id) : null

    const sb = supabaseAdmin()

    // If table doesn't exist, swallow errors so client fallback can still work.
    const { error } = await sb.from('plan_current').upsert(
      {
        user_id: user.id,
        plan_id: id ?? '',
      },
      { onConflict: 'user_id' }
    )

    if (error) {
      return NextResponse.json({ ok: true, fallback: true })
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Server error' }, { status: e?.status ?? 400 })
  }
}
