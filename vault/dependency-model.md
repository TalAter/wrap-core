---
name: dependency-model
description: How wrap-core actually resolves today for consumers — local workspace linking vs. CI's separate mechanism — versus the published-semver end state described elsewhere in this vault.
---

# Dependency model

wrap-core is not published anywhere yet. The "depends on published semver versions of wrap-core" language elsewhere (this vault's README, monowrapo's and wrap-core's own CLAUDE.md) describes the intended end state, not today's reality. Two different mechanisms currently stand in for that publish step — it's easy to know one and assume it covers both.

## Local dev: version-matched Bun workspace

`monowrapo` (private, sibling repo) declares `../wrap-core`, `../wrap`, `../sweep` as Bun workspace members. `bun install` from `monowrapo` links `wrap-core` into each consumer via ordinary semver workspace resolution — it matches a consumer's declared `"wrap-core": "0.0.1"` against wrap-core's own `package.json` version, which must literally equal that string. No git ref, no registry. Bump wrap-core's version and every consumer's dependency line has to move with it, or the match — and the link — breaks.

Deliberate: it lets you edit a consumer and wrap-core together without cutting a wrap-core release per change.

## CI: standalone, no monowrapo

A consumer's own CI checks out only that one repo — no siblings, no monowrapo. `wrap-core@0.0.1` has nowhere to resolve from (public npm 404s; never published there). `monowrapo` can't fill in either: it's private, and pulls in the unrelated third sibling too.

wrap's fix (`.github/workflows/release.yml`, step "Install dependencies via ad hoc workspace"): clone wrap-core alone and write a throwaway two-package workspace root (`{workspaces: ["../wrap-core", "../<consumer>"]}`) purely to get the same version-matched linking, without monowrapo or sweep.

A separate, older mechanism exists in wrap for the twice-daily stryker mutation-testing routine (`scripts/cloud-env-setup.sh`, `.claude/hooks/routine-session-start.sh`): it clones all four repos including the real `monowrapo` (using a token, since monowrapo is private) and runs the real workspace install. That exists for a different reason — the routine wants the *real* monowrapo/sweep context — and is unrelated to the release-CI fix above. Fixing one doesn't fix the other.

## If you're touching dependency wiring, build scripts, or release workflows in any consumer

Check that both paths still resolve wrap-core: a local `bun install` from `monowrapo`, and whatever that repo's own CI does standalone. They're independent mechanisms and can silently diverge — that's exactly what broke wrap's v0.0.6 release (its build script and release workflow had both drifted out of sync with wrap-core's module layout, undetected until a release was actually cut).
