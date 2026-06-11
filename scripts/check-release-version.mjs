#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import {
  compareReleaseVersions,
  getPackageVersion,
  parseReleaseVersion,
} from './version-utils.mjs';

const baseRef = process.env.GITHUB_BASE_REF || 'main';
const currentVersion = getPackageVersion();
parseReleaseVersion(currentVersion);

execFileSync(
  'git',
  ['fetch', '--no-tags', 'origin', `${baseRef}:refs/remotes/origin/${baseRef}`],
  { stdio: 'inherit' },
);

const basePackageJson = execFileSync(
  'git',
  ['show', `origin/${baseRef}:package.json`],
  { encoding: 'utf8' },
);
const baseVersion = JSON.parse(basePackageJson).version;
parseReleaseVersion(baseVersion);

if (compareReleaseVersions(currentVersion, baseVersion) <= 0) {
  console.error(
    `Release version ${currentVersion} must be greater than ${baseVersion} on ${baseRef}.`,
  );
  process.exit(1);
}

const tag = `v${currentVersion}`;
const tagLookup = spawnSync(
  'git',
  ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`],
  { stdio: 'ignore' },
);

if (tagLookup.status === 0) {
  console.error(`Release tag ${tag} already exists.`);
  process.exit(1);
}

if (tagLookup.status !== 2) {
  console.error(`Could not check whether release tag ${tag} exists.`);
  process.exit(1);
}

console.log(
  `Release version ${currentVersion} is greater than ${baseVersion}; ${tag} is available.`,
);
