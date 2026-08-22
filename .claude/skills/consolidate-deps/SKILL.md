---
name: consolidate-deps
description: Consolidate all open Dependabot dependency update PRs into a single verified release PR, with a grouped changelog and superseded PRs closed
---

# Consolidate Dependabot updates into one release

All open Dependabot bump PRs on the repo are scattershot and mutually conflicting. This skill merges every viable bump into **one** branch, proves it with build + tests + lint, and opens a **single** well-documented PR, closing the individual bot PRs as superseded.

## When to use

The user asks to "consolidate", "merge all the PRs into one", "make one release for the dependency updates", "update everything at /pulls", or similar. Run it whenever there are multiple open Dependabot PRs.

## Workflow

### 1. Recon

```
gh pr list --state open --json number,title,author,headRefName,createdAt
```

Gather for each PR: target version, runtime vs dev dep, and whether the bump is:
- **patch/minor** (low risk: nanoid, js-yaml, postcss, shiki, tailwindcss)
- **major** (high risk: typescript 5→7, pdf-parse 1→2, react, next). These need proof via build, not opinion.

Check how a major is used in the code (grep the source) before deciding it can land.

### 2. Risk review: include vs defer

Made only against real evidence, in this order:

1. **Superseded PRs.** If an earlier branch already merged a *newer* version of the same package (e.g. next 16.3.1 in a postcss group while another PR proposes 16.2.11), merging the older one would *downgrade*. Drop the newer-PR as superseded. Never merge a downgrade.
2. **Blocking toolchain incompatibility.** If a major breaks a core workflow and cannot be cleanly fixed, defer it with a documented reason and re-check it after the blocker clears. Example: TypeScript 7.0.2 fails `npm run lint` hard because `typescript-eslint@8.67.0` declares peer range `>=4.8.4 <6.1.0`. `tsc --noEmit` passing is not enough; a lint-broken toolchain does not ship. Stay on the previous major and keep the deferral note.
3. **Verified majors land.** A passing build + test suite is the gate for majors. pdf-parse 1.x→2.x, react, next all land if green.

### 3. Create the release branch

```
git checkout main && git pull origin main
git checkout -b release/deps-update origin/main
```

### 4. Merge each viable PR branch, in dependency-graph order

Merge the low-risk patches first, then majors. Use `git merge --no-edit "<branch>"`.

When a merge conflicts:
- `package.json` conflict: keep the **newer** version of every package, then apply that single resolved state.
- `package-lock.json` conflict: resolve the root `packages[""]` block to match the resolved `package.json`, then regenerate to reconcile.

After resolving conflicts in package.json, reconcile the lockfile so the tree is consistent:

```
npm install --package-lock-only --ignore-scripts
npm install --ignore-scripts
```

### 5. Verify (the gate)

```
npm run build
npm test
npm run lint
```

Green-build + green-tests is the gate. Lint: compare against the pristine `main` baseline. If `main` already fails lint (scratch `.js` files committed at baseline, pre-existing errors), treat it as pre-existing debt, do not regress it, and note it in the PR. Content-based lint errors in app source are pre-existing and not part of the dependency release scope.

If verification fails on something you merged, fix it if clean and safe, otherwise defer the bump with a documented commit.

### 6. Commit in clear units

- one commit for the merged bumps
- one for the lockfile reconcile (if any)
- one for any deferral (message states the exact blocker and the pinned version)

### 7. Push and open one PR

Push the branch, then create a single PR whose body contains:

- a **summary table** mapping each patch request to merged/superseded/deferred and why
- a **grouped changelog**: runtime deps and dev deps, each line as `name from → to` with a short reason
- a **deferred/superseded section** giving the concrete reason for anything not merged
- a **verification matrix**: build, test count, lint state, and any remaining `npm audit` findings with a note
- a short **why consolidated** section (atomic diff, one rollback unit, dependency-graph order, majors verified against the real toolchain)

Squash-merge is the recommended merge method.

### 8. Retire the individual bot PRs

Close every replaced PR with a pointer to the consolidated one. Give each closure a specific reason:

- merged: "Superseded by #N, this change landed in the consolidated release, see #N"
- superseded (newer version already present): name the newer version and that merging would downgrade
- deferred: name the exact blocker (peer range, toolchain error) and the re-enable condition

## Rules

- Never merge a dependency *downgrade*. Newer version always wins across PR conflicts.
- Never ship a broken core workflow (lint, build, test) to land a bump. Defer and document instead.
- Explicit version tags in the changelog: `next 16.2.10 → 16.3.1` with the exact from/to.
- Work in one release branch. Do not open one PR per bump.
- Never modify application source to paper over a dependency issue; if source changes are needed, they belong in their own review.
- When in doubt about a major, verify it first with the real build and test suite before including it.