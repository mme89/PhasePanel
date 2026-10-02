import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { UpdateCheck } from '../shared/updates.js';

// Source runs from server/; packaged builds run from dist/server/.
const packageUrl = [
  new URL('../package.json', import.meta.url),
  new URL('../../package.json', import.meta.url),
].find((url) => existsSync(url));
if (!packageUrl) throw new Error('PhasePanel package metadata is missing.');
export const appVersion = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(packageUrl, 'utf8'))).version;

const stableVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[\da-zA-Z.-]+)?$/;
const releaseSchema = z.object({
  tag_name: z
    .string()
    .refine((tag) => stableVersion.test(tag.replace(/^v/, ''))),
  draft: z.literal(false),
  prerelease: z.literal(false),
});

export function isNewerVersion(latest: string, current: string): boolean {
  if (!stableVersion.test(latest)) throw new Error('Invalid release version.');
  const currentCore = current.split(/[+-]/)[0];
  if (!stableVersion.test(currentCore))
    throw new Error('Invalid installed version.');
  const next = latest.split('+')[0].split('.').map(BigInt);
  const installed = currentCore.split('.').map(BigInt);
  for (let index = 0; index < 3; index++) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return current.split('+')[0].includes('-');
}

export function createUpdateChecker(
  fetcher: typeof fetch = fetch,
  currentVersion = appVersion,
  now: () => number = Date.now,
) {
  let cached: UpdateCheck | undefined;
  let inFlight: Promise<UpdateCheck> | undefined;
  async function check(): Promise<UpdateCheck> {
    const response = await fetcher(
      'https://api.github.com/repos/mme89/PhasePanel/releases/latest',
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `PhasePanel/${currentVersion}`,
          'X-GitHub-Api-Version': '2026-03-10',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 404) {
      return {
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        checkedAt: new Date(now()).toISOString(),
      };
    }
    if (!response.ok) throw new Error('Release check failed.');
    const release = releaseSchema.parse(await response.json());
    const latestVersion = release.tag_name.replace(/^v/, '');
    return {
      currentVersion,
      latestVersion,
      updateAvailable: isNewerVersion(latestVersion, currentVersion),
      releaseUrl: `https://github.com/mme89/PhasePanel/releases/tag/${encodeURIComponent(release.tag_name)}`,
      checkedAt: new Date(now()).toISOString(),
    };
  }
  return () => {
    if (cached && now() - Date.parse(cached.checkedAt) < 60_000)
      return Promise.resolve(cached);
    if (!inFlight) {
      inFlight = check()
        .then((result) => {
          cached = result;
          return result;
        })
        .finally(() => {
          inFlight = undefined;
        });
    }
    return inFlight;
  };
}
