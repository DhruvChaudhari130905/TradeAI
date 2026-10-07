import { createClient } from '@/lib/supabase/client'
import { requestApi, type ApiResult } from './core'

export type { ApiResult } from './core'

/** Browser-side call to the C++ API through the same-origin `/cpp-api` rewrite. */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const { data } = await createClient().auth.getSession()
  return requestApi<T>(`/cpp-api${path}`, data.session?.access_token ?? null, init)
}
