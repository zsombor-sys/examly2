'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, RotateCcw, SkipForward, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui'
import HScroll from '@/components/HScroll'

type Block = { type: 'study' | 'break'; minutes: number; label: string }
type DayPlan = { day: string; focus: string; tasks: string[]; minutes: number; blocks?: Block[] }

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function secondsToMMSS(s: number) {
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}

function normalizeBlocks(blocks?: Block[]) {
  if (!blocks?.length) return []
  return blocks
    .filter((b) => b && Number.isFinite(b.minutes))
    .map((b) => ({
      type: b.type === 'break' ? 'break' : 'study',
      minutes: clamp(Math.round(Number(b.minutes)), 1, 120),
      label: (b.label || '').trim() || (b.type === 'break' ? 'Break' : 'Focus'),
    }))
}

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rot: number
  vr: number
  life: number
  maxLife: number
  shape: 'rect' | 'circle'
  color: string
  alpha: number
}

function pick<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min
}

export default function Pomodoro({
  dailyPlan,
  className = '',
}: {
  dailyPlan: DayPlan[]
  className?: string
}) {
  // ----- normalize days (blocks)
  const days = useMemo(() => {
    const src = Array.isArray(dailyPlan) ? dailyPlan : []
    return src.map((d, i) => {
      const blocks = normalizeBlocks(d?.blocks)
      return {
        dayLabel: String(d?.day ?? `Day ${i + 1}`),
        focus: String(d?.focus ?? ''),
        blocks,
      }
    })
  }, [dailyPlan])

  const hasAnyBlocks = useMemo(() => days.some((d) => d.blocks.length > 0), [days])

  // ----- timer state
  const [activeDayIndex, setActiveDayIndex] = useState(0)
  const [activeBlockIndex, setActiveBlockIndex] = useState(0)
  const [running, setRunning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(25 * 60)

  const tickRef = useRef<number | null>(null)

  const activeDay = days[activeDayIndex] ?? null
  const activeBlock = activeDay?.blocks?.[activeBlockIndex] ?? null

  // ----- confetti canvas
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const animRef = useRef<number | null>(null)
  const lastTRef = useRef<number>(0)

  const resizeCanvas = () => {
    const c = canvasRef.current
    if (!c) return
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1))
    c.width = Math.floor(window.innerWidth * dpr)
    c.height = Math.floor(window.innerHeight * dpr)
    c.style.width = `${window.innerWidth}px`
    c.style.height = `${window.innerHeight}px`
    const ctx = c.getContext('2d')
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  useEffect(() => {
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)
    return () => window.removeEventListener('resize', resizeCanvas)
  }, [])

  const fireConfetti = (mode: 'block' | 'day' | 'end' = 'block') => {
    // full-screen, visible, lots of particles
    const c = canvasRef.current
    if (!c) return

    const base = mode === 'block' ? 140 : mode === 'day' ? 220 : 360
    const gravity = mode === 'block' ? 900 : mode === 'day' ? 1050 : 1250
    const spread = mode === 'block' ? 520 : mode === 'day' ? 720 : 920

    const colors = [
      '#ffffff',
      '#a3ffea',
      '#ffd9a3',
      '#ffb3d9',
      '#b3c7ff',
      '#d7ff8a',
      '#ff8ad7',
      '#8affff',
      '#ffe98a',
    ]

    const cx = window.innerWidth * 0.5
    const cy = window.innerHeight * 0.35

    for (let i = 0; i < base; i++) {
      const angle = rand(-Math.PI, 0) // shoot upward
      const speed = rand(spread * 0.35, spread)
      const vx = Math.cos(angle) * speed * rand(0.6, 1.05)
      const vy = Math.sin(angle) * speed * rand(0.75, 1.1)

      particlesRef.current.push({
        x: cx + rand(-30, 30),
        y: cy + rand(-25, 25),
        vx,
        vy,
        size: rand(3, mode === 'end' ? 8 : 6),
        rot: rand(0, Math.PI * 2),
        vr: rand(-8, 8),
        life: 0,
        maxLife: rand(mode === 'block' ? 900 : 1200, mode === 'end' ? 1900 : 1500),
        shape: Math.random() < 0.25 ? 'circle' : 'rect',
        color: pick(colors),
        alpha: 1,
      })
    }

    if (animRef.current == null) {
      lastTRef.current = performance.now()
      animRef.current = window.requestAnimationFrame(stepAnim(gravity))
    }
  }

  const stepAnim =
    (gravity: number) =>
    (t: number) => {
      const c = canvasRef.current
      if (!c) {
        animRef.current = null
        return
      }
      const ctx = c.getContext('2d')
      if (!ctx) {
        animRef.current = null
        return
      }

      const dt = Math.min(0.033, (t - lastTRef.current) / 1000)
      lastTRef.current = t

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)

      const next: Particle[] = []
      for (const p of particlesRef.current) {
        p.life += dt * 1000
        if (p.life >= p.maxLife) continue

        // physics
        p.vy += gravity * dt
        p.vx *= 0.995
        p.vy *= 0.995

        p.x += p.vx * dt
        p.y += p.vy * dt
        p.rot += p.vr * dt

        // fade out near end
        const k = 1 - p.life / p.maxLife
        p.alpha = clamp(k * 1.2, 0, 1)

        // draw
        ctx.save()
        ctx.globalAlpha = p.alpha
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color

        if (p.shape === 'circle') {
          ctx.beginPath()
          ctx.arc(0, 0, p.size * 0.6, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size)
        }

        ctx.restore()

        next.push(p)
      }

      particlesRef.current = next

      if (particlesRef.current.length > 0) {
        animRef.current = window.requestAnimationFrame(stepAnim(gravity))
      } else {
        animRef.current = null
      }
    }

  // ----- initialize: start at Day 1, first available block
  useEffect(() => {
    if (!hasAnyBlocks) return

    // pick first day that has blocks
    const firstDay = days.findIndex((d) => d.blocks.length > 0)
    const di = firstDay >= 0 ? firstDay : 0

    setActiveDayIndex(di)
    setActiveBlockIndex(0)

    const b = days[di]?.blocks?.[0]
    setSecondsLeft((b?.minutes ?? 25) * 60)
    setRunning(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAnyBlocks])

  // ----- ticking
  useEffect(() => {
    if (!running) return
    if (!activeBlock) return

    tickRef.current = window.setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? 0 : s - 1))
    }, 1000)

    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [running, activeBlock])

  // ----- when block ends: confetti + auto advance (block -> block, day -> day)
  useEffect(() => {
    if (!running) return
    if (!activeBlock) return
    if (secondsLeft !== 0) return

    // ALWAYS confetti on every block end (study + break)
    fireConfetti('block')

    const currDay = days[activeDayIndex]
    const currBlocks = currDay?.blocks ?? []

    const nextBlockIndex = activeBlockIndex + 1

    // if next block exists in same day: go there and keep running
    if (nextBlockIndex < currBlocks.length) {
      const nb = currBlocks[nextBlockIndex]
      setActiveBlockIndex(nextBlockIndex)
      setSecondsLeft((nb?.minutes ?? 25) * 60)
      // keep running true
      return
    }

    // day finished: jump to next day that has blocks
    fireConfetti('day')

    let di = activeDayIndex + 1
    while (di < days.length && (days[di]?.blocks?.length ?? 0) === 0) di++

    // if no more days: finale and stop
    if (di >= days.length) {
      fireConfetti('end')
      setRunning(false)
      return
    }

    // jump day
    setActiveDayIndex(di)
    setActiveBlockIndex(0)
    const first = days[di]?.blocks?.[0]
    setSecondsLeft((first?.minutes ?? 25) * 60)
    // keep running true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, running])

  const progressPct = useMemo(() => {
    if (!activeBlock) return 0
    const total = activeBlock.minutes * 60
    if (total <= 0) return 0
    return clamp(100 - (secondsLeft / total) * 100, 0, 100)
  }, [activeBlock, secondsLeft])

  const jumpToDay = (di: number) => {
    const d = days[di]
    if (!d || d.blocks.length === 0) return
    setRunning(false)
    setActiveDayIndex(di)
    setActiveBlockIndex(0)
    setSecondsLeft((d.blocks[0]?.minutes ?? 25) * 60)
  }

  const resetBlock = () => {
    if (!activeBlock) return
    setRunning(false)
    setSecondsLeft(activeBlock.minutes * 60)
  }

  const skipToNext = () => {
    if (!activeDay) return
    const currBlocks = activeDay.blocks ?? []
    const nextBlockIndex = activeBlockIndex + 1
    if (nextBlockIndex < currBlocks.length) {
      setRunning(false)
      setActiveBlockIndex(nextBlockIndex)
      setSecondsLeft((currBlocks[nextBlockIndex]?.minutes ?? 25) * 60)
      return
    }
    // go next day
    let di = activeDayIndex + 1
    while (di < days.length && (days[di]?.blocks?.length ?? 0) === 0) di++
    if (di >= days.length) return
    setRunning(false)
    setActiveDayIndex(di)
    setActiveBlockIndex(0)
    setSecondsLeft((days[di]?.blocks?.[0]?.minutes ?? 25) * 60)
  }

  return (
    <div className={className}>
      {/* full-screen confetti canvas */}
      <canvas
        ref={canvasRef}
        className="pointer-events-none fixed inset-0 z-[9999]"
        aria-hidden="true"
      />

      <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 overflow-hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-[0.18em] text-white/55">Pomodoro</div>

          <button
            onClick={() => fireConfetti('block')}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
            title="Test confetti"
          >
            <Sparkles size={14} />
            Confetti
          </button>
        </div>

        {/* Day jump pills */}
        <div className="mt-3">
          <HScroll className="-mx-1 px-1">
            {days.map((d, i) => {
              const disabled = d.blocks.length === 0
              const active = i === activeDayIndex
              return (
                <button
                  key={i}
                  onClick={() => jumpToDay(i)}
                  disabled={disabled}
                  className={[
                    'shrink-0 rounded-full border px-3 py-1 text-xs transition',
                    disabled ? 'opacity-40 cursor-not-allowed border-white/10 bg-white/5 text-white/50' : '',
                    active
                      ? 'border-white/20 bg-white/10 text-white'
                      : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10',
                  ].join(' ')}
                >
                  {d.dayLabel || `Day ${i + 1}`}
                </button>
              )
            })}
          </HScroll>
        </div>

        <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-4 overflow-hidden">
          <div className="flex items-start justify-between gap-3 min-w-0">
            <div className="min-w-0">
              <div className="text-xs text-white/55">Day</div>
              <div className="mt-1 text-sm font-semibold text-white/90 break-words">
                {activeDay ? activeDay.dayLabel : 'No day'}
              </div>

              <div className="mt-3 text-xs text-white/55">Session</div>
              <div className="mt-1 text-lg font-semibold leading-snug text-white break-words">
                {activeBlock ? activeBlock.label : 'No blocks'}
              </div>

              <div className="mt-1 text-sm text-white/60">
                {activeBlock ? (activeBlock.type === 'break' ? 'Break time' : 'Focus time') : '—'}
              </div>
            </div>

            <div className="text-right shrink-0 min-w-[120px]">
              <div className="text-xs uppercase tracking-[0.18em] text-white/55">Timer</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums text-white">
                {secondsToMMSS(secondsLeft)}
              </div>
            </div>
          </div>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/5">
            {activeBlock ? <div className="h-full bg-white/50" style={{ width: `${progressPct}%` }} /> : null}
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
              onClick={resetBlock}
              className="shrink-0 gap-2"
              disabled={!activeBlock}
            >
              <RotateCcw size={16} />
              Reset
            </Button>

            <Button
              variant="ghost"
              onClick={skipToNext}
              className="shrink-0 gap-2"
              disabled={!activeBlock}
            >
              <SkipForward size={16} />
              Next
            </Button>
          </HScroll>

          <div className="mt-3 text-xs text-white/50">
            Block {activeBlock ? activeBlockIndex + 1 : 0}/{activeDay?.blocks?.length ?? 0} • Day{' '}
            {activeDayIndex + 1}/{days.length}
          </div>
        </div>
      </div>
    </div>
  )
}
