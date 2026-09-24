#!/usr/bin/env node
/**
 * Runs the packaged application's `--smoke-test` and propagates its exit code.
 *
 * `npm run build` and `npm run build:unpack` both succeed on an artifact that
 * cannot start - that is exactly how `Cannot find module 'script-loader!sql.js'`
 * and `ReferenceError: DOMMatrix is not defined` reached a package. This script
 * closes that gap by running the real executable, which means the checks run
 * against the real app.asar, the real native addons and the real module
 * resolution.
 *
 * Usage:
 *   npm run build:unpack && npm run smoke:packaged
 *
 * Env:
 *   SMOKE_TEST_TIMEOUT_MS  how long to wait for the app to finish (default 120s)
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIST_DIR = resolve('dist')
const TIMEOUT_MS = Number(process.env.SMOKE_TEST_TIMEOUT_MS ?? 120_000)

/** electron-builder.yml is a flat file for the keys we need; avoid a YAML dep. */
function readYamlScalar(file, key) {
  const match = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm').exec(readFileSync(file, 'utf8'))
  return match?.[1]
}

/**
 * @returns {string} the `name` field of the package, used for the on-disk binary
 */
function readAppName() {
  const file = resolve('package.json')
  try {
    return JSON.parse(readFileSync(file, 'utf8')).name
  } catch (error) {
    console.error(`[smoke:packaged] cannot read ${file}: ${error.message}`)
    process.exit(1)
  }
}

/**
 * Locates the unpacked executable electron-builder produced for this platform.
 *
 * Mirrors electron-builder's layout: the on-disk name is `name` from
 * package.json for Linux/Windows (it defaults `executableName` to it, and
 * electron-builder.yml sets it explicitly to the same value) and `productName`
 * for the macOS bundle.
 *
 * @returns {string[]} candidate executable paths, most likely first
 */
function findExecutable() {
  const name = readAppName()
  const productName = readYamlScalar(resolve('electron-builder.yml'), 'productName') ?? name
  const roots = existsSync(DIST_DIR)
    ? readdirSync(DIST_DIR)
        .map((entry) => join(DIST_DIR, entry))
        .filter((path) => statSync(path).isDirectory())
    : []

  if (process.platform === 'darwin') {
    const binary = join('Contents', 'MacOS', productName)
    return roots
      .filter((dir) => /[\\/]mac/.test(dir))
      .map((dir) => join(dir, `${productName}.app`, binary))
  }

  if (process.platform === 'win32') {
    return roots.filter((dir) => dir.endsWith('-unpacked')).map((dir) => join(dir, `${name}.exe`))
  }

  return roots.filter((dir) => dir.endsWith('-unpacked')).map((dir) => join(dir, name))
}

const candidates = findExecutable()
const executable = candidates.find((candidate) => existsSync(candidate))

if (!executable) {
  console.error('[smoke:packaged] could not find an unpacked build of the app.')
  console.error('[smoke:packaged] looked for:')
  for (const candidate of candidates.length ? candidates : ['(nothing - is dist/ missing?)']) {
    console.error(`[smoke:packaged]   ${candidate}`)
  }
  console.error('[smoke:packaged] run `npm run build:unpack` first.')
  process.exit(1)
}

console.log(`[smoke:packaged] launching ${executable}`)

// Run against a throwaway profile: the app opens and migrates a real SQLite
// database on startup, and a smoke test must never touch a developer's own
// ~/.config/knownote.
const dataDir = mkdtempSync(join(tmpdir(), 'knownote-smoke-'))

const args = ['--smoke-test', `--user-data-dir=${dataDir}`]
// Electron's setuid sandbox cannot start as root, which is the norm inside CI
// containers. Only disable it when we actually are root.
if (typeof process.getuid === 'function' && process.getuid() === 0) {
  args.push('--no-sandbox')
}

const cleanup = () => rmSync(dataDir, { recursive: true, force: true })

const child = spawn(executable, args, {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
})

const timeout = setTimeout(() => {
  console.error(`[smoke:packaged] timed out after ${TIMEOUT_MS}ms, killing the app`)
  child.kill('SIGKILL')
}, TIMEOUT_MS)

child.on('error', (error) => {
  clearTimeout(timeout)
  cleanup()
  console.error('[smoke:packaged] failed to launch:', error.message)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  clearTimeout(timeout)
  cleanup()

  if (signal) {
    console.error(`[smoke:packaged] app was killed by ${signal}`)
    process.exit(1)
  }

  if (code !== 0) {
    console.error(`[smoke:packaged] FAIL - app exited with code ${code}`)
    process.exit(code ?? 1)
  }

  console.log('[smoke:packaged] PASS - packaged app started and self-checked')
  process.exit(0)
})
