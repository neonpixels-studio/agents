import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { repoPath } from './support/repo-files.js';
import { trimLogText } from '../scripts/trim-logs.mjs';

const NOW = new Date(2026, 10, 13, 12, 0, 0);

function pad(number) {
  return String(number).padStart(2, '0');
}

// run.sh writes markers in local time, so build them the same way.
function markerAt(date) {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `=== Run started: ${stamp} ===`;
}

function daysBefore(date, days) {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() - days);
  return shifted;
}

const markerDaysAgo = (days) => markerAt(daysBefore(NOW, days));

describe('trimLogText', () => {
  it('drops runs older than seven days and keeps the rest', () => {
    const recent = `${markerDaysAgo(1)}\nrecent output\n`;

    expect(
      trimLogText(`${markerDaysAgo(10)}\nold output\n${recent}`, NOW),
    ).toBe(recent);
  });

  it('keeps a run that started exactly seven days ago', () => {
    const boundary = `${markerDaysAgo(7)}\nboundary run\n`;

    expect(trimLogText(`${markerDaysAgo(8)}\nold\n${boundary}`, NOW)).toBe(
      boundary,
    );
  });

  it('empties a log whose runs are all older than seven days', () => {
    expect(trimLogText(`${markerDaysAgo(9)}\nold output\n`, NOW)).toBe('');
  });

  it('leaves a log alone when its first line already starts a kept run', () => {
    expect(trimLogText(`${markerDaysAgo(2)}\noutput\n`, NOW)).toBeNull();
  });

  it('leaves a log without run markers alone', () => {
    expect(trimLogText('no markers here\n', NOW)).toBeNull();
    expect(trimLogText('', NOW)).toBeNull();
  });

  it('cuts from the first recent run even when older runs follow it', () => {
    const tail = `${markerDaysAgo(3)}\nkept\n${markerDaysAgo(20)}\nalso kept\n`;

    expect(trimLogText(`${markerDaysAgo(30)}\nold\n${tail}`, NOW)).toBe(tail);
  });

  it('finds markers mid-line and preserves a missing final newline', () => {
    const tail = `prefix ${markerDaysAgo(1)} suffix\nlast line`;

    expect(trimLogText(`${markerDaysAgo(12)}\nold\n${tail}`, NOW)).toBe(tail);
  });
});

describe('scripts/trim-logs.mjs CLI', () => {
  let directory;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'agents-trim-logs-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function runCli(...paths) {
    execFileSync(process.execPath, [
      repoPath('scripts/trim-logs.mjs'),
      ...paths,
    ]);
  }

  it('trims every file it is given and skips missing ones', () => {
    const now = new Date();
    const oldRun = `${markerAt(daysBefore(now, 10))}\nold\n`;
    const recentRun = `${markerAt(daysBefore(now, 1))}\nrecent\n`;
    const runLog = join(directory, 'agents.log');
    const errorLog = join(directory, 'agents-error.log');
    writeFileSync(runLog, oldRun + recentRun);
    writeFileSync(errorLog, oldRun);

    runCli(runLog, errorLog, join(directory, 'missing.log'));

    expect(readFileSync(runLog, 'utf8')).toBe(recentRun);
    expect(readFileSync(errorLog, 'utf8')).toBe('');
  });

  it('does not rewrite a file that needs no trimming', () => {
    const logPath = join(directory, 'agents.log');
    writeFileSync(logPath, 'no markers here\n');
    const before = statSync(logPath).mtimeMs;

    runCli(logPath);

    expect(statSync(logPath).mtimeMs).toBe(before);
  });
});
