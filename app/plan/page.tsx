
'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Input, Textarea } from '@/components/ui'
import MarkdownMath from '@/components/MarkdownMath'
import InlineMath from '@/components/InlineMath'
import { FileUp, Loader2, Trash2, Play, Pause, RotateCcw, ArrowLeft } from 'lucide-react'
import AuthGate from '@/components/AuthGate'
import { authedFetch } from '@/lib/authClient'

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
    options: string[] | null
    answer: string | null
    explanation?: string
  }>
  notes: string[]
}

type SavedPlan = {
  id: string
  createdAt: number
  prompt: string
  result: PlanResult
}

const STORAGE_KEY = 'examly:plans:v1'

function nowId() {
  return Math.random().toString(16).slice(2) + '-' + Date.now().toString(16)
}

function fmtDate(ts: number) {
  const d = new Date(ts)
  return d.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function splitLines(s: string) {
  return String(s ?? '').replace(/\r/g, '').split('\n')
}

function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
      <div className="h-full bg-white/80" style={{ width: `${v * 100}%` }} />
    </div>
  )
}

function Pomodoro({ blocks }: { blocks: Block[] }) {
  // Default blocks if missing
  const seq = (blocks?.length ? blocks : [
    { type: 'study', minutes: 25, label: 'Focus' },
    { type: 'break', minutes: 5, label: 'Break' },
    { type: 'study', minutes: 25, label: 'Focus' },
    { type: 'break', minutes: 5, label: 'Break' },
    { type: 'study', minutes: 25, label: 'Focus' },
    { type: 'break', minutes: 5, label: 'Break' },
    { type: 'study', minutes: 25, label: 'Focus' },
    { type: 'break', minutes: 15, label: 'Long break' },
  ]) as Block[]

  const [running, setRunning] = useState(false)
  const [idx, setIdx] = useState(0)
  const [left, setLeft] = useState(seq[0].minutes * 60)
  const raf = useRef<number | null>(null)
  const last = useRef<number | null>(null)

  const current = seq[idx] ?? seq[0]
  const total = current.minutes * 60
  const progress = total ? 1 - left / total : 0

  useEffect(() => {
    // reset left when block changes
    setLeft((seq[idx]?.minutes ?? 25) * 60)
  }, [idx])

  useEffect(() => {
    if (!running) {
      if (raf.current) cancelAnimationFrame(raf.current)
      raf.current = null
      last.current = null
      return
    }

    const tick = (t: number) => {
      if (!last.current) last.current = t
      const dt = (t - last.current) / 1000
      last.current = t

      setLeft((s) => {
        const next = Math.max(0, s - dt)
        if (next === 0) {
          // advance
          setIdx((i) => (i + 1) % seq.length)
          return 0
        }
        return next
      })

      raf.current = requestAnimationFrame(tick)
    }

    raf.current = requestAnimationFrame(tick)
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [running, seq.length])

  const mm = Math.floor(left / 60)
  const ss = Math.floor(left % 60)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-white/55">Session</div>
          <div className="mt-1 text-xl font-semibold">{current.label}</div>
          <div className="mt-1 text-sm text-white/65">{current.type === 'study' ? 'Focus time' : 'Break time'}</div>
        </div>

        <div className="text-right">
          <div className="text-xs uppercase tracking-[0.18em] text-white/55">Timer</div>
          <div className="mt-1 font-mono tabular-nums text-3xl leading-none">{String(mm).padStart(2,'0')}:{String(ss).padStart(2,'0')}</div>
        </div>
      </div>

      <ProgressBar value={progress} />

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setRunning((r) => !r)} className="gap-2">
          {running ? <><Pause size={16} /> Pause</> : <><Play size={16} /> Start</>}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setRunning(false)
            setIdx(0)
            setLeft(seq[0].minutes * 60)
          }}
          className="gap-2"
        >
          <RotateCcw size={16} /> Reset
        </Button>
        <Button
          variant="ghost"
          onClick={() => setIdx((i) => (i + 1) % seq.length)}
          className="gap-2"
        >
          Next
        </Button>
      </div>

      <div className="text-xs text-white/50">
        Block {idx + 1}/{seq.length}
      </div>
    </div>
  )
}

