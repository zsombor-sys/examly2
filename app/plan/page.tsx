'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Textarea } from '@/components/ui'
import MarkdownMath from '@/components/MarkdownMath'
import InlineMath from '@/components/InlineMath'
import { FileUp, Loader2, Trash2, Play, Pause, RotateCcw, ArrowLeft } from 'lucide-react'
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
    options?: string[]
    answer?: string
    explanation?: string
  }>
}

type SavedPlan = { id: string; title: string; created_at: string }

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

function titleFromPrompt(p: string) {
  const t = p.trim().replace(/\s+/g, ' ')
  if (!t) return 'Untitled plan'
  return t.length > 60 ? t.slice(0, 60) + '…' : t
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
    try {
      const res = await authedFetch('/api/plan/history')
      const json = await res.json()
      if (!res.ok) return
      setSaved(Array.isArray(json?.items) ? json.items : [])
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadHistory()
  }, [])

  async function loadPlan(id: string) {
    setError(null)
    try {
      const res = await authedFetch(`/api/plan?id=${encodeURIComponent(id)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Failed to load')

      setSelectedId(id)
      setResult(json?.result ?? null)

      const b = normalizeBlocks(json?.result?.daily_plan?.[0]?.blocks ?? [])
      setBlocks(b)
      setBlockIndex(0)
      setRunning(false)
      setSecondsLeft(b[0] ? b[0].minutes * 60 : 25 * 60)

      setTab('plan')
    } catch (e: any) {
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
    setError(null)
  }

  async function generate() {
    setError(null)
    setLoading(true)
    try {
      const form = new FormData()
      form.append('prompt', prompt)
      if (file) form.append('file', file)

      const res = await authedFetch('/api/plan', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Generation failed')

      const r = json?.result as PlanResult
      setResult(r)
      setTab('plan')

      const b = normalizeBlocks(r?.daily_plan?.[0]?.blocks ?? [])
      setBlocks(b)
      setBlockIndex(0)
      setRunning(false)
      setSecondsLeft(b[0] ? b[0].minutes * 60 : 25 * 60)

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
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Failed')
      setSaved([])
      setSelectedId(null)
    } catch (e: any) {
      setError(e?.message ?? 'Error')
    }
  }

  const planTitle = result?.title ?? titleFromPrompt(prompt)

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 overflow-x-hidden">
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

          <Button className="mt-4 w-full" onClick={generate} disabled={loading || prompt.trim().length < 6}>
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
          <div className="rounded-3xl border border-white/10 bg-black/40 p-6 min-w-0">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between min-w-0">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.18em] text-white/55">Plan</div>
                <h1 className="mt-2 text-2xl md:text-3xl font-semibold tracking-tight text-white break-words">
                  {planTitle}
                </h1>
                {result?.quick_summary ? (
                  <p className="mt-2 max-w-[80ch] text-sm text-white/70 break-words">{result.quick_summary}</p>
                ) : (
                  <p className="mt-2 max-w-[80ch] text-sm text-white/50">
                    Generate a plan to see your schedule, notes, flashcards, and practice questions.
                  </p>
                )}
              </div>

              {/* Tabs: ONLY scroll when needed */}
             <HScroll
  className="
    w-full lg:w-auto
    justify-start lg:justify-end
    -mx-1 px-1
    lg:max-w-[520px]
  "
>
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

            <div className="mt-6 min-w-0">
              {!result && (
                <div className="text-sm text-white/55">
                  Tip: add the exam date and your material (PDF / photo). The plan becomes much more accurate.
                </div>
              )}
              {!result && (
  <div className="mt-6 grid gap-4 md:grid-cols-2">
    <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5">
      <div className="text-xs uppercase tracking-[0.18em] text-white/55">What you get</div>
      <ul className="mt-3 space-y-2 text-sm text-white/70">
        <li>• A structured daily plan (not chat)</li>
        <li>• Clean notes + quick summary</li>
        <li>• Flashcards and practice questions</li>
        <li>• Pomodoro blocks (focus + breaks)</li>
      </ul>
    </div>
    <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5">
      <div className="text-xs uppercase tracking-[0.18em] text-white/55">Tip</div>
      <p className="mt-3 text-sm text-white/70">
        Add your exam date + upload at least 1 PDF/photo for best accuracy.
      </p>
    </div>
  </div>
)}


              {tab === 'plan' && result && (
                <div className="grid gap-6 lg:grid-cols-[1fr_320px] min-w-0">
                  <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 min-w-0">
                    <div className="text-xs uppercase tracking-[0.18em] text-white/55">Study notes</div>
                    <div className="mt-3 min-w-0">
                      <MarkdownMath content={result.study_notes} />
                    </div>
                  </section>

                  <aside className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 min-w-0">
                    <div className="text-xs uppercase tracking-[0.18em] text-white/55">Pomodoro</div>

                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-4 min-w-0">
                      <div className="flex items-start justify-between gap-3 min-w-0">
                        <div className="min-w-0">
                          <div className="text-xs text-white/55">Session</div>
                          <div className="mt-1 text-lg font-semibold leading-snug text-white break-words">
                            {activeBlock ? activeBlock.label : 'No blocks'}
                          </div>
                          <div className="mt-1 text-sm text-white/60">Focus time</div>
                        </div>

                        <div className="text-right shrink-0">
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
                              width: `${activeBlock.minutes > 0 ? 100 - (secondsLeft / (activeBlock.minutes * 60)) * 100 : 0}%`,
                            }}
                          />
                        ) : null}
                      </div>

                      {/* Controls row: ONLY scroll when needed */}
                      <HScroll className="mt-4 -mx-1 px-1">
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
                  </aside>
                </div>
              )}

              {tab === 'notes' && result && (
                <div className="grid gap-6 lg:grid-cols-2 min-w-0">
                  <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 min-w-0">
                    <div className="text-xs uppercase tracking-[0.18em] text-white/55">Quick summary</div>
                    <div className="mt-3 text-white/80 min-w-0">
                      <MarkdownMath content={result.quick_summary} />
                    </div>
                  </section>

                  <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 min-w-0">
                    <div className="text-xs uppercase tracking-[0.18em] text-white/55">Flashcards</div>
                    <div className="mt-3 grid gap-3">
                      {result.flashcards?.slice(0, 8).map((c, i) => (
                        <div key={i} className="rounded-2xl border border-white/10 bg-black/30 p-4 min-w-0">
                          <div className="text-sm font-semibold text-white/90 break-words">{c.front}</div>
                          <div className="mt-2 text-sm text-white/70 break-words">{c.back}</div>
                        </div>
                      ))}
                      {(!result.flashcards || result.flashcards.length === 0) && (
                        <div className="text-sm text-white/55">No flashcards generated.</div>
                      )}
                    </div>
                  </section>
                </div>
              )}

              {tab === 'daily' && result && (
                <div className="space-y-6 min-w-0">
                  {result.daily_plan?.map((d, di) => {
                    const b = normalizeBlocks(d.blocks)
                    return (
                      <section key={di} className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 min-w-0">
                        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between min-w-0">
                          <div className="min-w-0">
                            <div className="text-xs uppercase tracking-[0.18em] text-white/55">{d.day}</div>
                            <div className="mt-2 text-xl font-semibold text-white break-words">{d.focus}</div>
                          </div>

                          {b.length ? (
                            <HScroll className="w-full md:w-auto justify-start md:justify-end -mx-1 px-1">
                              {b.map((x, i) => (
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
                          {d.tasks?.map((t, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-white/40">•</span>
                              <span className="break-words">{t}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )
                  })}
                </div>
              )}

              {tab === 'practice' && result && (
  <div className="space-y-6 min-w-0">
    {result.practice_questions?.map((q, qi) => (
      <section key={q.id ?? qi} className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 min-w-0">
        ...
      </section>
    ))}
  </div>
)}

/* IDE JÖN AZ ASK */
{tab === 'ask' && result && (
  <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 min-w-0">
    <div className="text-xs uppercase tracking-[0.18em] text-white/55">Ask</div>
    <p className="mt-2 text-sm text-white/70">
      This will be wired to the Ask feature (same credit rules). For now it’s a placeholder so the UI flow is correct.
    </p>

    <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/70">
      Coming next: ask questions about your generated plan/notes with citations to your content.
    </div>
  </div>
)}

              {tab === 'export' && result && (
                <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 min-w-0">
                  <div className="text-xs uppercase tracking-[0.18em] text-white/55">Export</div>
                  <p className="mt-2 text-sm text-white/70">
                    Download your plan or notes as a PDF.
                  </p>

                  <HScroll className="mt-4 -mx-1 px-1">
                    <Button
                      onClick={async () => {
                        try {
                          const res = await authedFetch('/api/plan/pdf', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ result }),
                          })
                          const blob = await res.blob()
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = `${planTitle.replace(/[^\w\d-_ ]+/g, '').slice(0, 80)}.pdf`
                          a.click()
                          URL.revokeObjectURL(url)
                        } catch {
                          setError('Export failed.')
                        }
                      }}
                      className="shrink-0"
                    >
                      Download PDF
                    </Button>

                    <Button
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(JSON.stringify(result, null, 2))
                        } catch {
                          // ignore
                        }
                      }}
                      className="shrink-0"
                    >
                      Copy JSON
                    </Button>

                    <Button
                      variant="ghost"
                      onClick={() => {
                        const md =
                          `# ${planTitle}\n\n` +
                          `## Quick summary\n${result.quick_summary}\n\n` +
                          `## Study notes\n${result.study_notes}\n\n` +
                          `## Daily plan\n` +
                          result.daily_plan
                            .map((d) => `### ${d.day}\n**${d.focus}**\n\n${d.tasks.map((t) => `- ${t}`).join('\n')}\n`)
                            .join('\n') +
                          `\n\n## Flashcards\n` +
                          (result.flashcards ?? []).map((c) => `- **${c.front}**: ${c.back}`).join('\n') +
                          `\n\n## Practice\n` +
                          (result.practice_questions ?? [])
                            .map((q, i) => `### ${i + 1}. ${q.question}\n${q.options?.length ? q.options.map((o) => `- ${o}`).join('\n') + '\n' : ''}\n**Answer:** ${q.answer ?? ''}\n`)
                            .join('\n')

                        const blob = new Blob([md], { type: 'text/markdown' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `${planTitle.replace(/[^\w\d-_ ]+/g, '').slice(0, 80)}.md`
                        a.click()
                        URL.revokeObjectURL(url)
                      }}
                      className="shrink-0"
                    >
                      Download Markdown
                    </Button>
                  </HScroll>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
