'use client'

import Link from 'next/link'
import { useState } from 'react'

const links = [
  { href: '/plan', label: 'Plan' },
  { href: '/practice', label: 'Practice' },
  { href: '/vocab', label: 'Vocab' },
  { href: '/ask', label: 'Ask' },
  { href: '/guide', label: 'Guide' },
  { href: '/billing', label: 'Billing' },
]

export default function Navbar() {
  const [open, setOpen] = useState(false)

  return (
    <div className="w-full border-b border-white/10">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
        <Link href="/" className="font-semibold">Examly</Link>

        <button
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
          onClick={() => setOpen(v => !v)}
          aria-label="Menu"
        >
          ☰
        </button>
      </div>

      {open && (
        <div className="mx-auto max-w-6xl px-4 pb-4">
          <div className="grid grid-cols-2 gap-2">
            {links.map(l => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
