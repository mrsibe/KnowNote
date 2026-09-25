#!/usr/bin/env node
/**
 * Version consistency guard.
 *
 * `package.json`'s `version` is the single source of truth: electron-builder
 * takes the app version and every artifact name (`knownote-${version}-setup.exe`,
 * the `.dmg`, `latest.yml`, the updater feed) from it, and Electron's
 * `app.getVersion()` - which is what the About panel shows - reads it back out of
 * the packaged package.json. The git tag has to agree, because `release.yml` is
 * tag-triggered and the updater compares versions: a tag that disagrees with the
 * build either publishes an artifact whose filename lies, or makes the updater
 * skip a release it should install.
 *
 * Nothing in CI used to notice. `package.json` sat at 1.2.2 while the newest
 * release was v1.3.x, and only a human reading both numbers could tell.
 *
 *   npm run check:version                  # compare against the newest tag
 *   npm run check:version -- --tag=v9.9.9  # pretend a release is being tagged
 *
 * Two modes, because the two situations have genuinely different invariants:
 *
 *   tag mode (release)   the tag must EQUAL `package.json`. This is the release
 *                        blocker: it refuses to build a mismatched release.
 *   compare mode (PR)    `package.json` must not be BEHIND the newest tag. Not
 *                        equality - a version bump is merged before the tag is
 *                        pushed, and during that window `main` is legitimately
 *                        ahead of the newest tag. Requiring equality there would
 *                        fail every unrelated PR opened in between.
 *
 * The parsing, ordering and tag-selection rules are exported and unit tested
 * (test/versionGuard.test.ts) the same way the design-token guard is: a silent
 * hole in a guard is worse than a missing rule, because everything downstream
 * reads "no violations" as proof.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PACKAGE_JSON = resolve('package.json')

/** `1.2.3` or `1.2.3-beta.1`, matching what this project has ever used. */
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/**
 * @returns {{major: number, minor: number, patch: number, prerelease: string | null} | null}
 *   null when the value is not a version this project would use.
 */
export const parseVersion = (value) => {
  const match = VERSION_RE.exec(value)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null
  }
}

/**
 * @returns {number} negative when `a` is older than `b`, 0 when equal.
 *
 * Pre-release ordering is the part that matters: `1.0.5-beta.1` must sort below
 * `1.0.5`, or the newest-tag lookup would answer a beta and hold back the release
 * that superseded it.
 */
export const compareVersions = (a, b) => {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] - b[key]
  }
  if (a.prerelease === b.prerelease) return 0
  if (a.prerelease === null) return 1
  if (b.prerelease === null) return -1
  return comparePrerelease(a.prerelease, b.prerelease)
}

/**
 * SemVer pre-release precedence, identifier by identifier.
 *
 * This cannot be a string comparison. `beta.10` is **newer** than `beta.2`, but
 * `'beta.10' < 'beta.2'` is true lexicographically, so a plain string comparison
 * reports the wrong order - and then `newestVersionTag` picks the wrong tag and the
 * guard validates against the wrong release. This project has shipped a
 * pre-release before (`v1.0.5-beta.1`), so the shape is real rather than
 * theoretical.
 *
 * SemVer 11.4, in order: identifiers are compared left to right; numeric
 * identifiers compare numerically; numeric identifiers always have lower
 * precedence than alphanumeric ones; and if every shared identifier is equal, the
 * longer set wins.
 *
 * @returns {number} negative when `a` takes precedence below `b`.
 */
export const comparePrerelease = (a, b) => {
  const left = a.split('.')
  const right = b.split('.')
  const length = Math.max(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const aPart = left[index]
    const bPart = right[index]

    // `beta` < `beta.1`: a shorter set of identifiers loses once the shared ones match.
    if (aPart === undefined) return -1
    if (bPart === undefined) return 1
    if (aPart === bPart) continue

    const aNumeric = /^\d+$/.test(aPart)
    const bNumeric = /^\d+$/.test(bPart)
    if (aNumeric && bNumeric) return Number(aPart) - Number(bPart)
    // `1` < `alpha`: numeric identifiers are always lower than alphanumeric ones.
    if (aNumeric) return -1
    if (bNumeric) return 1

    return aPart < bPart ? -1 : 1
  }

  return 0
}

