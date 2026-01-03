'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    supabase?.auth.getSession().then(({ data }) => {
      const e = data.session?.user?.email ?? ''
      setEmail(e)
    })
  }, [])

  async function refreshMe(): Promise<MeResponse | null> {
    try {
      const res = await authedFetch('/api/me', { method: 'GET' })
      if (!res.ok) return null
      return (await res.json()) as MeResponse
    } catch {
      return null
    }
  }

  async function waitForEntitlement(maxTries = 6): Promise<boolean> {
    // small backoff: 0ms, 250ms, 500ms, 750ms, 1000ms...
    for (let i = 0; i < maxTries; i++) {
      const me = await refreshMe()
      const ent = (me as any)?.entitlement
      if (ent?.ok) return true
      await sleep(250 + i * 250)
    }
    return false
  }

  async function activateFree() {
    setMsg(null)
    setLoading(true)
    try {
      const res = await authedFetch('/api/free/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, fullName, phone }),
      })
      const json = await res.json().catch(() => ({} as any))
      if (!res.ok) throw new Error(json?.error ?? 'Error')

      // ✅ IMPORTANT: wait until the server actually sees the new entitlement
      const ok = await waitForEntitlement()
      if (!ok) {
        throw new Error('Free trial activated, but entitlement did not refresh yet. Please refresh the page.')
      }

      router.replace('/plan')
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
        Examly works with credits. If you do not have credits and you have not used the free trial yet, pick one option below.
      </p>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {/* PRO FIRST */}
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
        <Card className="opacity-[0.85]">
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
            disabled={loading || fullName.trim().length < 2 || phone.trim().length < 6}
          >
            {loading ? 'Activating...' : 'Activate free trial'} <ArrowRight size={16} />
          </Button>

          <p className="mt-3 text-xs text-white/55">
            After 48 hours the free trial expires permanently for this account, and you will need Pro to continue.
          </p>
        </Card>
      </div>
    </div>
  )
}
