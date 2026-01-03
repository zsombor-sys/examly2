import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/authServer'
import { activateFree } from '@/lib/creditsServer'

export const runtime = 'nodejs'

const Schema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(40),
  email: z.string().trim().email().optional(),
})

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = await req.json().catch(() => ({}))
    const { fullName, phone } = Schema.parse(body)
    const profile = await activateFree(user.id, fullName, phone)
    return NextResponse.json({ profile })
  } catch (e: any) {
    const status = e?.status ?? 400
    return NextResponse.json({ error: e?.message ?? 'Error' }, { status })
  }
}
