#!/usr/bin/env bash
# Prints the latest usage-meter reading from a headless run log as JSON, with
# both meters as 0-1 fractions: {"weekly":0.86,"session":0.32}
#
# Usage: scripts/read-usage-meters.sh <run-log>
#
# Headless runs emit stream-json, and every `rate_limit_event` line carries the
# five-hour (session) and seven-day (weekly) windows, each with a `resetsAt`
# epoch. A meter is null when it can't be trusted:
# - no readable event: no log, no event yet, or every event line is malformed;
# - session: its window has reset since the reading, or the reading has no
#   `resetsAt`. A live window means the reading is under five hours old, and
#   interactive sessions only add to it, so it is a floor, never an overcount;
# - weekly: its window has reset since the reading.

RUN_LOG="${1:-}"
NO_READING='{"weekly":null,"session":null}'

if [ -z "$RUN_LOG" ] || [ ! -f "$RUN_LOG" ]; then
    echo "$NO_READING"
    exit 0
fi

grep -F '"rate_limit_event"' "$RUN_LOG" | jq -cnR --argjson now "$(date +%s)" '
    def utilization: (.utilization | numbers) // null;
    def window_reset: ((.resetsAt | numbers) <= $now) // false;
    def live_window: ((.resetsAt | numbers) > $now) // false;

    [inputs | fromjson? | objects | select(.type == "rate_limit_event")]
    | (last | .rate_limit_info.unifiedWindows? // {}) as $windows
    | {
        weekly: ($windows.seven_day // {} | if window_reset then null else utilization end),
        session: ($windows.five_hour // {} | if live_window then utilization else null end)
      }
' 2>/dev/null || echo "$NO_READING"
