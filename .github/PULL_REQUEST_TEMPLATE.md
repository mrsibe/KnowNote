<!--
PR title: use a Conventional Commits prefix (feat:, fix:, build:, docs:, ...).
It decides the label and the section this change lands in under the generated
release notes. See "Conventions" in CONTRIBUTING.md.
-->

## What does this PR do?

<!--
Briefly describe the change.

Focus on behavior and outcomes rather than implementation details.
-->

## Why?

<!--
Why is this change needed?
What problem does it solve?
-->

## Related issue

<!--
Use "Fixes #123" when this PR fully resolves an issue.
Use "Related to #123" when it does not.

Remove this section if there is no related issue.
-->

Fixes #

## What changed?

<!--
List the important changes. Keep this focused on reviewer-relevant details.
-->

-

## How was this tested?

<!--
Describe how you verified the change.

Examples:
- npm run typecheck
- npm run build
- npm run smoke:packaged
- Tested PDF import on Windows 11
- Tested Ollama connection locally
-->

-

## Screenshots / recordings

<!--
Required for meaningful UI/UX changes.
Remove this section if not applicable.
-->

| Before | After |
| ------ | ----- |
|        |       |

## Checklist

- [ ] I have reviewed my own changes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] I have tested the affected user workflow.
- [ ] I have not included unrelated changes.
- [ ] I have updated documentation when necessary.

### Desktop / build changes

<!--
Complete these when changing Electron, dependencies, native modules,
packaging, database initialization, or build configuration.
-->

- [ ] Not applicable
- [ ] `npm run build:unpack` passes.
- [ ] `npm run smoke:packaged` passes.
