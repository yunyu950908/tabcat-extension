#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import {
  compareReleaseVersions,
  getPackageVersion,
  parseReleaseVersion,
} from './version-utils.mjs';

const version = getPackageVersion();
parseReleaseVersion(version);

const tag = `v${version}`;
const eventName = process.env.GITHUB_EVENT_NAME || '';
const refName = process.env.GITHUB_REF_NAME || '';
const refType = process.env.GITHUB_REF_TYPE || '';
const event = readGithubEvent();

let shouldRelease = false;
let createTag = false;
let reason = 'No release trigger matched.';

if (eventName === 'push' && refType === 'branch' && refName === 'main') {
  const previousVersion = getPreviousMainVersion(event.before);

  if (previousVersion == null) {
    reason = 'Could not find previous package version on main.';
  } else if (compareReleaseVersions(version, previousVersion) > 0) {
    shouldRelease = true;
    createTag = true;
    reason = `Package version increased from ${previousVersion} to ${version}.`;
  } else {
    reason = `Package version ${version} did not increase from ${previousVersion}.`;
  }
} else if (eventName === 'push' && refType === 'tag') {
  if (refName !== tag) {
    console.error(
      `Tag ${refName} does not match package version ${version}; expected ${tag}.`,
    );
    process.exit(1);
  }

  shouldRelease = true;
  reason = `Tag ${tag} matches package version ${version}.`;
} else if (eventName === 'workflow_dispatch') {
  shouldRelease = true;
  createTag = !remoteTagExists(tag);
  reason = createTag
    ? `Manual release artifact run for ${tag}; tag will be created.`
    : `Manual release artifact run for existing ${tag}.`;
}

if (shouldRelease && createTag && remoteTagExists(tag)) {
  console.error(`Release tag ${tag} already exists.`);
  process.exit(1);
}

writeOutput('create_tag', String(createTag));
writeOutput('reason', reason);
writeOutput('should_release', String(shouldRelease));
writeOutput('tag', tag);
writeOutput('version', version);

console.log(reason);

function getPreviousMainVersion(beforeSha) {
  if (!beforeSha || /^0+$/.test(beforeSha)) {
    return null;
  }

  try {
    const packageJson = execFileSync('git', ['show', `${beforeSha}:package.json`], {
      encoding: 'utf8',
    });
    const previousVersion = JSON.parse(packageJson).version;
    parseReleaseVersion(previousVersion);
    return previousVersion;
  } catch {
    return null;
  }
}

function readGithubEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!eventPath || !existsSync(eventPath)) {
    return {};
  }

  return JSON.parse(readFileSync(eventPath, 'utf8'));
}

function remoteTagExists(tagName) {
  const tagLookup = spawnSync(
    'git',
    ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tagName}`],
    { stdio: 'ignore' },
  );

  if (tagLookup.status === 0) {
    return true;
  }

  if (tagLookup.status === 2) {
    return false;
  }

  throw new Error(`Could not check whether release tag ${tagName} exists.`);
}

function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;

  if (!outputPath) {
    console.log(`${name}=${value}`);
    return;
  }

  appendFileSync(outputPath, `${name}=${value}\n`);
}
