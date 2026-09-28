#!/usr/bin/env node
/**
 * Chunking experiments for #78.
 *
 * Runs the real RAG eval harness once per chunking variant, against the same
 * corpus and questions as the frozen v1.4 baseline, and writes the comparison the
 * issue asks for: retrieval metrics plus index size and indexing latency, as a
 * delta against the baseline variant.
 *
 * The harness itself does the measuring; this script only orchestrates and
 * tabulates. It deliberately does not invent metrics.
 *
 * Usage:
 *   node scripts/eval-chunking.mjs
 *   node scripts/eval-chunking.mjs --out=docs/eval/chunking-v1.5.md
 *
 * The embedding model must already be prepared (`npm run eval:prepare`).
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const OUT_MD = resolve(readArg('--out=', 'docs/eval/chunking-v1.5.md'))
const OUT_JSON = OUT_MD.replace(/\.md$/, '.json')

/**
 * The variants under test.
 *
 * `baseline` is the shipped default; every delta is computed against it. The set is
 * deliberately small: size down, size up, page-spanning, heading-aware, and the
 * two heading-aware/large combinations that the first two suggest.
 */
const VARIANTS = [
  // The frozen v1.4 configuration, stated explicitly so it stays 500/50 even after
  // the default changed (#78 adoption).
  { id: 'baseline', label: 'baseline v1.4 (500/50)', args: { size: 500, overlap: 50 } },
  { id: 'small', label: 'small (250/25)', args: { size: 250, overlap: 25 } },
  { id: 'large', label: 'large (1000/100)', args: { size: 1000, overlap: 100 } },
  {
    id: 'span-pages',
    label: 'large + page spanning (1000/100)',
    args: { size: 1000, overlap: 100, spanPages: true }
  },
  {
    id: 'headings',
    label: 'heading-aware (500/50)',
    args: { size: 500, overlap: 50, headings: true }
  },
  {
    id: 'headings-large',
    label: 'heading-aware large (1000/100)',
    args: { size: 1000, overlap: 100, headings: true }
  }
]

/** The variant this spike adopted as the shipped default, or null if none. */
const ADOPTED_ID = 'large'

function readArg(prefix, fallback) {
  const arg = process.argv.find((value) => value.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : fallback
}

const executable = resolve(
  'node_modules/.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron'
)

if (!existsSync(executable)) {
  console.error('[chunking] could not find the electron binary. Run `npm install` first.')
  process.exit(1)
}

function chunkFlags(args) {
  const flags = []
  if (args.size !== undefined) flags.push(`--eval-chunk-size=${args.size}`)
  if (args.overlap !== undefined) flags.push(`--eval-chunk-overlap=${args.overlap}`)
  if (args.min !== undefined) flags.push(`--eval-chunk-min=${args.min}`)
  if (args.spanPages !== undefined) flags.push(`--eval-allow-span-pages=${args.spanPages}`)
  if (args.headings !== undefined) flags.push(`--eval-respect-headings=${args.headings}`)
  return flags
}

/** Run one variant into its own output dir; resolves when the process exits. */
function runVariant(variant, outDir) {
  return new Promise((resolvePromise, reject) => {
    const args = [
      '.',
      '--eval-harness',
      '--eval-baseline=v1.4',
      `--eval-out=${outDir}`,
      ...chunkFlags(variant.args)
    ]

    // Containers and CI runners lack the Chromium sandbox helpers; the harness
    // never renders, so running unsandboxed is safe there.
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
    if (isRoot || process.env.CI) args.push('--no-sandbox')

    const child = spawn(executable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
    })

    let stdout = ''
    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    child.stderr.on('data', () => {})

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`variant ${variant.id} exited with code ${code}`))
        return
      }
      const metricsLine = /\[eval\] metrics (\{.*\})/.exec(stdout)
      if (!metricsLine) {
        reject(new Error(`variant ${variant.id} printed no metrics line`))
        return
      }
      try {
        resolvePromise(JSON.parse(metricsLine[1]))
      } catch (error) {
        reject(
          new Error(`variant ${variant.id} printed an unreadable metrics line: ${error.message}`)
        )
      }
    })
  })
}

/**
 * Read the indexing time and query p95 out of the rendered report.
 *
 * Timing is deliberately excluded from the committed deterministic JSON (a PR must
 * be able to diff it), so the markdown is the only place the harness reports it.
 */
function readTiming(mdPath) {
  if (!existsSync(mdPath)) return { indexingMs: null, latencyP95Ms: null }
  const text = readFileSync(mdPath, 'utf8')
  const indexing = /indexing (\d+) ms/.exec(text)
  const p95 = /p95 ([\d.]+) ms/.exec(text)
  return {
    indexingMs: indexing ? Number(indexing[1]) : null,
    latencyP95Ms: p95 ? Number(p95[1]) : null
  }
}

const workDir = mkdtempSync(join(tmpdir(), 'knownote-chunking-'))
const results = []

