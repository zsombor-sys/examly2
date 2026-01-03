import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabaseServer'
import { addProCredits, PRO_CREDITS_PER_PURCHASE } from '@/lib/creditsServer'

export const runtime = 'nodejs'

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
    return NextResponse.json({ error: `Webhook signature verification failed: ${err?.message ?? 'Error'}` }, { status: 400 })
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const userId = (session.metadata?.user_id || '').trim()
      if (!userId) throw new Error('Missing user_id metadata')

      const sb = supabaseAdmin()
      const sessionId = session.id

      // Idempotency: store processed ids.
      const { data: exists, error: existsErr } = await sb
        .from('stripe_events')
        .select('id')
        .eq('event_id', sessionId)
        .maybeSingle()

      if (existsErr) throw existsErr

      if (!exists) {
        await sb.from('stripe_events').insert({ event_id: sessionId, type: event.type })

        // 1) Credit the user
        await addProCredits(userId, PRO_CREDITS_PER_PURCHASE)

        // 2) Save payment method for auto-recharge (best effort)
        const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null
        if (paymentIntentId) {
          const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
          const pmId = typeof pi.payment_method === 'string' ? pi.payment_method : null

          if (pmId) {
            await sb
              .from('profiles')
              .update({ stripe_payment_method_id: pmId, auto_recharge: true })
              .eq('user_id', userId)
          }
        }
      }
    }

    return NextResponse.json({ received: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Webhook handler failed' }, { status: 500 })
  }
}
