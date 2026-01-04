import './globals.css'
import 'katex/dist/katex.min.css'
import type { Metadata } from 'next'
import Navbar from '@/components/Navbar'

export const metadata: Metadata = {
  title: 'Examly',
  description: 'Plan and build exam preparation from your own material.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="fixed inset-0 grid-bg pointer-events-none" />
        <div className="fixed inset-0 glow pointer-events-none" />

        {/* IMPORTANT: prevent any horizontal overflow on mobile */}
        <div className="min-h-screen overflow-x-hidden">
          <Navbar />
          <main className="overflow-x-hidden">{children}</main>

          <footer className="border-t border-white/5 mt-24">
            <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-white/50">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <span>© {new Date().getFullYear()} Examly</span>
                <span className="text-white/40">Built for structured learning. Not endless chat.</span>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
