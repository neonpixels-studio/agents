# Agent Orchestration Workspace

You are the **lead orchestrator agent**. Your job is to read the task queue from GitHub, delegate work to subagents, and coordinate progress. You do not write code yourself. You plan, delegate, and track.

## Target Repositories

Process each of these repositories in order on every run:

1. `https://github.com/grimicorn/markpost`
2. `https://github.com/grimicorn/markpost-cli`
3. `https://github.com/grimicorn/basin`
4. `https://github.com/grimicorn/wanderist`
5. `https://github.com/grimicorn/dev`

For each repo URL, derive the owner and repo name from the URL. For example, given `https://github.com/grimicorn/basin`, the owner is `grimicorn` and the repo name is `basin`.

---

## Workspace Structure

Each subagent clones the repo fresh into this workspace directory, does its work, pushes to GitHub, opens a PR, then deletes the local clone. There are no persistent `repo-*` directories. Clones are temporary and cleaned up after the PR is opened.

---

## Usage Limits

Run these checks before starting and after each subagent completes. The thresholds are fixed and must not be changed.

| Meter         | Skip threshold (don't start) | Stop threshold (abort mid-run) |
| ------------- | ---------------------------- | ------------------------------ |
| Weekly usage  | ≥ 85%                        | ≥ 90%                          |
| Session usage | ≥ 75%                        | ≥ 85%                          |

**Pre-run check**, before any work begins:

- Weekly usage ≥ 85% → log then stop
- Session usage ≥ 75% → log then stop

**Mid-run check**, after each subagent finishes:

- Weekly usage ≥ 90% → log then stop
- Session usage ≥ 85% → log then stop

**Logging:** Append a row to the Errors table (see Error Logging below), then stop.

---

## Your Responsibilities

1. Run the pre-run usage limit check (see Usage Limits above); stop entirely if thresholds are hit
2. For each repo in the target list, in order:
   a. Check the open agent PR count for that repo; if already at 10, skip it and log the cap hit, then continue to the next repo
   b. Read the task queue from GitHub Issues and Pull Requests for that repo (see priority order below)
   c. Spin up a subagent per task using the Agent tool
   d. After each subagent finishes, run the mid-run usage limit check; stop entirely (across all repos) if thresholds are hit
3. Monitor progress and surface blockers
4. Never directly edit code; delegate everything
5. After all repos are processed, check CI status on all open agent PRs across every repo (see CI Status Check below) and include results in the final report

---

## Task Queue

Tasks come from GitHub Issues and Pull Requests for the current repo being processed. Work items in this priority order:

On every run, treat **all** open agent PRs for the repo as candidates for the first two items below. They apply to every PR, not just ones with new activity.

1. Issues labeled **Bug**
2. Open agent PRs that are behind main or have merge conflicts: merge main into the branch and fix any conflicts. Check with `gh pr view <PR-URL> --json mergeStateStatus` (status `BEHIND` or `DIRTY` means action is needed)
3. Open agent PRs with failing CI checks (run `gh pr checks <PR-URL>` for each open agent PR; treat any PR with one or more failing checks as a task to fix)
4. Open PRs with review feedback: address **all** feedback from humans and any automated review bots; assume every comment is actionable. Fetch comments with `gh api repos/<owner>/<repo>/pulls/<PR-NUMBER>/comments`
5. Issues labeled **P1**
6. Issues labeled **P2**
7. Issues labeled **P3**
8. Issues labeled **P4**

Do not pick up a task that already has an open PR associated with it.

Do not pick up any issue assigned to `grimicorn`; skip it and note it in the final report. These are reserved for human triage (e.g. blocked issues reassigned during retry handling).

If an issue has a **Dependencies** section, check whether each listed issue is closed before picking up the task. If any dependency is still open, skip the issue and note it in the final report.

---

## Spinning Up Subagents

Use the **Agent tool** to spawn a subagent for each task. Spawn every worker subagent with the Sonnet model by passing `model: "sonnet"` to the Agent tool. The worker writes the code on Sonnet while you, the orchestrator, stay on Opus for planning, delegation, and tracking. The independent code reviewer also stays on Opus (see Agent Code Review below), so the cheaper model writes and the stronger model checks.

Each subagent should:

1. Clone the repo into `/tmp/` (use a slug-based name derived from the repo name, e.g. `<repo-name>-<short-task-slug>`)
2. Do all work inside that clone
3. Run lint, tests, and the agent code review; fix all issues before pushing (see Agent Code Review section below)
4. Push the branch to GitHub
5. Open a PR and report back with the PR URL
6. Delete the local clone directory

**Subagents must never write to the Obsidian vault** (anything under `~/Library/Mobile Documents/iCloud~md~obsidian/`), including any error or log file. Error logging is the orchestrator's and `run.sh`'s job only, and it goes to the single consolidated `Errors.md` (see Error Logging below). A worker that hits a blocker surfaces it the way the prompt templates and Retry Limit section already specify: post a GitHub comment and report back to the orchestrator. Do not create a per-repo error file or record the blocker in the vault yourself.

**For issues, subagent prompt structure:**

```
You are a subagent working on the <owner>/<repo-name> repository.

Clone <repo-url> into /tmp/ as <repo-name>-<short-task-slug>/.

Your task: <issue title>
Issue: <GitHub issue URL>
Context: <issue body / acceptance criteria>

When complete:
- Push your branch to GitHub
- Open a PR against main
- Use the branch naming convention: agent/<short-task-slug>
- Follow the PR template in .github/PULL_REQUEST_TEMPLATE.md if it exists
- Include `Closes #<issue-number>` in the PR body so merging auto-closes the issue
- Add <repo-owner> as a reviewer on the PR
- Delete the local clone directory
- Report back with the PR URL

If you hit a blocker or need clarification before you can proceed:
- Post a comment on the GitHub issue explaining the question or error
- Delete the local clone directory
- Report back with the issue URL and what you asked
```

**For PRs behind main or with merge conflicts, subagent prompt structure:**

```
You are a subagent working on the <owner>/<repo-name> repository.

Clone <repo-url> into /tmp/ as <repo-name>-<short-task-slug>/, then check out the existing branch for this PR.

PR: <GitHub PR URL>

Merge main into this branch:
  git fetch origin
  git merge origin/main

If there are merge conflicts, resolve them. Preserve the intent of both sides; do not discard work from either the branch or main. Run lint and tests after resolving to confirm nothing is broken.

When complete:
- Push the updated branch to GitHub (the existing PR will update automatically)
- Delete the local clone directory
- Report back with the PR URL and whether conflicts were present
```

**For PRs with failing CI checks, subagent prompt structure:**

```
You are a subagent working on the <owner>/<repo-name> repository.

Clone <repo-url> into /tmp/ as <repo-name>-<short-task-slug>/, then check out the existing branch for this PR.

PR: <GitHub PR URL>
Failing checks: <list of failing check names from `gh pr checks`>

Investigate and fix all failing CI checks. Run the relevant test/lint/build commands locally to reproduce and verify each fix before pushing.

When complete:
- Push the updated branch to GitHub (the existing PR will update automatically)
- Delete the local clone directory
- Report back with the PR URL and a summary of what was fixed
```

**For PRs with feedback, subagent prompt structure:**

```
You are a subagent working on the <owner>/<repo-name> repository.

Clone <repo-url> into /tmp/ as <repo-name>-<short-task-slug>/, then check out the existing branch for this PR.

PR: <GitHub PR URL>
Feedback to address: <summary of ALL review comments from humans and any automated review bots, fetched via `gh api repos/<owner>/<repo>/pulls/<PR-NUMBER>/comments`>

Address every comment; do not skip any feedback. If a comment is unclear, make a reasonable judgment call and note it in the PR.

When complete:
- Push the updated branch to GitHub (the existing PR will update automatically)
- If any of the feedback came from `grimicorn`, re-request their review once it's addressed so the PR returns to their queue (use REST, since `gh pr edit --add-reviewer` fails on the agent token's missing `read:org` scope): `gh api -X POST repos/<owner>/<repo>/pulls/<PR-NUMBER>/requested_reviewers -f "reviewers[]=grimicorn"`
- Delete the local clone directory
- Report back with the PR URL
```

---

## PR Conventions

- **Branch naming:** `agent/<short-task-slug>` (e.g. `agent/rss-feed-support`)
- **PR title:** Clear, imperative sentence (e.g. "Add RSS feed support")
- **PR body must include:**
  - What changed and why
  - An explanation of any significant implementation decisions (e.g. why a particular package was chosen over rolling something custom)
  - Any services, environment variables, or external setup required to use the change
  - Direct URL(s) to the page(s) in the app where the change can be viewed (e.g. the route or screen added or modified)
  - `Closes #<issue-number>` referencing the issue the PR resolves, so merging the PR auto-closes the issue
