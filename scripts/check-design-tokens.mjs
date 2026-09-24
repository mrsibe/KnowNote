#!/usr/bin/env node
/**
 * Design-token guard.
 *
 * Enforces the mechanically checkable half of DESIGN.md: which radius values,
 * which elevation tokens, which colours and which text-level modifiers are
 * allowed in the renderer. It reads source text, so it is fast, needs no build
 * and can run before anything else in CI.
 *
 * The rules are deliberately not configurable. DESIGN.md is the source of
 * truth; if a rule is wrong, change the document and this file in the same PR
 * rather than adding an allowlist here.
 *
 *   npm run check:design          # report violations, exit 1 if any
 *   npm run check:design -- --list # print the rules and exit 0
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SCAN_ROOT = join(process.cwd(), 'src', 'renderer', 'src')
const EXTENSIONS = ['.ts', '.tsx', '.css']

/** Tailwind class characters, including `!`, `/`, `[]`, `()` and `.`. */
const CLASS_CHAR = 'a-zA-Z0-9\\-_\\[\\](),.%_!/'

const ALLOWED_RADII = new Set([
  'rounded-md',
  'rounded-lg',
  'rounded-full',
  ...['t', 'b', 'l', 'r', 'tl', 'tr', 'bl', 'br'].flatMap((side) =>
    ['md', 'lg', 'full'].map((size) => `rounded-${side}-${size}`)
  )
])

const ALLOWED_SHADOWS = new Set(['shadow-elevation', 'shadow-control', 'shadow-none'])

const ALLOWED_CSS_RADII = new Set(['0.375rem', '0.5rem', '9999px'])

const PALETTE =
  'white|black|gray|slate|zinc|neutral|stone|blue|green|red|purple|amber|yellow|orange|pink|teal|cyan|emerald|indigo|violet|rose|sky|lime|fuchsia'

const RULES = [
  {
    id: 'radius',
    describe: 'radius is rounded-md (control), rounded-lg (container) or rounded-full (pill)',
    applies: ['.ts', '.tsx'],
    scan(line, check) {
      for (const token of utilities(line, 'rounded')) {
        if (!ALLOWED_RADII.has(token)) check(token, 'use rounded-md / rounded-lg / rounded-full')
      }
    }
  },
  {
    id: 'shadow',
    describe: 'elevation is shadow-elevation (floating layers) or shadow-control (knobs)',
    applies: ['.ts', '.tsx'],
    scan(line, check) {
      for (const token of utilities(line, 'shadow')) {
        if (!ALLOWED_SHADOWS.has(token)) {
          check(token, 'use shadow-elevation / shadow-control / shadow-none')
        }
      }
    }
  },
  {
    id: 'palette',
    describe: 'colours come from tokens, never from the raw Tailwind palette',
    applies: ['.ts', '.tsx'],
    scan(line, check) {
      const literal = new RegExp(
        `\\b(bg|text|border|ring|fill|stroke|from|to|via)-(?:${PALETTE})(?:-\\d{2,3})?\\b`,
        'g'
      )
      const arbitrary = /\b(bg|text|border|ring|fill|stroke)-\[(?:#|rgb|hsl|oklch|color)/g
      for (const match of [...line.matchAll(literal), ...line.matchAll(arbitrary)]) {
        check(match[0], 'use a surface/text/accent token')
      }
    }
  },
  {
    id: 'text-level',
    describe: 'a text level carries no opacity of its own',
    applies: ['.ts', '.tsx'],
    scan(line, check) {
      const pattern = /\btext-(foreground|muted-foreground|subtle-foreground)\/\d+/g
      for (const match of line.matchAll(pattern)) {
        check(match[0], 'use a darker level (T1/T2/T3) instead of stacking alpha')
      }
    }
  },
  {
    id: 'css-radius',
    describe: 'raw CSS border-radius matches the radius scale',
    applies: ['.css'],
    scan(line, check) {
      for (const match of line.matchAll(/border-radius:\s*([^;]+);/g)) {
        const value = match[1].trim()
        if (!ALLOWED_CSS_RADII.has(value)) {
          check(value, 'use 0.375rem (control), 0.5rem (container) or 9999px (pill)')
        }
      }
    }
  }
]

/**
 * Extracts whole utility tokens that start with `prefix` and are not part of a
 * larger word (`box-shadow` and `var(--shadow-sm)` are definitions, not usages).
 */
function utilities(line, prefix) {
  const pattern = new RegExp(`(?<![\\w-])${prefix}[${CLASS_CHAR}]*`, 'g')
  return [...line.matchAll(pattern)].map((match) =>
    match[0].replace(/!+$/, '').replace(/[^a-zA-Z0-9[\]().%_/-]+$/, '')
  )
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, files)
    else if (EXTENSIONS.some((extension) => path.endsWith(extension))) files.push(path)
  }
  return files
}

function list() {
  console.log('Design-token guard rules (see DESIGN.md):\n')
  for (const rule of RULES) {
    console.log(`  ${rule.id.padEnd(12)} ${rule.describe}`)
    console.log(`  ${' '.repeat(12)} files: ${rule.applies.join(', ')}`)
  }
  console.log(`\nAllowed radii:  ${[...ALLOWED_RADII].join('  ')}`)
  console.log(`Allowed shadows: ${[...ALLOWED_SHADOWS].join('  ')}\n`)
}

function main() {
  if (process.argv.includes('--list')) {
    list()
    return
  }

  const violations = []

  for (const path of walk(SCAN_ROOT)) {
    const extension = EXTENSIONS.find((candidate) => path.endsWith(candidate))
    const lines = readFileSync(path, 'utf8').split('\n')

    lines.forEach((line, index) => {
      const trimmed = line.trim()
      const column = line.length - line.trimStart().length + 1
      for (const rule of RULES) {
        if (!rule.applies.includes(extension)) continue
        rule.scan(line, (token, hint) => {
          violations.push({
            file: relative(process.cwd(), path),
            line: index + 1,
            column,
            rule: rule.id,
            token,
            hint,
            context: trimmed
          })
        })
      }
    })
  }

  if (violations.length === 0) {
    console.log('check:design — no violations.')
    return
  }

  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line}:${violation.column}  ${violation.rule}  ${violation.token}`
    )
    console.error(`    ${violation.hint}`)
    console.error(`    ${violation.context}`)
  }
  console.error(`\ncheck:design — ${violations.length} violation(s). See DESIGN.md for the rules.`)
  process.exitCode = 1
}

main()
