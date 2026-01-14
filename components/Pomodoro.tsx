'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui'
import HScroll from '@/components/HScroll'
import { Play, Pause, RotateCcw, SkipForward, CalendarDays } from 'lucide-react'

type Block = { type: 'study' | 'break'; minutes: number; label: string }
type DayPlan = { day: string; focus: string; tasks: string[]; minutes: number; blocks?: Block[] }

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function normalizeBlocks(blocks?: Block[]) {
  if (!blocks?.length) return []
  return blocks
    .filter((b) => b && Number.isFinite(b.minutes))
    .map((b) => ({
      type: b.type === 'break' ? 'break' : 'study',
      minutes: clamp(Math.round(b.minutes), 1, 240),
      label: (b.label || '').trim() || (b.type === 'break' ? 'Break' : 'Focus'),
    }))
}

function secondsToMMSS(s: number) {
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}

/**
 * Elegant mini confetti (no deps)
 * intensity:
 *  - "block" (small)
 *  - "day"   (medium)
 *  - "end"   (big)
 */
function burstConfetti(canvas: HTMLCanvasElement, intensity: 'block' | 'day' | 'end') {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
  const rect = canvas.getBoundingClientRect()
  canvas.width = Math.floor(rect.width * dpr)
  canvas.height = Math.floor(rect.height * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const W = rect.width
  const H = rect.height

  const palette = [
    'rgba(255,255,255,0.95)',
    'rgba(255,255,255,0.75)',
    'rgba(255,255,255,0.55)',
  ]

  const cfg =
    intensity === 'block'
      ? { n: 70, dur: 900, spread: 0.9, speed: 1.0 }
      : intensity === 'day'
      ? { n: 110, dur: 1100, spread: 1.05, speed: 1.15 }
      : { n: 170, dur: 1400, spread: 1.2, speed: 1.35 }

  const rand = (a: number, b: number) => a + Math.random() * (b - a)

  // launch from two “soft cannons”
  const particles = Array.from({ length: cfg.n }).map(() => {
    const side = Math.random() < 0.5 ? 'left' : 'right'
    const x = side === 'left' ? rand(30, W * 0.35) : rand(W * 0.65, W - 30)
    const y = rand(H * 0.18, H * 0.4)

    const baseVx = rand(-2.2, 2.2) * cfg.spread * cfg.speed
    const baseVy = rand(-6.8, -3.4) * cfg.speed

    return {
      x,
      y,
      vx: baseVx,
      vy: baseVy,
      g: rand(0.12, 0.24) * cfg.speed,
      rot: rand(0, Math.PI * 2),
      vrot: rand(-0.18, 0.18),
      w: rand(6, 12) * (intensity === 'end' ? 1.05 : 1.0),
      h: rand(2, 6),
      a: 1,
      va: rand(0.010, 0.018) * (intensity === 'end' ? 0.85 : 1.0),
      c: palette[Math.floor(Math.random() * palette.length)],
    }
  })

  const start = performance.now()
  const dur = cfg.dur

  const step = (t: number) => {
    const p = clamp((t - start) / dur, 0, 1)
    ctx.clearRect(0, 0, W, H)

    for (const q of particles) {
      q.vy += q.g
      q.x += q.vx
      q.y += q.vy
      q.rot += q.vrot
      q.a = Math.max(0, q.a - q.va)

      ctx.save()
      ctx.globalAlpha = q.a
      ctx.translate(q.x, q.y)
      ctx.rotate(q.rot)
      ctx.fillStyle = q.c
      ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h)
      ctx.restore()
    }

    // soft glow haze, stronger on end
    ctx.save()
    const haze = intensity === 'end' ? 0.085 : intensity === 'day' ? 0.065 : 0.05
    ctx.globalAlpha = haze * (1 - p)
    const grd = ctx.createRadialGradient(W / 2, H / 3, 0, W / 2, H / 3, Math.max(W, H) * 0.75)
    grd.addColorStop(0, '#ffffff')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grd
    ctx.fillRect(0, 0, W, H)
    ctx.restore()

    if (p < 1) requestAnimationFrame(step)
    else ctx.clearRect(0, 0, W, H)
  }

  requestAnimationFrame(step)
}

