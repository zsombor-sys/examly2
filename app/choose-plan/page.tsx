'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AuthGate from '@/components/AuthGate'
import { supabase } from '@/lib/supabaseClient'
import { authedFetch } from '@/lib/authClient'
import { Button, Card, Input } from '@/components/ui'
import { ArrowRight, ShieldCheck, Zap } from 'lucide-react'

type MeResponse = {
  user?: { id: string; email?: string }
  profile?: any
  entitlement?: {
    ok: boolean
    credits: number
    freeActive: boolean
    freeRemaining: number
    freeExpiresAt?: string | null
    freeUsed?: number
    freeWindowStart?: string | null
  }
}

export default function ChoosePlanPage() {
  return (
    <AuthGate requireEntitlement={false}>
      <Inner />
    </AuthGate>
  )
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function Inner() {
  const router = useRouter()
  const sp = useSearchParams()
  const nextUrl = useMemo(() => sp.get('next') || '/plan', [sp])

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const [freeLocked, setFreeLocked] = useState(false) // free already used + expired

  async function refreshMe(): Promise<MeResponse | null> {
    try {
      const res = await authedFetch('/api/me', {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-store' },
      })
      if (!res.ok) return null
      return (await res.json()) as MeResponse
    } catch {
      return null
    }
  }

  useEffect(() => {
    let alive = true

    ;(async () => {
      // email prefill
      try {
        const sess = await supabase?.auth.getSession()
        const e = sess?.data?.session?.user?.email ?? ''
        if (alive) setEmail(e)
      } catch {}

      const me = await refreshMe()
      if (!alive) return

      if (me?.entitlement?.ok) {
        router.replace(nextUrl)
        return
      }

      const freeWindowStart =
        (me?.entitlement as any)?.freeWindowStart ?? (me?.profile as any)?.free_window_start ?? null
      const freeActive = !!me?.entitlement?.freeActive

      // If they already used free and it's not active anymore -> lock free
      if (freeWindowStart && !freeActive) {
        setFreeLocked(true)
        setMsg('This account already used the free trial. Please choose Pro to continue.')
      } else {
        setFreeLocked(false)
        setMsg(null)
      }
    })()

    return () => {
      alive = false
    }
  }, [router, nextUrl])

  async function waitForEntitlement(maxTries = 10): Promise<boolean> {
    for (let i = 0; i < maxTries; i++) {
      const me = await refreshMe()
      if (me?.entitlement?.ok) return true
      await sleep(250 + i * 250)
    }
    return false
  }

  async function activateFree() {
    if (freeLocked) return

    setMsg(null)
    setLoading(true)
    try {
      const res = await authedFetch('/api/free/activate', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ email, fullName, phone }),
      })

      const json = await res.json().catch(() => ({} as any))

      if (!res.ok) {
        const errMsg = String(json?.error ?? 'Error')
        const code = String(json?.code ?? '')

        // if already used -> lock UI (no infinite loop)
        if (res.status === 403 && (code === 'FREE_ALREADY_USED' || /already used/i.test(errMsg))) {
          setFreeLocked(true)
          setMsg('This account already used the free trial. Please choose Pro to continue.')
          return
        }

        throw new Error(errMsg)
      }

      const ok = await waitForEntitlement()
      if (!ok) throw new Error('Free trial activated, but entitlement did not refresh yet. Please refresh the page.')

      router.replace(nextUrl)
    } catch (e: any) {
      setMsg(e?.message ?? 'Error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <div className="text-xs uppercase tracking-[0.18em] text-white/55">One last step</div>
      <h1 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight">Choose your plan</h1>
      <p className="mt-3 text-white/70 max-w-[70ch]">
        Examly works with credits. If you do not have credits and you have not used the free trial yet, pick one option
        below.
      </p>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {/* PRO */}
        <Card className="relative overflow-hidden">
          <div className="flex items-center gap-2 text-white/90">
            <Zap size={18} />
            <div className="font-semibold">Pro</div>
          </div>
          <div className="mt-2 text-sm text-white/70">30 generations • 3500 Ft (≈ €8.9)</div>

          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-white/70">
            <ul className="list-disc pl-5 space-y-1">
              <li>Use credits on any feature (Plan, Practice, Vocab, Ask, Audio)</li>
              <li>When credits run out, Examly will try to auto-top-up (charge 3500 Ft again) using your saved payment method.</li>
              <li>If your bank requires extra confirmation, we will ask you to complete payment on the Billing page</li>
              <li>Credits are stored server-side (can’t be edited from the browser)</li>
            </ul>
          </div>

          <Button className="mt-6 w-full gap-2" onClick={() => router.push('/billing')}>
            Continue to payment <ArrowRight size={16} />
          </Button>

          {msg && <p className="mt-3 text-sm text-red-400">{msg}</p>}
        </Card>

        {/* FREE */}
        <Card className="opacity-[0.92]">
          <div className="flex items-center gap-2 text-white/80">
            <ShieldCheck size={18} />
            <div className="font-semibold">Free trial</div>
          </div>
          <div className="mt-2 text-sm text-white/60">10 generations • 48 hours • only once</div>

          <div className="mt-6 space-y-3">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" />
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" />
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" />
          </div>

          <Button
            className="mt-6 w-full gap-2"
            variant="ghost"
            onClick={activateFree}
            disabled={freeLocked || loading || fullName.trim().length < 2 || phone.trim().length < 6}
            title={freeLocked ? 'Free trial already used on this account' : undefined}
          >
            {freeLocked ? 'Free trial already used' : loading ? 'Activating...' : 'Activate free trial'}{' '}
            <ArrowRight size={16} />
          </Button>

          <p className="mt-3 text-xs text-white/55">
            After 48 hours the free trial expires permanently for this account, and you will need Pro to continue.
          </p>

          {msg && <p className="mt-3 text-sm text-red-400">{msg}</p>}
        </Card>
      </div>
    </div>
  )
}
