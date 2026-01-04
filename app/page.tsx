'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Button, Card } from '@/components/ui'
import { ArrowRight, Sparkles, ShieldCheck, Zap } from 'lucide-react'

export default function HomePage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        if (!supabase) {
          setChecking(false)
          return
        }
        const { data } = await supabase.auth.getSession()
        const session = data.session
        if (session) {
          // logged in → go to app
          router.replace('/plan')
          return
        }
      } catch {
        // ignore
      } finally {
        setChecking(false)
      }
    })()
  }, [router])

  // While checking session: keep it subtle, not blank
  if (checking) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div className="text-white/70 text-sm">Loading…</div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-14 overflow-x-hidden">
      {/* HERO */}
      <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] items-start">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/70">
            <Sparkles size={14} />
            Structured exam prep from your own material
          </div>

          <h1 className="mt-5 text-4xl md:text-5xl font-semibold tracking-tight min-w-0">
            Build a study plan you can actually follow.
          </h1>

          <p className="mt-4 text-white/70 max-w-[70ch]">
            Upload your PDFs or photos, describe the exam, and Examly creates a plan, notes, flashcards and practice tasks.
            Credits are tracked server-side.
          </p>

          <div className="mt-7 flex flex-col sm:flex-row gap-3">
            <Button className="gap-2" onClick={() => router.push('/login')}>
              Log in <ArrowRight size={16} />
            </Button>
            <Link
              href="/guide"
              className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/80 hover:text-white"
            >
              View guide
            </Link>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 min-w-0">
              <div className="text-sm font-semibold">Plan</div>
              <div className="mt-1 text-sm text-white/65">
                Daily schedule, milestones and focus blocks.
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 min-w-0">
              <div className="text-sm font-semibold">Practice</div>
              <div className="mt-1 text-sm text-white/65">
                Questions + explanations from your material.
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 min-w-0">
              <div className="text-sm font-semibold">Vocab</div>
              <div className="mt-1 text-sm text-white/65">
                Turn word lists into flashcards fast.
              </div>
            </div>
          </div>
        </div>

        {/* CARD */}
        <Card className="p-6 min-w-0">
          <div className="flex items-center gap-2 text-white/90">
            <Zap size={18} />
            <div className="font-semibold">Pro credits</div>
          </div>
          <div className="mt-2 text-sm text-white/70">30 generations • 3500 Ft (≈ €8.9)</div>

          <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-white/70">
            <ul className="list-disc pl-5 space-y-1">
              <li>Use credits on Plan, Practice, Vocab and Audio</li>
              <li>Credits tracked server-side (cannot be edited in browser)</li>
              <li>When credits run out, auto-recharge may top up again (best-effort)</li>
            </ul>
          </div>

          <div className="mt-5 flex flex-col gap-2">
            <Button className="w-full gap-2" onClick={() => router.push('/login')}>
              Log in to start <ArrowRight size={16} />
            </Button>

            <div className="flex items-center gap-2 text-xs text-white/55">
              <ShieldCheck size={14} />
              Free trial available once after login (48h).
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
