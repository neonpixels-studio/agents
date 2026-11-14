import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { readRepoFile, repoPath } from './support/repo-files.js';

function checkPaths(paths) {
  const result = spawnSync(
    'bash',
    [repoPath('scripts/check-protected-paths.sh')],
    { input: paths.map((path) => `${path}\n`).join(''), encoding: 'utf8' },
  );
  return {
    status: result.status,
    flagged: result.stdout.split('\n').filter(Boolean),
  };
}

describe('scripts/check-protected-paths.sh', () => {
  it.each([
    '.github/workflows/ci.yml',
    '.github/dependabot.yml',
    '.husky/pre-commit',
    '.env',
    '.env.e2e',
    'apps/web/.env.local',
    '.envrc',
    '.npmrc',
    'netlify.toml',
    'package.json',
    'packages/cli/package.json',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'pnpm-lock.yaml',
    'yarn.lock',
  ])('blocks %s', (path) => {
    expect(checkPaths(['src/app.ts', path])).toEqual({
      status: 1,
      flagged: [path],
    });
  });

  it.each([
    'src/github/client.ts',
    'docs/env.md',
    'src/environment.ts',
    'tests/package.test.ts',
    'netlify/functions/feed.ts',
    'README.md',
  ])('allows %s', (path) => {
    expect(checkPaths([path])).toEqual({ status: 0, flagged: [] });
  });

  it('lists every protected path in a mixed change set', () => {
    const result = checkPaths([
      'src/app.ts',
      'package.json',
      '.github/workflows/deploy.yml',
    ]);

    expect(result.status).toBe(1);
    expect(result.flagged).toEqual([
      'package.json',
      '.github/workflows/deploy.yml',
    ]);
  });

  it('passes an empty change set', () => {
    expect(checkPaths([])).toEqual({ status: 0, flagged: [] });
  });

  it('is the gate the spec runs before pushing untrusted-origin work', () => {
    expect(readRepoFile('CLAUDE.md')).toContain(
      'git -C <clone-dir> diff --name-only origin/main...HEAD | scripts/check-protected-paths.sh',
    );
  });
});
