'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import AuthGate from '@/components/AuthGate'
import { authedFetch } from '@/lib/authClient'
import HScroll from '@/components/HScroll'
import { Button } from '@/components/ui'
import { ArrowLeft, Loader2, Play, Pause, RotateCcw } from 'lucide-react'

type Block = { type: 'study' | 'break'; minutes: number; label: string }
type DayPlan = { day: string; focus: string; tasks: string[]; minutes: number; blocks?: Block[] }
type PlanResult = { title: string; daily_plan: DayPlan[] }

const CURRENT_PLAN_LS_KEY = 'examly_current_plan_id_v1'
const LS_KEY = 'examly_plans_v1'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function normalizeBlocks(blocks?: Block[]) {
  if (!blocks?.length) return []
  return blocks
    .filter((b) => b && Number.isFinite(b.minutes))
    .map((b) => ({
      ...b,
      minutes: clamp(Math.round(b.minutes), 1, 120),
      label: (b.label || '').trim() || (b.type === 'break' ? 'Break' : 'Focus'),
    }))
}

function secondsToMMSS(s: number) {
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}

function getLocalCurrentId(): string | null {
  try {
    return window.localStorage.getItem(CURRENT_PLAN_LS_KEY)
  } catch {
    return null
  }
}

function loadLocalPlan(id: string): any | null {
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return null
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return null
    const found = arr.find((x: any) => String(x?.id) === id)
    return found?.result ?? null
  } catch {
    return null
  }
}

export default function DailyPage() {
  return (
    <AuthGate requireEntitlement={true}>
      <Inner />
    </AuthGate>
  )
}

