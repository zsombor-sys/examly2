import { supabase } from '@/lib/supabaseClient'

export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
) {
  const client = supabase!
  // 👆 ezzel kijelented TS-nek: "itt garantáltan nem null"

  const { data } = await client.auth.getSession()
  const token = data.session?.access_token

  const headers = new Headers(init.headers || {})
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return fetch(input, {
    ...init,
    headers,
  })
}
