'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui'
import CreditsPill from '@/components/CreditsPill'

export default function Navbar() {
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      const e = data.session?.user?.email ?? null
      setEmail(e)
      try {
        if (e) window.localStorage.setItem('examly_user_email_v1', e)
        else window.localStorage.removeItem('examly_user_email_v1')
      } catch {}
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const e = session?.user?.email ?? null
      setEmail(e)
      try {
        if (e) window.localStorage.setItem('examly_user_email_v1', e)
        else window.localStorage.removeItem('examly_user_email_v1')
      } catch {}
    })
    return () => {
      mounted = false
      sub?.subscription?.unsubscribe()
    }
  }, [])

  async function signOut() {
    if (!supabase) return
    await supabase.auth.signOut()
  }

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-black/60 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link href="/" className="flex items-center gap-3">
          {/* logo lives in /public/assets/logo.png */}
          <img src="/assets/logo.png" alt="Examly" className="h-8 w-8" />
          <span className="text-sm font-semibold tracking-tight">Examly</span>
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm text-dim">
          <Link href="/plan" className="hover:text-white">Plan</Link>
          <Link href="/practice" className="hover:text-white">Practice</Link>
          <Link href="/vocab" className="hover:text-white">Vocab</Link>
          <Link href="/guide" className="hover:text-white">Guide</Link>
          <a href="/#pricing" className="hover:text-white">Pricing</a>
        </nav>

        <div className="flex items-center gap-2">
          {email ? (
            <>
              <CreditsPill />
              <span className="hidden sm:inline text-xs text-dim">{email}</span>
              <Button variant="ghost" onClick={signOut}>Sign out</Button>
            </>
          ) : (
            <>
              <Link href="/login"><Button variant="ghost">Log in</Button></Link>
              <Link href="/signup"><Button>Sign up</Button></Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
