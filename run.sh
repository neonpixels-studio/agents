#!/usr/bin/env bash

LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/agents.log"
ERR_FILE="$LOG_DIR/agents-error.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
LOCK_DIR="$LOG_DIR/.agents-run.lock"
OBSIDIAN_ERR_FILE="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vault/Claude/Agents/Agents Errors.md"

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

log_skip_to_obsidian() {
    local note="$1"
    local datestr row tmp
    datestr=$(ordinal_date)
    row="| ${note} | ${datestr} |"

    if [ ! -f "$OBSIDIAN_ERR_FILE" ]; then
        mkdir -p "$(dirname "$OBSIDIAN_ERR_FILE")"
        printf -- '---\ncollection: Code Agents\n---\n\n## Errors\n\n| note | date |\n| ---- | ---- |\n^errorTable\n' > "$OBSIDIAN_ERR_FILE"
    fi

    tmp=$(mktemp)
    awk -v row="$row" 'index($0,"^errorTable")==1 { print row } { print }' "$OBSIDIAN_ERR_FILE" > "$tmp" && mv "$tmp" "$OBSIDIAN_ERR_FILE"
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
        log_skip_to_obsidian "Run skipped: previous run (PID $lock_pid) still active"
        exit 0
    fi

    echo "=== Removing stale lock from PID ${lock_pid:-unknown} ($TIMESTAMP) ===" >> "$LOG_FILE"
    rm -rf "$LOCK_DIR"
    take_lock && return

    echo "=== Run skipped: could not acquire lock ($TIMESTAMP) ===" >> "$LOG_FILE"
    log_skip_to_obsidian "Run skipped: could not acquire lock"
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

direnv exec "$SCRIPT_DIR" claude \
    -p "Process Github issues and delegate to subagents" \
    --dangerously-skip-permissions \
    --output-format stream-json \
    --verbose \
    >> "$LOG_FILE" 2>> "$ERR_FILE"

EXIT_CODE=$?
echo "=== Run ended: $(date '+%Y-%m-%d %H:%M:%S') (exit: $EXIT_CODE) ===" >> "$LOG_FILE"
