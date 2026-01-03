'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { authedFetch } from '@/lib/authClient'

type Me = {
  entitlement: {
    ok: boolean
    credits: number
    freeActive: boolean
    freeRemaining: number
    freeExpiresAt: string | null
  }
}

export default function AuthGate({ children, requireEntitlement = true }: { children: React.ReactNode; requireEntitlement?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    async function run() {
      setError(null)
      if (!supabase) {
        // If Supabase isn't configured, we can't enforce auth.
        setReady(true)
        return
      }

      const { data } = await supabase.auth.getSession()
      const session = data.session

      if (!session) {
        router.replace(`/login?next=${encodeURIComponent(pathname || '/plan')}`)
        return
      }

      if (requireEntitlement) {
        try {
          const res = await authedFetch('/api/me')
          const json = (await res.json()) as Me
          if (!res.ok) throw new Error((json as any)?.error || 'Error')
          if (!json?.entitlement?.ok) {
            router.replace('/choose-plan')
            return
          }
        } catch (e: any) {
          setError(e?.message ?? 'Error')
        }
      }

      if (!alive) return
      setReady(true)
    }

    run()

    return () => {
      alive = false
    }
  }, [router, pathname, requireEntitlement])

  if (ready) return <>{children}</>

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <div className="text-sm text-white/70">Loading…</div>
      {error && <div className="mt-3 text-sm text-red-400">{error}</div>}
    </div>
  )
}
