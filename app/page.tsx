
import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui'
import { ArrowRight, Sparkles, Timer, FileUp, CheckCircle2 } from 'lucide-react'

function MiniStat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left">
      <div className="flex items-center gap-2 text-sm text-white/90">
        <span className="text-white/80">{icon}</span>
        <span className="font-medium">{label}</span>
      </div>
    </div>
  )
}

function Feature({ kicker, title, body, img, reverse }: { kicker: string; title: string; body: string; img: string; reverse?: boolean }) {
  return (
    <div className={"grid items-center gap-10 py-14 md:grid-cols-2 " + (reverse ? "md:[&>div:first-child]:order-2" : "")}>
      <div>
        <div className="text-xs uppercase tracking-[0.18em] text-white/55">{kicker}</div>
        <h3 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight">{title}</h3>
        <p className="mt-4 text-base leading-relaxed text-white/70 max-w-[52ch]">{body}</p>

        <ul className="mt-6 space-y-2 text-sm text-white/70">
          <li className="flex gap-2"><CheckCircle2 size={16} className="mt-[2px] text-white/70" /> Built from your material</li>
          <li className="flex gap-2"><CheckCircle2 size={16} className="mt-[2px] text-white/70" /> Clear structure, no fluff</li>
          <li className="flex gap-2"><CheckCircle2 size={16} className="mt-[2px] text-white/70" /> Works in Hungarian and English</li>
        </ul>
      </div>

      <div className="fade-edges rounded-2xl">
        <Image src={img} alt={title} width={1100} height={720} className="h-auto w-full" priority={false} />
      </div>
    </div>
  )
}

export default function HomePage() {
  return (
    <div className="relative">
      <div className="grid-overlay" />
      <div className="glow" />


      <main>
        <section className="mx-auto max-w-6xl px-4 pt-14 md:pt-20">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <h1 className="text-5xl md:text-6xl font-semibold tracking-tight leading-[1.02]">
              Turn messy notes into a clean study system.
            </h1>
            <p className="mt-5 text-dim text-lg md:text-xl max-w-2xl">
              Upload PDFs or photos and get study notes you can actually learn from, a daily plan with timers, and practice tests.
            </p>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/plan"><Button className="gap-2">Build my plan <ArrowRight size={16} /></Button></Link>
              <a href="#features"><Button variant="ghost" className="gap-2"><Sparkles size={16} /> See features</Button></a>
            </div>

            <div className="mt-8 grid w-full grid-cols-1 gap-3 md:max-w-2xl md:grid-cols-3">
              <MiniStat icon={<FileUp size={16} />} label="PDFs + photos" />
              <MiniStat icon={<Timer size={16} />} label="Pomodoro daily flow" />
              <MiniStat icon={<Sparkles size={16} />} label="Notes + tests" />
            </div>

            {/* BIG HERO IMAGE under the main text */}
            <div className="mt-10 w-full fade-edges rounded-2xl">
              <Image src="/assets/hero.png" alt="Examly preview" width={1400} height={900} className="h-auto w-full" priority />
            </div>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl px-4 pt-6">
          <Feature
            kicker="Notes"
            title="Study notes that feel like a real notebook."
            body="Examly transforms your material into clear sections, key points, examples, and what teachers love to ask. No endless chat. Just learnable notes."
            img="/assets/feature-a.png"
          />
          <Feature
            kicker="Daily Plan"
            title="A daily plan you can actually follow."
            body="Start a session, focus, then take a break. Examly guides you with a progress bar and realistic blocks so you finish on time."
            img="/assets/feature-b.png"
            reverse
          />
<Feature
  kicker="Vocab"
  title="Quizlet-style vocab from text or photos."
  body="Paste up to 70 words (free) or upload a photo of your vocab sheet. Examly turns it into flashcards, learn mode, and timed tests (English ⇄ Hungarian)."
  img="/assets/feature-vocab.png"
  reverse
/>
          <Feature
            kicker="Practice"
            title="Practice tests built from your content."
            body="Generate 15–20 questions (mixed MCQ + short answer) with solutions, so you can check what you really know."
            img="/assets/feature-c.png"
          />
        </section>

        <section id="pricing" className="mx-auto max-w-6xl px-4 py-20">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 md:p-10">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-8">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-white/55">Pricing</div>
                <h3 className="mt-3 text-3xl font-semibold tracking-tight">Pro credits. Buy when needed.</h3>
                <p className="mt-3 text-white/70 max-w-[58ch]">
                  3500 Ft (≈ €8.9) for 30 generations. One-time purchase. When you run out, buy another pack.
                </p>
              </div>
              <Link href="/billing"><Button className="gap-2">Buy Pro credits <ArrowRight size={16} /></Button></Link>
            </div>
          </div>

          <footer className="mt-10 flex items-center justify-between text-xs text-white/50">
            <div className="flex items-center gap-2">
              <Image src="/assets/logo.png" alt="Examly" width={18} height={18} />
              <span>© {new Date().getFullYear()} Examly</span>
            </div>
            <div className="flex gap-4">
              <span>Privacy</span>
              <span>Terms</span>
            </div>
          </footer>
        </section>
      </main>
    </div>
  )
}
