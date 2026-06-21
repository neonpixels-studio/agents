#!/usr/bin/env bash

LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/agents.log"
ERR_FILE="$LOG_DIR/agents-error.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"

python3 "$SCRIPT_DIR/trim_logs.py" "$LOG_FILE" "$ERR_FILE"

echo "" >> "$LOG_FILE"
echo "=== Run started: $TIMESTAMP ===" >> "$LOG_FILE"
echo "" >> "$ERR_FILE"
echo "=== Run started: $TIMESTAMP ===" >> "$ERR_FILE"

direnv exec "$SCRIPT_DIR" claude \
    -p "Process Github issues and delegate to subagents" \
    --dangerously-skip-permissions \
    --output-format stream-json \
    --verbose \
    >> "$LOG_FILE" 2>> "$ERR_FILE"

EXIT_CODE=$?
echo "=== Run ended: $(date '+%Y-%m-%d %H:%M:%S') (exit: $EXIT_CODE) ===" >> "$LOG_FILE"
