import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authServer'
import { activateFree } from '@/lib/creditsServer'

export const runtime = 'nodejs'

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

    return NextResponse.json({ ok: true, profile })
  } catch (e: any) {
    const status = e?.status ?? 500
    return NextResponse.json({ error: e?.message ?? 'Error' }, { status })
  }
}
