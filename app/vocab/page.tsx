'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Textarea } from '@/components/ui'
import FlipCard from '@/components/FlipCard'
import { FileUp, Loader2, RotateCcw, ArrowLeftRight } from 'lucide-react'
import AuthGate from '@/components/AuthGate'
import { authedFetch } from '@/lib/authClient'
import { supabase } from '@/lib/supabaseClient'

type Item = { term: string; translation: string; example?: string }
type Payload = { title: string; language: string; items: Item[] }

const LANGS: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'de', label: 'German' },
  { code: 'es', label: 'Spanish' },
  { code: 'it', label: 'Italian' },
  { code: 'la', label: 'Latin' },
]

type SavedSet = {
  id: string
  createdAt: number
  sourceLang: string
  targetLang: string
  swappedView: boolean
  data: Payload
}

const HISTORY_KEY = 'examly:vocabsets:v1'

function nowId() {
  return Math.random().toString(16).slice(2) + '-' + Date.now().toString(16)
}

function fmtDate(ts: number) {
  const d = new Date(ts)
  return d.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function parseWords(raw: string) {
  const cleaned = raw.replace(/\r/g, '\n')
  const parts = cleaned
    .split(/\n|,|;|\t/)
    .map((s) => s.trim())
    .filter(Boolean)
  // de-dupe while preserving order
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

function VocabPageInner() {
  const [tab, setTab] = useState<'cards' | 'history' | 'learn'>('cards')
  const [raw, setRaw] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [sourceLang, setSourceLang] = useState('en')
  const [targetLang, setTargetLang] = useState('hu')
  const [swappedView, setSwappedView] = useState(false)

  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [history, setHistory] = useState<SavedSet[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  // Learn mode state (quiz)
  const [learnStarted, setLearnStarted] = useState(false)
  const [learnMode, setLearnMode] = useState<'type' | 'mcq'>('type')
  const [queue, setQueue] = useState<number[]>([])
  const [current, setCurrent] = useState<number | null>(null)
  const [answer, setAnswer] = useState('')
  const [reveal, setReveal] = useState(false)
  const [pendingRequeue, setPendingRequeue] = useState(false)
  const [correctCount, setCorrectCount] = useState(0)
  const [wrongCount, setWrongCount] = useState(0)
  const [wrongTerms, setWrongTerms] = useState<Record<string, number>>({})
  const [streak, setStreak] = useState(0)
  const [sessionStart, setSessionStart] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  const [finished, setFinished] = useState(false)

  const totalCards = data?.items?.length ?? 0

  useEffect(() => {
    // Prefer Supabase history if the user is signed in.
    ;(async () => {
      try {
        const userRes = await supabase?.auth.getUser()
        const user = userRes?.data?.user

        if (supabase && user) {
          const { data: rows, error } = await supabase
            .from('vocab_sets')
            .select('id, created_at, from_lang, to_lang, cards')
            .order('created_at', { ascending: false })
            .limit(40)

          if (!error && Array.isArray(rows)) {
            const mapped: SavedSet[] = rows.map((r: any) => ({
              id: r.id,
              createdAt: new Date(r.created_at).getTime(),
              sourceLang: r.from_lang,
              targetLang: r.to_lang,
              swappedView: false,
              data: {
                title: 'Saved set',
                language: `${r.from_lang}→${r.to_lang}`,
                items: Array.isArray(r.cards)
                  ? r.cards.map((c: any) => ({ term: c.term, translation: c.translation, example: c.example }))
                  : [],
              },
            }))

            setHistory(mapped)
            if (mapped[0]?.id) {
              setActiveId(mapped[0].id)
              setData(mapped[0].data)
              setSourceLang(mapped[0].sourceLang)
              setTargetLang(mapped[0].targetLang)
              setSwappedView(!!mapped[0].swappedView)
            }
            return
          }
        }

        // Fallback: localStorage history
        const raw = localStorage.getItem(HISTORY_KEY)
        if (!raw) return
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          setHistory(parsed)
          if (parsed[0]?.id) {
            setActiveId(parsed[0].id)
            setData(parsed[0].data)
            setSourceLang(parsed[0].sourceLang)
            setTargetLang(parsed[0].targetLang)
            setSwappedView(!!parsed[0].swappedView)
          }
        }
      } catch {
        // ignore
      }
    })()
  }, [])

  function saveHistory(next: SavedSet[]) {
    setHistory(next)
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next.slice(0, 40))) } catch {}
  }

  function loadSaved(id: string) {
    const found = history.find((h) => h.id === id)
    if (!found) return
    setActiveId(found.id)
    setData(found.data)
    setSourceLang(found.sourceLang)
    setTargetLang(found.targetLang)
    setSwappedView(!!found.swappedView)
    setTab('cards')
  }

  function clearAll() {
    setHistory([])
    setActiveId(null)
    try { localStorage.removeItem(HISTORY_KEY) } catch {}
  }

  const words = useMemo(() => parseWords(raw), [raw])

  const sourceLabel = useMemo(() => LANGS.find((l) => l.code === sourceLang)?.label ?? sourceLang, [sourceLang])
  const targetLabel = useMemo(() => LANGS.find((l) => l.code === targetLang)?.label ?? targetLang, [targetLang])

  function swapDirection() {
    // Swap the translation direction (e.g. EN → HU becomes HU → EN)
    // and also flip the card UI so it stays intuitive.
    setSourceLang(targetLang)
    setTargetLang(sourceLang)
    setSwappedView((v) => !v)
  }

  async function generate() {
    setError(null)
      return
    }

    // Free plan hard-cap: 70 words (client side). Admin override: unlimited.
    const trimmed = isAdmin ? words : words.slice(0, 70)

    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('words', trimmed.join('\n'))
      fd.append('sourceLang', sourceLang)
      fd.append('targetLang', targetLang)
      for (const f of files) fd.append('files', f, f.name)

      const res = await authedFetch('/api/vocab', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Request failed')
      setData(json)

      // If signed in, persist to Supabase so it follows the account (not the browser).
      let persistedId: string | null = null
      let persistedCreatedAt: number | null = null
      try {
        const userRes = await supabase?.auth.getUser()
        const user = userRes?.data?.user
        if (supabase && user) {
          const cards = (json?.items ?? []).map((it: Item) => ({
            term: it.term,
            translation: it.translation,
            example: it.example,
          }))
          const { data: row, error } = await supabase
            .from('vocab_sets')
            .insert({ user_id: user.id, from_lang: sourceLang, to_lang: targetLang, cards })
            .select('id, created_at')
            .single()
          if (!error && row?.id) {
            persistedId = row.id
            persistedCreatedAt = row.created_at ? new Date(row.created_at).getTime() : Date.now()
          }
        }
      } catch {
        // ignore persistence errors; local history still works.
      }

      // Save to history so good sets don't disappear.
      const item: SavedSet = {
        id: persistedId ?? nowId(),
        createdAt: persistedCreatedAt ?? Date.now(),
        sourceLang,
        targetLang,
        swappedView,
        data: json,
      }

      const next = [item, ...history].slice(0, 40)
      setActiveId(item.id)
      // Keep local history for instant UX even when we also saved to DB.
      saveHistory(next)
      setTab('cards')
    } catch (e: any) {
      setError(e?.message ?? 'Error')
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setRaw('')
    setFiles([])
    setData(null)
    setError(null)
  }

  function normalizeGuess(s: string) {
    return s
      .trim()
      .toLowerCase()
      .replace(/[“”"']/g, '')
      .replace(/\s+/g, ' ')
  }

  function splitAcceptedAnswers(s: string) {
    // allow multiple answers separated by comma, semicolon, slash, or " / "
    return s
      .split(/[,;/]| \/\s?|\s\/\s/g)
      .map((x) => normalizeGuess(x))
      .filter(Boolean)
  }

  function buildInitialQueue(n: number) {
    const arr = Array.from({ length: n }, (_, i) => i)
    // light shuffle to avoid always same order
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }

  function startLearnSession() {
    if (!data?.items?.length) return
    const q = buildInitialQueue(data.items.length)
    setQueue(q)
    setCurrent(q[0] ?? null)
    setLearnStarted(true)
    setFinished(false)
    setReveal(false)
    setPendingRequeue(false)
    setAnswer('')
    setCorrectCount(0)
    setWrongCount(0)
    setWrongTerms({})
    setStreak(0)
    setSessionStart(Date.now())
  }

  function popNextFromQueue(nextQueue: number[]) {
    if (nextQueue.length === 0) {
      setFinished(true)
      setCurrent(null)
      return
    }
    setQueue(nextQueue)
    setCurrent(nextQueue[0] ?? null)
    setAnswer('')
    setReveal(false)
    setPendingRequeue(false)
  }

  function markWrong(term: string) {
    setWrongTerms((prev) => ({ ...prev, [term]: (prev[term] ?? 0) + 1 }))
  }

  function handleCorrect() {
    if (!data || current == null) return
    const nextQueue = queue.slice(1) // drop current
    setCorrectCount((x) => x + 1)
    setStreak((s) => s + 1)
    setPendingRequeue(false)
    popNextFromQueue(nextQueue)
  }

  function handleWrong(showAnswer = true) {
    if (!data || current == null) return
    const card = data.items[current]
    setWrongCount((x) => x + 1)
    setStreak(0)
    markWrong(card.term)
    setPendingRequeue(true)
    if (showAnswer) setReveal(true)
  }

  function continueAfterReveal() {
    if (!data || current == null) return
    const rest = queue.slice(1)
    if (pendingRequeue) {
      const insertAt = Math.min(rest.length, 2 + Math.floor(rest.length * 0.4))
      const nextQueue = rest.slice(0, insertAt).concat([current]).concat(rest.slice(insertAt))
      setPendingRequeue(false)
      popNextFromQueue(nextQueue)
      return
    }
    popNextFromQueue(rest)
  }

  function checkTypedAnswer() {
    if (!data || current == null) return
    const card = data.items[current]
    const guess = normalizeGuess(answer)
    const accepted = splitAcceptedAnswers(card.translation)
    const ok = accepted.includes(guess)
    if (ok) {
      handleCorrect()
    } else {
      handleWrong(true)
    }
  }

  function makeChoices(correct: string, allTranslations: string[]) {
    const pool = allTranslations.filter((t) => t !== correct)
    const choices = [correct]
    while (choices.length < 4 && pool.length > 0) {
      const pick = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]
      choices.push(pick)
    }
    // shuffle
    for (let i = choices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[choices[i], choices[j]] = [choices[j], choices[i]]
    }
    return choices
  }

  function checkChoice(chosen: string) {
    if (!data || current == null) return
    const card = data.items[current]
    const ok = normalizeGuess(chosen) === normalizeGuess(card.translation)
    if (ok) {
      handleCorrect()
    } else {
      handleWrong(true)
    }
  }



  useEffect(() => {
    if (!learnStarted || finished || !sessionStart) return
    const id = window.setInterval(() => setTick((t) => t + 1), 500)
    return () => window.clearInterval(id)
  }, [learnStarted, finished, sessionStart])

  const elapsedMs = useMemo(() => {
    if (!sessionStart) return 0
    const now = Date.now()
    return Math.max(0, now - sessionStart)
  }, [sessionStart, tick])

  function formatTime(ms: number) {
    const total = Math.floor(ms / 1000)
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }


  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Vocab</h1>
          <p className="mt-2 text-white/70 max-w-[70ch]">
            Paste a word list or upload a photo of your vocab sheet. Examly turns it into flashcards you can actually use (any language pair).
          </p>
          <p className="mt-1 text-xs text-white/50">
            Free: 1 set / 48h (max 70 words). Pro: unlimited.
          </p>
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 no-scrollbar">
          <Button
            className="shrink-0"
            variant={tab === 'cards' ? 'primary' : 'ghost'}
            onClick={() => setTab('cards')}
          >
            Cards
          </Button>
          <Button
            className="shrink-0"
            variant={tab === 'history' ? 'primary' : 'ghost'}
            onClick={() => setTab('history')}
          >
            History
          </Button>
          <Button
            className="shrink-0"
            variant={tab === 'learn' ? 'primary' : 'ghost'}
            onClick={() => setTab('learn')}
          >
            Learn
          </Button>
          <Button className="shrink-0" variant="ghost" onClick={reset}><RotateCcw size={16} /> Reset</Button>
          <Button className="shrink-0" onClick={generate} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" size={16} /> : <FileUp size={16} />}
            Generate set
          </Button>
        </div>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Card>
          <div className="text-xs uppercase tracking-[0.18em] text-white/55">Input</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-xs text-white/60">From</label>
            <select
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
              className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/80"
            >
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>

            <Button variant="ghost" onClick={swapDirection} className="gap-2">
              <ArrowLeftRight size={16} /> Swap
            </Button>

            <label className="text-xs text-white/60">To</label>
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/80"
            >
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>
          <Textarea
            className="mt-3 min-h-[240px]"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={"Paste words (one per line)\n\nExample:\napple - alma\ndog - kutya\nbook - könyv"}
          />
          <div className="mt-4 flex items-center justify-between">
            <div className="text-xs text-white/55">{words.length} words detected</div>
            <label className="text-xs text-white/70 cursor-pointer inline-flex items-center gap-2">
              <input
                className="hidden"
                type="file"
                multiple
                accept="image/*"
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
              <span className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">Upload photo</span>
            </label>
          </div>
          {files.length > 0 && (
            <div className="mt-2 text-xs text-white/60">
              {files.length} image(s) attached
            </div>
          )}
          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        </Card>

        <Card>
          {tab === 'history' ? (
            <>
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-[0.18em] text-white/55">History</div>
                <Button variant="ghost" onClick={clearAll} className="gap-2">Clear</Button>
              </div>
              {history.length === 0 ? (
                <p className="mt-3 text-sm text-white/60">No saved sets yet. Generate one and it will appear here.</p>
              ) : (
                <div className="mt-4 space-y-2 max-h-[520px] overflow-auto pr-2">
                  {history.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => loadSaved(h.id)}
                      className={
                        'w-full text-left rounded-xl px-3 py-2 border ' +
                        (activeId === h.id
                          ? 'border-white/20 bg-white/[0.06]'
                          : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]')
                      }
                    >
                      <div className="text-sm font-medium truncate">{h.data?.title || 'Vocab set'}</div>
                      <div className="mt-1 text-xs text-white/55">
                        {LANGS.find((l) => l.code === h.sourceLang)?.label ?? h.sourceLang} → {LANGS.find((l) => l.code === h.targetLang)?.label ?? h.targetLang}
                        {' '}• {fmtDate(h.createdAt)}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : tab === 'learn' ? (
            <>
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-[0.18em] text-white/55">Learn</div>
                <div className="flex items-center gap-2">
                  <Button variant={learnMode === 'type' ? 'primary' : 'ghost'} onClick={() => setLearnMode('type')}>Type</Button>
                  <Button
                    variant={learnMode === 'mcq' ? 'primary' : 'ghost'}
                    onClick={() => setLearnMode('mcq')}
                    disabled={(data?.items?.length ?? 0) < 4}
                    title={(data?.items?.length ?? 0) < 4 ? 'Need at least 4 cards' : undefined}
                  >
                    4 choices
                  </Button>
                  <Button onClick={startLearnSession} disabled={!data?.items?.length}>
                    {learnStarted && !finished ? 'Restart' : 'Start'}
                  </Button>
                </div>
              </div>

              {!data?.items?.length ? (
                <p className="mt-3 text-sm text-white/60">Generate a set first, then come back here to learn it quiz-style.</p>
              ) : finished ? (
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-lg font-semibold">Session summary</div>
                    <div className="text-sm text-white/70">Time: <span className="font-medium text-white">{formatTime(elapsedMs)}</span></div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-white/60">Correct</div><div className="mt-1 text-2xl font-semibold">{correctCount}</div></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-white/60">Wrong</div><div className="mt-1 text-2xl font-semibold">{wrongCount}</div></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-white/60">Total</div><div className="mt-1 text-2xl font-semibold">{totalCards}</div></div>
                  </div>

                  {Object.keys(wrongTerms).length > 0 ? (
                    <>
                      <div className="mt-4 text-sm text-white/70">Review these again (you missed them at least once):</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {Object.entries(wrongTerms)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 18)
                          .map(([term, c]) => (
                            <span key={term} className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/80">
                              {term} <span className="text-white/50">×{c}</span>
                            </span>
                          ))}
                      </div>
                    </>
                  ) : (
                    <div className="mt-4 text-sm text-white/70">Perfect run. Nothing to review.</div>
                  )}

                  <div className="mt-5 flex gap-2">
                    <Button onClick={startLearnSession}>Learn again</Button>
                    <Button variant="ghost" onClick={() => setTab('cards')}>Back to cards</Button>
                  </div>
                </div>
              ) : !learnStarted ? (
                <p className="mt-3 text-sm text-white/60">Press <span className="text-white">Start</span> to begin. Wrong answers will come back later (Quizlet-style).</p>
              ) : (
                <>
                  <div className="mt-3 flex items-center justify-between text-sm text-white/70">
                    <div>
                      Progress: <span className="text-white font-medium">{correctCount}/{totalCards}</span> correct
                      {wrongCount > 0 ? <span className="text-white/50"> · {wrongCount} wrong</span> : null}
                      {streak > 1 ? <span className="text-white/50"> · streak {streak}</span> : null}
                    </div>
                    <div>Time: <span className="text-white font-medium">{formatTime(elapsedMs)}</span></div>
                  </div>

                  {(() => {
                    if (!data || current == null) return null
                    const card = data.items[current]
                    const allTranslations = data.items.map((x) => x.translation)
                    const choices = learnMode === 'mcq' ? makeChoices(card.translation, allTranslations) : []
                    const fromLabel = LANGS.find((l) => l.code === sourceLang)?.label ?? sourceLang
                    const toLabel = LANGS.find((l) => l.code === targetLang)?.label ?? targetLang
                    return (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-white/55">{fromLabel}</div>
                        <div className="mt-2 text-3xl font-semibold leading-tight">{card.term}</div>

                        {reveal ? (
                          <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-3">
                            <div className="text-xs uppercase tracking-[0.18em] text-white/55">{toLabel}</div>
                            <div className="mt-1 text-lg font-semibold">{card.translation}</div>
                            {card.example ? <div className="mt-2 text-sm text-white/70">{card.example}</div> : null}
                            <div className="mt-3 flex gap-2">
                              <Button onClick={continueAfterReveal}>Next</Button>
                              <Button variant="ghost" onClick={() => setReveal(false)}>Hide answer</Button>
                            </div>
                          </div>
                        ) : learnMode === 'mcq' && choices.length >= 2 ? (
                          <div className="mt-5 grid grid-cols-1 gap-2">
                            {choices.map((c) => (
                              <button
                                key={c}
                                onClick={() => checkChoice(c)}
                                className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left text-white/90 hover:bg-black/30 transition"
                              >
                                {c}
                              </button>
                            ))}
                            <div className="mt-2 flex gap-2">
                              <Button variant="ghost" onClick={() => handleWrong(true)}>Skip</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-5">
                            <div className="text-sm text-white/70">Type the translation, then press <span className="text-white">Check</span>.</div>
                            <input
                              value={answer}
                              onChange={(e) => setAnswer(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') checkTypedAnswer() }}
                              placeholder={`Type in ${toLabel}...`}
                              className="mt-3 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none focus:border-white/25"
                            />
                            <div className="mt-3 flex gap-2">
                              <Button onClick={checkTypedAnswer} disabled={!answer.trim()}>Check</Button>
                              <Button variant="ghost" onClick={() => handleWrong(true)}>Skip</Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </>
              )}
            </>
          ) : (
            <>
              <div className="text-xs uppercase tracking-[0.18em] text-white/55">Flashcards</div>
              {!data ? (
                <p className="mt-3 text-sm text-white/60">Generate a set to see your cards here.</p>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 max-h-[520px] overflow-auto pr-2">
                  {data.items.map((it, i) => (
                    <div key={i}>
                      <FlipCard
                        front={swappedView ? it.translation : it.term}
                        back={swappedView ? it.term : it.translation}
                        hintFront={swappedView ? LANGS.find((l) => l.code === targetLang)?.label : LANGS.find((l) => l.code === sourceLang)?.label}
                        hintBack={swappedView ? LANGS.find((l) => l.code === sourceLang)?.label : LANGS.find((l) => l.code === targetLang)?.label}
                      />
                      {it.example ? <div className="mt-2 text-xs text-white/55">{it.example}</div> : null}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  )
}


export default function VocabPage() {
  return (
    <AuthGate>
      <VocabPageInner />
    </AuthGate>
  )
}

