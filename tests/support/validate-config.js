const GITHUB_REPO_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/;
const BOT_LOGIN = /^[\w-]+\[bot\]$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

const isNonEmptyString = (value) =>
  typeof value === 'string' && value.trim() !== '';
const isDomain = (value) => isNonEmptyString(value) && DOMAIN.test(value);
const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function repoNameFromUrl(url) {
  return url.split('/').pop();
}

export function validateConfig(config) {
  const knownRepos = knownRepoNames(config.repos);

  return [
    ...validateIdentities(config.identities),
    ...validateTrustedBots(config.trustedBots),
    ...validateRepos(config.repos),
    ...validateErrorLog(config.errorLog),
    ...validateCrossRepoDependencies(config.crossRepoDependencies, knownRepos),
    ...validateSentry(config.sentry, knownRepos),
    ...validateSiteScans(config.siteScans, knownRepos),
  ];
}

function validateIdentities(identities) {
  if (!isObject(identities)) {
    return ['identities is required'];
  }

  const missing = ['human', 'agent']
    .filter((key) => !isNonEmptyString(identities[key]))
    .map((key) => `identities.${key} must be a non-empty string`);
  const sameAccount =
    identities.human === identities.agent
      ? ['identities.human and identities.agent must be different accounts']
      : [];

  return [...missing, ...sameAccount];
}

function validateTrustedBots(trustedBots) {
  if (!Array.isArray(trustedBots)) {
    return ['trustedBots must be an array'];
  }

  return trustedBots
    .filter((login) => !BOT_LOGIN.test(login))
    .map((login) => `trustedBots entry is not a bot login: ${login}`);
}

function hasRepoLists(repos) {
  return (
    isObject(repos) &&
    Array.isArray(repos.active) &&
    Array.isArray(repos.disabled)
  );
}

function findDuplicates(values) {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

function validateRepos(repos) {
  if (!hasRepoLists(repos)) {
    return ['repos.active and repos.disabled must be arrays'];
  }

  const allUrls = [...repos.active, ...repos.disabled];
  const empty =
    repos.active.length === 0
      ? ['repos.active must list at least one repo']
      : [];
  const malformed = allUrls
    .filter((url) => !GITHUB_REPO_URL.test(url))
    .map((url) => `not a GitHub repo URL: ${url}`);
  const duplicated = findDuplicates(allUrls).map(
    (url) => `repo listed more than once across active and disabled: ${url}`,
  );

  return [...empty, ...malformed, ...duplicated];
}

function knownRepoNames(repos) {
  if (!hasRepoLists(repos)) {
    return new Set();
  }

  return new Set([...repos.active, ...repos.disabled].map(repoNameFromUrl));
}

function validateErrorLog(errorLog) {
  if (errorLog === null || isNonEmptyString(errorLog)) {
    return [];
  }

  return ['errorLog must be a path or null'];
}

function unknownRepoErrors(names, knownRepos, key) {
  return names
    .filter((name) => !knownRepos.has(name))
    .map((name) => `${key} references unknown repo: ${name}`);
}

function validateDependency(dependency, knownRepos) {
  const unknown = unknownRepoErrors(
    [dependency.dependent, dependency.dependsOn],
    knownRepos,
    'crossRepoDependencies',
  );
  const missingContract = isNonEmptyString(dependency.contractSurface)
    ? []
    : [
        `crossRepoDependencies entry for ${dependency.dependent} needs a contractSurface`,
      ];

  return [...unknown, ...missingContract];
}

function validateCrossRepoDependencies(dependencies, knownRepos) {
  if (!Array.isArray(dependencies)) {
    return ['crossRepoDependencies must be an array'];
  }

  return dependencies.flatMap((dependency) =>
    validateDependency(dependency, knownRepos),
  );
}

function validateRepoMap(map, knownRepos, key, isValidValue) {
  if (!isObject(map)) {
    return [`${key} must be an object`];
  }

  const invalidValues = Object.entries(map)
    .filter(([, value]) => !isValidValue(value))
    .map(([repo, value]) => `${key}.${repo} has an invalid value: ${value}`);

  return [
    ...unknownRepoErrors(Object.keys(map), knownRepos, key),
    ...invalidValues,
  ];
}

function validateSentry(sentry, knownRepos) {
  if (!isObject(sentry) || typeof sentry.enabled !== 'boolean') {
    return ['sentry.enabled must be a boolean'];
  }

  if (!sentry.enabled) {
    return [];
  }

  const missingOrg = isNonEmptyString(sentry.org)
    ? []
    : ['sentry.org is required when Sentry is enabled'];

  return [
    ...missingOrg,
    ...validateRepoMap(
      sentry.projects,
      knownRepos,
      'sentry.projects',
      isNonEmptyString,
    ),
  ];
}

function validateSiteScans(siteScans, knownRepos) {
  if (!isObject(siteScans) || typeof siteScans.enabled !== 'boolean') {
    return ['siteScans.enabled must be a boolean'];
  }

  if (!siteScans.enabled) {
    return [];
  }

  const missingVault = isNonEmptyString(siteScans.vaultDir)
    ? []
    : ['siteScans.vaultDir is required when site scans are enabled'];

  return [
    ...missingVault,
    ...validateRepoMap(
      siteScans.sites,
      knownRepos,
      'siteScans.sites',
      isDomain,
    ),
  ];
}
