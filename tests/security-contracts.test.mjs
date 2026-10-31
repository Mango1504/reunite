import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { MIN_PASSWORD_LENGTH, validatePassword } from '../src/security.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('password policy rejects passwords shorter than eight characters', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8)
  assert.match(validatePassword('1234567'), /8/)
  assert.equal(validatePassword('12345678'), '')
})

test('active finder messaging uses device-scoped public APIs', async () => {
  const source = await readFile(join(root, 'src', 'main.jsx'), 'utf8')
  const activeFinderPath = source.slice(source.indexOf('function ScanPageRealtime'), source.indexOf('function ScanPage({'))
  assert.doesNotMatch(activeFinderPath, /rpc\(['"](?:get_public_messages|mark_public_messages_seen)['"]\s*,/)
  assert.match(activeFinderPath, /get_public_messages_v5/)
  assert.match(source, /send_public_message_v2/)
  assert.match(source, /send_public_reply_v2/)
  assert.match(source, /report_public_pet_v2/)
  assert.match(activeFinderPath, /mark_public_messages_seen_v2/)
})
