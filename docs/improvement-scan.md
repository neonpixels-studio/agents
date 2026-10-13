## Weekly Improvement Scan

Weekly, the orchestrator scans each repo for improvements/missing functionality that **don't already have an issue** and surfaces them as one **digest issue** per repo for human triage. This generates candidate work; it builds nothing.

Candidates come from two sources: the **generator** (a fresh codebase scan, Wed/Sun) and **suggestion intake** — follow-up notes the agent leaves on PRs plus `/suggest` comments the human leaves on PRs, harvested **daily** into the ledger so they're queued and ready by the next generation day.

**Three cadences:**
- **Suggestion intake — daily** (Phase 0). Harvest PR-sourced and human-sourced suggestions into the ledger as pre-vetted `held` candidates.
- **Digest promotion — daily** (Phase 1). Triggered by the human closing a digest. An **open** digest = not triaged yet; leave it alone.
- **Digest generation — Wednesdays and Sundays only** (Phase 2). Runs in the scan pass, before any task work, on those days. Pulls the whole ledger pool (generator output + carried `held`, including intake) through the ranker.

Generation guards:
- **At most once per generation day:** skip if a digest was already created today — `gh issue list --repo <owner>/<repo> --label improvement-digest --state all --search "created:$(date +%Y-%m-%d)" --json number`.
- **No pile-up:** skip if an **open** `improvement-digest` issue already exists (last week's still awaiting triage); note it.
- Subject to Usage Limits — skip if a stop threshold was hit.

### The ledger

Persistent memory of every candidate ever proposed, so the scan never re-proposes something tracked/promoted/rejected. Without it you get the same suggestions weekly.

- **Location:** `/Volumes/External/Development/agents/.ledger/<repo-name>.jsonl`, one file per repo (`.ledger/` is gitignored).
- **Written only by the orchestrator.** Subagents never touch it. Generator/ranker subagents receive ledger context in prompts and return data; the orchestrator does all reads/writes.
- **Append-only JSONL, latest record per `id` wins.** To change status, append a new record with the same `id` — never rewrite the file.
- **Record:**
  ```json
  {"id": "<repo-short>-<YYYYMMDD>-<n>", "date": "<YYYY-MM-DD>", "title": "...", "summary": "...", "rationale": "...", "suggested_label": "P2", "effort": "M", "status": "proposed", "source": "scan", "origin_pr_url": null, "digest_issue_url": "...", "promoted_issue_url": null, "notes": ""}
  ```
  `status` ∈ `proposed | promoted | rejected | held`. `source` ∈ `scan | pr | human` (default `scan`; `pr`/`human` come from Phase 0 intake, with `origin_pr_url` set). `id` e.g. `basin-20260724-2`.
- **`held`:** a strong candidate the ranker keeps but cuts only for the 5-item cap, a root-cause/larger-than-one-issue item worth remembering, **or a freshly-intaken PR/human suggestion awaiting its first ranking**. Not in this week's digest; carried forward and re-injected into the ranker pool every run as **pre-vetted** (`"carried": true`) until surfaced (→ `proposed`), promoted, or dropped. It must clear the same bar as a survivor — held is not a filler bucket (filler is `rejected`, dropped forever). A held item keeps its `id` for life; append a new record only when status actually changes.

### Phase 0 — Suggestion intake (daily)

Runs every run per repo, before promotion. Harvests two suggestion sources into the ledger as `held` candidates so the next generation ranks them alongside fresh scan output. Cheap (GitHub reads + ledger appends, no subagents) — runs even when the PR cap is hit and on non-generation days.

Scope the scan to bound cost: **open PRs plus PRs merged/closed in the last 7 days.**

1. **Agent-sourced (PR body blocks).** Find PRs carrying follow-ups: `gh pr list --repo <owner>/<repo> --state all --label has-suggestions --search "updated:>=<7-days-ago>" --json number,url,body`. For each, parse the `<!-- suggestions:start -->`…`<!-- suggestions:end -->` block; each bullet is one candidate. Derive `id` = `<repo-short>-pr<NUM>-<n>` (bullet index).
2. **Human-sourced (`/suggest` comments).** For each in-scope PR, read conversation comments: `gh api repos/<owner>/<repo>/issues/<PR-NUMBER>/comments --jq '.[] | {id, user: .user.login, body}'`. Any comment whose body has a line beginning `/suggest ` is a candidate — the text after `/suggest ` is the suggestion (first sentence = `title`/`summary`; infer `suggested_label`/`effort` if the human didn't state them). Derive `id` = `<repo-short>-pr<NUM>-h<comment-id>` (the GitHub comment id makes this idempotent and stable).
3. **Dedupe by `id` against the ledger.** Skip any `id` that already has a record — never re-intake. This is the whole idempotency guard (no label juggling needed).
4. **Append a ledger record** for each new candidate: `status: held`, `carried: true`, `source: pr` (step 1) or `human` (step 2), `origin_pr_url` set, `date` today. Held items already carry into the ranker pool, so nothing else is needed to feed generation.
5. **Acknowledge human suggestions** so the human sees them land: on each newly-intaken `/suggest` comment's PR, `gh pr comment <PR-URL> --body "📥 Recorded \`<title>\` to the improvement ledger — it'll compete in the next digest (added to suggestions)."` Skip the ack for agent-sourced blocks (no human waiting on them).

### Phase 1 — Digest promotion (daily)

Runs every run as step 2b, per repo. **The human closing a digest is the trigger.**

1. List **closed** digests not yet processed: `gh issue list --repo <owner>/<repo> --label improvement-digest --state closed --json number,body,url,labels`; skip any with `digest-processed`. Never touch **open** digests.
2. Ensure the label exists: `gh label create digest-processed --repo <owner>/<repo> --color 0E8A16 --description "Improvement digest whose checks have been promoted" 2>/dev/null || true`.
3. Parse each digest's checklist: `- [x] \`<id>\` ...` = checked (wanted); `- [ ] \`<id>\` ...` = unchecked (dismissed). Nothing checked is a valid "dismiss all".
4. For each **checked** item: look up its ledger record by `id`, create a real issue — title from `title`; body = `rationale` + acceptance criteria + `Promoted from improvement digest <digest-url>`; label = `suggested_label`. **Leave it unassigned** (do not assign `grimicorn`). Append a ledger record with `status: promoted` and `promoted_issue_url` set.
5. For each **unchecked** item: append a record with `status: rejected` (won't be re-proposed).
6. Mark the digest done (never reprocessed): `gh issue edit <digest-url> --add-label digest-processed` then `gh issue comment <digest-url> --body "Promoted: <urls>. Dismissed: <n> unchecked."` Leave it **closed**. The `digest-processed` label is the idempotency guard.

### Phase 2 — Generate a new digest (Wednesdays and Sundays only)

Per repo, independent of promotion.

0. Skip if either guard trips (already generated today, or an open digest exists); note the reason.
1. Read the ledger and open issue titles (the "already known" set) plus the current **held** set (every `id` whose latest record is `held`) — held items carry forward and re-enter ranking. This held set now includes Phase 0 intake (`source: pr | human`); those enter the ranker pool exactly like any carried candidate.
2. Spawn a **generator subagent on Sonnet** (read-only; no push/PR/issue) with the prompt below. If the repo is a cross-repo dependent, add the read-only reference-clone instruction and tell it to ground CLI/consumer candidates in the dependency's contract. Held titles are in the exclusion list, so the generator won't re-derive them — they reach the ranker via the orchestrator.
3. Feed the ranker **both** the generator's fresh candidates and the carried-forward held items (each tagged `"carried": true`). Spawn a **ranker subagent on Opus** (independent). It keeps **at most 5** survivors and returns a capped `held` list.
4. Persist to the ledger:
   - Each **survivor:** fresh → new `id`; carried → reuse `id`. Append a `proposed` record. Include in the digest.
   - Each ranker-returned **held:** fresh → new `id` + `held` record; already held → leave it (no new record).
   - Any previously-held `id` in **neither** list → append a `rejected` record so it stops carrying forward.
5. Post one digest per repo (format below) with only the survivors. No survivors → post nothing, note "no candidates cleared the bar" (report held count).
6. Ensure the label exists: `gh label create improvement-digest --repo <owner>/<repo> --color BFD4F2 --description "Weekly improvement candidates for human triage" 2>/dev/null || true`.

**Generator subagent prompt:**
```
You are a subagent analyzing the <owner>/<repo-name> repository for improvement candidates. READ-ONLY. Do not push, open a PR, or create issues.
Clone <repo-url> into /tmp/ as <repo-name>-improvement-scan/ (shallow is fine).
Study the codebase, README, and existing open + recently-closed issues (`gh issue list` and `--state closed`) to understand the project and where it's weak. Look for: missing functionality implied by the project's purpose, obvious gaps, fragile/untested areas, reliability and DX improvements, small high-leverage features. Ground every candidate in something you actually saw — no generic best-practice filler.
Do NOT propose anything overlapping these already-tracked/decided items:
<open issue titles + every ledger title with its status>
Return 3–8 candidates as a JSON array, best first. Each: {title, summary (one sentence), rationale (why it adds value, tied to a specific file/area), suggested_label (Bug|P1|P2|P3|P4), effort (S|M|L), evidence (path/area you saw)}.
In every text field use a plain hyphen (`-`); never use an em dash (`—`).
Delete the clone when done. Your final message must be ONLY the JSON array.
```

**Ranker subagent prompt (Opus):**
```
You are an independent reviewer scoring improvement candidates for <owner>/<repo-name>. You did NOT generate these. Be harsh: keep only candidates a busy maintainer would genuinely act on; reject filler.
Candidates (JSON):
<fresh generator output + carried-forward held items>
Some are tagged `"carried": true` — pre-vetted (a prior run kept them but cut for space). Treat them as clearing the bar; prefer them on ties against a fresh candidate of similar value; do not re-reject a carried item unless now clearly obsolete (already done or superseded).
Items with `"source": "pr"` are agent-authored follow-ups grounded in real code changes; items with `"source": "human"` are suggestions the maintainer explicitly asked for — never hard-reject a `source: human` item as filler; if it can't make the top 5, put it in `held` so it carries forward (only drop it if already done or obsolete).
Reject anything that is: generic best-practice noise not grounded in this codebase, speculative, already effectively done, cosmetic with no payoff, or so large it's an epic not a single issue. Prefer concrete, bounded, high-leverage improvements.
Return one JSON object with two arrays:
- `survivors`: at most 5, best first — this week's digest.
- `held`: at most 3 — strong candidates cut only for the 5-item cap, OR root-cause/larger-than-one-issue items worth remembering. NOT filler (filler goes in neither array). A carried item you still rate highly but that lost the top 5 belongs here.
Every returned item keeps its original fields plus a one-line `justification`, and preserves its `id` and `carried` flag if it had them. Empty array if nothing clears the bar. Output ONLY the JSON object.
```

### Phase 3 - Sentry intake (daily)

Runs every run per repo, after Phase 1, in the scan pass. Turns the most severe unresolved production errors into `bug` issues **directly** (no digest, no human triage), so the Task Queue picks them up as item 1 (Bug). Cheap (API reads + issue writes, no subagents): runs even when the PR cap is hit and on non-generation days.

**Scope:** only repos in **both** the active Target Repositories list and this Sentry list. Disabled repos get nothing until re-enabled.

| Repo | Sentry project |
| ---- | -------------- |
| `dashboard` | `dashboard` |
| `basin` | `basin` |
| `farflung` | `farflung` |
| `markpost` | `markpost` |

Org slug: `neonpixels`. API base: `https://sentry.io/api/0`. Auth: `Authorization: Bearer $SENTRY_AUTH_TOKEN` (from `.envrc`; read-only scopes `org:read`, `project:read`, `event:read`).

**Limits (named, tune here):**
- `SENTRY_NEW_PER_RUN = 5`: max issues filed or reopened per repo per run.
- `SENTRY_OPEN_CEILING = 10`: file nothing while the repo already has this many open `sentry` issues; otherwise file at most `min(SENTRY_NEW_PER_RUN, SENTRY_OPEN_CEILING - open)`.

Steps per repo:

0. **Guards.** If `SENTRY_AUTH_TOKEN` is empty or any Sentry call returns 401/403, log one Errors row (`item` = repo, note = the status) and skip this phase for the repo. Never fail silently. Count open issues: `gh issue list --repo <owner>/<repo> --label sentry --state open --json number --jq length`; at or above the ceiling, skip and note it.
1. **Ensure labels:** `gh label create sentry --repo <owner>/<repo> --color 362D59 --description "Filed from a Sentry production error" 2>/dev/null || true` (`bug` already exists).
2. **Resolve the project id:** `curl -sf -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" "https://sentry.io/api/0/projects/neonpixels/<project>/" | jq -r .id`.
3. **Fetch candidates** (unresolved, production, fatal/error, last 14 days):
   ```bash
   curl -sf -G -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" "https://sentry.io/api/0/organizations/neonpixels/issues/" \
     --data-urlencode "project=<project-id>" --data-urlencode "environment=production" \
     --data-urlencode "query=is:unresolved level:[fatal,error]" \
     --data-urlencode "statsPeriod=14d" --data-urlencode "sort=freq" --data-urlencode "limit=100"
   ```
   Re-sort locally: `level` fatal before error, then `userCount` desc, then `count` desc. Server-side errors (cron syncs) carry no user, so `userCount` is often 0 and `count` decides.
4. **Dedupe against GitHub** (GitHub is the source of truth, no ledger). Load every `sentry` issue: `gh issue list --repo <owner>/<repo> --label sentry --state all --limit 1000 --json number,url,state,stateReason,closedAt,body`. Match on the body marker `<!-- sentry-issue-id: <id> -->`. For each candidate, in severity order:
   - **No match:** file it (step 5).
   - **Open match:** skip.
   - **Closed as not planned:** skip forever (the worker or human judged it noise).
   - **Closed as completed, Sentry `lastSeen` after `closedAt`:** it regressed. Reopen with `gh issue reopen <url> --comment "Regressed in Sentry: last seen <lastSeen>, <count> events. <permalink>"`. Counts against the per-run cap.
   - **Closed as completed, not seen since:** skip (the fix has not deployed yet, or Sentry has not auto-resolved).
   Stop when the per-run allowance is spent.
5. **Build the issue.** Fetch the latest event: `curl -sf -H "Authorization: Bearer $SENTRY_AUTH_TOKEN" "https://sentry.io/api/0/organizations/neonpixels/issues/<id>/events/latest/"`. From its `exception` entry take only each value's `type`, `value`, and the last 15 in-app frames (`filename`, `function`, `lineNo`): `jq '[.entries[] | select(.type=="exception") | .data.values[] | {type, value, frames: ((.stacktrace.frames // []) | map(select(.inApp)) | .[-15:])}]'`. Also take `release.version` (the deployed commit SHA). **Copy nothing else** from the event: no `request`, `user`, `contexts`, `tags`, `breadcrumbs`, or `extra`. They carry IPs, emails, cookies, and headers, and these repos may be public. Redact any email address or token-looking string in `value` to `[redacted]`.
   ```bash
   gh issue create --repo <owner>/<repo> --label bug --label sentry \
     --title "<shortId>: <title>" --body "<body>"
   ```
   Body:
   ```
   <!-- sentry-issue-id: <id> -->
   Production error from Sentry: [<shortId>](<permalink>)

   - **Level:** <level>
   - **Culprit:** `<culprit>`
   - **Events (14d):** <count> - **Users:** <userCount>
   - **First seen:** <firstSeen> - **Last seen:** <lastSeen>
   - **Deployed release:** `<release.version>`

   ### Exception
   `<type>: <value>`

   ### Stack (most recent call last, in-app only)
   Frames may point into the built bundle (e.g. `nitro.mjs`); line numbers are bundle lines, so locate source by function name.
   - `<filename>:<lineNo>` in `<function>`

   ### Notes for the worker
   Production may lag `main`. Run `git log <release.version>..origin/main` to see what has landed since the deployed release, and verify the error still reproduces against `main` before fixing. If it is already fixed on `main`, close this as completed with a comment naming the fixing commit. If it is noise (bot traffic, third-party/network failure, rate limiting with no code cause), comment why and close as not planned; it will not be re-filed. Put `Fixes <shortId>` in the PR body alongside `Closes #<n>`.
   ```
   Leave it **unassigned** (assigned to `grimicorn` = skipped by the Task Queue). Use plain hyphens, never em dashes, in anything you write into the issue.

### Digest issue format

- **Title:** `Improvement candidates - <repo-name> - <Month Dth, YYYY>`
- **Label:** `improvement-digest`
- **Assignee:** `grimicorn` (lands it in the human's queue; the "skip grimicorn-assigned" rule keeps the daily loop from treating it as a task)
- **Body:**
  ```
  Automated weekly scan. Check the boxes for the improvements you want turned into tracked issues, then **close this issue** when you're done triaging — closing it is the go signal. On its next run the agent creates the checked items as real issues (unassigned, labelled by priority) and leaves this digest closed; unchecked items are dismissed and won't be re-proposed. While this stays open nothing happens, so take as long as you need.

  - [ ] `<id>` **<title>** - <summary> _(suggested: <label>, effort: <S|M|L>)_
  - [ ] `<id>` **<title>** - <summary> _(suggested: <label>, effort: <S|M|L>)_

  <details><summary>Rationale</summary>

  - `<id>`: <rationale>
  - `<id>`: <rationale>

  </details>
  ```

For a survivor with `source: pr | human`, append its origin to the item's meta so you recognize suggestions you or the agent raised, e.g. `_(suggested: P2, effort: M, from PR #123)_`.

The digest's per-item priority label is a suggestion only; it's applied to the promoted issue at promotion time (Phase 1), not to the digest.

Use a plain hyphen (`-`), never an em dash (`—`/`—`), everywhere in the digest — separators and any model-authored `title`/`summary`/`rationale` text. If a candidate's text arrives with an em dash, rewrite it to a hyphen before posting.

### Reporting the scan

Add an **Improvement Scan** section covering:
- **Intake (daily):** per repo, how many new suggestions were harvested, split by `source` (`pr` vs `human`), with their origin PR URLs.
- **Promotion (daily):** per repo, which closed digests were processed, how many promoted (with new issue URLs), how many dismissed.
- **Generation (Wed & Sun):** per repo, the digest URL, or skip reason (`skipped — already generated today`, `skipped — open digest still awaiting triage`, or `no candidates cleared the bar`).
- **Sentry intake (daily):** per repo, issues filed and reopened (URLs), or skip reason (`not a Sentry repo`, `open ceiling reached (<n>)`, `no unresolved production errors`, `auth failed`).
- **Held set:** per repo, how many candidates are parked (`status: held`) and carrying forward, with titles.

