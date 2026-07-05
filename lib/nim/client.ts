import OpenAI from 'openai'

// Nemotron-3 models available as of July 2026
// nvidia/llama-3.1-nemotron-70b-instruct is DEPRECATED (returns 404)
export const NIM_MODEL = 'nvidia/nemotron-3-super-120b-a12b'
export const NIM_FALLBACK_MODEL = 'nvidia/nemotron-3-nano-30b-a3b'

let _nimClient: OpenAI | null = null

export function getNimClient(): OpenAI {
  if (!_nimClient) {
    if (!process.env.NVIDIA_NIM_API_KEY) {
      throw new Error('NVIDIA_NIM_API_KEY is not set')
    }
    _nimClient = new OpenAI({
      apiKey: process.env.NVIDIA_NIM_API_KEY,
      baseURL: 'https://integrate.api.nvidia.com/v1',
    })
  }
  return _nimClient
}
