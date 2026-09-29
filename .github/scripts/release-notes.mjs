import { readFileSync } from 'node:fs';

const tag = process.argv[2];
const packagePath = process.argv[3] ?? 'package.json';
const changelogPath = process.argv[4] ?? 'CHANGELOG.md';
const version = JSON.parse(readFileSync(packagePath, 'utf8')).version;

if (tag && tag !== `v${version}`) {
  throw new Error(
    `Release tag ${tag} does not match package version v${version}.`,
  );
}

const changelog = readFileSync(changelogPath, 'utf8');
const headings = [...changelog.matchAll(/^## (.+)$/gm)];
const heading = headings.find((match) => match[1].startsWith(`${version} - `));

if (!heading) {
  throw new Error(`CHANGELOG.md has no section for version ${version}.`);
}

const nextHeading = headings.find((match) => match.index > heading.index);
const notes = changelog
  .slice(heading.index, nextHeading?.index ?? changelog.length)
  .trim();

if (!/^[-*] /m.test(notes)) {
  throw new Error(`CHANGELOG.md section for ${version} has no release notes.`);
}

process.stdout.write(`${notes}\n`);
