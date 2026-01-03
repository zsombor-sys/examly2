import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authServer'
import { getOrCreateProfile, hasAnyEntitlement } from '@/lib/creditsServer'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const profile = await getOrCreateProfile(user.id)
    const ent = hasAnyEntitlement(profile)

    return NextResponse.json({
      user: { id: user.id, email: user.email },
      profile,
      entitlement: ent,
    })
  } catch (e: any) {
    const status = e?.status ?? 500
    return NextResponse.json({ error: e?.message ?? 'Error' }, { status })
  }
}
