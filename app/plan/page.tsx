'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Textarea } from '@/components/ui'
import MarkdownMath from '@/components/MarkdownMath'
import InlineMath from '@/components/InlineMath'
import { FileUp, Loader2, Trash2, Play, Pause, RotateCcw, ArrowLeft, Send } from 'lucide-react'
import AuthGate from '@/components/AuthGate'
import { authedFetch } from '@/lib/authClient'
import HScroll from '@/components/HScroll'

type Block = { type: 'study' | 'break'; minutes: number; label: string }
type DayPlan = { day: string; focus: string; tasks: string[]; minutes: number; blocks?: Block[] }
type Flashcard = { front: string; back: string }

type PlanResult = {
  title: string
  language: string
  exam_date?: string | null
  confidence?: number | null
  daily_plan: DayPlan[]
  quick_summary: string
  study_notes: string
  flashcards: Flashcard[]
  practice_questions: Array<{
    id: string
    type: 'mcq' | 'short'
    question: string
    options?: string[] | null
    answer?: string | null
    explanation?: string | null
  }>
}

type SavedPlan = { id: string; title: string; created_at: string }
type LocalSavedPlan = SavedPlan & { result: PlanResult }

const LS_KEY = 'examly_plans_v1'
const CURRENT_PLAN_LS_KEY = 'examly_current_plan_id_v1'

function loadLocalPlans(): LocalSavedPlan[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .filter(Boolean)
      .map((x: any) => ({
        id: String(x?.id ?? ''),
        title: String(x?.title ?? ''),
        created_at: String(x?.created_at ?? ''),
        result: x?.result ?? null,
      }))
      .filter((x: any) => x.id && x.result)
  } catch {
    return []
  }
}

function saveLocalPlan(entry: LocalSavedPlan) {
  if (typeof window === 'undefined') return
  try {
    const curr = loadLocalPlans()
    const next = [entry, ...curr.filter((p) => p.id !== entry.id)].slice(0, 50)
    window.localStorage.setItem(LS_KEY, JSON.stringify(next))
  } catch {}
}

function clearLocalPlans() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(LS_KEY)
  } catch {}
}

function setCurrentPlanLocal(id: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (!id) window.localStorage.removeItem(CURRENT_PLAN_LS_KEY)
    else window.localStorage.setItem(CURRENT_PLAN_LS_KEY, id)
  } catch {}
}

