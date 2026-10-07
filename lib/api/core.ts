export type ApiResult<T> = { success: true; data: T } | { success: false; error: string }

export const GENERIC_API_ERROR = 'Something went wrong. Please try again.'

function isApiResult<T>(value: unknown): value is ApiResult<T> {
  if (typeof value !== 'object' || value === null || !('success' in value)) return false
  if (value.success === true) return 'data' in value
  return value.success === false && 'error' in value && typeof value.error === 'string'
}

/** Calls the C++ API and normalizes every failure into the `{ success: false }` envelope. */
export async function requestApi<T>(
  url: string,
  token: string | null,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  try {
    const headers = new Headers(init.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    // Only string bodies default to JSON; fetch sets the type for FormData, Blob, etc.
    if (typeof init.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    const res = await fetch(url, { ...init, headers, cache: 'no-store' })
    const body: unknown = await res.json()
    if (!isApiResult<T>(body)) return { success: false, error: GENERIC_API_ERROR }
    return body
  } catch (error) {
    console.error('[requestApi]', error)
    return { success: false, error: GENERIC_API_ERROR }
  }
}
