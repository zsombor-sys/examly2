'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function AuthCallback() {
  const params = useSearchParams()
  const router = useRouter()
  const [msg, setMsg] = useState('Signing you in…')

  useEffect(() => {
    if (!supabase) { setStatus('Auth not configured'); return }

    const code = params.get('code')
    if (!code) {
      setMsg('No auth code found.')
      return
    }
    supabase?.auth.exchangeCodeForSession(code)
      .then(({ error }) => {
        if (error) throw error
        router.replace('/plan')
      })
      .catch((e) => setMsg(e.message ?? 'Auth failed'))
  }, [params, router])

  return (
    <div className="mx-auto max-w-2xl px-4 pt-16">
      <div className="glass rounded-3xl p-8">
        <div className="text-sm text-white/70">{msg}</div>
      </div>
    </div>
  )
}
