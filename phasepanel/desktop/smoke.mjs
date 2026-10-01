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

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(true);
  return new Promise((resolve) => {
    const exited = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.off('exit', exited);
      resolve(false);
    }, timeoutMs);
    child.once('exit', exited);
  });
}

let child;
let failure;
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
  const asset = page.match(/<script[^>]+src="([^"]+)"/)?.[1];
  if (!asset)
    throw new Error('Bundled frontend JavaScript was not referenced.');
  const assetResponse = await fetch(new URL(asset, `http://127.0.0.1:${port}`));
  // Drain the response so a pending download cannot hold up server shutdown.
  const assetBody = await assetResponse.arrayBuffer();
  if (!assetResponse.ok || assetBody.byteLength === 0)
    throw new Error('Bundled frontend JavaScript was not served.');
  const created = await fetch(`http://127.0.0.1:${port}/api/dashboards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Smoke check',
      refreshSeconds: 5,
      widgets: [],
    }),
  });
  if (created.status !== 201)
    throw new Error('Bundled server could not save a dashboard.');
  const dashboard = await created.json();
  const saved = await fetch(
    `http://127.0.0.1:${port}/api/dashboards/${dashboard.id}`,
  );
  if (!saved.ok || (await saved.json()).name !== 'Smoke check')
    throw new Error('Bundled server could not read the saved dashboard.');
  child.stdin.end();
  const exited = await waitForExit(child, 5000);
  if (!exited)
    throw new Error(
      `Bundled server did not stop when launcher input closed:\n${output}`,
    );
  console.log(`Bundled server smoke check passed on ${process.platform}.`);
} catch (error) {
  failure = error;
} finally {
  try {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      if (!(await waitForExit(child, 5000))) {
        child.kill('SIGKILL');
        if (!(await waitForExit(child, 5000)))
          throw new Error('Bundled server could not be stopped for cleanup.');
      }
    }
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  } catch (error) {
    // Windows file locks must not hide the failure that triggered cleanup.
    if (failure) console.error('Smoke check cleanup also failed:', error);
    else failure = error;
  }
}
if (failure) throw failure;
