import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, readRepoFile, repoPath } from './support/repo-files.js';

const FILTER = 'filters/trusted-comments.jq';
const AGENT = 'the-agent';

// The jq half of each pipeline the spec tells the orchestrator to run, captured
// verbatim (quoting and config lookups included) so editing the spec is tested.
const REVIEW_FEEDBACK_PIPELINE =
  /done \| (jq -s [\s\S]*?-f filters\/trusted-comments\.jq)/;
const SUGGEST_PIPELINE =
  /--jq '\.\[\]' \| (jq -s --argjson bots '\[\]' [^`]*?-f filters\/trusted-comments\.jq)/;

let nextId = 1;

function comment({ login, association, type = 'User', ...overrides }) {
  return {
    id: nextId++,
    user: { login, type },
    author_association: association,
    body: 'Please fix this',
    created_at: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

const TEAM = [
  comment({ login: 'owner', association: 'OWNER' }),
  comment({ login: 'member', association: 'MEMBER' }),
  comment({ login: 'collaborator', association: 'COLLABORATOR' }),
];
const STRANGERS = [
  comment({ login: 'stranger', association: 'NONE' }),
  comment({ login: 'past-contributor', association: 'CONTRIBUTOR' }),
  comment({ login: 'newcomer', association: 'FIRST_TIME_CONTRIBUTOR' }),
];
const BOTS = [
  comment({ login: 'review-bot[bot]', association: 'NONE', type: 'Bot' }),
  comment({ login: 'netlify[bot]', association: 'NONE', type: 'Bot' }),
  comment({
    login: 'dependabot[bot]',
    association: 'CONTRIBUTOR',
    type: 'Bot',
  }),
];

function streamOf(items) {
  return items.map((item) => JSON.stringify(item)).join('\n');
}

function runFilter(items, { bots = [], agent = AGENT } = {}) {
  const result = spawnSync(
    'jq',
    [
      '-s',
      '--argjson',
      'bots',
      JSON.stringify(bots),
      '--arg',
      'agent',
      agent,
      '-f',
      repoPath(FILTER),
    ],
    { input: streamOf(items), encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`jq failed: ${result.stderr}`);
  }

  return JSON.parse(result.stdout);
}

function runSpecPipeline(command, items) {
  const result = spawnSync('bash', ['-c', command], {
    cwd: REPO_ROOT,
    input: streamOf(items),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`pipeline failed: ${result.stderr}`);
  }

  return JSON.parse(result.stdout);
}

function extractPipeline(file, pattern) {
  const match = readRepoFile(file).match(pattern);
  if (!match) {
    throw new Error(`Could not find the trusted-comments pipeline in ${file}`);
  }

  return match[1];
}

const authorsOf = (result) => result.trusted.map((entry) => entry.author);

describe(FILTER, () => {
  it('keeps the team and drops strangers, counting them', () => {
    const result = runFilter([...TEAM, ...STRANGERS]);

    expect(authorsOf(result)).toEqual(['owner', 'member', 'collaborator']);
    expect(result.dropped).toEqual({ users: 3, bots: 0 });
  });

  it('trusts no bot by default, so a bot cannot launder a stranger', () => {
    const result = runFilter([...TEAM, ...BOTS]);

    expect(authorsOf(result)).toEqual(['owner', 'member', 'collaborator']);
    expect(result.dropped).toEqual({ users: 0, bots: 3 });
  });

  it('trusts a bot only when it is allowlisted', () => {
    const result = runFilter(BOTS, { bots: ['review-bot[bot]'] });

    expect(authorsOf(result)).toEqual(['review-bot[bot]']);
  });

  it("leaves out the agent's own comments entirely", () => {
    const own = comment({ login: AGENT, association: 'MEMBER' });
    const result = runFilter([own, ...TEAM]);

    expect(authorsOf(result)).not.toContain(AGENT);
    expect(result.dropped).toEqual({ users: 0, bots: 0 });
  });

  it('skips reviews and comments with no text', () => {
    const emptyApproval = comment({
      login: 'member',
      association: 'MEMBER',
      body: '',
      state: 'APPROVED',
    });
    const nullBody = comment({
      login: 'owner',
      association: 'OWNER',
      body: null,
    });

    expect(runFilter([emptyApproval, nullBody]).trusted).toEqual([]);
  });

  it('normalizes review bodies, inline comments, and conversation comments', () => {
    const review = comment({
      login: 'owner',
      association: 'OWNER',
      created_at: undefined,
      submitted_at: '2026-11-02T00:00:00Z',
      state: 'CHANGES_REQUESTED',
    });
    const inline = comment({
      login: 'member',
      association: 'MEMBER',
      path: 'src/app.ts',
      line: 12,
    });

    const [reviewEntry, inlineEntry] = runFilter([review, inline]).trusted;

    expect(reviewEntry).toMatchObject({
      posted_at: '2026-11-02T00:00:00Z',
      review_state: 'CHANGES_REQUESTED',
      path: null,
    });
    expect(inlineEntry).toMatchObject({ path: 'src/app.ts', line: 12 });
  });
});

describe('pipelines the spec tells the orchestrator to run', () => {
  it('Task Queue item 4 reads all three endpoints, every page', () => {
    const claude = readRepoFile('CLAUDE.md');

    expect(claude).toMatch(
      /for endpoint in pulls\/<PR-NUMBER>\/comments pulls\/<PR-NUMBER>\/reviews issues\/<PR-NUMBER>\/comments; do\s+gh api --paginate /,
    );
  });

  it('Task Queue item 4 filters with the config, dropping strangers', () => {
    const command = extractPipeline('CLAUDE.md', REVIEW_FEEDBACK_PIPELINE);
    const result = runSpecPipeline(command, [...TEAM, ...STRANGERS, ...BOTS]);

    expect(authorsOf(result)).toEqual(['owner', 'member', 'collaborator']);
    expect(result.dropped.users).toBe(3);
  });

  it('Phase 0 /suggest intake accepts the team only, never bots', () => {
    const command = extractPipeline(
      'docs/improvement-scan.md',
      SUGGEST_PIPELINE,
    );
    const result = runSpecPipeline(command, [...TEAM, ...STRANGERS, ...BOTS]);

    expect(authorsOf(result)).toEqual(['owner', 'member', 'collaborator']);
  });

  it('the Issue template passes filtered discussion, not raw comments', () => {
    expect(readRepoFile('CLAUDE.md')).toMatch(
      /Discussion: <the `trusted` entries from running the issue's conversation comments through filters\/trusted-comments\.jq/,
    );
  });
});
