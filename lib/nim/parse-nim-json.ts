/** Strip markdown code fences that NIM sometimes wraps around JSON.
 *  Safely parses JSON with error handling.
 */
export function parseNimJson<T>(raw: string): T {
  try {
    const cleaned = raw.replace(/```json\n?|```\n?/g, '').trim()
    return parseJsonFromCleanedResponse<T>(cleaned)
  } catch (parseError) {
    // Log raw response (truncated) + parse error for debugging
    const preview = raw.length > 500 ? raw.slice(0, 500) + '…[truncated]' : raw
    console.error('[parseNimJson] Failed to parse NIM response. Raw:', preview)
    console.error('[parseNimJson] Parse error:', parseError)
    throw new Error('AI returned invalid JSON. Please try again.')
  }
}

function parseJsonFromCleanedResponse<T>(cleaned: string): T {
  try {
    return JSON.parse(cleaned) as T
  } catch (fullParseError) {
    let candidateCount = 0
    for (const candidate of extractBalancedJsonCandidates(cleaned)) {
      candidateCount++
      try {
        return JSON.parse(candidate) as T
      } catch {
        // Keep looking: prose can contain balanced non-JSON brackets before the payload.
      }
    }

    if (candidateCount === 0) {
      console.error('[parseNimJson] No JSON-like structure (no balanced {} or []) found in response.')
    } else {
      console.error('[parseNimJson] Found', candidateCount, 'balanced candidates but none parsed as valid JSON.')
    }

    throw fullParseError
  }
}

function* extractBalancedJsonCandidates(input: string): Generator<string> {
  for (let start = 0; start < input.length; start += 1) {
    const opening = input[start]

    if (opening !== '{' && opening !== '[') {
      continue
    }

    const candidate = readBalancedJsonCandidate(input, start)
    if (candidate) {
      yield candidate
    }
  }
}

function readBalancedJsonCandidate(input: string, start: number): string | null {
  const stack: string[] = []
  let inString = false
  let escaped = false

  for (let index = start; index < input.length; index += 1) {
    const char = input[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      stack.push('}')
      continue
    }

    if (char === '[') {
      stack.push(']')
      continue
    }

    if (char !== '}' && char !== ']') {
      continue
    }

    if (stack.pop() !== char) {
      return null
    }

    if (stack.length === 0) {
      return input.slice(start, index + 1)
    }
  }

  return null
}
