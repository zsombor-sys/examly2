import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabaseServer'

export const runtime = 'nodejs'

const CREDITS_PER_PURCHASE = 30

async function creditUserOnce(sb: ReturnType<typeof supabaseAdmin>, userId: string, amount: number) {
  // Read current credits then update. (Simple + robust.)
  const { data: p1 } = await sb.from('profiles').select('credits').eq('user_id', userId).maybeSingle()
  const { data: p2 } = p1 ? { data: null } : await sb.from('profiles').select('credits').eq('id', userId).maybeSingle()

  const current = Number((p1?.credits ?? p2?.credits) ?? 0)
  const next = current + amount

  const r1 = await sb.from('profiles').update({ credits: next }).eq('user_id', userId)
  if (r1.error) {
    await sb.from('profiles').update({ credits: next }).eq('id', userId)
  }
}

export async function POST(req: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripeKey || !webhookSecret) {
    return NextResponse.json({ error: 'Stripe webhook is not configured.' }, { status: 500 })
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' })

  const sig = req.headers.get('stripe-signature')
  if (!sig) return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 })

  const rawBody = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
  } catch (err: any) {
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${err?.message ?? 'Error'}` },
      { status: 400 }
    )
  }

  const sb = supabaseAdmin()

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session

      // only paid sessions
      if (session.payment_status !== 'paid') {
        return NextResponse.json({ received: true })
      }

      const userId = (session.metadata?.user_id || '').trim()
      if (!userId) throw new Error('Missing metadata.user_id')

      // ✅ Idempotency by event.id (Stripe retries delivery)
      const eventId = event.id

      // If stripe_events table exists, use it. If not, still credit (best effort).
      let already = false
      try {
        const { data: exists, error } = await sb.from('stripe_events').select('id').eq('event_id', eventId).maybeSingle()
        if (error) throw error
        already = !!exists

        if (!already) {
          const ins = await sb.from('stripe_events').insert({ event_id: eventId, type: event.type })
          if (ins.error) throw ins.error
        }
      } catch {
        // If stripe_events doesn't exist yet, we don't hard fail.
        already = false
      }

      if (!already) {
        // 1) Credit the user (+30)
        await creditUserOnce(sb, userId, CREDITS_PER_PURCHASE)

        // 2) Save payment method for auto-recharge (best effort)
        try {
          const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null
          if (paymentIntentId) {
            const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
            const pmId = typeof pi.payment_method === 'string' ? pi.payment_method : null

            if (pmId) {
              const upd = { stripe_payment_method_id: pmId, auto_recharge: true }

              const r1 = await sb.from('profiles').update(upd).eq('user_id', userId)
              if (r1.error) {
                await sb.from('profiles').update(upd).eq('id', userId)
              }
            }
          }
        } catch {
          // ignore; credits already granted
        }
      }
    }

    return NextResponse.json({ received: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Webhook handler failed' }, { status: 500 })
  }
}
