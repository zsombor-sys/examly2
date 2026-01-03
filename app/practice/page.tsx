'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Textarea } from '@/components/ui'
import { Loader2, Play, RotateCcw } from 'lucide-react'
import AuthGate from '@/components/AuthGate'
import { authedFetch } from '@/lib/authClient'
import MarkdownMath from '@/components/MarkdownMath'

type Q = { id: string; type: 'mcq' | 'short'; question: string; options?: string[]; answer: string }

type TestPayload = {
  title: string
  language: string
  duration_minutes: number
  questions: Q[]
}

function PracticePageInner() {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<TestPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [leftSec, setLeftSec] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [showKey, setShowKey] = useState(false)

  const score = useMemo(() => {
    if (!data) return null
    let correct = 0
    for (const q of data.questions) {
      const a = (answers[q.id] ?? '').trim().toLowerCase()
      const b = (q.answer ?? '').trim().toLowerCase()
      if (!a) continue
      if (q.type === 'mcq') {
        if (a === b) correct += 1
      } else {
        // rough check: contains key answer tokens
        if (b.length && a.includes(b.slice(0, Math.min(10, b.length)))) correct += 1
      }
    }
    return { correct, total: data.questions.length }
  }, [answers, data])

  useEffect(() => {
    if (!started || leftSec <= 0) return
    const t = setInterval(() => setLeftSec((s) => s - 1), 1000)
    return () => clearInterval(t)
  }, [started, leftSec])

  async function generate() {
      return
    }
    setLoading(true)
    setError(null)
    setData(null)
    setStarted(false)
    setAnswers({})

    try {
      const res = await authedFetch('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Failed')
      setData(json)
      setLeftSec((json.duration_minutes ?? 15) * 60)
    } catch (e: any) {
      setError(e?.message ?? 'Failed')
    } finally {
      setLoading(false)
    }
  }

  function start() {
    if (!data) return
    setStarted(true)
    setLeftSec(data.duration_minutes * 60)
    setShowKey(false)
  }

  function reset() {
    setStarted(false)
    if (data) setLeftSec(data.duration_minutes * 60)
    setAnswers({})
    setShowKey(false)
  }

  const mm = String(Math.max(0, Math.floor(leftSec / 60))).padStart(2, '0')
  const ss = String(Math.max(0, leftSec % 60)).padStart(2, '0')

  return (
    <div className="mx-auto max-w-6xl px-4 pt-10">
      <h1 className="text-3xl font-semibold">Practice</h1>
      <p className="mt-2 text-muted">
        Generate a quiz from your material. Tip: paste a summary or upload in Plan first, then copy the quick summary here.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Card className="p-6">
          <div className="text-sm text-white/70">Test generator</div>
          <div className="mt-4">
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Example: World War II overview, answer in English, 10 questions, 15 minutes." />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={generate} disabled={loading || !prompt} className="gap-2">
              {loading ? <Loader2 className="animate-spin" size={16} /> : null}
              Generate test
            </Button>
            {error ? <span className="text-sm text-red-200">{error}</span> : null}
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-white/70">Test</div>
              <div className="text-xs text-white/40">Timer + grading (MVP)</div>
            </div>
            <div className="-mx-1 flex flex-wrap items-center justify-end gap-2 px-1">
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">{mm}:{ss}</div>
              <Button variant="ghost" onClick={reset} disabled={!data} className="gap-2"><RotateCcw size={16} />Reset</Button>
              <Button onClick={start} disabled={!data || started} className="gap-2"><Play size={16} />Start</Button>
              <Button variant="ghost" onClick={() => setShowKey((s) => !s)} disabled={!data || started}>
                {showKey ? 'Hide key' : 'Show key'}
              </Button>
            </div>
          </div>

          {!data ? (
            <div className="mt-6 text-sm text-white/50">Generate a test to see it here.</div>
          ) : (
            <div className="mt-6 space-y-4">
              <div>
                <div className="text-lg font-semibold">{data.title}</div>
                <div className="text-xs text-white/50">Language: {data.language} · {data.duration_minutes} min</div>
                {score ? (
                  <div className="mt-2 text-xs text-white/60">Score (rough): {score.correct}/{score.total}</div>
                ) : null}
              </div>

              <div className="space-y-3">
                {data.questions.map((q, i) => (
                  <div key={q.id} className="rounded-3xl border border-white/10 bg-white/5 p-4">
                    <div className="text-sm text-white/80">
                      <span className="mr-2">{i + 1}.</span>
                      <span className="inline-block align-middle"><MarkdownMath content={q.question} /></span>
                    </div>

                    {q.type === 'mcq' && q.options ? (
                      <div className="mt-3 grid gap-2">
                        {q.options.map((o) => (
                          <label key={o} className="flex cursor-pointer items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70 hover:bg-black/30">
                            <input
                              type="radio"
                              name={q.id}
                              value={o}
                              disabled={!started || leftSec <= 0}
                              checked={(answers[q.id] ?? '') === o}
                              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                            />
                            <span className="flex-1"><MarkdownMath content={o} /></span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <textarea
                        className="mt-3 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/80 placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
                        placeholder="Your answer…"
                        disabled={!started || leftSec <= 0}
                        value={answers[q.id] ?? ''}
                        onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                      />
                    )}

                    {showKey || leftSec <= 0 ? (
                      <div className="mt-3 text-xs text-white/40">Answer key: {q.answer}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}


export default function PracticePage() {
  return (
    <AuthGate>
      <PracticePageInner />
    </AuthGate>
  )
}

