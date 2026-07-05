import assert from 'node:assert/strict'
import test from 'node:test'

import { parseNimJson } from './parse-nim-json.ts'

test('parses a plain JSON object', () => {
  assert.deepEqual(parseNimJson('{"ok":true}'), { ok: true })
})

test('parses a plain JSON array', () => {
  assert.deepEqual(parseNimJson('[1,2,3]'), [1, 2, 3])
})

test('parses JSON wrapped in markdown fences', () => {
  assert.deepEqual(parseNimJson('```json\n{"ok":true}\n```'), { ok: true })
})

test('parses a JSON object after prose', () => {
  const raw = 'We need to extract the rules first.\n{"indicators":[],"entry_long":[]}'

  assert.deepEqual(parseNimJson(raw), {
    indicators: [],
    entry_long: [],
  })
})

test('parses a JSON array after prose', () => {
  assert.deepEqual(parseNimJson('Here are the insights:\n[{"title":"Risk"}]'), [{ title: 'Risk' }])
})

test('ignores braces inside JSON strings while finding the end of the payload', () => {
  const raw = 'Result:\n{"notes":"Use {support} and escaped \\"}\\" text","ok":true}\nThanks.'

  assert.deepEqual(parseNimJson(raw), {
    notes: 'Use {support} and escaped "}" text',
    ok: true,
  })
})

test('throws a sanitized error when no JSON payload exists', () => {
  assert.throws(
    () => parseNimJson('We need to explain this without JSON.'),
    /AI returned invalid JSON\. Please try again\./,
  )
})
