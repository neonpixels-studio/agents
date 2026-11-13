import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { readConfig, readRepoFile } from './support/repo-files.js';

// These tests run the exact jq programs the spec tells the orchestrator to use,
// so editing the filter in CLAUDE.md or docs/improvement-scan.md is tested too.
const REVIEW_COMMENT_FILTER =
  /--argjson bots "\$\(jq -c \.trustedBots agents\.config\.json\)" \\\s*\n\s*'([^']+)'/;
const SUGGEST_COMMENT_FILTER =
  /--jq '(\.\[\] \| select\(\.author_association[^']+)'/;

const COMMENTS = [
  { author_association: 'OWNER', user: { login: 'owner' } },
  { author_association: 'MEMBER', user: { login: 'member' } },
  { author_association: 'COLLABORATOR', user: { login: 'collaborator' } },
  { author_association: 'NONE', user: { login: 'stranger' } },
  { author_association: 'CONTRIBUTOR', user: { login: 'past-contributor' } },
  { author_association: 'FIRST_TIME_CONTRIBUTOR', user: { login: 'newcomer' } },
  { author_association: 'NONE', user: { login: 'coderabbitai[bot]' } },
  { author_association: 'NONE', user: { login: 'github-actions[bot]' } },
  { author_association: 'CONTRIBUTOR', user: { login: 'dependabot[bot]' } },
  { author_association: 'NONE', user: { login: 'netlify[bot]' } },
].map((comment, index) => ({ id: index, body: 'Please fix this', ...comment }));

function extractProgram(text, pattern, description) {
  const match = text.match(pattern);
  if (!match) {
    throw new Error(`Could not find the ${description} jq filter in the spec`);
  }

  return match[1];
}

function runJq(program, input) {
  const bots = JSON.stringify(readConfig().trustedBots);
  const result = spawnSync('jq', ['-c', '--argjson', 'bots', bots, program], {
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`jq failed: ${result.stderr}`);
  }

  return result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => JSON.parse(line));
}

const loginsOf = (comments) =>
  comments.map((comment) => comment.user?.login ?? comment.user);

describe('Task Queue item 4: review comment filter in CLAUDE.md', () => {
  const program = extractProgram(
    readRepoFile('CLAUDE.md'),
    REVIEW_COMMENT_FILTER,
    'review comment',
  );

  it('keeps team members and allowlisted bots only', () => {
    expect(loginsOf(runJq(program, COMMENTS))).toEqual([
      'owner',
      'member',
      'collaborator',
      'coderabbitai[bot]',
      'github-actions[bot]',
      'dependabot[bot]',
    ]);
  });

  it('drops a stranger even when they are a past contributor', () => {
    const kept = loginsOf(runJq(program, COMMENTS));

    expect(kept).not.toContain('stranger');
    expect(kept).not.toContain('past-contributor');
    expect(kept).not.toContain('newcomer');
    expect(kept).not.toContain('netlify[bot]');
  });
});

describe('Phase 0 /suggest intake filter in docs/improvement-scan.md', () => {
  const program = extractProgram(
    readRepoFile('docs/improvement-scan.md'),
    SUGGEST_COMMENT_FILTER,
    '/suggest comment',
  );

  it('accepts suggestions from team members only, not bots or strangers', () => {
    expect(loginsOf(runJq(program, COMMENTS))).toEqual([
      'owner',
      'member',
      'collaborator',
    ]);
  });
});
