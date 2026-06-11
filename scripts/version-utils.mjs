import { readFileSync } from 'node:fs';

export function compareReleaseVersions(left, right) {
  const leftParts = parseReleaseVersion(left);
  const rightParts = parseReleaseVersion(right);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;

    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }

  return 0;
}

export function getPackageVersion(path = 'package.json') {
  return readJson(path).version;
}

export function parseReleaseVersion(version) {
  if (typeof version !== 'string') {
    throw new Error('Version must be a string.');
  }

  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(
      `Version "${version}" must use numeric X.Y.Z format for Chrome MV3.`,
    );
  }

  return version.split('.').map((part) => Number(part));
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
