import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui'
import { ArrowRight, Sparkles, Timer, FileUp, CheckCircle2 } from 'lucide-react'

function MiniStat({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left">
      <div className="flex items-center gap-2 text-sm text-white/90">
        <span className="text-white/80">{icon}</span>
        <span className="font-medium">{label}</span>
      </div>
    </div>
  )
}

function Feature({
  kicker,
  title,
  body,
  img,
  reverse,
}: {
  kicker: string
  title: string
  body: string
  img: string
  reverse?: boolean
}) {
  return (
    <div className={'grid items-center gap-10 py-14 md:grid-cols-2 ' + (reverse ? 'md:[&>div:first-child]:order-2' : '')}>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-[0.18em] text-white/55">{kicker}</div>
        <h3 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight">{title}</h3>
        <p className="mt-4 text-base leading-relaxed text-white/70 max-w-[52ch]">{body}</p>

        <ul className="mt-6 space-y-2 text-sm text-white/70">
          <li className="flex gap-2">
            <CheckCircle2 size={16} className="mt-[2px] text-white/70 shrink-0" /> Built from your material
          </li>
          <li className="flex gap-2">
            <CheckCircle2 size={16} className="mt-[2px] text-white/70 shrink-0" /> Clear structure, no fluff
          </li>
          <li className="flex gap-2">
            <CheckCircle2 size={16} className="mt-[2px] text-white/70 shrink-0" /> Works with PDFs and photos
          </li>
        </ul>

        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/login">
            <Button className="gap-2">
              Log in <ArrowRight size={16} />
            </Button>
          </Link>
          <Link
            href="/guide"
            className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/80 hover:text-white"
          >
            View guide
          </Link>
        </div>
      </div>

      <div className="fade-edges rounded-2xl min-w-0">
        <Image src={img} alt={title} width={1400} height={900} className="h-auto w-full" />
      </div>
    </div>
  )
}

export default function HomePage() {
  return (
    <div className="relative min-h-[calc(100vh-0px)] overflow-x-hidden">
      <div className="fixed inset-0 grid-bg pointer-events-none" />
      <div className="fixed inset-0 glow pointer-events-none" />

      <main className="mx-auto max-w-6xl px-4 py-14">
        {/* HERO (image UNDER the big text, like your old layout) */}
        <section className="mx-auto max-w-6xl">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/70">
              <Sparkles size={14} />
              Structured exam prep from your own material
            </div>

            <h1 className="mt-6 text-4xl md:text-5xl font-semibold tracking-tight">
              Turn your notes into a real study plan.
            </h1>

            <p className="mt-4 text-white/70 max-w-[70ch]">
              Upload PDFs or photos, describe the exam, and Examly builds a plan, practice questions and vocab cards. No
              endless chat, just structure.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Link href="/login">
                <Button className="w-full sm:w-auto gap-2">
                  Log in <ArrowRight size={16} />
                </Button>
              </Link>

              <Link
                href="/guide"
                className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/80 hover:text-white"
              >
                View guide
              </Link>
            </div>

            <div className="mt-10 grid gap-3 sm:grid-cols-3">
              <MiniStat icon={<FileUp size={16} />} label="PDFs + handwritten photos" />
              <MiniStat icon={<Timer size={16} />} label="Pomodoro daily flow" />
              <MiniStat icon={<Sparkles size={16} />} label="Notes + tests" />
            </div>

            {/* BIG HERO IMAGE under the main text */}
            <div className="mt-10 w-full fade-edges rounded-2xl">
              <Image src="/assets/hero.png" alt="Examly preview" width={1400} height={900} className="h-auto w-full" priority />
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section id="features" className="mx-auto max-w-6xl px-0 pt-6">
          <Feature
            kicker="Notes"
            title="Study notes that feel like a real notebook."
            body="Examly transforms your material into clear sections, key points, examples, and what teachers love to ask."
            img="/assets/feature-summary.png"
          />

          <Feature
            kicker="Practice"
            title="Practice tests from your own material."
            body="Generate questions that match the exam style, with explanations so you actually learn from mistakes."
            img="/assets/feature-test.png"
            reverse
          />

          <Feature
            kicker="Vocab"
            title="Flashcards from word lists, instantly."
            body="Paste a list or upload a photo. Examly turns it into cards you can learn from."
            img="/assets/feature-vocab.png"
          />
        </section>

        {/* CTA */}
        <section className="mt-10 rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-10">
          <div className="grid gap-8 md:grid-cols-2 md:items-center">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-[0.18em] text-white/55">Pricing</div>
              <h2 className="mt-3 text-2xl md:text-3xl font-semibold tracking-tight">
                One plan. Simple credits.
              </h2>
              <p className="mt-3 text-white/70 max-w-[70ch]">
                Pro gives you 30 generations. When credits run out, Examly can auto-recharge another 30 (best-effort).
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
              <div className="text-sm font-semibold">Pro</div>
              <div className="mt-1 text-sm text-white/70">30 generations • 3500 Ft (≈ €8.9)</div>
              <ul className="mt-3 space-y-1 text-sm text-white/65">
                <li>• Use credits on Plan, Practice, Vocab, Audio</li>
                <li>• Auto-recharge may top up when you run out</li>
              </ul>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
