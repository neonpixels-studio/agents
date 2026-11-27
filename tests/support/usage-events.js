const HOUR_IN_SECONDS = 60 * 60;

const secondsFromNow = (hours) =>
  Math.floor(Date.now() / 1000) + hours * HOUR_IN_SECONDS;

// One stream-json `rate_limit_event` line in the shape headless `claude -p`
// writes to the run log. Each window resets `resetsInHours` from now; a
// negative value means the window has already reset since the reading.
export function rateLimitEvent({
  weekly = 0.5,
  session = 0.2,
  weeklyResetsInHours = 48,
  sessionResetsInHours = 2,
} = {}) {
  return JSON.stringify({
    type: 'rate_limit_event',
    rate_limit_info: {
      status: 'allowed',
      unifiedWindows: {
        five_hour: {
          utilization: session,
          resetsAt: secondsFromNow(sessionResetsInHours),
          status: 'allowed',
        },
        seven_day: {
          utilization: weekly,
          resetsAt: secondsFromNow(weeklyResetsInHours),
          status: 'allowed',
        },
      },
    },
    session_id: 'previous-run',
  });
}

// A run log from an earlier run, with the event lines among the run's other
// output, the way run.sh appends them.
export function runLogWith(...eventLines) {
  return [
    '',
    '=== Run started: 2026-11-27 06:05:05 ===',
    '{"type":"system","subtype":"init"}',
    ...eventLines,
    '{"type":"result","subtype":"success"}',
    '=== Run ended: 2026-11-27 06:18:22 (exit: 0) ===',
    '',
  ].join('\n');
}