function PlanPageInner() {
  const [tab, setTab] = useState<'plan' | 'notes' | 'daily' | 'practice' | 'export' | 'ask'>('plan')

  const [prompt, setPrompt] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PlanResult | null>(null)

  // Ask (mini tutor) + audio
  const [askLang, setAskLang] = useState<'hu' | 'en'>('hu')
  const [askQ, setAskQ] = useState('')
  const [askLoading, setAskLoading] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  const [askDisplay, setAskDisplay] = useState('')
  const [askSpeech, setAskSpeech] = useState('')
  const [audioLoading, setAudioLoading] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)

  const [history, setHistory] = useState<SavedPlan[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const data = JSON.parse(raw)
      if (Array.isArray(data)) {
        setHistory(data)
        if (data[0]?.id) {
          setActiveId(data[0].id)
          setResult(data[0].result)
          setPrompt(data[0].prompt ?? '')
        }
      }
    } catch {}
  }, [])

  function saveHistory(next: SavedPlan[]) {
    setHistory(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(0, 30)))
    } catch {}
  }

  const hasUploads = files.length > 0
  const uploadLabel = useMemo(() => {
    if (!hasUploads) return 'Upload PDFs or photos (handwritten supported).'
    return `${files.length} file(s) ready.`
  }, [hasUploads, files.length])

  async function runPlan() {
    setLoading(true)
    setError(null)

    try {
      const form = new FormData()
      form.append('prompt', prompt)
      files.forEach((f) => form.append('files', f))

      const res = await authedFetch('/api/plan', { method: 'POST', body: form })
      const json = await res.json()

      if (!res.ok) throw new Error(json?.error ?? 'Request failed')

      setResult(json)
      setTab('plan')

      const item: SavedPlan = {
        id: nowId(),
        createdAt: Date.now(),
        prompt,
        result: json,
      }
      const next = [item, ...history].slice(0, 30)
      setActiveId(item.id)
      saveHistory(next)
    } catch (e: any) {
      setError(e?.message ?? 'Error')
    } finally {
      setLoading(false)
    }
  }

  async function runAsk() {
    setAskError(null)
    setAskLoading(true)
    setAskDisplay('')
    setAskSpeech('')
    setAudioUrl(null)

    try {
      const res = await authedFetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: askQ, language: askLang }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Request failed')
      setAskDisplay(String(json?.display ?? ''))
      setAskSpeech(String(json?.speech ?? ''))
    } catch (e: any) {
      setAskError(e?.message ?? 'Error')
    } finally {
      setAskLoading(false)
    }
  }

  async function genAudio() {
    setAskError(null)
    const text = (askSpeech || askDisplay).trim()
    if (!text) {
      setAskError('Nothing to read yet. Ask a question first.')
      return
    }
    setAudioLoading(true)
    setAudioUrl(null)
    try {
      const res = await authedFetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, format: 'mp3' }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error ?? 'TTS failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setAudioUrl(url)
    } catch (e: any) {
      setAskError(e?.message ?? 'Audio error')
    } finally {
      setAudioLoading(false)
    }
  }

  function loadSaved(id: string) {
    const found = history.find((h) => h.id === id)
    if (!found) return
    setActiveId(found.id)
    setPrompt(found.prompt)
    setResult(found.result)
    setError(null)
  }

  function clearAll() {
    setHistory([])
    setActiveId(null)
    setResult(null)
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
  }

  const todayBlocks = result?.daily_plan?.[0]?.blocks ?? []

  return (
    <div className="relative min-h-[calc(100vh-0px)]">
      <div className="grid-overlay" />
      <div className="glow" />

      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/assets/logo.png" alt="Examly" width={34} height={34} />
            <span className="text-base font-semibold tracking-tight">Examly</span>
          </Link>
          <Link href="/" className="text-sm text-white/70 hover:text-white inline-flex items-center gap-2">
            <ArrowLeft size={16} /> Back
          </Link>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* Sidebar */}
          <aside className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-white/55">History</div>
            <div className="mt-3 space-y-2 max-h-[58vh] overflow-auto pr-1">
              {history.length === 0 && (
                <div className="text-sm text-white/55">No saved plans yet.</div>
              )}
              {history.map((h) => (
                <button
                  key={h.id}
                  onClick={() => loadSaved(h.id)}
                  className={
                    'w-full text-left rounded-xl px-3 py-2 border ' +
                    (activeId === h.id ? 'border-white/20 bg-white/[0.06]' : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]')
                  }
                >
                  <div className="text-sm font-medium truncate">{h.result?.title || 'Untitled plan'}</div>
                  <div className="text-xs text-white/55 mt-1">{fmtDate(h.createdAt)}</div>
                </button>
              ))}
            </div>

            <div className="mt-4 flex gap-2">
              <Button
                className="gap-2 flex-1"
                onClick={() => {
                  setResult(null)
                  setActiveId(null)
                  setPrompt('')
                  setFiles([])
                  setError(null)
                }}
              >
                New
              </Button>
              <Button variant="ghost" onClick={clearAll} className="gap-2">
                <Trash2 size={16} /> Clear
              </Button>
            </div>

            <div className="mt-5 rounded-xl border border-white/10 bg-black/40 p-3">
              <div className="text-xs uppercase tracking-[0.18em] text-white/55">Input</div>

              <Textarea
                className="mt-2 min-h-[120px]"
                placeholder="Describe your exam: topic, date, what matters most. (Hungarian is OK)"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />

              <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-white/75 hover:bg-white/[0.04]">
                <FileUp size={16} />
                <span className="flex-1">{uploadLabel}</span>
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept="image/*,application/pdf"
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                />
              </label>

              {hasUploads && (
                <div className="mt-2 text-xs text-white/55">
                  {files.map((f) => f.name).slice(0, 4).join(', ')}{files.length > 4 ? '…' : ''}
                </div>
              )}

              <Button
                onClick={runPlan}
                disabled={loading || (!prompt.trim() && files.length === 0)}
                className="mt-3 w-full gap-2"
              >
                {loading ? <><Loader2 className="animate-spin" size={16} /> Generating…</> : 'Generate'}
              </Button>

              {error && (
                <div className="mt-3 text-sm text-red-300">
                  {error}
                </div>
              )}
            </div>
          </aside>

          {/* Main */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-white/55">Plan</div>
                <div className="mt-1 text-2xl font-semibold tracking-tight">
                  {result?.title || 'Create a plan'}
                </div>
                {result?.quick_summary && (
                  <div className="mt-2 text-sm text-white/65 max-w-[70ch]">
                    {result.quick_summary}
                  </div>
                )}
              </div>

              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 no-scrollbar">
                {(['plan','notes','daily','practice','ask','export'] as const).map((k) => (
                  <Button
                    key={k}
                    variant={tab === k ? 'primary' : 'ghost'}
                    onClick={() => setTab(k)}
                    className="shrink-0 capitalize"
                  >
                    {k}
                  </Button>
                ))}
              </div>
            </div>

            <div className="mt-6">
              {!result && (
                <div className="text-white/60">
                  Upload your material, describe your exam, then hit <span className="text-white">Generate</span>.
                </div>
              )}

              {result && tab === 'plan' && (
                <div className="space-y-4">
                  {result.daily_plan.map((d, i) => (
                    <div key={i} className="rounded-2xl border border-white/10 bg-black/40 p-5">
                      <div className="flex flex-col gap-2 md:flex-row md:items-baseline md:justify-between">
                        <div className="text-lg font-semibold">{d.day}</div>
                        <div className="text-sm text-white/60"><InlineMath content={d.focus} /> • {d.minutes} min</div>
                      </div>
                      <ul className="mt-3 space-y-2 text-sm text-white/75">
                        {d.tasks.map((t, idx) => (
                          <li key={idx} className="flex gap-2">
                            <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-white/70" />
                            <span className="flex-1"><InlineMath content={t} /></span>
                          </li>
                        ))}
                      </ul>
                      {Array.isArray(d.blocks) && d.blocks.length > 0 && (
                        <div className="mt-4 text-xs text-white/55">
                          {d.blocks.map((b, j) => (
                            <span key={j} className="mr-2 inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">
                              {b.type === 'study' ? 'Focus' : 'Break'} {b.minutes}m
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {result && tab === 'notes' && (
                <div className="rounded-2xl border border-white/10 bg-black/40 p-5 max-h-[62vh] overflow-auto">
                  <MarkdownMath content={result.study_notes || 'No notes generated.'} />

                  {result.flashcards?.length ? (
                    <div className="mt-6">
                      <div className="text-xs uppercase tracking-[0.18em] text-white/55">Flashcards</div>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        {result.flashcards.slice(0, 10).map((c, i) => (
                          <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                            <div className="text-sm font-semibold">
                              <MarkdownMath content={String(c.front ?? '')} />
                            </div>
                            <div className="mt-2 text-sm text-white/70">
                              <MarkdownMath content={String(c.back ?? '')} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {result && tab === 'daily' && (
                <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
                  <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
                    <div className="text-xs uppercase tracking-[0.18em] text-white/55">Today</div>
                    <div className="mt-2 text-lg font-semibold"><InlineMath content={result.daily_plan?.[0]?.focus || 'Focus session'} /></div>
                    <ul className="mt-3 space-y-2 text-sm text-white/75">
                      {(result.daily_plan?.[0]?.tasks ?? []).map((t, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="mt-[6px] h-1.5 w-1.5 rounded-full bg-white/70" />
                          <span className="flex-1"><InlineMath content={t} /></span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
                    <div className="text-xs uppercase tracking-[0.18em] text-white/55">Pomodoro</div>
                    <div className="mt-4">
                      <Pomodoro blocks={todayBlocks as Block[]} />
                    </div>
                  </div>
                </div>
              )}

              {result && tab === 'practice' && (
                <div className="rounded-2xl border border-white/10 bg-black/40 p-5 max-h-[68vh] overflow-auto">
                  <div className="text-xs uppercase tracking-[0.18em] text-white/55">Practice questions</div>
                  <div className="mt-3 space-y-5">
                    {result.practice_questions.slice(0, 20).map((q, i) => (
                      <div key={q.id || i} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                        <div className="text-sm font-semibold">{i + 1}.</div>
                        <div className="mt-1">
                          <MarkdownMath content={q.question} />
                        </div>
                        {q.type === 'mcq' && q.options?.length ? (
                          <ul className="mt-2 space-y-1 text-sm text-white/75">
                            {q.options.map((o, idx) => (
                              <li key={idx} className="flex gap-2"><span>•</span><span className="flex-1"><MarkdownMath content={o} /></span></li>
                            ))}
                          </ul>
                        ) : null}
                        <div className="mt-3 text-sm text-white/70">
                          <span className="text-white/50">Answer:</span>
                          <div className="mt-1"><MarkdownMath content={q.answer || "—"} /></div>
                        </div>
                        {q.explanation ? (
                          <div className="mt-2 text-xs text-white/55"><MarkdownMath content={q.explanation} /></div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === 'ask' && (
                <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
                  <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
                    <div className="text-xs uppercase tracking-[0.18em] text-white/55">Ask Examly</div>
                    <p className="mt-2 text-sm text-white/65">
                      Ask anything about the topic. Math will render nicely, and you can generate a short audio explanation.
                    </p>

                    <div className="mt-4 flex items-center gap-2">
                      <label className="text-xs text-white/60">Language</label>
                      <select
                        value={askLang}
                        onChange={(e) => setAskLang(e.target.value as 'hu' | 'en')}
                        className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/80"
                      >
                        <option value="hu">Hungarian</option>
                        <option value="en">English</option>
                      </select>
                    </div>

                    <Textarea
                      className="mt-3 min-h-[160px]"
                      placeholder={askLang === 'hu' ? 'Írd ide a kérdésed… (pl. oldd meg, magyarázd el lépésenként)' : 'Type your question… (step-by-step please)'}
                      value={askQ}
                      onChange={(e) => setAskQ(e.target.value)}
                    />

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button onClick={runAsk} disabled={askLoading || !askQ.trim()} className="gap-2">
                        {askLoading ? <><Loader2 className="animate-spin" size={16} /> Thinking…</> : 'Answer'}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={genAudio}
                        disabled={audioLoading || (!askSpeech.trim() && !askDisplay.trim())}
                        className="gap-2"
                      >
                        {audioLoading ? <><Loader2 className="animate-spin" size={16} /> Generating audio…</> : 'Generate audio'}
                      </Button>
                    </div>

                    <div className="mt-3 text-xs text-white/50">
                      Free: 2 audio / 48h. Admin: unlimited.
                    </div>

                    {askError && <div className="mt-3 text-sm text-red-300">{askError}</div>}

                    {audioUrl && (
                      <div className="mt-4">
                        <audio controls src={audioUrl} className="w-full" />
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/40 p-5 max-h-[68vh] overflow-auto">
                    <div className="text-xs uppercase tracking-[0.18em] text-white/55">Answer</div>
                    {!askDisplay ? (
                      <p className="mt-3 text-sm text-white/60">Ask a question to see the explanation here.</p>
                    ) : (
                      <div className="mt-3">
                        <MarkdownMath content={askDisplay} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {result && tab === 'export' && (
                <div className="rounded-2xl border border-white/10 bg-black/40 p-5 space-y-4">
                  <div className="text-sm text-white/70">
                    Export your notes as a PDF for offline study.
                  </div>
                  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 no-scrollbar">
                    <Button
                      onClick={async () => {
                        try {
                          const res = await authedFetch('/api/plan/pdf', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ result }),
                          })
                          if (!res.ok) throw new Error('PDF export failed')
                          const blob = await res.blob()
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          const safeTitle = String(result.title || 'examly-notes')
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, '-')
                            .replace(/(^-|-$)/g, '')
                          a.href = url
                          a.download = `${safeTitle || 'examly-notes'}.pdf`
                          document.body.appendChild(a)
                          a.click()
                          a.remove()
                          URL.revokeObjectURL(url)
                        } catch (e) {
                          // handled by existing UI; keep quiet here
                        }
                      }}
                    >
                      Download PDF
                    </Button>
                    
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const raw = JSON.stringify(result, null, 2)
                        navigator.clipboard.writeText(raw).catch(() => {})
                      }}
                    >
                      Copy JSON
                    </Button>
                  </div>

                  {result.notes?.length ? (
                    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-white/55">Notes</div>
                      <ul className="mt-2 space-y-1 text-sm text-white/70">
                        {result.notes.slice(0, 8).map((n, i) => <li key={i}>• {n}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}


export default function PlanPage() {
  return (
    <AuthGate>
      <PlanPageInner />
    </AuthGate>
  )
}

