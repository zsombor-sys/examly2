import { supabaseAdmin } from '@/lib/supabaseServer'
import Stripe from 'stripe'

export type ProfileRow = {
  id?: string

  user_id: string
  full_name: string | null
  phone: string | null

  credits: number | null

  free_window_start: string | null
  free_expires_at: string | null
  free_used: number | null

  stripe_customer_id: string | null
  stripe_payment_method_id: string | null
  auto_recharge: boolean

  created_at?: string
  updated_at?: string
}

export const PRO_CREDITS_PER_PURCHASE = 30
export const PRO_AMOUNT_HUF = 3500
export const PRO_CURRENCY = 'huf'
export const FREE_MAX = 10
export const FREE_WINDOW_HOURS = 48

function nowIso() {
  return new Date().toISOString()
}

function addHoursISO(hours: number) {
  const d = new Date()
  d.setHours(d.getHours() + hours)
  return d.toISOString()
}

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('Missing STRIPE_SECRET_KEY')
  return new Stripe(key, { apiVersion: '2024-06-20' })
}

/**
 * profiles.id NOT NULL -> insertnél kötelező.
 * Biztonság: ha valahol nem user_id alapján van a rekord, fallback id-ra is.
 */
export async function getOrCreateProfile(userId: string): Promise<ProfileRow> {
  const sb = supabaseAdmin()

  const { data: byUserId, error: selErr1 } = await sb
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (selErr1) throw selErr1
  if (byUserId) {
    // best-effort: NULL mezők javítása
    if ((byUserId as any).credits == null || (byUserId as any).free_used == null) {
      const patch: any = { updated_at: nowIso() }
      if ((byUserId as any).credits == null) patch.credits = 0
      if ((byUserId as any).free_used == null) patch.free_used = 0

      const { data: fixed } = await sb
        .from('profiles')
        .update(patch)
        .eq('user_id', userId)
        .select('*')
        .maybeSingle()

      return (fixed ?? { ...byUserId, ...patch }) as ProfileRow
    }
    return byUserId as ProfileRow
  }

  const { data: byId, error: selErr2 } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (selErr2) throw selErr2
  if (byId) {
    if (!(byId as any).user_id) {
      await sb.from('profiles').update({ user_id: userId, updated_at: nowIso() }).eq('id', userId)
    }
    if ((byId as any).credits == null) {
      await sb.from('profiles').update({ credits: 0, updated_at: nowIso() }).eq('id', userId)
      ;(byId as any).credits = 0
    }
    if ((byId as any).free_used == null) {
      await sb.from('profiles').update({ free_used: 0, updated_at: nowIso() }).eq('id', userId)
      ;(byId as any).free_used = 0
    }
    return byId as ProfileRow
  }

  const row: Partial<ProfileRow> = {
    id: userId,
    user_id: userId,

    credits: 0,
    free_used: 0,
    free_window_start: null,
    free_expires_at: null,

    full_name: null,
    phone: null,

    stripe_customer_id: null,
    stripe_payment_method_id: null,
    auto_recharge: false,
    updated_at: nowIso(),
  }

  const { data: inserted, error: insErr } = await sb.from('profiles').insert(row).select('*').single()
  if (insErr) throw insErr
  return inserted as ProfileRow
}

export function entitlementSnapshot(p: ProfileRow) {
  const freeActive = !!p.free_expires_at && new Date(p.free_expires_at).getTime() > Date.now()
  const freeRemaining = freeActive ? Math.max(0, FREE_MAX - Number(p.free_used ?? 0)) : 0
  const credits = Number(p.credits ?? 0)
  return {
    ok: credits > 0 || freeRemaining > 0,
    credits,
    freeActive,
    freeRemaining,
    freeExpiresAt: p.free_expires_at,
    freeUsed: Number(p.free_used ?? 0),
  }
}

async function markStripeEventOnce(eventId: string, type: string) {
  const sb = supabaseAdmin()
  const { data: exists, error } = await sb.from('stripe_events').select('id').eq('event_id', eventId).maybeSingle()
  if (error) throw error
  if (exists) return false
  await sb.from('stripe_events').insert({ event_id: eventId, type })
  return true
}

/**
 * Best-effort auto-recharge.
 */
