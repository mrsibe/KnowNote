#!/usr/bin/env node
/**
 * Launches the RAG eval harness (#75) through the real Electron main process.
 *
 * The harness needs the app's database, vector store and document loaders, none
 * of which load outside Electron. `--eval-prepare` is the one-time, networked
 * model bootstrap; `npm run eval` itself performs no network access.
 *
 * Usage:
 *   node scripts/eval.mjs            # run the harness (offline)
 *   node scripts/eval.mjs --prepare  # download the pinned model
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const prepare = process.argv.includes('--prepare')
const flag = prepare ? '--eval-prepare' : '--eval-harness'

const executable = resolve(
  'node_modules/.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron'
)

if (!existsSync(executable)) {
  console.error('[eval] could not find the electron binary. Run `npm install` first.')
  process.exit(1)
}

const args = ['.', flag]

// The Chromium sandbox needs a setuid helper or user namespaces; containers run
// as root and CI runners often lack both. The harness never renders anything, so
// running unsandboxed is safe here and keeps `npm run eval` working in CI.
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
if (isRoot || process.env.CI) {
  args.push('--no-sandbox')
}

const child = spawn(executable, args, {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
})

child.on('error', (error) => {
  console.error('[eval] failed to launch:', error.message)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[eval] app was killed by ${signal}`)
    process.exit(1)
  }
  process.exit(code ?? 1)
})
