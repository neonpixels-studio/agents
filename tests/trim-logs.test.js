import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { repoPath } from './support/repo-files.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let directory;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'agents-trim-logs-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function pad(number) {
  return String(number).padStart(2, '0');
}

// trim_logs.py parses these markers as local time, so build them the same way.
function runMarker(daysAgo) {
  const date = new Date(Date.now() - daysAgo * DAY_MS);
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `=== Run started: ${stamp} ===`;
}

function trim(contents) {
  const logPath = join(directory, 'agents.log');
  writeFileSync(logPath, contents);
  execFileSync('python3', [repoPath('trim_logs.py'), logPath]);
  return readFileSync(logPath, 'utf8');
}

describe('trim_logs.py', () => {
  it('drops runs older than seven days and keeps the rest', () => {
    const recent = `${runMarker(1)}\nrecent output\n`;

    expect(trim(`${runMarker(10)}\nold output\n${recent}`)).toBe(recent);
  });

  it('empties a log whose runs are all older than seven days', () => {
    expect(trim(`${runMarker(9)}\nold output\n`)).toBe('');
  });

  it('leaves a log without run markers untouched', () => {
    const contents = 'no markers here\n';

    expect(trim(contents)).toBe(contents);
  });
});
