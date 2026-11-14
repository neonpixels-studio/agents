const SEE_REFERENCE = /\(see ([^)]+)\)/g;
const FILE_REFERENCE = /^`([^`]+)`$/;
const HEADING = /^#{1,6}\s+(.+?)\s*$/gm;
const RELATIVE_LINK = /\]\((?!https?:|#|mailto:)([^)\s]+)\)/g;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Matches the value as a whole token, so `grimicorn` does not match inside
// `grimicorn-agent` or `neonpixels` inside `neonpixels-studio`.
export function findLiteralValues(text, values) {
  return values.filter((value) =>
    new RegExp(`(?<![\\w-])${escapeRegExp(value)}(?![\\w-])`).test(text),
  );
}

export function extractHeadings(markdown) {
  return [...markdown.matchAll(HEADING)].map((match) => match[1]);
}

// "(see Weekly Improvement Scan → Phase 4)" yields both section names, and
// "(see Untrusted Input in CLAUDE.md)" yields "Untrusted Input". Lowercase
// phrases ("the Issue template", "priority order below") are prose, not
// section names, so they are not checked.
export function extractSectionReferences(text) {
  return [...text.matchAll(SEE_REFERENCE)]
    .map((match) => match[1])
    .filter((reference) => !FILE_REFERENCE.test(reference))
    .map((reference) => reference.replace(/\s+in\s+.*$/, ''))
    .flatMap((reference) => reference.split(/\s+and\s+|\s*→\s*/))
    .map((target) => target.trim())
    .filter((target) => /^[A-Z]/.test(target));
}

export function extractFileReferences(text) {
  return [...text.matchAll(SEE_REFERENCE)]
    .map((match) => match[1].match(FILE_REFERENCE))
    .filter(Boolean)
    .map((match) => match[1]);
}

function matchesHeading(target, headings) {
  return headings.some(
    (heading) => heading === target || heading.startsWith(`${target} `),
  );
}

export function findBrokenSectionReferences(text, headings) {
  return extractSectionReferences(text).filter(
    (target) => !matchesHeading(target, headings),
  );
}

export function extractRelativeLinks(markdown) {
  return [...markdown.matchAll(RELATIVE_LINK)].map(
    (match) => match[1].split('#')[0],
  );
}
