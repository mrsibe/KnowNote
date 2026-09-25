# Contributing to KnowNote

Thanks for your interest in KnowNote. Bug reports, feature requests, and pull
requests are all welcome.

KnowNote is a young project maintained by one person, so the guidance below is
mostly about keeping review cheap.

## Before you start

- **Search existing issues** before opening a new one — duplicates cost triage
  time.
- **Open an issue first** for anything larger than a bug fix or a small
  improvement (a new provider, a new document format, a schema change,
  anything touching packaging). It is much cheaper to agree on the approach
  before the code exists than after.
- Small, obviously-correct fixes can go straight to a PR.

## Development setup

Requirements:

- **Node.js 24** — the version used by CI (`.github/workflows/verify.yml`).
- **npm** — KnowNote uses npm, not pnpm or yarn. The native-module collector in
  `electron-builder` is built around npm's `node_modules` layout and silently
  drops transitive dependencies under pnpm. See the `//dependencies` comment in
  `package.json` for the full story.
- A working native build toolchain. `npm install` runs
  `electron-builder install-app-deps` as a `postinstall` step, which compiles
  the native addons (`better-sqlite3`, `sqlite-vec`), so the first install
  takes a while.

```bash
git clone https://github.com/MrSibe/KnowNote.git
cd KnowNote
npm install
npm run dev
```

## Commands

| Command                  | What it does                                                   |
| ------------------------ | -------------------------------------------------------------- |
| `npm run dev`            | Start the app in development with HMR.                         |
| `npm run typecheck`      | Typecheck the main/preload, renderer and test projects.        |
| `npm test`               | Run the Node test suite (`test/**/*.test.ts`).                 |
| `npm run lint`           | ESLint (see the note on the current baseline below).           |
| `npm run format`         | Prettier over the whole repository.                            |
| `npm run build`          | Typecheck, then bundle with electron-vite.                     |
| `npm run build:unpack`   | `build`, then produce an unpacked app in `dist/`.              |
| `npm run smoke:packaged` | Launch the packaged app's `--smoke-test` and check it starts.  |
| `npm run eval:prepare`   | One-time, networked: download the pinned eval embedding model. |
| `npm run eval`           | Run the RAG eval harness offline; rewrites `docs/eval/`.       |
| `npm run db:generate`    | Generate a Drizzle migration from `src/main/db/schema.ts`.     |
| `npm run db:studio`      | Inspect the development database.                              |

## Before you open a pull request

```bash
npm run typecheck   # required — this is a CI gate
npm test            # required — this is a CI gate
npm run build
```

Additionally, run the packaged-app checks if you touched Electron main or
preload code, `dependencies`, native addons, packaging, database
initialization, or build configuration:

```bash
npm run build:unpack
npm run smoke:packaged
```

`npm run build` and `build:unpack` both succeed on an artifact that cannot
start. That is how `Cannot find module 'script-loader!sql.js'`,
`ReferenceError: DOMMatrix is not defined`, and a lost CJS interop in the Anki
export have all reached a release. `smoke:packaged` runs the real executable
against the real `app.asar`, so it is the step that actually catches these.

Two caveats:

- **`lint` is not a gate.** `npm run lint` has no errors, but `main` still
  reports ~118 pre-existing `@typescript-eslint/no-explicit-any` warnings.
  Don't add new ones, and don't mass-refactor them in an unrelated PR.
- **Don't run `npm run format` on the whole repository.** It rewrites every
  file, and a repo-wide format pulls unrelated changes into your diff. Format
  only what you touched:

  ```bash
  npx prettier --write <files>
  ```

Tests live in `test/**/*.test.ts` and run on Node's built-in test runner via
`npm test` (no test framework dependency). `test/fixtures/` additionally
contains sample documents for manual parser checks. For anything not covered by
a test, describe your manual verification in the PR instead — which platform,
which workflow, what you observed.

## Conventions

**Branches** come off `main` and are named `<type>/<short-description>`, e.g.
`fix/macos-native-modules`, `feat/audio-transcription`.

**Commits** follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `build:`, `style:`. A scope is
welcome when it is meaningful: `fix(mac): ...`.

**Pull request titles** use the same prefixes, because the prefix decides two
things automatically:

- the label applied by the `Label PR` workflow, and
- the section the change appears under in the generated release notes
  (`.github/release.yml`).

| Title prefix                       | Label            | Release section   |
| ---------------------------------- | ---------------- | ----------------- |
| `feat:`, `perf:`                   | `enhancement`    | Features          |
| `fix:`                             | `bug`            | Bug Fixes         |
| `build:`                           | `build`          | Build & Packaging |
| `deps:`, `chore(deps):`            | `dependencies`   | Dependencies      |
| `docs:`                            | `documentation`  | Documentation     |
| `chore:`, `ci:`, `style:`, `test:` | `skip-changelog` | _(excluded)_      |
| `refactor:`                        | _(none)_         | Other Changes     |

`refactor:` is left unlabelled on purpose: the workflow cannot tell whether a
refactor changes user-visible behaviour. Add `enhancement` or `bug` yourself
when it does, and `breaking` when it breaks compatibility.

**Version bumps and releases are done by the maintainer** — don't change
`version` in `package.json` or add a tag in a PR.

## Where things live

```plaintext
src/main/       Electron main process
  db/           Drizzle schema, migrations, queries
  services/     Document parsing, RAG, item and note storage
  models/       Model Connection resolution and API protocol adapters
src/preload/    IPC bridge
src/renderer/   React UI
src/shared/     Types and utilities used by more than one process
```

A few project-specific rules worth knowing before you write code:

- **Keep `dependencies` minimal.** Only packages that cannot be bundled belong
  there (native addons and a few CommonJS packages that rollup can't inline).
  Everything else goes in `devDependencies`. A dependency in the wrong bucket
  means either a runtime `MODULE_NOT_FOUND` in the packaged app or a bloated
  `app.asar`. The `//dependencies` comment in `package.json` explains the
  boundary.
- **Database changes are migrations.** Edit `src/main/db/schema.ts`, then run
  `npm run db:generate` and commit the generated file under
  `src/main/db/migrations/`. Never edit a migration that has already shipped.
- **Add user-facing strings to both locales.** `src/renderer/src/locales/en-US/`
  and `src/renderer/src/locales/zh-CN/` are kept in sync, and every namespace is
  registered in `src/renderer/src/i18n.ts`.
- **Keep PRs focused.** No drive-by reformatting, renames, or unrelated
  cleanups. If you spot something else that needs fixing, open an issue.

## Pull requests

The PR template asks for the change, the motivation, the related issue, the
scope, and how you tested it. Fill in what applies; delete what does not.
Screenshots are expected for meaningful UI changes.

If your PR fixes an issue, use `Fixes #123` so it closes automatically.

## License

KnowNote is licensed under GPL-3.0. By contributing, you agree that your
contributions are licensed under the same terms.
