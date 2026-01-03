'use client'

import React, { useState } from 'react'
import MarkdownMath from '@/components/MarkdownMath'
import { Loader2, Play } from 'lucide-react'
import { authedFetch } from '@/lib/authClient'

type Question = {
  id: string
  type: 'mcq' | 'open'
  question: string
  options?: string[]
}

type TestData = {
  title: string
  language: string
  duration_min: number
  questions: Question[]
}

function Panel({
  className = '',
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={'rounded-3xl border border-white/10 bg-white/5 ' + className}>
      {children}
    </div>
  )
}

export default function PracticePage() {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<TestData | null>(null)
  const [started, setStarted] = useState(false)
  const [answers, setAnswers] = useState<Record<string, string>>({})

  const generate = async () => {
    try {
      setLoading(true)
      setError(null)
      setData(null)

      const res = await authedFetch('/api/test', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Generation failed')

      setData(json)
      setStarted(false)
      setAnswers({})
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <Panel className="p-6 space-y-4">
        <textarea
          className="w-full rounded-xl border border-white/10 bg-black/20 p-3 text-sm"
          placeholder="Describe the test you want..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={generate}
            disabled={loading}
            className="rounded-xl bg-white px-4 py-2 text-black text-sm font-medium flex items-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={16} /> : 'Generate test'}
          </button>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </Panel>

      {!data && (
        <p className="text-sm text-white/50 text-center">Generate a test to see it here.</p>
      )}

      {data && (
        <Panel className="p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold">{data.title}</h2>
            <p className="text-xs text-white/50">
              Language: {data.language} • {data.duration_min} min
            </p>
          </div>

          {!started && (
            <button
              onClick={() => setStarted(true)}
              className="rounded-xl bg-white px-4 py-2 text-black text-sm font-medium flex items-center gap-2"
            >
              <Play size={16} />
              Start test
            </button>
          )}

          {started && (
            <div className="space-y-6">
              {data.questions.map((q, i) => (
                <div
                  key={q.id}
                  className="rounded-3xl border border-white/10 bg-black/20 p-4 space-y-3"
                >
                  <div className="text-sm text-white/80 flex gap-2">
                    <span>{i + 1}.</span>
                    <MarkdownMath content={q.question} />
                  </div>

                  {q.type === 'mcq' && q.options && (
                    <div className="grid gap-2">
                      {q.options.map((opt) => (
                        <label
                          key={opt}
                          className="flex items-center gap-2 cursor-pointer text-sm"
                        >
                          <input
                            type="radio"
                            name={q.id}
                            value={opt}
                            checked={answers[q.id] === opt}
                            onChange={(e) =>
                              setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                            }
                          />
                          <MarkdownMath content={opt} />
                        </label>
                      ))}
                    </div>
                  )}

                  {q.type === 'open' && (
                    <textarea
                      className="w-full rounded-xl border border-white/10 bg-black/20 p-2 text-sm"
                      placeholder="Your answer..."
                      value={answers[q.id] || ''}
                      onChange={(e) =>
                        setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}
