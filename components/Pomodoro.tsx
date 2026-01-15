'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, RotateCcw, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui'
import HScroll from '@/components/HScroll'
import confetti from 'canvas-confetti'

type Block = { type: 'study' | 'break'; minutes: number; label: string }
type DayPlan = { day: string; blocks?: Block[] }

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function normalizeBlocks(blocks?: Block[]) {
  if (!blocks?.length) return []
  return blocks
    .filter((b) => b && Number.isFinite(b.minutes))
    .map((b) => ({
      type: b.type === 'break' ? 'break' : 'study',
      minutes: clamp(Math.round(Number(b.minutes)), 1, 180),
      label: String(b.label ?? '').trim() || (b.type === 'break' ? 'Break' : 'Focus'),
    }))
}

function secondsToMMSS(s: number) {
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}

// Fullscreen-ish confetti burst (no portal needed)
function fireConfetti() {
  const duration = 1400
  const end = Date.now() + duration

  const frame = () => {
    confetti({
      particleCount: 10,
      startVelocity: 45,
      spread: 75,
      ticks: 180,
      origin: { x: Math.random() * 0.2 + 0.1, y: 0.75 },
    })
    confetti({
      particleCount: 10,
      startVelocity: 45,
      spread: 75,
      ticks: 180,
      origin: { x: Math.random() * 0.2 + 0.7, y: 0.75 },
    })

    if (Date.now() < end) requestAnimationFrame(frame)
  }

  // big initial pop
  confetti({
    particleCount: 160,
    spread: 100,
    startVelocity: 55,
    ticks: 220,
    origin: { y: 0.65 },
  })

  requestAnimationFrame(frame)
}

export default function Pomodoro({
  dailyPlan,
  className = '',
}: {
  dailyPlan: DayPlan[]
  className?: string
}) {
  const [activeDayIndex, setActiveDayIndex] = useState(0)
  const [activeBlockIndex, setActiveBlockIndex] = useState(0)
  const [running, setRunning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(0)

  const intervalRef = useRef<number | null>(null)

  const blocks = useMemo(() => normalizeBlocks(dailyPlan?.[activeDayIndex]?.blocks ?? []), [dailyPlan, activeDayIndex])
  const activeBlock = blocks[activeBlockIndex] ?? null

  // Start at day 1, block 1
  useEffect(() => {
    setActiveDayIndex(0)
    setActiveBlockIndex(0)
    setRunning(false)
  }, [dailyPlan?.length])

  // When day/block changes, load new seconds
  useEffect(() => {
    if (!activeBlock) {
      setSecondsLeft(0)
      setRunning(false)
      return
    }
    setSecondsLeft(activeBlock.minutes * 60)
    setRunning(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDayIndex, activeBlockIndex])

  // Tick
  useEffect(() => {
    if (!running) return

    intervalRef.current = window.setInterval(() => {
      setSecondsLeft((s) => s - 1)
    }, 1000)

    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [running])

  // When reaches 0 or less -> CONFETTI + auto advance
  useEffect(() => {
    if (!running) return
    if (!activeBlock) return
    if (secondsLeft > 0) return

    // stop + confetti
    setRunning(false)
    fireConfetti()

    // advance after a short delay so UI feels "celebration -> move"
    window.setTimeout(() => {
      // next block in the SAME day
      if (activeBlockIndex + 1 < blocks.length) {
        setActiveBlockIndex((i) => i + 1)
        return
      }

      // next day
      if (activeDayIndex + 1 < dailyPlan.length) {
        setActiveDayIndex((d) => d + 1)
        setActiveBlockIndex(0)
        return
      }

      // end of all days: stay at last block, just reset time
      if (activeBlock) {
        setSecondsLeft(activeBlock.minutes * 60)
      }
    }, 450)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft])

  const dayLabel = dailyPlan?.[activeDayIndex]?.day ?? `Day ${activeDayIndex + 1}`

  const progressPct = useMemo(() => {
    if (!activeBlock) return 0
    const total = activeBlock.minutes * 60
    if (total <= 0) return 0
    return Math.max(0, Math.min(100, 100 - (secondsLeft / total) * 100))
  }, [activeBlock, secondsLeft])

  const canNext =
    (activeBlockIndex + 1 < blocks.length) || (activeDayIndex + 1 < (dailyPlan?.length ?? 0))

  return (
    <div className={['rounded-3xl border border-white/10 bg-white/[0.02] p-5 overflow-hidden', className].join(' ')}>
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.18em] text-white/55">Pomodoro</div>
          <div className="mt-2 text-xs text-white/50">{dayLabel}</div>
          <div className="mt-1 text-lg font-semibold leading-snug text-white break-words">
            {activeBlock ? activeBlock.label : 'No blocks'}
          </div>
        </div>

        <div className="text-right shrink-0 min-w-[120px]">
          <div className="text-xs uppercase tracking-[0.18em] text-white/55">Timer</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums text-white">
            {secondsToMMSS(Math.max(0, secondsLeft))}
          </div>
        </div>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/5">
        <div className="h-full bg-white/50 transition-all" style={{ width: `${progressPct}%` }} />
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
          onClick={() => {
            // manual next also gives confetti (as "nice feedback")
            fireConfetti()

            if (activeBlockIndex + 1 < blocks.length) {
              setActiveBlockIndex((i) => i + 1)
              return
            }
            if (activeDayIndex + 1 < dailyPlan.length) {
              setActiveDayIndex((d) => d + 1)
              setActiveBlockIndex(0)
              return
            }
          }}
          className="shrink-0 gap-2"
          disabled={!canNext}
        >
          <SkipForward size={16} />
          Next
        </Button>
      </HScroll>

      <div className="mt-3 text-xs text-white/50">
        Day {activeDayIndex + 1}/{dailyPlan?.length || 0} • Block {blocks.length ? activeBlockIndex + 1 : 0}/
        {blocks.length || 0}
      </div>
    </div>
  )
}