export default function Pomodoro({
  dailyPlan,
  className = '',
}: {
  dailyPlan: DayPlan[]
  className?: string
}) {
  const dayBlocks = useMemo(() => {
    return (dailyPlan ?? []).map((d) => normalizeBlocks(d?.blocks ?? []))
  }, [dailyPlan])

  const totalDays = dayBlocks.length

  const [activeDayIndex, setActiveDayIndex] = useState(0)
  const [activeBlockIndex, setActiveBlockIndex] = useState(0)
  const [running, setRunning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(25 * 60)

  const tickRef = useRef<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const blocks = dayBlocks[activeDayIndex] ?? []
  const activeBlock = blocks[activeBlockIndex] ?? null
  const phase: 'focus' | 'break' = activeBlock?.type === 'break' ? 'break' : 'focus'

  // init to day1/block1
  useEffect(() => {
    setActiveDayIndex(0)
    setActiveBlockIndex(0)
    setRunning(false)

    const first = dayBlocks[0]?.[0]
    setSecondsLeft(first ? first.minutes * 60 : 25 * 60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalDays])

  // when selecting new day/block, reset timer to that block
  useEffect(() => {
    if (!activeBlock) {
      setSecondsLeft(25 * 60)
      setRunning(false)
      return
    }
    setSecondsLeft(activeBlock.minutes * 60)
    setRunning(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDayIndex, activeBlockIndex])

  // ticking
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

  // auto-advance at 0
  useEffect(() => {
    if (!running) return
    if (secondsLeft !== 0) return

    setRunning(false)

    const blocksHere = dayBlocks[activeDayIndex] ?? []
    const isLastBlockOfDay = blocksHere.length > 0 && activeBlockIndex >= blocksHere.length - 1
    const isLastDay = totalDays > 0 && activeDayIndex >= totalDays - 1

    // ✅ ALWAYS confetti on block end (small), and bigger on day/end
    const intensity: 'block' | 'day' | 'end' =
      isLastBlockOfDay && isLastDay ? 'end' : isLastBlockOfDay ? 'day' : 'block'

    if (canvasRef.current) burstConfetti(canvasRef.current, intensity)

    // advance after small pause
    const t = window.setTimeout(() => {
      const nextBlock = activeBlockIndex + 1

      // next block same day
      if (nextBlock < blocksHere.length) {
        setActiveBlockIndex(nextBlock)
        setRunning(true)
        return
      }

      // next day
      const nextDay = activeDayIndex + 1
      if (nextDay < totalDays) {
        setActiveDayIndex(nextDay)
        setActiveBlockIndex(0)
        setRunning(true)
        return
      }

      // plan finished
      setRunning(false)
    }, 220)

    return () => window.clearTimeout(t)
  }, [secondsLeft, running, activeDayIndex, activeBlockIndex, dayBlocks, totalDays])

  const progressPct = useMemo(() => {
    if (!activeBlock) return 0
    const total = activeBlock.minutes * 60
    if (total <= 0) return 0
    return clamp(100 - (secondsLeft / total) * 100, 0, 100)
  }, [activeBlock, secondsLeft])

  const canStart = !!activeBlock
  const dayLabel = dailyPlan?.[activeDayIndex]?.day || `Day ${activeDayIndex + 1}`
  const focusLabel = dailyPlan?.[activeDayIndex]?.focus || ''

  function jumpToDay(di: number) {
    setRunning(false)
    setActiveDayIndex(di)
    setActiveBlockIndex(0)
  }

  function nextBlock() {
    const blocksHere = dayBlocks[activeDayIndex] ?? []
    if (!blocksHere.length) return
    setRunning(false)
    setActiveBlockIndex((i) => Math.min(i + 1, blocksHere.length - 1))
  }

  function nextDay() {
    if (activeDayIndex >= totalDays - 1) return
    setRunning(false)
    setActiveDayIndex((d) => Math.min(d + 1, totalDays - 1))
    setActiveBlockIndex(0)
  }

  function resetBlock() {
    if (!activeBlock) return
    setRunning(false)
    setSecondsLeft(activeBlock.minutes * 60)
  }

  // optional: manual “celebrate” click on timer title (fun but subtle)
  function manualPop() {
    if (!canvasRef.current) return
    burstConfetti(canvasRef.current, 'block')
  }

  return (
    <div className={['relative', className].join(' ')}>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
        aria-hidden="true"
      />

      <div className="relative z-[2] rounded-3xl border border-white/10 bg-white/[0.02] p-5 overflow-hidden">
        <div className="flex items-start justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <button
              type="button"
              onClick={manualPop}
              className="text-left"
              title="✨"
            >
              <div className="text-xs uppercase tracking-[0.18em] text-white/55">Pomodoro</div>
            </button>

            <div className="mt-2 text-sm text-white/60">
              <span className="inline-flex items-center gap-2">
                <CalendarDays size={14} />
                <span className="text-white/80 font-medium">{dayLabel}</span>
                <span className="text-white/40">
                  ({totalDays ? activeDayIndex + 1 : 0}/{totalDays || 0})
                </span>
              </span>
            </div>

            {focusLabel ? <div className="mt-1 text-xs text-white/50 line-clamp-1">{focusLabel}</div> : null}
          </div>

          <div className="text-right shrink-0 min-w-[122px]">
            <div className="text-xs uppercase tracking-[0.18em] text-white/55">{phase === 'break' ? 'Break' : 'Focus'}</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-white">
              {secondsToMMSS(secondsLeft)}
            </div>
          </div>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/5">
          <div className="h-full bg-white/50" style={{ width: `${progressPct}%` }} />
        </div>

        <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-4 overflow-hidden">
          <div className="flex items-start justify-between gap-3 min-w-0">
            <div className="min-w-0">
              <div className="text-xs text-white/55">Session</div>
              <div className="mt-1 text-lg font-semibold leading-snug text-white break-words">
                {activeBlock ? activeBlock.label : 'No blocks'}
              </div>
              <div className="mt-1 text-xs text-white/50">
                Block {blocks.length ? activeBlockIndex + 1 : 0}/{blocks.length || 0}
              </div>
            </div>

            <div className="shrink-0 text-right">
              <div className="text-xs text-white/55">Duration</div>
              <div className="mt-1 text-sm text-white/80">{activeBlock ? `${activeBlock.minutes}m` : '—'}</div>
            </div>
          </div>

          <HScroll className="mt-4 -mx-1 px-1 max-w-full">
            <Button onClick={() => setRunning((v) => !v)} disabled={!canStart} className="shrink-0 gap-2">
              {running ? <Pause size={16} /> : <Play size={16} />}
              {running ? 'Pause' : 'Start'}
            </Button>

            <Button variant="ghost" onClick={resetBlock} className="shrink-0 gap-2" disabled={!activeBlock}>
              <RotateCcw size={16} />
              Reset
            </Button>

            <Button
              variant="ghost"
              onClick={nextBlock}
              className="shrink-0 gap-2"
              disabled={!blocks.length || activeBlockIndex >= blocks.length - 1}
            >
              <SkipForward size={16} />
              Next block
            </Button>

            <Button
              variant="ghost"
              onClick={nextDay}
              className="shrink-0 gap-2"
              disabled={!dayBlocks.length || activeDayIndex >= dayBlocks.length - 1}
            >
              <SkipForward size={16} />
              Next day
            </Button>
          </HScroll>

          {dayBlocks.length > 1 ? (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-[0.18em] text-white/55">Jump to day</div>
              <HScroll className="mt-2 -mx-1 px-1 max-w-full">
                {dayBlocks.map((_, di) => (
                  <button
                    key={di}
                    onClick={() => jumpToDay(di)}
                    className={
                      'shrink-0 rounded-full border px-3 py-1 text-xs transition ' +
                      (di === activeDayIndex
                        ? 'border-white/20 bg-white/10 text-white/90'
                        : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10')
                    }
                    type="button"
                  >
                    {dailyPlan?.[di]?.day || `Day ${di + 1}`}
                  </button>
                ))}
              </HScroll>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
