import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

function getBearer(req: Request) {
  const h = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!h) return null
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m ? m[1] : null
}

export type AuthUser = { id: string; email: string | null }

export async function requireUser(req: Request): Promise<AuthUser> {
  if (!url || !anon) {
    throw new Error('Supabase env missing (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)')
  }

  const token = getBearer(req)
  if (!token) {
    const err: any = new Error('Not authenticated')
    err.status = 401
    throw err
  }

  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) {
    const err: any = new Error('Invalid session')
    err.status = 401
    throw err
  }

  return { id: data.user.id, email: data.user.email ?? null }
}
