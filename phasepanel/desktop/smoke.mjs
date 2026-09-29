import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const bundle = resolve(process.argv[2] ?? '');
if (!process.argv[2])
  throw new Error('Usage: node desktop/smoke.mjs <bundle-resources-directory>');
const node = join(bundle, process.platform === 'win32' ? 'node.exe' : 'node');
const app = join(bundle, 'app');
const temporary = mkdtempSync(join(tmpdir(), 'phasepanel-smoke-'));

async function availablePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

let child;
try {
  const port = await availablePort();
  child = spawn(node, ['dist/server/index.js'], {
    cwd: app,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_PATH: join(temporary, 'dashboards.db'),
      DESKTOP_LAUNCHER: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  let healthy = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok && (await response.json()).status === 'ok') {
        healthy = true;
        break;
      }
    } catch {
      /* Wait for the server. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!healthy)
    throw new Error(`Bundled server did not become ready:\n${output}`);
  const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  if (!page.includes('<title>PhasePanel'))
    throw new Error('Bundled frontend was not served.');
  child.stdin.end();
  const exited =
    child.exitCode !== null ||
    (await Promise.race([
      new Promise((resolve) => child.once('exit', () => resolve(true))),
      new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
    ]));
  if (!exited)
    throw new Error('Bundled server did not stop when launcher input closed.');
  console.log(`Bundled server smoke check passed on ${process.platform}.`);
} finally {
  if (child && child.exitCode === null) child.kill();
  rmSync(temporary, { recursive: true, force: true });
}
