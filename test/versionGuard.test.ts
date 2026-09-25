import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareVersions, newestVersionTag, parseVersion } from '../scripts/check-version.mjs'

/**
 * A version guard is a build gate, so a silent hole in it is worse than a missing
 * rule: everything downstream reads "no violations" as proof. The first version of
 * the design-token guard shipped with a Windows-only hole for exactly that reason,
 * so the ordering rules here are tested directly rather than only through CI.
 *
 * The end-to-end cases at the bottom re-run the script the way CI does, because
 * "exits non-zero with a clear message" is the acceptance criterion and an exit
 * code cannot be asserted from an in-process import.
 */

const pkgVersion = JSON.parse(readFileSync('package.json', 'utf8')).version

/** Definitely different from `pkgVersion`, so the mismatch case stays a mismatch. */
const otherVersion = (() => {
  const parsed = parseVersion(pkgVersion)
  return parsed ? `${parsed.major + 1}.0.0` : '99.0.0'
})()

test('parseVersion accepts the shapes this project uses', () => {
  assert.deepEqual(parseVersion('1.3.0'), {
    major: 1,
    minor: 3,
    patch: 0,
    prerelease: null
  })
  assert.deepEqual(parseVersion('1.0.5-beta.1'), {
    major: 1,
    minor: 0,
    patch: 5,
    prerelease: 'beta.1'
  })
  assert.equal(parseVersion('10.20.30')?.major, 10)
})

test('parseVersion rejects anything that is not X.Y.Z', () => {
  for (const value of ['1.3', '1.3.0.1', 'v1.3.0', 'abc', '', '1.3.x', ' 1.3.0']) {
    assert.equal(parseVersion(value), null, value)
  }
})

test('compareVersions orders numerically, not lexicographically', () => {
  const gt = (a, b) =>
    assert.ok(compareVersions(parseVersion(a), parseVersion(b)) > 0, `${a} > ${b}`)
  const eq = (a, b) => assert.equal(compareVersions(parseVersion(a), parseVersion(b)), 0)

  gt('1.0.10', '1.0.9') // the classic: "1.0.10" < "1.0.9" as strings
  gt('1.10.0', '1.9.0')
  gt('2.0.0', '1.99.99')
  gt('1.0.1', '1.0.0')
  gt('10.0.0', '9.0.0')
  eq('1.3.0', '1.3.0')
})

test('a pre-release sorts below the release it precedes', () => {
  assert.ok(compareVersions(parseVersion('1.0.5-beta.1'), parseVersion('1.0.5')) < 0)
  assert.ok(compareVersions(parseVersion('1.0.5'), parseVersion('1.0.5-beta.1')) > 0)
  assert.ok(compareVersions(parseVersion('1.0.5-alpha'), parseVersion('1.0.5-beta')) < 0)
})

test('newestVersionTag picks the highest version, including past a pre-release', () => {
  // A pre-release of 1.0.5 is newer than the 1.0.4 release it supersedes; only its
  // own release outranks it.
  assert.equal(newestVersionTag(['v1.0.4', 'v1.0.5-beta.1', 'v1.0.4-rc.1']), 'v1.0.5-beta.1')
  assert.equal(newestVersionTag(['v1.0.4']), 'v1.0.4')
  assert.equal(newestVersionTag(['v1.0.4-rc.1', 'v1.0.4']), 'v1.0.4')

  // A pre-release must never win over the release it precedes.
  assert.equal(newestVersionTag(['v1.0.5', 'v1.0.5-beta.1']), 'v1.0.5')
  assert.equal(newestVersionTag(['v1.0.5-beta.1', 'v1.0.5']), 'v1.0.5')

  // Two-digit components are the case a lexicographic sort gets wrong.
  assert.equal(newestVersionTag(['v1.0.9', 'v1.0.10']), 'v1.0.10')
  assert.equal(newestVersionTag(['v1.0.10', 'v1.0.9']), 'v1.0.10')

  // Accepts a bare tag too, and reports it back as given.
  assert.equal(newestVersionTag(['1.2.0', 'v1.1.1']), '1.2.0')
})

