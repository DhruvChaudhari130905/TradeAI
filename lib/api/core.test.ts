import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GENERIC_API_ERROR, requestApi } from './core'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  fetchMock.mockReset()
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

describe('requestApi', () => {
  it('passes through a success envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: 'u1' } }))
    await expect(requestApi<{ id: string }>('/cpp-api/me', 'tok')).resolves.toEqual({
      success: true,
      data: { id: 'u1' },
    })
  })

  it('passes through an error envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: false, error: 'Not authenticated' }, 401))
    await expect(requestApi('/cpp-api/me', null)).resolves.toEqual({
      success: false,
      error: 'Not authenticated',
    })
  })

  it('sends the bearer token when present', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }))
    await requestApi('/cpp-api/me', 'tok')
    const headers = fetchMock.mock.calls[0][1].headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer tok')
  })

  it('omits Authorization without a token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }))
    await requestApi('/cpp-api/me', null)
    const headers = fetchMock.mock.calls[0][1].headers as Headers
    expect(headers.has('Authorization')).toBe(false)
  })

  it('defaults Content-Type to JSON when sending a body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }))
    await requestApi('/cpp-api/x', 'tok', { method: 'POST', body: '{}' })
    const headers = fetchMock.mock.calls[0][1].headers as Headers
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  it('lets fetch set Content-Type for FormData bodies', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: null }))
    const form = new FormData()
    form.append('file', new Blob(['x']), 'doc.pdf')
    await requestApi('/cpp-api/x', 'tok', { method: 'POST', body: form })
    const headers = fetchMock.mock.calls[0][1].headers as Headers
    expect(headers.has('Content-Type')).toBe(false)
  })

  it('maps a non-JSON response to the generic error', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502</html>', { status: 502 }))
    await expect(requestApi('/cpp-api/me', 'tok')).resolves.toEqual({
      success: false,
      error: GENERIC_API_ERROR,
    })
  })

  it('maps an unexpected JSON shape to the generic error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ foo: 1 }))
    await expect(requestApi('/cpp-api/me', 'tok')).resolves.toEqual({
      success: false,
      error: GENERIC_API_ERROR,
    })
  })

  it('maps a network failure to the generic error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    await expect(requestApi('/cpp-api/me', 'tok')).resolves.toEqual({
      success: false,
      error: GENERIC_API_ERROR,
    })
  })
})