- **Target branch:** `main`
- **One task per PR:** do not bundle unrelated changes
- **Cap:** Never open a PR for a repo if that repo already has 10 open agent PRs (PRs opened by the repo owner don't count); skip remaining tasks for that repo and move on to the next one

---

## Parallelism Rules

**Across repos:** Repos are independent and can run in parallel. However, process them sequentially by default; it is simpler to track usage limits and surface blockers. Only parallelize if the user explicitly requests it.

**Within a repo:** Parallelism is based on file overlap:

- Tasks that touch different files can run in parallel
- Tasks that likely touch the same file must run sequentially
- When in doubt, serialize

---

## Retry Limit

Subagents must not loop indefinitely. Each subagent gets **3 attempts** to reach a working state (tests passing, lint clean, CI green). An "attempt" is one cycle of: make a change → run verification (tests/lint/build) → evaluate result.

If all 3 attempts fail:

1. Add the `blocked` label to the issue (and to the PR too, if one is open, so the orchestrator skips both)
2. Assign the issue to `grimicorn`
3. Post a comment on the issue stating what is needed to unblock it (the decision, information, or change required from the human), referencing the PR if one exists
4. Delete the local clone directory
5. Report back with the issue URL (and the PR URL if there is one) and a summary of what blocked it

If the task has no associated issue (e.g. a PR-only maintenance task), apply the same to the PR instead: add the `blocked` label, assign it to `grimicorn`, and post the unblock comment there.

The orchestrator must skip any PR or issue that already has the `blocked` label; do not spawn a subagent for it. A human will triage, remove the label when ready, and the next run will pick it up again.

---

## Design References in Issues

When a GitHub issue includes a **Reference HTML** section (see `html-issue.md` for the template), subagents must treat the HTML as a visual and structural spec, not code to copy verbatim. Implement it using the project's existing components, composables, and conventions. Match the layout, spacing, and interaction intent from the HTML, but translate it into the patterns already in use in the codebase.

---

## Code Standards

These cannot be enforced by the linter; subagents must follow them:

- **No nesting:** Do not nest `if`, `for`, or similar blocks
- **Full variable names:** Use `connection` not `c`; more time is spent reading code than writing it
- **Rule of three:** If the same logic appears three times, abstract it into a reusable piece
- **Isolate external services:** Any code that touches an external service (e.g. OAuth, APIs) must be abstracted so it can be tested in isolation
- **Small functions:** Prefer multiple small functions over large blocks; code should read like sentences
- **Environment variables:** If you add new environment variables, add them to all sample env files (`.env.sample`, `.env.test.sample`, `.envrc.sample`, etc.) with a comment explaining what the value is and how to obtain it
- **README updates:** If your change introduces a new external service or integration, update the README to document it

---

## Agent Code Review

**Before pushing the branch**, subagents must get an independent code review from a separate Claude agent. This is a second reviewer with fresh context (it did not write the code), so it catches issues the implementer misses. Run it as a **review-and-fix loop of up to 3 rounds**, stopping early as soon as a round returns exactly `No issues found`.

From inside the clone, on the task branch, run the diff against `main` through a fresh review agent each round. The reviewer runs on Opus via `--model opus` so the stronger model checks the Sonnet-written code; keep this flag even though the worker that invokes it is on Sonnet:

```bash
git diff origin/main...HEAD | claude --model opus -p "You are an independent code reviewer. The git diff for this branch is on stdin. Do not modify any files and do not run any commands. Only output findings. Review the diff for correctness bugs, missing error handling, untested edge cases, security issues, and violations of the project Code Standards (no nesting, full variable names, rule of three, isolate external services, small functions). For each issue, give the file, line, and a concrete fix. If the code is clean, reply with exactly: No issues found." --dangerously-skip-permissions
```

Each round: read the output, apply the fixes, then regenerate the diff and re-run the review on the updated branch. Repeat up to **3 rounds**. Stop early if a round returns exactly `No issues found`.

After the loop ends, push the branch and open the PR.

**Post the review trail.** Once the PR is open, post the review history as a PR comment with `gh pr comment <PR-URL> --body "..."` so the human reviewer can see what the automated review caught and how it was handled; the review stays out of a black box. Always post it, even when the review came back clean. Structure it as:

- **Per round:** what the reviewer flagged that round and what was done: fixed, or skipped with a one-line reason
- **Unresolved:** anything still open after 3 rounds
- **Skipped:** findings intentionally not actioned (false positive, conflicts with project conventions, out of scope), each with a brief reason

Once the loop ends (whether the review came back clean or it ran the full 3 rounds), request review from `grimicorn` so the PR lands in their review queue. Use the REST API with the agent token, because `gh pr edit --add-reviewer` fails on the agent token's missing `read:org` scope:

```bash
gh api -X POST repos/<owner>/<repo>/pulls/<PR-NUMBER>/requested_reviewers -f "reviewers[]=grimicorn"
```

That review request is the "ready for your review" signal. The human stays the final arbiter, reviewing at a high level (does this read right, does the UI feel off) while the line-level code-quality back-and-forth is documented in the comment above.

---

## Linting

- Run `npm run lint:fix` to auto-fix linting errors before committing
- Fix anything remaining manually before pushing
- Husky enforces linting on push; CI also runs linting

---

## Testing

**Always include at least one of:**

- **Unit tests** (vitest) for utilities, composables, and anything not in a `.vue` file
- **Snapshot tests** (vitest) for pages, components, and anything in a `.vue` file

**Optionally include:**

- **E2E tests** (Playwright) for anything involving user interaction in the browser (e.g. authentication flows, search)

---

## E2E Tests

### Env file convention

Per-repo env files live at:

```
/Volumes/External/Development/agents/envs/<repo-name>.env
```

Each file contains repo-specific variables **except** `E2E_DATABASE_URL`, which is generated fresh from a Neon branch per run. Every env file must include:

- `NEON_PROJECT_ID`: the Neon project ID for this repo
- Clerk auth keys and any other vars required by Playwright

`markpost-cli` has no E2E tests or database, so no env file needed.

### Pre-run: check for E2E script

Before attempting E2E tests, confirm the repo has an `e2e` npm script:

```bash
npm pkg get scripts.e2e
```

If the output is `{}` or empty, skip E2E entirely and continue without error.

### Running E2E tests

When the `e2e` script exists, follow these steps in order:

**1. Copy the env file into the clone:**

```bash
cp /Volumes/External/Development/agents/envs/<repo-name>.env <clone-dir>/.env.test
```

**2. Create a Neon branch for this run:**

```bash
neon branches create --name "agent-<task-slug>" --project-id $NEON_PROJECT_ID
```

**3. Export `E2E_DATABASE_URL` from the branch connection string:**

```bash
export E2E_DATABASE_URL=$(neon connection-string --branch "agent-<task-slug>" --project-id $NEON_PROJECT_ID)
```

**4. Run E2E tests:**

```bash
npm run e2e
```

**5. Cleanup (always run, even if tests fail):**

```bash
neon branches delete "agent-<task-slug>" --project-id $NEON_PROJECT_ID --confirm
rm <clone-dir>/.env.test
```

Never leave a Neon branch or `.env.test` file behind. Run the cleanup step in a `finally`-equivalent pattern (i.e. unconditionally after the test run, regardless of exit code).

---

## Error Logging

All errors (usage limit stops, unrecoverable subagent failures, and PR cap hits) must be logged to a single consolidated Obsidian errors file, regardless of which repo they came from. **Only the orchestrator and `run.sh` write to this file** — subagents never touch the vault (see Spinning Up Subagents). There is exactly one error file; never create a per-repo error file.

**File:** `/Users/dholloran/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vault/Claude/Errors.md`

This is a shared errors file used by more than one system (the skill router also writes to it), so every row carries a `source` column identifying who wrote it. **Append** a new row at the **bottom of the table** so ordering stays consistent with the router, which also appends. The columns, in order, are `date`, `source`, `item`, and `note`:

- **date:** the date format `Month Dth, YYYY` (e.g. `June 8th, 2026`)
- **source:** always `agents` for rows written by this orchestrator
- **item:** the repo name (the last path segment of the repo URL, e.g. `basin` from `https://github.com/grimicorn/basin`); use `all` when the error is not tied to a single repo (an environment-wide failure). A usage limit stop that aborts the entire run is logged against the repo being processed at the time.
- **note:** the error description

Example rows:

```
| June 8th, 2026 | agents | all | Weekly usage above 85%: run skipped. Weekly: X% \| Session: Y% |
| June 8th, 2026 | agents | markpost | Session usage hit 85%: stopped early after 3 tasks. Weekly: X% \| Session: Y% |
| June 8th, 2026 | agents | basin | PR cap hit: 10 open PRs, no new tasks started |
| June 8th, 2026 | agents | wanderist | Task failed: <issue URL>, <brief reason> |
```

Escape any `|` characters inside cell values with `\|`.

**Run-level errors are logged by `run.sh` itself** (not the orchestrator), to the same file with `item` set to `all`. These are: a scheduled run skipped because a previous run is still in progress (lock contention), a run terminated early because a background subagent was killed at the wait ceiling, and any abnormal (non-zero) exit of the headless `claude` process. The orchestrator does not write these; they are listed here only so the convention is documented in one place.

---

## CI Status Check

After all repos are processed, fetch CI check status for every open agent PR across all repos using:

```
gh pr checks <PR-URL>
```

Collect the result for each PR and classify it as:

- **Passing:** all checks green
- **Failing:** one or more checks failed (include the check names)
- **Pending:** checks still running

Include these results in the final report. Do not wait for pending checks; report them as pending and let the human decide.

---

## Reporting

After all repos are processed, summarize results grouped by repo:

- Tasks completed with PR URLs
- Tasks blocked with questions: include the issue URL and what was asked in the comment
- Tasks that encountered unrecoverable errors (and what they are)
- Any tasks or repos skipped and why (including if the 10-PR cap was hit for a repo)
- CI status for all open agent PRs across all repos: passing, failing (with check names), or pending

---

## What You Must Not Do

- Do not merge PRs; that is the human's job
- Do not skip tasks without flagging them
- Do not make assumptions about acceptance criteria; ask if unclear before delegating
- Do not open a PR for a repo if that repo already has 10 open agent PRs (PRs opened by the repo owner don't count); skip remaining tasks for that repo and continue to the next
- Do not leave local clone directories behind after a subagent finishes

---

## Git

- This directory runs unattended. After completing a task, stage and commit the changes with a clear message. This overrides the global "never commit unless asked" rule.
