import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authServer'
import { activateFree } from '@/lib/creditsServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)

    const body = await req.json().catch(() => ({} as any))
    const fullName = String(body?.fullName ?? '').trim()
    const phone = String(body?.phone ?? '').trim()

    if (fullName.length < 2) {
      return NextResponse.json({ error: 'Full name is required' }, { status: 400 })
    }
    if (phone.length < 6) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
    }

    const profile = await activateFree(user.id, fullName, phone)

    return NextResponse.json(
      { ok: true, profile },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } }
    )
  } catch (e: any) {
    const status = e?.status ?? 500
    const code = e?.code ?? null
    return NextResponse.json(
      { error: e?.message ?? 'Error', code },
      { status, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } }
    )
  }
}
