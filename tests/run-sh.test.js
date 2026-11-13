import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSandbox,
  lockDir,
  readSandboxFile,
  removeSandbox,
  runRunSh,
} from './support/run-sh-sandbox.js';

const ERROR_LOG = '~/vault/Errors.md';
const DEAD_PID = '999999';

let sandbox;

afterEach(() => {
  removeSandbox(sandbox);
});

function setUp(config = { errorLog: ERROR_LOG }) {
  sandbox = createSandbox({ config });
  return sandbox;
}

const errorTable = () => readSandboxFile(sandbox, 'vault', 'Errors.md');
const runLog = () => readSandboxFile(sandbox, 'Library', 'Logs', 'agents.log');
const claudeRan = () => existsSync(join(sandbox.home, 'claude-cwd'));

describe('run.sh config guard', () => {
  it.each([
    ['missing', undefined],
    ['not valid JSON', '{ not json'],
  ])(
    'aborts without starting claude when the config is %s',
    (_case, config) => {
      sandbox = createSandbox({ config });

      const result = runRunSh(sandbox);

      expect(result.status).toBe(1);
      expect(runLog()).toContain('Run aborted');
      expect(claudeRan()).toBe(false);
    },
  );

  it('starts claude from the workspace even when called from elsewhere', () => {
    setUp();

    runRunSh(sandbox);

    expect(readSandboxFile(sandbox, 'claude-cwd').trim()).toMatch(
      /\/workspace$/,
    );
  });
});

describe('run.sh error table', () => {
  it('writes nothing after a clean run', () => {
    setUp();

    runRunSh(sandbox);

    expect(errorTable()).toBeNull();
  });

  it('creates the table under $HOME when errorLog starts with ~', () => {
    setUp();

    runRunSh(sandbox, { exitCode: 3 });

    expect(errorTable()).toContain('| date | source | item | note |');
    expect(errorTable()).toContain(
      '| agents | all | Run exited abnormally (exit code 3)',
    );
  });

  it('inserts the row above the ^errorTable anchor, not after it', () => {
    setUp();
    mkdirSync(join(sandbox.home, 'vault'));
    writeFileSync(
      join(sandbox.home, 'vault', 'Errors.md'),
      '| date | source | item | note |\n| - | - | - | - |\n^errorTable\n',
    );

    runRunSh(sandbox, { exitCode: 3 });

    const lines = errorTable().trim().split('\n');
    expect(lines.at(-1)).toBe('^errorTable');
    expect(lines.at(-2)).toContain('Run exited abnormally');
  });

  it('writes no table at all when errorLog is null', () => {
    setUp({ errorLog: null });

    const result = runRunSh(sandbox, { exitCode: 3 });

    expect(result.stderr).toBe('');
    expect(errorTable()).toBeNull();
    expect(existsSync(join(sandbox.home, 'vault'))).toBe(false);
  });
});

describe('run.sh failure detection', () => {
  it('reports expired auth that claude only prints to stdout', () => {
    setUp();

    runRunSh(sandbox, {
      stdout: '{"error":"OAuth session expired"}',
      exitCode: 1,
    });

    expect(errorTable()).toContain('Auth expired');
    expect(errorTable()).not.toContain('Run exited abnormally');
  });

  it('reports a session-limit rejection as a rate limit, not a crash', () => {
    setUp();

    runRunSh(sandbox, {
      stdout: "You've hit your session limit",
      exitCode: 1,
    });

    expect(errorTable()).toContain('Rate limited');
    expect(errorTable()).not.toContain('Run exited abnormally');
  });

  it('reports a subagent killed at the wait ceiling even though claude exits 0', () => {
    setUp();

    runRunSh(sandbox, {
      stderr: 'Background tasks still running',
      exitCode: 0,
    });

    expect(errorTable()).toContain('Run terminated early');
  });

  it('ignores the auth message when the run succeeded', () => {
    setUp();

    runRunSh(sandbox, {
      stdout: 'printing OAuth session expired',
      exitCode: 0,
    });

    expect(errorTable()).toBeNull();
  });
});

describe('run.sh lock', () => {
  it('removes a stale lock left by a dead process and runs', () => {
    setUp();
    mkdirSync(lockDir(sandbox));
    writeFileSync(join(lockDir(sandbox), 'pid'), DEAD_PID);

    runRunSh(sandbox);

    expect(runLog()).toContain('Removing stale lock');
    expect(claudeRan()).toBe(true);
    expect(existsSync(lockDir(sandbox))).toBe(false);
  });

  it('skips the run while a previous run.sh is still alive', () => {
    setUp();
    // `; true` stops bash from exec-ing sleep, so the process command line
    // keeps the `run.sh` argument that run.sh greps for.
    const previousRun = spawn('bash', ['-c', 'sleep 30; true', 'run.sh']);
    mkdirSync(lockDir(sandbox));
    writeFileSync(join(lockDir(sandbox), 'pid'), String(previousRun.pid));

    try {
      const result = runRunSh(sandbox);

      expect(result.status).toBe(0);
      expect(claudeRan()).toBe(false);
      expect(errorTable()).toContain('Run skipped: previous run');
    } finally {
      previousRun.kill();
    }
  });
});
