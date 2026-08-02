#!/usr/bin/env bash

LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/agents.log"
ERR_FILE="$LOG_DIR/agents-error.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
LOCK_DIR="$LOG_DIR/.agents-run.lock"
OBSIDIAN_ERR_FILE="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vault/Claude/Errors.md"

ordinal_date() {
    local day month year suffix
    day=$(date +%-d)
    month=$(date +%B)
    year=$(date +%Y)
    case "$day" in
        1|21|31) suffix="st" ;;
        2|22) suffix="nd" ;;
        3|23) suffix="rd" ;;
        *) suffix="th" ;;
    esac
    printf '%s %s%s, %s' "$month" "$day" "$suffix" "$year"
}

log_error_to_obsidian() {
    local note="$1"
    local repo="${2:-all}"
    local datestr row tmp
    datestr=$(ordinal_date)
    row="| ${datestr} | agents | ${repo} | ${note} |"

    if [ ! -f "$OBSIDIAN_ERR_FILE" ]; then
        mkdir -p "$(dirname "$OBSIDIAN_ERR_FILE")"
        printf -- '\n| date | source | item | note |\n| ---- | ------ | ---- | ---- |\n' > "$OBSIDIAN_ERR_FILE"
    fi

    # The file may end with an Obsidian block-reference anchor (`^errorTable`)
    # directly after the table. Appending at EOF would drop the row below the
    # anchor and orphan it into a second table, so insert immediately BEFORE the
    # anchor line when it exists. The row is passed via the environment (ROW) so
    # awk doesn't reinterpret backslash escapes like `\|` inside the note.
    if grep -qxF '^errorTable' "$OBSIDIAN_ERR_FILE"; then
        local tmp
        tmp=$(mktemp)
        ROW="$row" awk '$0 == "^errorTable" { print ENVIRON["ROW"] } { print }' \
            "$OBSIDIAN_ERR_FILE" > "$tmp" && mv "$tmp" "$OBSIDIAN_ERR_FILE"
        return
    fi

    # No anchor: append at the end of the table. Ensure a trailing newline first
    # so the new row never joins the last existing line.
    [ -n "$(tail -c1 "$OBSIDIAN_ERR_FILE")" ] && printf '\n' >> "$OBSIDIAN_ERR_FILE"
    printf '%s\n' "$row" >> "$OBSIDIAN_ERR_FILE"
}

take_lock() {
    mkdir "$LOCK_DIR" 2>/dev/null || return 1
    echo $$ > "$LOCK_DIR/pid"
    trap 'rm -rf "$LOCK_DIR"' EXIT
}

acquire_lock_or_exit() {
    take_lock && return

    local lock_pid
    lock_pid=$(cat "$LOCK_DIR/pid" 2>/dev/null)
    if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null && ps -p "$lock_pid" -o command= 2>/dev/null | grep -q "run.sh"; then
        echo "=== Run skipped: previous run (PID $lock_pid) still active ($TIMESTAMP) ===" >> "$LOG_FILE"
        log_error_to_obsidian "Run skipped: previous run (PID $lock_pid) still active" "all"
        exit 0
    fi

    echo "=== Removing stale lock from PID ${lock_pid:-unknown} ($TIMESTAMP) ===" >> "$LOG_FILE"
    rm -rf "$LOCK_DIR"
    take_lock && return

    echo "=== Run skipped: could not acquire lock ($TIMESTAMP) ===" >> "$LOG_FILE"
    log_error_to_obsidian "Run skipped: could not acquire lock" "all"
    exit 0
}

acquire_lock_or_exit

python3 "$SCRIPT_DIR/trim_logs.py" "$LOG_FILE" "$ERR_FILE"

echo "" >> "$LOG_FILE"
echo "=== Run started: $TIMESTAMP ===" >> "$LOG_FILE"
echo "" >> "$ERR_FILE"
echo "=== Run started: $TIMESTAMP ===" >> "$ERR_FILE"

# Headless `claude -p` runs subagents in the background and terminates them
# once the background-wait ceiling is hit (default 600000ms = 10 min). A clone +
# tests + e2e + 3-round review + push + PR takes far longer than 10 min, so the
# worker was being killed before it could open the PR. Raise the ceiling to 90
# min: well above the slowest task, but ~30 min under the 2-hour run cadence so a
# wedged run self-terminates before the next scheduled run and never holds the
# lock across slots. Both names are set to cover Claude Code's env-var naming
# drift; an unrecognized var is harmless.
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=5400000
export CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS=5400000

# Capture this run's stderr to a temp file so we can inspect it for run-level
# errors, while still appending it to the rolling error log as before.
RUN_ERR_FILE=$(mktemp)

direnv exec "$SCRIPT_DIR" claude \
    -p "Process Github issues and delegate to subagents" \
    --dangerously-skip-permissions \
    --output-format stream-json \
    --verbose \
    >> "$LOG_FILE" 2> "$RUN_ERR_FILE"

EXIT_CODE=$?
cat "$RUN_ERR_FILE" >> "$ERR_FILE"
echo "=== Run ended: $(date '+%Y-%m-%d %H:%M:%S') (exit: $EXIT_CODE) ===" >> "$LOG_FILE"

# Surface run-level failures to the consolidated Obsidian error log (repo "all"
# since these are environment-wide, not tied to one repo). The background-task
# termination still exits 0, so it must be detected by message, not exit code.
if grep -q "Background tasks still running" "$RUN_ERR_FILE"; then
    log_error_to_obsidian "Run terminated early: a background subagent was killed at the wait ceiling before finishing, so its PR was likely never opened. Raise CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS if this recurs." "all"
fi

# An expired/unrefreshable OAuth session makes `claude -p` exit 1 within ~1s
# before any work runs. The message lands in stdout JSON (LOG_FILE), not stderr,
# so it never reached this error path and hid as a generic exit-1 for days.
# Detect it explicitly and log an actionable row pointing at the fix.
if tail -50 "$LOG_FILE" | grep -qa "OAuth session expired\|authentication_failed"; then
    log_error_to_obsidian "Auth expired: claude could not authenticate (OAuth session expired). Re-run \`claude setup-token\` and update CLAUDE_CODE_OAUTH_TOKEN in .envrc. No repos were processed." "all"
elif tail -50 "$LOG_FILE" | grep -qa "You've hit your session limit"; then
    # A 5-hour session-limit rejection makes `claude -p` exit 1, but it's an
    # expected throttle, not a crash. Log it as an informational skip so it stops
    # masquerading as a generic abnormal exit. The next scheduled run in a fresh
    # window retries automatically. Frequent rows here mean the run cadence
    # outpaces the plan's 5-hour budget — space the runs out.
    log_error_to_obsidian "Rate limited: hit the 5-hour session limit; run stopped without finishing. Not a failure — the next run in a fresh window retries. Recurring rows mean the cadence exceeds the plan's 5-hour budget." "all"
elif [ "$EXIT_CODE" -ne 0 ]; then
    log_error_to_obsidian "Run exited abnormally (exit code $EXIT_CODE); see agents-error.log for details." "all"
fi

rm -f "$RUN_ERR_FILE"
