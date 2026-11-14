#!/usr/bin/env node
// Keeps the rolling run logs to the last seven days of runs. run.sh calls this
// at the start of every run with agents.log and agents-error.log.
//
// Usage: node scripts/trim-logs.mjs <log-file>...
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const RETENTION_DAYS = 7;
const RUN_MARKER =
  /=== Run started: (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ===/;

// run.sh writes markers in local time (`date '+%Y-%m-%d %H:%M:%S'`).
function markerTime(line) {
  const match = line.match(RUN_MARKER);
  if (!match) {
    return null;
  }

  const [year, month, day, hours, minutes, seconds] = match
    .slice(1)
    .map(Number);
  return new Date(year, month - 1, day, hours, minutes, seconds);
}

// Calendar days, not 7 x 24 hours, so a DST change doesn't shift the cutoff.
function retentionCutoff(now) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  return cutoff;
}

// Returns the trimmed text, or null when the file should be left untouched:
// it has no run markers, or its first line already starts a run worth keeping.
export function trimLogText(text, now = new Date()) {
  const cutoff = retentionCutoff(now);
  const lines = text.split(/(?<=\n)/);
  const markerTimes = lines.map(markerTime);
  const firstKeptRun = markerTimes.findIndex(
    (time) => time !== null && time >= cutoff,
  );

  if (firstKeptRun === -1) {
    return markerTimes.some((time) => time !== null) ? '' : null;
  }

  if (firstKeptRun === 0) {
    return null;
  }

  return lines.slice(firstKeptRun).join('');
}

export function trimLogFile(logPath, now = new Date()) {
  if (!existsSync(logPath)) {
    return;
  }

  const trimmed = trimLogText(readFileSync(logPath, 'utf8'), now);
  if (trimmed === null) {
    return;
  }

  writeFileSync(logPath, trimmed);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const now = new Date();
  process.argv.slice(2).forEach((logPath) => trimLogFile(logPath, now));
}
