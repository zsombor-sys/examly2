import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authServer'
import { getOrCreateProfile } from '@/lib/creditsServer'

export const runtime = 'nodejs'

function isFreeActive(profile: any) {
  if (!profile?.free_expires_at) return false
  const exp = new Date(profile.free_expires_at).getTime()
  return Number.isFinite(exp) && exp > Date.now()
}

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const profile = await getOrCreateProfile(user.id)

    const credits = Number(profile?.credits ?? 0)
    const freeActive = isFreeActive(profile)

    // Entitlement = van Pro kredit VAGY aktív free ablak
    const hasAnyEntitlement = credits > 0 || freeActive

    return NextResponse.json({
      user: { id: user.id, email: user.email },
      profile: {
        credits,
        free_used: !!profile?.free_used,
        free_expires_at: profile?.free_expires_at ?? null,
        full_name: profile?.full_name ?? null,
        phone: profile?.phone ?? null,
      },
      hasAnyEntitlement,
      freeActive,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unauthorized' }, { status: 401 })
  }
}
