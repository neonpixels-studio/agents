import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readRepoFile, repoPath } from './support/repo-files.js';

const PLACEHOLDERS = ['__WORKSPACE__', '__HOME__', '__PATH__'];

// plistlib is in the Python standard library, so this parses the template the
// same way on macOS and on Linux CI runners.
function parsePlist(relativePath) {
  const output = execFileSync(
    'python3',
    [
      '-c',
      'import json, plistlib, sys; print(json.dumps(plistlib.load(open(sys.argv[1], "rb"))))',
      repoPath(relativePath),
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(output);
}

const templates = readdirSync(repoPath('launchd')).map(
  (file) => `launchd/${file}`,
);

describe.each(templates)('%s', (template) => {
  const plist = parsePlist(template);
  const raw = readRepoFile(template);

  it('runs run.sh from the workspace placeholder', () => {
    expect(plist.ProgramArguments.at(-1)).toBe('__WORKSPACE__/run.sh');
    expect(plist.WorkingDirectory).toBe('__WORKSPACE__');
  });

  it('is scheduled at least once a day', () => {
    expect(plist.StartCalendarInterval.length).toBeGreaterThan(0);
  });

  it('contains no machine-specific paths', () => {
    expect(raw).not.toMatch(/\/Users\/|\/Volumes\/|\/home\//);
  });

  it('uses only the placeholders the README install command fills in', () => {
    const readme = readRepoFile('README.md');
    const used = [...new Set(raw.match(/__[A-Z]+__/g))];

    expect(used.sort()).toEqual([...PLACEHOLDERS].sort());
    PLACEHOLDERS.forEach((placeholder) =>
      expect(readme).toContain(`s#${placeholder}#`),
    );
  });
});
