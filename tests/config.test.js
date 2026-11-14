import { describe, expect, it } from 'vitest';
import { readConfig } from './support/repo-files.js';
import { validateConfig } from '../scripts/validate-config.mjs';

function withChange(change) {
  const config = structuredClone(readConfig());
  change(config);
  return config;
}

describe('agents.config.json', () => {
  it('is valid', () => {
    expect(validateConfig(readConfig())).toEqual([]);
  });
});

describe('validateConfig', () => {
  it.each([
    [
      'missing human identity',
      (config) => delete config.identities.human,
      'identities.human must be a non-empty string',
    ],
    [
      'human and agent are the same account',
      (config) => (config.identities.agent = config.identities.human),
      'must be different accounts',
    ],
    [
      'trusted bot that is not a bot login',
      (config) => config.trustedBots.push('some-stranger'),
      'not a bot login: some-stranger',
    ],
    [
      'no active repos',
      (config) => (config.repos.active = []),
      'repos.active must list at least one repo',
    ],
    [
      'repo URL that is not a GitHub repo',
      (config) => config.repos.active.push('https://gitlab.com/someone/thing'),
      'not a GitHub repo URL',
    ],
    [
      'repo both active and disabled',
      (config) => config.repos.disabled.push(config.repos.active[0]),
      'listed more than once',
    ],
    [
      'error log that is neither a path nor null',
      (config) => (config.errorLog = 42),
      'errorLog must be a path or null',
    ],
    [
      'cross-repo dependency on an unknown repo',
      (config) => (config.crossRepoDependencies[0].dependsOn = 'nowhere'),
      'crossRepoDependencies references unknown repo: nowhere',
    ],
    [
      'cross-repo dependency without a contract surface',
      (config) => (config.crossRepoDependencies[0].contractSurface = ''),
      'needs a contractSurface',
    ],
    [
      'Sentry enabled without an org',
      (config) => (config.sentry.org = ''),
      'sentry.org is required',
    ],
    [
      'Sentry project for an unknown repo',
      (config) => (config.sentry.projects.typo = 'typo'),
      'sentry.projects references unknown repo: typo',
    ],
    [
      'site scans enabled without a vault directory',
      (config) => delete config.siteScans.vaultDir,
      'siteScans.vaultDir is required',
    ],
    [
      'site mapped to something that is not a domain',
      (config) =>
        (config.siteScans.sites[Object.keys(config.siteScans.sites)[0]] =
          'not a domain'),
      'has an invalid value: not a domain',
    ],
  ])('rejects %s', (_description, change, expectedError) => {
    const errors = validateConfig(withChange(change));

    expect(errors.join('\n')).toContain(expectedError);
  });

  it('skips Sentry and site-scan details when those integrations are disabled', () => {
    const config = withChange((draft) => {
      draft.sentry = { enabled: false };
      draft.siteScans = { enabled: false };
    });

    expect(validateConfig(config)).toEqual([]);
  });
});
