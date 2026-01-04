import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { requireUser } from '@/lib/authServer'
import { getOrCreateProfile } from '@/lib/creditsServer'
import { supabaseAdmin } from '@/lib/supabaseServer'

export const runtime = 'nodejs'

function baseUrl(req: Request) {
  const env = process.env.NEXT_PUBLIC_SITE_URL
  if (env) return env.replace(/\/$/, '')
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  return `${proto}://${host}`
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)

    const stripeKey = process.env.STRIPE_SECRET_KEY
    const priceId = process.env.STRIPE_PRICE_ID_PRO
    if (!stripeKey || !priceId) {
      return NextResponse.json(
        { error: 'Stripe is not configured (missing STRIPE_SECRET_KEY / STRIPE_PRICE_ID_PRO).' },
        { status: 500 }
      )
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' })
    const profile = await getOrCreateProfile(user.id)

    // Create / reuse Stripe customer.
    let customerId = profile.stripe_customer_id as string | null

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { supabase_user_id: user.id },
      })
      customerId = customer.id

      // robust update: try user_id, fallback to id
      const sb = supabaseAdmin()
      const upd = { stripe_customer_id: customerId }

      const r1 = await sb.from('profiles').update(upd).eq('user_id', user.id)
      if (r1.error) {
        await sb.from('profiles').update(upd).eq('id', user.id)
      }
    }

    const url = baseUrl(req)

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: false,

      // 🚩 Do NOT rely on line_items in webhook. Use metadata.
      metadata: {
        user_id: user.id,
        price_id: priceId,
        plan: 'pro_30',
      },

      payment_intent_data: { setup_future_usage: 'off_session' },

      success_url: `${url}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${url}/billing?canceled=1`,
    })

    return NextResponse.json({ url: session.url })
  } catch (e: any) {
    const status = e?.status ?? 500
    return NextResponse.json({ error: e?.message ?? 'Error' }, { status })
  }
}
