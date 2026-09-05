import {
  getNimClient,
  NIM_MODEL_OMNI,
  NIM_FALLBACK_MODEL,
  NIM_DEFAULT_TIMEOUT_MS,
} from '@/lib/nim/client'
import { parseNimJson } from '@/lib/nim/parse-nim-json'
import {
  type RawTradeExtraction,
  isRawTradeExtraction,
  normalizeExtraction,
  type TradeImageExtraction,
} from '@/lib/nim/trade-extract-types'

// Server-only module: reads a chart screenshot and extracts trade details via
// the NVIDIA NIM omni (vision) model. Mirrors the call pattern in
// lib/nim/run-replay-reviews.ts but sends an image message instead of text.

export const EXTRACT_PROMPT = `You are a precise trading-platform (MT4/MT5) chart OCR assistant.
Read the chart screenshot and extract the trade details that are clearly visible.
Return ONLY valid JSON with these keys and nothing else:
{
  "pair": string | null,          // e.g. "XAUUSD", "EUR/USD"
  "direction": "long" | "short" | null,
  "entry_price": number | null,
  "stop_loss": number | null,
  "take_profit": number | null,
  "lot_size": number | null,
  "risk_reward_ratio": number | null,
  "outcome": "win" | "loss" | "breakeven" | "open" | null,
  "pnl_usd": number | null,
  "session": "london" | "new_york" | "asian" | "overlap" | "other" | null,
  "entry_time": string | null,     // ISO-ish date/time if readable
  "exit_time": string | null,
  "notes": string | null,          // brief setup description from the chart
  "tags": string[] | null,         // e.g. ["breakout", "trend-follow"]
  "confidence": {                  // your self-assessed reliability per KEY NAME
    "pair": "high" | "low",
    "entry_price": "high" | "low",
    "stop_loss": "high" | "low",
    "take_profit": "high" | "low",
    "direction": "high" | "low"
  }
}
Rules:
- Read numbers exactly as shown, preserving decimal places.
- Use null for any field you cannot see clearly. NEVER invent values.
- "high" confidence means you read the exact number/word from the image;
  "low" means you inferred or are unsure.
- Prefer the floating position/order line (entry, stop loss, take profit) over the price axis.`

/** Server-only helper: download an image and return it base64-encoded.
 *  Shared by the screenshot extractor and the trade reviewers. */
export async function base64FromUrl(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch screenshot (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  return buf.toString('base64')
}

async function callExtractor(imageUrl: string): Promise<RawTradeExtraction | null> {
  const b64 = await base64FromUrl(imageUrl)
  const dataUrl = `data:image/jpeg;base64,${b64}`

  for (const model of [NIM_MODEL_OMNI, NIM_FALLBACK_MODEL]) {
    try {
      const completion = await getNimClient().chat.completions.create(
        {
          model,
          messages: [
            { role: 'system', content: EXTRACT_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Extract the trade data from this chart screenshot into the requested JSON.' },
                { type: 'image_url', image_url: { url: dataUrl } },
              ] as never,
            },
          ],
          max_tokens: 1024,
          temperature: 0.1,
        },
        { timeout: NIM_DEFAULT_TIMEOUT_MS },
      )

      const raw = completion.choices[0]?.message?.content
      if (!raw) continue
      const parsed = parseNimJson<unknown>(raw)
      if (isRawTradeExtraction(parsed)) return parsed
      // Fall back to a permissive shape if the strict guard rejects a partial payload.
      if (typeof parsed === 'object' && parsed !== null) return parsed as RawTradeExtraction
    } catch (err) {
      console.error(`[extract-trade-from-image] ${model} failed:`, err)
    }
  }
  return null
}

/** Read a chart screenshot (already uploaded & stored) and return normalized extraction. */
export async function extractTradeFromImageUrl(imageUrl: string): Promise<TradeImageExtraction> {
  const raw = await callExtractor(imageUrl)
  if (!raw) {
    throw new Error('The AI model could not read this screenshot. Please retry or enter manually.')
  }
  return normalizeExtraction(raw)
}