/**
 * Highest release tag among `tags`.
 *
 * Only `v`-prefixed tags count. `release.yml` triggers on `tags: v*.*.*`, so a bare
 * `1.2.3` is a tag no release will ever be built from - treating it as the newest
 * release would red every pull request over a version that was never published.
 * Such tags are reported separately by `bareVersionTags` instead.
 *
 * Takes the list rather than reading git, so the selection rule is testable. It
 * re-compares with `compareVersions` instead of trusting `git tag --sort`, so a
 * pre-release or a two-digit component cannot win by lexicographic accident -
 * `v1.0.10` is newer than `v1.0.9`, but sorts before it as a string.
 *
 * @returns {string | null} the tag as given, or null when nothing is usable.
 */
export const newestVersionTag = (tags) => {
  let best = null
  let bestParsed = null

  for (const tag of tags) {
    if (!tag.startsWith('v')) continue
    const parsed = parseVersion(tag.slice(1))
    if (!parsed) continue
    if (bestParsed === null || compareVersions(parsed, bestParsed) > 0) {
      best = tag
      bestParsed = parsed
    }
  }

  return best
}

/**
 * Version tags that are missing their `v` prefix - a mistake rather than a release.
 *
 * `release.yml` triggers on `tags: v*.*.*`, so pushing a bare `2.0.0` publishes
 * nothing at all. Left unreported it is also invisible: the tag exists on the
 * remote and nobody learns that the release never happened.
 */
export const bareVersionTags = (tags) =>
  tags.filter((tag) => !tag.startsWith('v') && parseVersion(tag) !== null)

/**
 * Under Actions an `::error::` line becomes an annotation on the failed step, the
 * same way release.yml reports its packaging failures.
 */
const inActions = process.env.GITHUB_ACTIONS === 'true'
const report = (message, failed) => {
  const write = failed ? console.error : console.log
  write(failed && inActions ? `::error::${message.replace(/\n/g, '%0A')}` : message)
  if (failed) process.exitCode = 1
}

const fail = (message) => report(message, true)

const readPackageVersion = () => {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read ${PACKAGE_JSON}: ${error.message}`)
  }

  const version = parsed.version
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`${PACKAGE_JSON} has no "version" string`)
  }
  if (!parseVersion(version)) {
    throw new Error(`${PACKAGE_JSON} version ${JSON.stringify(version)} is not X.Y.Z[-prerelease]`)
  }
  return version
}

/**
 * The tag this run is about, if any.
 *
 * `refs/tags/` is the reliable signal - `GITHUB_REF_NAME` is a branch name on
 * `workflow_dispatch`. `--tag=` exists so the check can be exercised locally
 * without inventing a repository state.
 */
const releaseTag = () => {
  const flag = process.argv.find((argument) => argument.startsWith('--tag='))
  if (flag) return flag.slice('--tag='.length)

  if ((process.env.GITHUB_REF ?? '').startsWith('refs/tags/')) {
    return process.env.GITHUB_REF_NAME ?? process.env.GITHUB_REF.slice('refs/tags/'.length)
  }

  return null
}

/** Tags in the repository, or null when it is not a clone / git is unavailable. */
const repositoryTags = () => {
  try {
    return execFileSync('git', ['tag', '--list'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch {
    return null
  }
}

const checkTagMode = (version, tag) => {
  const expectedTag = `v${version}`
  if (tag === expectedTag) {
    return report(`check:version — tag ${tag} matches package.json ${version}`, false)
  }

  const tagVersion = tag.replace(/^v/, '')
  const missingPrefix = !tag.startsWith('v')

  // Right version, wrong tag name: the only problem is the missing `v`, which is
  // fatal rather than cosmetic because release.yml triggers on `v*.*.*`.
  if (missingPrefix && tagVersion === version) {
    return fail(
      `Tag ${tag} has the right version but the wrong name: it must be ${expectedTag}.\n` +
        `  release.yml triggers on \`tags: v*.*.*\`, so \`${tag}\` would push nothing and\n` +
        `  publish no artifacts. Delete it and tag ${expectedTag} instead.`
    )
  }

  const lines = [
    `Tag ${tag} does not match package.json ("version": "${version}").`,
    `  electron-builder takes every artifact name and the updater feed from package.json,`,
    `  so releasing this tag would publish a build whose version does not match its tag.`,
    `  Pick one:`,
    `    - you are releasing ${tagVersion}:  run \`npm version ${tagVersion}\` on main, merge it, then re-tag`,
    `    - you are releasing ${version}:  delete this tag and tag ${expectedTag} instead`
  ]
  if (missingPrefix) {
    lines.push(
      `  Note: the tag has no "v" prefix, so release.yml (on: tags: v*.*.*) would not run for it at all.`
    )
  }

  return fail(lines.join('\n'))
}