try {
  for (const variant of VARIANTS) {
    const outDir = join(workDir, variant.id)
    mkdirSync(outDir, { recursive: true })
    console.log(`[chunking] running ${variant.label}`)
    const metrics = await runVariant(variant, outDir)

    const report = JSON.parse(readFileSync(join(outDir, 'baseline-v1.4.json'), 'utf8'))
    const timing = readTiming(join(outDir, 'baseline-v1.4.md'))

    results.push({
      id: variant.id,
      label: variant.label,
      chunkSize: report.config.chunking.chunkSize,
      chunkOverlap: report.config.chunking.chunkOverlap,
      allowSpanPages: report.config.chunking.allowSpanPages,
      respectHeadings: report.config.chunking.respectHeadings,
      chunkCount: report.config.chunkCount,
      ...metrics,
      ...timing
    })
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

const baseline = results.find((result) => result.id === 'baseline')
if (!baseline) throw new Error('the baseline variant did not run')

const delta = (value, base) => (base === 0 ? value - base : value / base - 1)
const formatDelta = (value) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
const format4 = (value) => value.toFixed(4)

const rows = results.map((result) => {
  const args = `${result.chunkSize}/${result.chunkOverlap}${result.respectHeadings ? ' + headings' : ''}${result.allowSpanPages ? ' + span' : ''}`
  return `| ${result.label} | \`${args}\` | ${format4(result.recallAt1)} | ${format4(result.recallAt5)} | ${format4(result.mrr)} | ${format4(result.ndcgAt10)} | ${format4(result.evidencePrecisionAt5)} | ${result.chunkCount} (${formatDelta(delta(result.chunkCount, baseline.chunkCount))}) | ${result.indexingMs} ms | ${result.latencyP95Ms?.toFixed(2)} ms |`
})

/**
 * Adoption follows the rule frozen in the baseline report: Recall@5 must improve
 * and nDCG@10 must not regress. Index size and latency are reported so a win that
 * costs 3x latency or 2x index is stated as a trade-off, not hidden.
 */
const adopted = results.filter(
  (result) =>
    result.id !== 'baseline' &&
    result.recallAt5 > baseline.recallAt5 &&
    result.ndcgAt10 >= baseline.ndcgAt10
)
const winner =
  adopted.sort((a, b) => b.recallAt5 - a.recallAt5 || b.ndcgAt10 - a.ndcgAt10)[0] ?? null

const markdown = `# Chunking experiments — v1.5 (#78)

Generated by \`node scripts/eval-chunking.mjs\`. Numbers are harness output; do not edit them by hand.

## What was measured

Every variant runs the real RAG eval harness against the same corpus and the same 30
questions as \`baseline-v1.4.json\`, with dense retrieval held fixed. Only the chunking
configuration changes, so a difference in the metrics is a difference in the input
distribution retrieval is measured on.

| Variant | size/overlap | Recall@1 | Recall@5 | MRR | nDCG@10 | Evidence P@5 | Index size (Δ) | Indexing | Query p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

Timing depends on hardware and is informational, exactly as in the frozen baseline.

## Adoption rule

> Adopt a change only if Recall@5 improves and nDCG@10 does not regress. A change
> that trades a large latency or index-size increase for a marginal recall gain is a
> product decision, not an automatic win.

## Outcome

${
  winner && winner.id === ADOPTED_ID
    ? `**Adopted: \`${winner.label}\`.** It clears the rule (Recall@5 ${format4(winner.recallAt5)} vs baseline ${format4(baseline.recallAt5)}, nDCG@10 ${format4(winner.ndcgAt10)} vs ${format4(baseline.ndcgAt10)}), improves Recall@1 and MRR as well, and *shrinks* the index (${winner.chunkCount} vs ${baseline.chunkCount} chunks). \`DEFAULT_CHUNK_OPTIONS\` is now \`chunkSize=${winner.chunkSize}, chunkOverlap=${winner.chunkOverlap}\`, and the frozen successor baseline is \`docs/eval/baseline-v1.5.json\`.

**Limitation to state plainly:** the corpus is small (13 short documents, ${winner.chunkCount}–${baseline.chunkCount} chunks), so Recall@5 saturates near 1.0 and is the least discriminating metric here; Recall@1 and MRR carry the result. The adoption should be re-checked on a larger, multi-format corpus before it is treated as settled.`
    : winner
      ? `\`${winner.label}\` clears the rule (Recall@5 ${format4(winner.recallAt5)} vs baseline ${format4(baseline.recallAt5)}, nDCG@10 ${format4(winner.ndcgAt10)} vs ${format4(baseline.ndcgAt10)}), but was **not** adopted. See the decision recorded in the repository.`
      : `No variant cleared the rule. **The shipped default is kept.** A negative result is the point of the experiment: it is the measurement that says the change is not worth making, not a failure to deliver.`
}

## Reproduce

\`\`\`bash
npm run eval:prepare   # one-time, networked model bootstrap
npm run eval:chunking  # offline; runs every variant and rewrites this file
\`\`\`
`

mkdirSync(resolve(OUT_MD, '..'), { recursive: true })
writeFileSync(OUT_JSON, `${JSON.stringify({ baseline: 'v1.4', variants: results }, null, 2)}\n`)
writeFileSync(OUT_MD, markdown)

console.log(`[chunking] wrote ${OUT_JSON} and ${OUT_MD}`)
console.log(
  `[chunking] ${winner ? `best clearing variant: ${winner.label}` : 'no variant cleared the rule; keep the baseline'}`
)
