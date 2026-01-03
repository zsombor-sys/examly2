import { supabase } from '@/lib/supabaseClient'

export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  if (!supabase) {
    throw new Error('Supabase is not configured on the client')
  }

  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  const headers = new Headers(init.headers || {})
  if (token) headers.set('Authorization', `Bearer ${token}`)

  // don't force content-type for GET etc.
  return fetch(input, {
    ...init,
    headers,
  })
}
