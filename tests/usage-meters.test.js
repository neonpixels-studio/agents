import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readRepoFile, repoPath } from './support/repo-files.js';
import { rateLimitEvent, runLogWith } from './support/usage-events.js';

const READER = 'scripts/read-usage-meters.sh';
const NO_READING = { weekly: null, session: null };

let directory;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'agents-usage-meters-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function readMeters(logContents) {
  const runLog = join(directory, 'agents.log');
  if (logContents !== undefined) {
    writeFileSync(runLog, logContents);
  }

  const result = spawnSync(repoPath(READER), [runLog], { encoding: 'utf8' });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

describe('scripts/read-usage-meters.sh', () => {
  it('reads both meters from the latest event', () => {
    const log = runLogWith(
      rateLimitEvent({ weekly: 0.5, session: 0.1 }),
      rateLimitEvent({ weekly: 0.86, session: 0.32 }),
    );

    expect(readMeters(log)).toEqual({ weekly: 0.86, session: 0.32 });
  });

  it('drops the session reading once its five-hour window has reset', () => {
    const log = runLogWith(
      rateLimitEvent({ weekly: 0.6, session: 0.8, sessionResetsInHours: -1 }),
    );

    expect(readMeters(log)).toEqual({ weekly: 0.6, session: null });
  });

  it('drops the weekly reading once its seven-day window has reset', () => {
    const log = runLogWith(
      rateLimitEvent({ weekly: 0.95, weeklyResetsInHours: -1 }),
    );

    expect(readMeters(log).weekly).toBeNull();
  });

  it('skips malformed lines and lines that only mention the event', () => {
    const log = runLogWith(
      rateLimitEvent({ weekly: 0.7, session: 0.4 }),
      '{"type":"rate_limit_event","rate_limit_info":',
      JSON.stringify({ type: 'user', content: '"rate_limit_event"' }),
    );

    expect(readMeters(log)).toEqual({ weekly: 0.7, session: 0.4 });
  });

  it.each([
    ['the log does not exist', undefined],
    ['the log has no event', runLogWith()],
    ['every event line is malformed', '{"type":"rate_limit_event", broken\n'],
  ])('reports no reading when %s', (_case, log) => {
    expect(readMeters(log)).toEqual(NO_READING);
  });

  it('reports no reading when no log path is given', () => {
    const result = spawnSync(repoPath(READER), [], { encoding: 'utf8' });

    expect(JSON.parse(result.stdout)).toEqual(NO_READING);
  });

  it('is the command the spec runs, on the log run.sh exports', () => {
    expect(readRepoFile('CLAUDE.md')).toContain(`${READER} "$AGENTS_RUN_LOG"`);
    expect(readRepoFile('run.sh')).toContain(
      'export AGENTS_RUN_LOG="$LOG_FILE"',
    );
  });
});