async function setCurrentPlanRemote(id: string | null) {
  try {
    await authedFetch('/api/plan/current', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
  } catch {
    // ignore (fallback is local)
  }
}

async function setCurrentPlan(id: string | null) {
  setCurrentPlanLocal(id)
  await setCurrentPlanRemote(id)
}

function fmtDate(d: string) {
  try {
    return new Date(d).toLocaleString(undefined, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return d
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function shortPrompt(p: string) {
  const t = p.trim().replace(/\s+/g, ' ')
  if (!t) return ''
  return t.length > 120 ? t.slice(0, 120) + '…' : t
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

export default function PlanPage() {
  return (
    <AuthGate requireEntitlement={true}>
      <Inner />
    </AuthGate>
  )
}

function Inner() {
  const [prompt, setPrompt] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [saved, setSaved] = useState<SavedPlan[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [result, setResult] = useState<PlanResult | null>(null)
  const [tab, setTab] = useState<'plan' | 'notes' | 'daily' | 'practice' | 'ask' | 'export'>('plan')

  // Ask
  const [askText, setAskText] = useState('')
  const [askLoading, setAskLoading] = useState(false)
  const [askAnswer, setAskAnswer] = useState<string | null>(null)
  const [askError, setAskError] = useState<string | null>(null)

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

  async function loadHistory() {
    const local = loadLocalPlans().map(({ id, title, created_at }) => ({ id, title, created_at }))
    try {
      const res = await authedFetch('/api/plan/history')
      const json = await res.json().catch(() => ({} as any))
      if (!res.ok) {
        setSaved(local)
        return
      }
      const serverItems = Array.isArray(json?.items) ? (json.items as SavedPlan[]) : []

      const byId = new Map<string, SavedPlan>()
      for (const x of [...local, ...serverItems]) {
        if (x?.id) byId.set(x.id, x)
      }
      const merged = Array.from(byId.values()).sort((a, b) => {
        const ta = +new Date(a.created_at || 0)
        const tb = +new Date(b.created_at || 0)
        return tb - ta
      })
      setSaved(merged)
    } catch {
      setSaved(local)
    }
  }

  useEffect(() => {
    loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadPlan(id: string) {
    setError(null)
    try {
      const res = await authedFetch(`/api/plan?id=${encodeURIComponent(id)}`)
      const json = await res.json().catch(() => ({} as any))
      if (!res.ok) throw new Error(json?.error ?? 'Failed to load')

      setSelectedId(id)
      setResult(json?.result ?? null)

      const b = normalizeBlocks(json?.result?.daily_plan?.[0]?.blocks ?? [])
      setBlocks(b)
      setBlockIndex(0)
      setRunning(false)
      setSecondsLeft(b[0] ? b[0].minutes * 60 : 25 * 60)

      setAskAnswer(null)
      setAskError(null)
      setAskText('')
      setTab('plan')

      await setCurrentPlan(id)
      return
    } catch (e: any) {
      const local = loadLocalPlans().find((p) => p.id === id)
      if (local?.result) {
        setSelectedId(id)
        setResult(local.result)

        const b = normalizeBlocks(local.result?.daily_plan?.[0]?.blocks ?? [])
        setBlocks(b)
        setBlockIndex(0)
        setRunning(false)
        setSecondsLeft(b[0] ? b[0].minutes * 60 : 25 * 60)

        setAskAnswer(null)
        setAskError(null)
        setAskText('')
        setTab('plan')

        await setCurrentPlan(id)
        return
      }

      setError(e?.message ?? 'Error')
    }
  }

  function resetAll() {
    setPrompt('')
    setFile(null)
    setResult(null)
    setSelectedId(null)
    setTab('plan')
    setBlocks([])
    setBlockIndex(0)
    setRunning(false)
    setSecondsLeft(25 * 60)
    setAskAnswer(null)
    setAskError(null)
    setAskText('')
    setError(null)
  }

  async function generate() {
    setError(null)
    setLoading(true)
    try {
      const form = new FormData()
      form.append('prompt', prompt || '')
      if (file) form.append('files', file)

      const res = await authedFetch('/api/plan', { method: 'POST', body: form })
      const json = await res.json().catch(() => ({} as any))
      if (!res.ok) throw new Error(json?.error ?? `Generation failed (${res.status})`)

      const r = (json?.result ?? null) as PlanResult | null
      if (!r) throw new Error('Server returned no result')

      const id = typeof json?.id === 'string' ? (json.id as string) : null
      const localId = id || `local_${Date.now()}_${Math.random().toString(16).slice(2)}`
      const created_at = new Date().toISOString()

      if (id) setSelectedId(id)
      else setSelectedId(localId)

      setResult(r)
      setTab('plan')

      const b = normalizeBlocks(r?.daily_plan?.[0]?.blocks ?? [])
      setBlocks(b)
      setBlockIndex(0)
      setRunning(false)
      setSecondsLeft(b[0] ? b[0].minutes * 60 : 25 * 60)

      setAskAnswer(null)
      setAskError(null)
      setAskText('')

      saveLocalPlan({ id: localId, title: r.title || 'Untitled plan', created_at, result: r })

      await setCurrentPlan(localId)
      await loadHistory()
    } catch (e: any) {
      setError(e?.message ?? 'Error')
    } finally {
      setLoading(false)
    }
  }

  async function clearHistory() {
    setError(null)
    try {
      const res = await authedFetch('/api/plan/history', { method: 'DELETE' })
      const json = await res.json().catch(() => ({} as any))
      if (!res.ok) throw new Error(json?.error ?? 'Failed')
      setSaved([])
      setSelectedId(null)
      clearLocalPlans()
      await setCurrentPlan(null)
    } catch (e: any) {
      clearLocalPlans()
      setSaved([])
      setSelectedId(null)
      await setCurrentPlan(null)
      setError(e?.message ?? 'Error')
    }
  }

  async function ask() {
    setAskError(null)
    setAskAnswer(null)
    setAskLoading(true)
    try {
      const q = askText.trim()
      if (!q) throw new Error('Írj be egy kérdést.')

      const lang = (result?.language ?? '').toLowerCase().includes('hun') ? 'hu' : 'en'

      const res = await authedFetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, language: lang }),
      })
      const json = await res.json().catch(() => ({} as any))
      if (!res.ok) throw new Error(json?.error ?? 'Ask failed')

      setAskAnswer(String(json?.display ?? json?.speech ?? ''))
    } catch (e: any) {
      setAskError(e?.message ?? 'Ask error')
    } finally {
      setAskLoading(false)
    }
  }

  const displayTitle = result?.title?.trim() ? result.title : 'Study plan'
  const displayInput = shortPrompt(prompt)
  const canGenerate = !loading && (prompt.trim().length >= 6 || !!file)

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-2 text-white/70 hover:text-white">
          <ArrowLeft size={18} />
          Back
        </Link>

        <div className="text-xs text-white/50">
          {result?.language ? (
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{result.language}</span>
          ) : null}
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* LEFT SIDEBAR */}
        <div className="rounded-3xl border border-white/10 bg-black/40 p-5">
          <div className="text-xs uppercase tracking-[0.18em] text-white/55">History</div>

          <div className="mt-3 space-y-2">
            {saved.length === 0 ? (
              <div className="text-sm text-white/50">No saved plans yet.</div>
            ) : (
              saved.map((p) => (
                <button
                  key={p.id}
                  onClick={() => loadPlan(p.id)}
                  className={
                    'w-full rounded-2xl border px-3 py-2 text-left transition ' +
                    (selectedId === p.id
                      ? 'border-white/20 bg-white/10'
                      : 'border-white/10 bg-white/5 hover:bg-white/10')
                  }
                >
                  <div className="text-sm font-medium text-white/90 line-clamp-1">{p.title}</div>
                  <div className="mt-0.5 text-xs text-white/50">{fmtDate(p.created_at)}</div>
                </button>
              ))
            )}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button className="flex-1" onClick={resetAll} variant="primary">
              New
            </Button>
            <Button onClick={clearHistory} variant="ghost" className="gap-2">
              <Trash2 size={16} /> Clear
            </Button>
          </div>

          <div className="mt-6 text-xs uppercase tracking-[0.18em] text-white/55">Input</div>

          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What’s your exam about? When is it? What material do you have?"
            className="mt-3 min-h-[110px]"
          />

          <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70 hover:bg-white/10">
            <span className="inline-flex items-center gap-2">
              <FileUp size={16} />
              Upload PDFs or photos (handwritten supported).
            </span>
            <input
              type="file"
              className="hidden"
              accept="application/pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <Button className="mt-4 w-full" onClick={generate} disabled={!canGenerate}>
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="animate-spin" size={16} />
                Generating…
              </span>
            ) : (
              'Generate'
            )}
          </Button>

          {error ? <div className="mt-3 text-sm text-red-400">{error}</div> : null}
        </div>

        {/* MAIN */}
        <div className="min-w-0">
          <div className="rounded-3xl border border-white/10 bg-black/40 p-6 min-w-0 overflow-hidden">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6 min-w-0">
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-[0.18em] text-white/55">Plan</div>

                <h1 className="mt-2 text-2xl md:text-3xl font-semibold tracking-tight text-white break-words">
                  {displayTitle}
                </h1>

                {displayInput ? (
                  <p className="mt-2 text-sm text-white/55 break-words">
                    <span className="text-white/40">Your input:</span> {displayInput}
                  </p>
                ) : null}

                {result?.quick_summary ? (
                  <p className="mt-2 max-w-[80ch] text-sm text-white/70 break-words">{result.quick_summary}</p>
                ) : (
                  <p className="mt-2 max-w-[80ch] text-sm text-white/50">
                    Generate a plan to see your schedule, notes, flashcards, and practice questions.
                  </p>
                )}
              </div>

              <div className="min-w-0">
                <HScroll className="w-full md:max-w-[520px] -mx-1 px-1 md:justify-end">
                  {(['plan', 'notes', 'daily', 'practice', 'ask', 'export'] as const).map((k) => (
                    <Button
                      key={k}
                      variant={tab === k ? 'primary' : 'ghost'}
                      onClick={() => setTab(k)}
                      className="shrink-0 capitalize"
                    >
                      {k}
                    </Button>
                  ))}
                </HScroll>
              </div>
            </div>

            <div className="mt-6 min-w-0">
              {!result && (
                <div className="text-sm text-white/55">
                  Tip: add the exam date and your material (PDF / photo). The plan becomes much more accurate.
                </div>
              )}

              {/* NOTES */}
              {tab === 'notes' && result && (
                <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 min-w-0 overflow-hidden">
                  <div className="text-xs uppercase tracking-[0.18em] text-white/55">Study notes</div>
                  <div className="mt-3 richtext min-w-0 max-w-full overflow-x-auto">
                    <MarkdownMath content={result?.study_notes ?? ''} />
                  </div>
                </div>
              )}

              {/* DAILY ✅ Pomodoro top on normal screens, right only at 2XL */}
              {tab === 'daily' && result && (
                <div className="grid gap-6 min-w-0 2xl:grid-cols-[minmax(0,1fr)_360px]">
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
                          <Button
                            onClick={() => setRunning((v) => !v)}
                            disabled={!activeBlock}
                            className="shrink-0 gap-2"
                          >
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

                  <div className="order-2 min-w-0 space-y-6 2xl:order-1">
                    {(result?.daily_plan ?? []).map((d, di) => (
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
              )}

              {/* PRACTICE */}
              {tab === 'practice' && result && (
                <div className="space-y-6 min-w-0">
                  {(result?.practice_questions ?? []).map((q, qi) => (
                    <section
                      key={q.id ?? String(qi)}
                      className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 min-w-0 overflow-hidden"
                    >
                      <div className="flex items-start justify-between gap-3 min-w-0">
                        <div className="text-sm font-semibold text-white/90 min-w-0 break-words">
                          {qi + 1}. <InlineMath content={q.question} />
                        </div>
                        <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                          {q.type.toUpperCase()}
                        </span>
                      </div>

                      {q.type === 'mcq' && q.options?.length ? (
                        <div className="mt-4 grid gap-2">
                          {q.options.map((o, i) => (
                            <div
                              key={i}
                              className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/80"
                            >
                              <InlineMath content={o} />
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {q.answer ? (
                        <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                          <div className="text-xs uppercase tracking-[0.18em] text-white/55">Answer</div>
                          <div className="mt-2 text-sm text-white/80 break-words">
                            <InlineMath content={q.answer ?? ''} />
                          </div>
                        </div>
                      ) : null}

                      {q.explanation ? (
                        <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                          <div className="text-xs uppercase tracking-[0.18em] text-white/55">Explanation</div>
                          <div className="mt-2 text-sm text-white/70 richtext min-w-0 max-w-full overflow-x-auto">
                            <MarkdownMath content={q.explanation ?? ''} />
                          </div>
                        </div>
                      ) : null}
                    </section>
                  ))}
                </div>
              )}

              {/* ASK */}
              {tab === 'ask' && result && (
                <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 min-w-0 overflow-hidden">
                  <div className="text-xs uppercase tracking-[0.18em] text-white/55">Ask</div>

                  <Textarea
                    value={askText}
                    onChange={(e) => setAskText(e.target.value)}
                    placeholder="Pl.: Oldd meg: x² - 5x + 6 = 0 és magyarázd el lépésről lépésre."
                    className="mt-4 min-h-[110px]"
                  />

                  <div className="mt-3 flex gap-2">
                    <Button onClick={ask} disabled={askLoading || askText.trim().length < 2} className="gap-2">
                      {askLoading ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                      Ask
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setAskText('')
                        setAskAnswer(null)
                        setAskError(null)
                      }}
                    >
                      Clear
                    </Button>
                  </div>

                  {askError ? <div className="mt-3 text-sm text-red-400">{askError}</div> : null}

                  {askAnswer ? (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-white/55">Answer</div>
                      <div className="mt-3 richtext min-w-0 max-w-full overflow-x-auto text-white/80">
                        <MarkdownMath content={askAnswer} />
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* EXPORT */}
              {tab === 'export' && result && (
                <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 min-w-0 overflow-hidden">
                  <div className="text-xs uppercase tracking-[0.18em] text-white/55">Export</div>
                  <p className="mt-2 text-sm text-white/70">Export uses your existing PDF route.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