test('newestVersionTag ignores tags that are not versions', () => {
  assert.equal(newestVersionTag([]), null)
  assert.equal(newestVersionTag(['archive/ai-conversation', 'release-candidate']), null)
  assert.equal(newestVersionTag(['archive/ai-conversation', 'v1.2.0']), 'v1.2.0')
})

/**
 * End-to-end: the actual script, the actual exit code. `--tag=` forces tag mode
 * without inventing a repository state, and the mismatched version is derived from
 * package.json so these keep working across a release bump.
 */

// `execFileSync` throws on a non-zero exit and types the caught value as unknown.
// `spawnSync` returns the status and streams instead, so the exit code can be
// asserted directly without narrowing a thrown value.
const runCheck = (args: string[]): { status: number | null; output: string } => {
  const result = spawnSync('node', ['scripts/check-version.mjs', ...args], { encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

const runCheckExpectingFailure = (args: string[]): { status: number | null; output: string } => {
  const result = runCheck(args)
  assert.notEqual(result.status, 0, `expected a non-zero exit for: ${args.join(' ')}`)
  return result
}

test('the matching tag passes', () => {
  assert.equal(runCheck([`--tag=v${pkgVersion}`]).status, 0)
  assert.match(runCheck([`--tag=v${pkgVersion}`]).output, /matches package\.json/)
})

test('a mismatched tag exits non-zero and names both versions', () => {
  const { output } = runCheckExpectingFailure([`--tag=v${otherVersion}`])

  assert.match(output, new RegExp(`v${otherVersion.replace(/\./g, '\\.')}`))
  assert.match(output, new RegExp(pkgVersion.replace(/\./g, '\\.')))
  assert.match(output, /does not match package\.json/)
})

test('a tag without the v prefix fails and explains why it is fatal', () => {
  // Right version, wrong tag name: release.yml triggers on `tags: v*.*.*`, so this
  // tag would push nothing at all.
  const { output } = runCheckExpectingFailure([`--tag=${pkgVersion}`])

  assert.match(output, /wrong name/)
  assert.match(output, /v\*\.\*\.\*/)
})

test('the repository itself passes the guard', () => {
  // Read-only end-to-end check of compare mode against the real tags: a plain run
  // must stay green, so a version that has fallen behind the newest release fails
  // the test suite as well as CI.
  const result = runCheck([])

  assert.equal(result.status, 0)
  assert.match(result.output, /check:version/)
})

test('the documented entry point is wired to this script', () => {
  // Asserted by reading package.json rather than by running `npm run check:version`:
  // on Windows `npm` is an `npm.cmd` shim, and spawnSync cannot execute a .cmd
  // without `shell: true`, so the subprocess returns `status: null` and the test
  // fails on Windows only. CI runs the real `npm run check:version` step anyway,
  // which is the stronger check.
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts

  assert.equal(scripts['check:version'], 'node scripts/check-version.mjs')
})

/**
 * The failure this guard is most likely to have is not a wrong answer but a silent
 * one: a checkout that cannot see any tags compares nothing and then reports
 * success. That already happened once - `fetch-tags: true` turned out to fetch no
 * tags for a pull request - and the step went green while checking nothing.
 *
 * Reproduced in a throwaway directory that is not a git repository at all, which is
 * the same shape as a checkout that fetched no tags.
 */
test('in CI, having no tags to compare against fails instead of passing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'knownote-version-guard-'))
  try {
    copyFileSync('scripts/check-version.mjs', join(dir, 'check-version.mjs'))
    copyFileSync('package.json', join(dir, 'package.json'))

    // The environment has to be controlled explicitly: CI sets GITHUB_ACTIONS, so
    // inheriting it here would run the "not in CI" case in CI mode and the test
    // would assert the wrong branch (which is how this first failed).
    const withoutActions = { ...process.env }
    delete withoutActions.GITHUB_ACTIONS

    const local = spawnSync('node', ['check-version.mjs'], {
      cwd: dir,
      encoding: 'utf8',
      env: withoutActions
    })
    assert.equal(local.status, 0, 'outside CI a missing tag list is tolerated')

    const ci = spawnSync('node', ['check-version.mjs'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ACTIONS: 'true' }
    })

    assert.notEqual(ci.status, 0, 'in CI it must not report success without comparing')
    assert.match(`${ci.stdout}${ci.stderr}`, /fetch-depth: 0/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