export async function maybeAutoRecharge(userId: string) {
  const sb = supabaseAdmin()
  const p = await getOrCreateProfile(userId)

  if (!p.auto_recharge) return { attempted: false, succeeded: false }
  if (!p.stripe_customer_id || !p.stripe_payment_method_id) return { attempted: false, succeeded: false }

  const stripe = stripeClient()
  const bucket = Math.floor(Date.now() / 60000)
  const idempotencyKey = `examly_autorecharge_${userId}_${bucket}`

  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: PRO_AMOUNT_HUF,
        currency: PRO_CURRENCY,
        customer: p.stripe_customer_id,
        payment_method: p.stripe_payment_method_id,
        off_session: true,
        confirm: true,
        description: 'Examly Pro top-up (30 generations)',
        metadata: { user_id: userId, product: 'examly_pro_30_credits_autorecharge' },
      },
      { idempotencyKey }
    )

    if (pi.status !== 'succeeded') return { attempted: true, succeeded: false, status: pi.status }

    const shouldCredit = await markStripeEventOnce(pi.id, 'auto_recharge_payment_intent')
    if (shouldCredit) {
      const next = Number(p.credits ?? 0) + PRO_CREDITS_PER_PURCHASE
      await sb.from('profiles').update({ credits: next, updated_at: nowIso() }).eq('user_id', userId)
      await sb.from('profiles').update({ credits: next, updated_at: nowIso() }).eq('id', userId)
    }

    return { attempted: true, succeeded: true }
  } catch (e: any) {
    return { attempted: true, succeeded: false, error: e?.code ?? e?.message }
  }
}

async function updateProfileByUserOrId(userId: string, patch: Record<string, any>): Promise<ProfileRow | null> {
  const sb = supabaseAdmin()

  // user_id
  {
    const { data, error } = await sb.from('profiles').update(patch).eq('user_id', userId).select('*').maybeSingle()
    if (!error && data) return data as any
  }

  // id
  {
    const { data, error } = await sb.from('profiles').update(patch).eq('id', userId).select('*').maybeSingle()
    if (!error && data) return data as any
  }

  return null
}

/**
 * ✅ STABLE consume: nincs optimistic compare, nincs RPC.
 * Ez NEM dob 409-et "Please try again"-ből.
 */
export async function consumeGeneration(userId: string) {
  const p = await getOrCreateProfile(userId)
  const ent = entitlementSnapshot(p)

  if (!ent.ok) {
    const recharge = await maybeAutoRecharge(userId)
    if (recharge.succeeded) {
      const p2 = await getOrCreateProfile(userId)
      const ent2 = entitlementSnapshot(p2)
      if (ent2.credits > 0) {
        const updated = await updateProfileByUserOrId(userId, { credits: ent2.credits - 1, updated_at: nowIso() })
        if (updated) return { mode: 'pro', profile: updated }
      }
    }

    const err: any = new Error('No credits left')
    err.status = 402
    err.code = 'NO_CREDITS'
    throw err
  }

  // Pro credits
  if (ent.credits > 0) {
    const updated = await updateProfileByUserOrId(userId, { credits: ent.credits - 1, updated_at: nowIso() })
    if (updated) return { mode: 'pro', profile: updated }

    const err: any = new Error('Profile update failed (credits)')
    err.status = 500
    err.code = 'PROFILE_UPDATE_FAILED'
    throw err
  }

  // Free
  const cur = Number(p.free_used ?? 0)
  const updated = await updateProfileByUserOrId(userId, { free_used: cur + 1, updated_at: nowIso() })
  if (updated) return { mode: 'free', profile: updated }

  const err: any = new Error('Profile update failed (free_used)')
  err.status = 500
  err.code = 'PROFILE_UPDATE_FAILED'
  throw err
}

/**
 * FREE: 48 óra, egyszer.
 */
export async function activateFree(userId: string, fullName: string, phone: string) {
  const sb = supabaseAdmin()
  const p = await getOrCreateProfile(userId)

  if (p.free_expires_at && new Date(p.free_expires_at).getTime() > Date.now()) return p

  if (p.free_window_start) {
    const err: any = new Error('Free plan already used')
    err.status = 403
    err.code = 'FREE_ALREADY_USED'
    throw err
  }

  const patch = {
    full_name: fullName,
    phone,
    free_window_start: nowIso(),
    free_expires_at: addHoursISO(FREE_WINDOW_HOURS),
    free_used: 0,
    credits: Number(p.credits ?? 0),
    updated_at: nowIso(),
  }

  let out: any = null

  {
    const { data } = await sb.from('profiles').update(patch).eq('user_id', userId).select('*').maybeSingle()
    if (data) out = data
  }

  if (!out) {
    const { data } = await sb.from('profiles').update(patch).eq('id', userId).select('*').maybeSingle()
    if (data) out = data
  }

  if (!out) throw new Error('Failed to activate free (profile not found)')
  return out as ProfileRow
}

export async function addProCredits(userId: string, amount = PRO_CREDITS_PER_PURCHASE) {
  const sb = supabaseAdmin()
  const p = await getOrCreateProfile(userId)
  const next = Number(p.credits ?? 0) + amount

  let out: any = null

  {
    const { data } = await sb
      .from('profiles')
      .update({ credits: next, updated_at: nowIso() })
      .eq('user_id', userId)
      .select('*')
      .maybeSingle()
    if (data) out = data
  }

  if (!out) {
    const { data } = await sb
      .from('profiles')
      .update({ credits: next, updated_at: nowIso() })
      .eq('id', userId)
      .select('*')
      .maybeSingle()
    if (data) out = data
  }

  if (!out) throw new Error('Failed to add credits (profile not found)')
  return out as ProfileRow
}