const checkCompareMode = (version, tags) => {
  // A bare version tag is a mistake: release.yml will never build from it, so it is
  // invisible unless it is reported. It is also deliberately NOT counted as a
  // release below, because otherwise a stray `2.0.0` tag would make every pull
  // request fail against a version that was never published.
  const bare = tags === null ? [] : bareVersionTags(tags)
  if (bare.length > 0) {
    return fail(
      [
        `Unusable version tag${bare.length === 1 ? '' : 's'}: ${bare.join(', ')}`,
        `  release.yml triggers on \`tags: v*.*.*\`, so ${bare.length === 1 ? 'this tag' : 'these tags'} would publish no artifacts.`,
        `  ${bare.length === 1 ? 'It is' : 'They are'} not counted as a release here, or every pull request would fail against a`,
        `  version that was never published.`,
        `  Delete ${bare.length === 1 ? 'it' : 'them'}, or rename to v<version>.`
      ].join('\n')
    )
  }

  const latest = tags === null ? null : newestVersionTag(tags)

  if (latest === null) {
    // In CI this must not happen, and it is the failure this guard is most likely
    // to have: a checkout that cannot see the tags compares nothing and then
    // reports success, so the step looks green and checks absolutely nothing.
    // That already happened once here - `fetch-tags: true` turned out to fetch no
    // tags for a pull request, because it only adds the checked-out ref's own tag.
    // Failing loudly is the same call as allowMissingDependencies: false in
    // electron-builder.yml: a check that cannot run must not look like one that ran.
    if (inActions) {
      return fail(
        `no version tag is reachable, so this check has nothing to compare against.\n` +
          `  In CI that means the checkout did not fetch tags. verify.yml must use\n` +
          `  \`fetch-depth: 0\`: actions/checkout only fetches every tag when it fetches\n` +
          `  all history (\`fetch-tags\` adds just the checked-out ref's own tag).`
      )
    }

    return report(
      `check:version — package.json ${version}; no version tag reachable, nothing to compare ` +
        `(not a git clone, or a shallow checkout without tags)`,
      false
    )
  }

  const latestVersion = latest.replace(/^v/, '')
  const packageParsed = parseVersion(version)
  const latestParsed = parseVersion(latestVersion)

  if (!packageParsed || !latestParsed) {
    return fail(`could not compare ${version} with ${latest}`)
  }

  if (compareVersions(packageParsed, latestParsed) < 0) {
    return fail(
      `package.json is at ${version} but the newest version tag is ${latest}. ` +
        `The packaged app and its artifacts would claim a version older than what has ` +
        `already shipped, and the updater would ignore the newer release. ` +
        `Run \`npm version ${latestVersion}\` (or higher) to catch up.`
    )
  }

  const relation = compareVersions(packageParsed, latestParsed) === 0 ? 'matches' : 'is ahead of'
  return report(
    `check:version — package.json ${version} ${relation} the newest version tag ${latest}`,
    false
  )
}

const main = () => {
  let version
  try {
    version = readPackageVersion()
  } catch (error) {
    return fail(error.message)
  }

  const tag = releaseTag()
  return tag === null ? checkCompareMode(version, repositoryTags()) : checkTagMode(version, tag)
}

// Only run when invoked directly (`npm run check:version`), so tests can import
// the ordering rules without executing the check.
const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) main()