function Inner() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [plan, setPlan] = useState<PlanResult | null>(null)

  // pomodoro
  const [blocks, setBlocks] = useState<Block[]>([])
  const [blockIndex, setBlockIndex] = useState(0)
  const [running, setRunning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(25 * 60)
  const tickRef = useRef<number | null>(null)

  const activeBlock = useMemo(() => blocks[blockIndex] ?? null, [blocks, blockIndex])

  useEffect(() => {
    if (!running) return
    tickRef.current = window.setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? 0 : s - 1))
    }, 1000)
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [running])

  useEffect(() => {
    if (!running) return
    if (secondsLeft !== 0) return
    setRunning(false)
    setTimeout(() => {
      setBlockIndex((i) => {
        const next = i + 1
        if (next >= blocks.length) return i
        return next
      })
    }, 150)
  }, [secondsLeft, running, blocks.length])

  useEffect(() => {
    if (!activeBlock) return
    setSecondsLeft(activeBlock.minutes * 60)
    setRunning(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockIndex])

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        let id: string | null = null
        try {
          const r1 = await authedFetch('/api/plan/current')
          const j1 = await r1.json().catch(() => ({} as any))
          if (r1.ok && typeof j1?.id === 'string') id = j1.id
        } catch {}

        if (!id) id = getLocalCurrentId()
        if (!id) throw new Error('Nincs kiválasztott plan. Menj a Plan oldalra és generálj vagy válassz egyet.')

        // server plan
        try {
          const r2 = await authedFetch(`/api/plan?id=${encodeURIComponent(id)}`)
          const j2 = await r2.json().catch(() => ({} as any))
          if (!r2.ok) throw new Error(j2?.error ?? 'Failed to load')
          setPlan(j2?.result ?? null)

          const b = normalizeBlocks(j2?.result?.daily_plan?.[0]?.blocks ?? [])
          setBlocks(b)
          setBlockIndex(0)
          setRunning(false)
          setSecondsLeft(b[0] ? b[0].minutes * 60 : 25 * 60)

          setLoading(false)
          return
        } catch {
          const local = loadLocalPlan(id)
          if (!local) throw new Error('Nem találom a plan-t (se szerveren, se lokálisan).')

          setPlan(local)

          const b = normalizeBlocks(local?.daily_plan?.[0]?.blocks ?? [])
          setBlocks(b)
          setBlockIndex(0)
          setRunning(false)
          setSecondsLeft(b[0] ? b[0].minutes * 60 : 25 * 60)

          setLoading(false)
          return
        }
      } catch (e: any) {
        setError(e?.message ?? 'Error')
        setLoading(false)
      }
    })()
  }, [])

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex items-center justify-between">
        <Link href="/plan" className="inline-flex items-center gap-2 text-white/70 hover:text-white">
          <ArrowLeft size={18} />
          Back to Plan
        </Link>
      </div>

      <div className="mt-6 rounded-3xl border border-white/10 bg-black/40 p-6">
        {loading ? (
          <div className="inline-flex items-center gap-2 text-white/70">
            <Loader2 className="animate-spin" size={16} /> Loading…
          </div>
        ) : error ? (
          <div className="text-sm text-red-400">{error}</div>
        ) : plan ? (
          <>
            <div className="text-xs uppercase tracking-[0.18em] text-white/55">Daily</div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white break-words">
              {plan.title || 'Daily'}
            </h1>

            <div className="mt-6 grid gap-6 min-w-0 2xl:grid-cols-[minmax(0,1fr)_360px]">
              {/* TIMER */}
              <aside className="order-1 w-full shrink-0 self-start 2xl:order-2 2xl:w-[360px] 2xl:sticky 2xl:top-6">
                <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 overflow-hidden">
                  <div className="text-xs uppercase tracking-[0.18em] text-white/55">Pomodoro</div>

                  <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-4 overflow-hidden">
                    <div className="flex items-start justify-between gap-3 min-w-0">
                      <div className="min-w-0">
                        <div className="text-xs text-white/55">Session</div>
                        <div className="mt-1 text-lg font-semibold leading-snug text-white break-words">
                          {activeBlock ? activeBlock.label : 'No blocks'}
                        </div>
                        <div className="mt-1 text-sm text-white/60">Focus time</div>
                      </div>

                      <div className="text-right shrink-0 min-w-[110px]">
                        <div className="text-xs uppercase tracking-[0.18em] text-white/55">Timer</div>
                        <div className="mt-1 text-3xl font-semibold tabular-nums text-white">
                          {secondsToMMSS(secondsLeft)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/5">
                      {activeBlock ? (
                        <div
                          className="h-full bg-white/50"
                          style={{
                            width: `${
                              activeBlock.minutes > 0
                                ? 100 - (secondsLeft / (activeBlock.minutes * 60)) * 100
                                : 0
                            }%`,
                          }}
                        />
                      ) : null}
                    </div>

                    <HScroll className="mt-4 -mx-1 px-1 max-w-full">
                      <Button onClick={() => setRunning((v) => !v)} disabled={!activeBlock} className="shrink-0 gap-2">
                        {running ? <Pause size={16} /> : <Play size={16} />}
                        {running ? 'Pause' : 'Start'}
                      </Button>

                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (!activeBlock) return
                          setRunning(false)
                          setSecondsLeft(activeBlock.minutes * 60)
                        }}
                        className="shrink-0 gap-2"
                        disabled={!activeBlock}
                      >
                        <RotateCcw size={16} />
                        Reset
                      </Button>

                      <Button
                        variant="ghost"
                        onClick={() => setBlockIndex((i) => Math.min(i + 1, Math.max(0, blocks.length - 1)))}
                        className="shrink-0"
                        disabled={blocks.length === 0 || blockIndex >= blocks.length - 1}
                      >
                        Next
                      </Button>
                    </HScroll>

                    <div className="mt-3 text-xs text-white/50">
                      Block {blocks.length ? blockIndex + 1 : 0}/{blocks.length || 0}
                    </div>
                  </div>
                </div>
              </aside>

              {/* DAYS */}
              <div className="order-2 min-w-0 space-y-6 2xl:order-1">
                {(plan?.daily_plan ?? []).map((d, di) => (
                  <section
                    key={di}
                    className="w-full rounded-3xl border border-white/10 bg-white/[0.02] p-5 min-w-0 overflow-hidden"
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between min-w-0">
                      <div className="min-w-0">
                        <div className="text-xs uppercase tracking-[0.18em] text-white/55">{d.day}</div>
                        <div className="mt-2 text-xl font-semibold text-white break-normal hyphens-auto">
                          {d.focus}
                        </div>
                      </div>

                      {d.blocks?.length ? (
                        <HScroll className="w-full md:w-auto md:justify-end -mx-1 px-1 max-w-full">
                          {d.blocks.map((x, i) => (
                            <span
                              key={i}
                              className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70"
                            >
                              {x.label} {x.minutes}m
                            </span>
                          ))}
                        </HScroll>
                      ) : null}
                    </div>

                    <ul className="mt-4 space-y-2 text-sm text-white/80">
                      {(d.tasks ?? []).map((t, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-white/40">•</span>
                          <span className="break-words">{t}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
