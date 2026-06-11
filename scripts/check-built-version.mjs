#!/usr/bin/env node
import { getPackageVersion, readJson } from './version-utils.mjs';

const packageVersion = getPackageVersion();
const manifest = readJson('.output/chrome-mv3/manifest.json');

if (manifest.version !== packageVersion) {
  console.error(
    `Built manifest version ${manifest.version} does not match package version ${packageVersion}.`,
  );
  process.exit(1);
}

console.log(`Built manifest version matches package version ${packageVersion}.`);
