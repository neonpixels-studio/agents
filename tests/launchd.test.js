import { readdirSync } from 'node:fs';
import { parse as parsePlistXml } from 'plist';
import { describe, expect, it } from 'vitest';
import { readRepoFile, repoPath } from './support/repo-files.js';

const PLACEHOLDERS = ['__WORKSPACE__', '__HOME__', '__PATH__'];

function parsePlist(relativePath) {
  return parsePlistXml(readRepoFile(relativePath));
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
