import { supabaseAdmin } from '@/lib/supabaseServer'
import Stripe from 'stripe'

export type ProfileRow = {
  user_id: string
  full_name: string | null
  phone: string | null
  credits: number
  free_window_start: string | null
  free_expires_at: string | null
  free_used: number
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

export async function getOrCreateProfile(userId: string): Promise<ProfileRow> {
  const sb = supabaseAdmin()

  const { data: existing, error: selErr } = await sb
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (selErr) throw selErr
  if (existing) return existing as ProfileRow

  const row: Partial<ProfileRow> = {
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
 * Best-effort auto-recharge:
 * If user has auto_recharge enabled + saved payment method, we try an off-session payment.
 * Note: Some cards/banks require customer action (SCA). In that case we can't fully automate.
 */
export async function maybeAutoRecharge(userId: string) {
  const sb = supabaseAdmin()
  const p = await getOrCreateProfile(userId)

  if (!p.auto_recharge) return { attempted: false, succeeded: false }
  if (!p.stripe_customer_id || !p.stripe_payment_method_id) return { attempted: false, succeeded: false }

  const stripe = stripeClient()

  // Idempotency key: userId + minute bucket. Prevent double-charging on rapid parallel calls.
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

    if (pi.status !== 'succeeded') {
      return { attempted: true, succeeded: false, status: pi.status }
    }

    // Extra idempotency: store PI id so webhook + recharge never double-add credits.
    const shouldCredit = await markStripeEventOnce(pi.id, 'auto_recharge_payment_intent')
    if (shouldCredit) {
      const next = Number(p.credits ?? 0) + PRO_CREDITS_PER_PURCHASE
      await sb.from('profiles').update({ credits: next, updated_at: nowIso() }).eq('user_id', userId)
    }

    return { attempted: true, succeeded: true }
  } catch (e: any) {
    // Stripe error like authentication_required can happen with SCA.
    return { attempted: true, succeeded: false, error: e?.code ?? e?.message }
  }
}

/**
 * Consume 1 generation.
 * Priority: paid credits -> free window.
 *
 * If no credits and no free, we attempt auto-recharge (best effort), then retry.
 */
export async function consumeGeneration(userId: string) {
  const sb = supabaseAdmin()

  // Fast path: try RPC if present.
  const { data: rpcData, error: rpcErr } = await sb.rpc('consume_generation', { p_user_id: userId }).maybeSingle()
  if (!rpcErr && rpcData) return rpcData as any

  // If RPC failed due to NO_CREDITS, try auto-recharge then retry RPC once.
  if (rpcErr && String(rpcErr.message || '').includes('NO_CREDITS')) {
    const r = await maybeAutoRecharge(userId)
    if (r.succeeded) {
      const { data: again, error: againErr } = await sb.rpc('consume_generation', { p_user_id: userId }).maybeSingle()
      if (!againErr && again) return again as any
    }
  }

  // Fallback: optimistic concurrency a few times.
  for (let attempt = 0; attempt < 3; attempt++) {
    const p = await getOrCreateProfile(userId)
    const ent = entitlementSnapshot(p)

    if (!ent.ok) {
      const recharge = await maybeAutoRecharge(userId)
      if (recharge.succeeded) {
        // retry this attempt after recharge
        continue
      }

      const err: any = new Error('No credits left')
      err.status = 402
      err.code = 'NO_CREDITS'
      err.autoRechargeAttempted = recharge.attempted
      err.autoRechargeSucceeded = recharge.succeeded
      err.autoRechargeError = (recharge as any).error
      throw err
    }

    if (ent.credits > 0) {
      const { data, error } = await sb
        .from('profiles')
        .update({ credits: ent.credits - 1, updated_at: nowIso() })
        .eq('user_id', userId)
        .eq('credits', ent.credits)
        .select('*')
        .maybeSingle()

      if (!error && data) return { mode: 'pro', profile: data }
    } else if (ent.freeRemaining > 0) {
      const cur = Number(p.free_used ?? 0)
      const { data, error } = await sb
        .from('profiles')
        .update({ free_used: cur + 1, updated_at: nowIso() })
        .eq('user_id', userId)
        .eq('free_used', cur)
        .select('*')
        .maybeSingle()

      if (!error && data) return { mode: 'free', profile: data }
    }
  }

  const err: any = new Error('Please try again')
  err.status = 409
  throw err
}

export async function activateFree(userId: string, fullName: string, phone: string) {
  const sb = supabaseAdmin()
  const p = await getOrCreateProfile(userId)

  // If currently active, keep it.
  if (p.free_expires_at && new Date(p.free_expires_at).getTime() > Date.now()) return p

  // FREE is only once per account. If the window already started before (even if expired), block.
  if (p.free_window_start) {
    const err: any = new Error('Free plan already used')
    err.status = 403
    err.code = 'FREE_ALREADY_USED'
    throw err
  }

  const { data, error } = await sb
    .from('profiles')
    .update({
      full_name: fullName,
      phone,
      free_window_start: nowIso(),
      free_expires_at: addHoursISO(FREE_WINDOW_HOURS),
      free_used: 0,
      updated_at: nowIso(),
    })
    .eq('user_id', userId)
    .select('*')
    .single()

  if (error) throw error
  return data as ProfileRow
}

export async function addProCredits(userId: string, amount = PRO_CREDITS_PER_PURCHASE) {
  const sb = supabaseAdmin()
  const p = await getOrCreateProfile(userId)
  const next = Number(p.credits ?? 0) + amount

  const { data, error } = await sb
    .from('profiles')
    .update({ credits: next, updated_at: nowIso() })
    .eq('user_id', userId)
    .select('*')
    .single()

  if (error) throw error
  return data as ProfileRow
}
