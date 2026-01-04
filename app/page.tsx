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

export default function HomePage() {
  return (
    <div className="relative min-h-[calc(100vh-0px)] overflow-x-hidden">
      <div className="fixed inset-0 grid-bg pointer-events-none" />
      <div className="fixed inset-0 glow pointer-events-none" />

      <main className="mx-auto max-w-6xl px-4 py-14">
        <section className="grid gap-10 lg:grid-cols-2 lg:items-center">
          {/* LEFT */}
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/70">
              <Sparkles size={14} />
              Structured exam prep from your own material
            </div>

            <h1 className="mt-6 text-4xl md:text-5xl font-semibold tracking-tight">
              Turn your notes into a real study plan.
            </h1>

            <p className="mt-4 text-white/70 max-w-[65ch]">
              Upload PDFs or photos, describe the exam, and Examly builds a plan, practice questions and vocab cards.
              No endless chat, just structure.
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
              <MiniStat icon={<Timer size={16} />} label="Daily plan + focus blocks" />
              <MiniStat icon={<CheckCircle2 size={16} />} label="Practice + vocab cards" />
            </div>

            <ul className="mt-6 space-y-2 text-sm text-white/70">
              <li>• Built for exams: plan, practice, vocab</li>
              <li>• Credits tracked server-side</li>
              <li>• Free trial available once after login</li>
            </ul>
          </div>

          {/* RIGHT */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:p-8">
            <div className="text-xs uppercase tracking-[0.18em] text-white/55">Example</div>

            <div className="mt-3 rounded-2xl border border-white/10 bg-black/40 p-5">
              <div className="text-sm text-white/80">Exam prompt</div>
              <div className="mt-2 text-white/90">
                “I have a test in 3 days from quadratic equations. I struggle with factoring and word problems.”
              </div>

              <div className="mt-4 border-t border-white/10 pt-4 text-sm text-white/70">
                Examly generates:
                <ul className="mt-2 list-disc pl-5 space-y-1">
                  <li>Daily schedule (what to do each day)</li>
                  <li>Practice questions + explanations</li>
                  <li>Flashcards and vocab lists</li>
                </ul>
              </div>
            </div>

            <div className="mt-6 grid gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="text-sm font-semibold">Pro</div>
                <div className="mt-1 text-sm text-white/70">30 generations • 3500 Ft (≈ €8.9)</div>
                <ul className="mt-3 space-y-1 text-sm text-white/65">
                  <li>• Use credits on Plan, Practice, Vocab, Audio</li>
                  <li>• Auto-recharge may top up when you run out</li>
                </ul>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="text-sm font-semibold">Free trial</div>
                <div className="mt-1 text-sm text-white/70">10 generations • 48 hours • only once</div>
                <div className="mt-3 text-sm text-white/60">
                  After 48 hours, free trial expires permanently for this account.
                </div>
              </div>
            </div>

            <footer className="mt-6 flex items-center justify-between text-xs text-white/50">
              <div className="flex items-center gap-2">
                <Image src="/assets/logo.png" alt="Examly" width={18} height={18} />
                <span>© {new Date().getFullYear()} Examly</span>
              </div>
              <div className="flex gap-4">
                <span>Privacy</span>
                <span>Terms</span>
              </div>
            </footer>
          </div>
        </section>
      </main>
    </div>
  )
}
