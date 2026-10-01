import { readdirSync, rmSync, rmdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const developmentDirectories = new Set([
  '.github',
  'benchmark',
  'benchmarks',
  'coverage',
  'doc',
  'docs',
  'example',
  'examples',
  'test',
  'tests',
  '__tests__',
]);
const licenseFile = /^(licen[cs]e|copying|notice|copyright)([.-]|$)/i;
const developmentFile = /(?:\.d\.(?:ts|cts|mts)|\.map)$/i;

// Only prune a staged production install. Keep runtime JS/JSON/assets and legal
// notices, including notices inside otherwise removable documentation folders.
export function pruneDependencies(directory) {
  const root = resolve(directory);
  if (basename(root) !== 'node_modules')
    throw new Error('Expected a staged node_modules directory.');
  let removed = 0;
  let kept = 0;

  function walk(folder, packageRoot = false, discard = false) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isSymbolicLink()) {
        // Do not traverse links outside the staged tree.
        kept++;
      } else if (entry.isDirectory()) {
        if (entry.name === 'node_modules' && !discard) modules(path);
        else
          walk(
            path,
            false,
            discard || (packageRoot && developmentDirectories.has(entry.name)),
          );
        if (readdirSync(path).length === 0) rmdirSync(path);
      } else if (
        !licenseFile.test(entry.name) &&
        (discard || developmentFile.test(entry.name))
      ) {
        rmSync(path);
        removed++;
      } else {
        kept++;
      }
    }
  }

  function modules(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(folder, entry.name);
      if (entry.name.startsWith('@')) modules(path);
      else walk(path, true);
    }
  }

  modules(root);
  return { removed, kept };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (!process.argv[2])
    throw new Error(
      'Usage: node desktop/prune-dependencies.mjs <staged-node_modules>',
    );
  const { removed, kept } = pruneDependencies(process.argv[2]);
  console.log(
    `Pruned ${removed} dependency files; kept ${kept} runtime/legal files.`,
  );
}
