import OpenAI from 'openai'

// ── Per-task model registry (all free-endpoint models on integrate.api.nvidia.com) ──
// Interactive chat wants speed → lightning, thinking disabled.
// Personality reviews want depth + image understanding → kimi-k3 (multimodal, reasoning).
// Chart-screenshot OCR wants the omni vision model.
// nano is the universal fallback (text-only — reviews degrade to text-only context).

export const NIM_MODEL_FAST = 'nvidia/nemotron-3.5-lightning-30b-a3b'
export const NIM_MODEL_VISION = 'moonshotai/kimi-k3'
export const NIM_MODEL_OMNI = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'
/** Replacement for nemotron-3-nano-30b-a3b, which reached end-of-life 2026-09-01 */
export const NIM_FALLBACK_MODEL = 'nvidia/nemotron-nano-3-30b-a3b'

/** Cap for interactive (chat/suggestions) calls — fall back fast rather than hang */
export const NIM_REQUEST_TIMEOUT_MS = 20_000
/** Client-wide default — generous ceiling for heavy jobs (reviews) */
export const NIM_DEFAULT_TIMEOUT_MS = 90_000

/** Request option that disables lightning's thinking mode for fast interactive replies.
 *  Cast needed: extra_body-style keys pass through the OpenAI SDK to NIM. */
export const NIM_NO_THINKING = {
  chat_template_kwargs: { enable_thinking: false },
} as unknown as Record<string, never>

let _nimClient: OpenAI | null = null

export function getNimClient(): OpenAI {
  if (!_nimClient) {
    if (!process.env.NVIDIA_NIM_API_KEY) {
      throw new Error('NVIDIA_NIM_API_KEY is not set')
    }
    _nimClient = new OpenAI({
      apiKey: process.env.NVIDIA_NIM_API_KEY,
      baseURL: 'https://integrate.api.nvidia.com/v1',
      timeout: NIM_DEFAULT_TIMEOUT_MS,
    })
  }
  return _nimClient
}
