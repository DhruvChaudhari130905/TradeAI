import { createClient } from '@/lib/supabase/server'
import { GENERIC_API_ERROR, requestApi, type ApiResult } from './core'

export type { ApiResult } from './core'

/**
 * Server-side (Server Components, Server Actions, Route Handlers) call straight to
 * the C++ API. The token is forwarded unverified; the C++ service verifies it.
 */
export async function apiFetchServer<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const baseUrl = process.env.CPP_API_URL
  if (!baseUrl) {
    console.error('[apiFetchServer] CPP_API_URL is not set')
    return { success: false, error: GENERIC_API_ERROR }
  }
  const supabase = await createClient()
  const { data } = await supabase.auth.getSession()
  return requestApi<T>(`${baseUrl}${path}`, data.session?.access_token ?? null, init)
}
