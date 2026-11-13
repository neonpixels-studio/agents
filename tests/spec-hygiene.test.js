import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  readConfig,
  readRepoFile,
  repoFileExists,
} from './support/repo-files.js';
import {
  extractFileReferences,
  extractHeadings,
  extractRelativeLinks,
  findBrokenSectionReferences,
  findLiteralValues,
} from './support/spec-hygiene.js';

const SPEC_FILES = [
  'CLAUDE.md',
  ...readdirSync(new URL('../docs', import.meta.url)).map(
    (file) => `docs/${file}`,
  ),
];
const RUNTIME_FILES = [...SPEC_FILES, 'run.sh'];
const MACHINE_PATH_FRAGMENTS = ['/Users/', '/Volumes/', 'iCloud~md~obsidian'];

function installationValues() {
  const config = readConfig();
  return [
    config.identities.human,
    config.identities.agent,
    config.sentry.org,
  ].filter(Boolean);
}

describe('installation-specific values stay in agents.config.json', () => {
  it.each(RUNTIME_FILES)('%s hardcodes no identity or Sentry org', (file) => {
    expect(findLiteralValues(readRepoFile(file), installationValues())).toEqual(
      [],
    );
  });

  it.each(RUNTIME_FILES)('%s hardcodes no machine paths', (file) => {
    const text = readRepoFile(file);

    expect(
      MACHINE_PATH_FRAGMENTS.filter((fragment) => text.includes(fragment)),
    ).toEqual([]);
  });
});

describe('cross-references in the spec', () => {
  const headings = SPEC_FILES.flatMap((file) =>
    extractHeadings(readRepoFile(file)),
  );

  it.each(SPEC_FILES)(
    'every "(see Section)" in %s names a real heading',
    (file) => {
      expect(findBrokenSectionReferences(readRepoFile(file), headings)).toEqual(
        [],
      );
    },
  );

  it.each(SPEC_FILES)('every "(see `file`)" in %s exists', (file) => {
    const missing = extractFileReferences(readRepoFile(file)).filter(
      (reference) => !repoFileExists(reference),
    );

    expect(missing).toEqual([]);
  });
});

describe('README', () => {
  it('links only to files that exist', () => {
    const missing = extractRelativeLinks(readRepoFile('README.md')).filter(
      (link) => !repoFileExists(link),
    );

    expect(missing).toEqual([]);
  });
});

describe('spec-hygiene helpers', () => {
  it('finds a hardcoded value as a whole token only', () => {
    const text = 'assign `octocat` but not `octocat-agent` or octocat.dev';

    expect(findLiteralValues(text, ['octocat'])).toEqual(['octocat']);
    expect(findLiteralValues('only octocat-agent here', ['octocat'])).toEqual(
      [],
    );
  });

  it('flags a reference to a heading that does not exist', () => {
    const text =
      'Do it (see Retry Limit). Then (see Weekly Scan → Phase 9) and (see the template below).';
    const headings = ['Retry Limit', 'Weekly Scan', 'Phase 1 - Intake'];

    expect(findBrokenSectionReferences(text, headings)).toEqual(['Phase 9']);
  });

  it('splits compound references and drops "in <file>" suffixes', () => {
    const text =
      '(see Agent Code Review and Missing Part) (see Untrusted Input in CLAUDE.md)';
    const headings = ['Agent Code Review', 'Untrusted Input'];

    expect(findBrokenSectionReferences(text, headings)).toEqual([
      'Missing Part',
    ]);
  });

  it('extracts relative links without anchors and skips URLs', () => {
    const markdown =
      '[a](CLAUDE.md#top) [b](https://example.com) [c](#local) [d](docs/x.md)';

    expect(extractRelativeLinks(markdown)).toEqual(['CLAUDE.md', 'docs/x.md']);
  });
});
