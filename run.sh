#!/usr/bin/env bash

LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/agents.log"
ERR_FILE="$LOG_DIR/agents-error.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
LOCK_DIR="$LOG_DIR/.agents-run.lock"
CONFIG_FILE="$SCRIPT_DIR/agents.config.json"
ERROR_LOG_FILE=""

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

log_error_row() {
    local note="$1"
    local repo="${2:-all}"
    local datestr row tmp
    [ -z "$ERROR_LOG_FILE" ] && return 0
    datestr=$(ordinal_date)
    row="| ${datestr} | agents | ${repo} | ${note} |"

    if [ ! -f "$ERROR_LOG_FILE" ]; then
        mkdir -p "$(dirname "$ERROR_LOG_FILE")"
        printf -- '\n| date | source | item | note |\n| ---- | ------ | ---- | ---- |\n' > "$ERROR_LOG_FILE"
    fi

    # The file may end with an Obsidian block-reference anchor (`^errorTable`)
    # directly after the table. Appending at EOF would drop the row below the
    # anchor and orphan it into a second table, so insert immediately BEFORE the
    # anchor line when it exists. The row is passed via the environment (ROW) so
    # awk doesn't reinterpret backslash escapes like `\|` inside the note.
    if grep -qxF '^errorTable' "$ERROR_LOG_FILE"; then
        tmp=$(mktemp)
        ROW="$row" awk '$0 == "^errorTable" { print ENVIRON["ROW"] } { print }' \
            "$ERROR_LOG_FILE" > "$tmp" && mv "$tmp" "$ERROR_LOG_FILE"
        return
    fi

    # No anchor: append at the end of the table. Ensure a trailing newline first
    # so the new row never joins the last existing line.
    [ -n "$(tail -c1 "$ERROR_LOG_FILE")" ] && printf '\n' >> "$ERROR_LOG_FILE"
    printf '%s\n' "$row" >> "$ERROR_LOG_FILE"
}

abort_run() {
    echo "=== Run aborted: $1 ($TIMESTAMP) ===" >> "$LOG_FILE"
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 && return 0
    abort_run "$1 is not on PATH ($PATH); install it or add its directory to the launchd plist's PATH"
}

# `errorLog: null` disables the markdown error table; a leading ~ means $HOME.
# Best effort: this also runs before validation so an invalid config can still
# report itself in the table the human actually watches.
load_error_log_path() {
    ERROR_LOG_FILE=$(jq -r '.errorLog | strings' "$CONFIG_FILE" 2>/dev/null)
    ERROR_LOG_FILE="${ERROR_LOG_FILE/#\~/$HOME}"
}

# Every per-installation value lives in agents.config.json, checked by the same
# validator CI runs. A typo such as `sentry.enable` aborts the run instead of
# silently disabling a phase.
validate_config_or_abort() {
    local config_errors
    config_errors=$(node "$SCRIPT_DIR/scripts/validate-config.mjs" "$CONFIG_FILE" 2>&1) && return 0
    echo "$config_errors" >> "$LOG_FILE"
    log_error_row "Run aborted: agents.config.json is invalid: $(head -1 <<< "$config_errors") (see agents.log for all errors)" "all"
    abort_run "$CONFIG_FILE is invalid"
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
        log_error_row "Run skipped: previous run (PID $lock_pid) still active" "all"
        exit 0
    fi

    echo "=== Removing stale lock from PID ${lock_pid:-unknown} ($TIMESTAMP) ===" >> "$LOG_FILE"
    rm -rf "$LOCK_DIR"
    take_lock && return

    echo "=== Run skipped: could not acquire lock ($TIMESTAMP) ===" >> "$LOG_FILE"
    log_error_row "Run skipped: could not acquire lock" "all"
    exit 0
}

require_command jq
require_command node
load_error_log_path
validate_config_or_abort
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

# The orchestrator resolves agents.config.json, .ledger/, and envs/ relative to
# its working directory, so run it from the workspace regardless of the caller.
cd "$SCRIPT_DIR" || exit 1

direnv exec "$SCRIPT_DIR" claude \
    -p "Process Github issues and delegate to subagents" \
    --dangerously-skip-permissions \
    --output-format stream-json \
    --verbose \
    >> "$LOG_FILE" 2> "$RUN_ERR_FILE"

EXIT_CODE=$?
cat "$RUN_ERR_FILE" >> "$ERR_FILE"
echo "=== Run ended: $(date '+%Y-%m-%d %H:%M:%S') (exit: $EXIT_CODE) ===" >> "$LOG_FILE"

# Surface run-level failures to the consolidated error table (repo "all"
# since these are environment-wide, not tied to one repo). The background-task
# termination still exits 0, so it must be detected by message, not exit code.
if grep -q "Background tasks still running" "$RUN_ERR_FILE"; then
    log_error_row "Run terminated early: a background subagent was killed at the wait ceiling before finishing, so its PR was likely never opened. Raise CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS if this recurs." "all"
fi

# An expired/unrefreshable OAuth session makes `claude -p` exit 1 within ~1s
# before any work runs. The message lands in stdout JSON (LOG_FILE), not stderr,
# so it never reached this error path and hid as a generic exit-1 for days.
# Detect it explicitly and log an actionable row pointing at the fix.
# Both message checks are gated on a non-zero exit: a successful run can echo
# these strings into the log (e.g. by printing this script), which is not a failure.
if [ "$EXIT_CODE" -ne 0 ] && tail -50 "$LOG_FILE" | grep -qa "OAuth session expired\|authentication_failed"; then
    log_error_row "Auth expired: claude could not authenticate (OAuth session expired or token revoked). Re-run \`claude setup-token\`, update CLAUDE_CODE_OAUTH_TOKEN in .envrc, then run \`direnv allow\` in the agents dir (editing .envrc revokes direnv approval, so run.sh can't load it). No repos were processed." "all"
elif [ "$EXIT_CODE" -ne 0 ] && tail -50 "$LOG_FILE" | grep -qa "You've hit your session limit"; then
    # A 5-hour session-limit rejection makes `claude -p` exit 1, but it's an
    # expected throttle, not a crash. Log it as an informational skip so it stops
    # masquerading as a generic abnormal exit. The next scheduled run in a fresh
    # window retries automatically. Frequent rows here mean the run cadence
    # outpaces the plan's 5-hour budget — space the runs out.
    log_error_row "Rate limited: hit the 5-hour session limit; run stopped without finishing. Not a failure — the next run in a fresh window retries. Recurring rows mean the cadence exceeds the plan's 5-hour budget." "all"
elif [ "$EXIT_CODE" -ne 0 ]; then
    log_error_row "Run exited abnormally (exit code $EXIT_CODE); see agents-error.log for details." "all"
fi

rm -f "$RUN_ERR_FILE"
