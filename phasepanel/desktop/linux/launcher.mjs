import { spawn } from 'node:child_process';
import {
  openSync,
  closeSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(
  process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'),
  'phasepanel',
);
const sessionFile = join(dataDir, 'session.json');
const appDir = join(root, 'app');
mkdirSync(dataDir, { recursive: true });
const dataPathFile = join(dataDir, 'data-directory.txt');
try {
  readFileSync(dataPathFile, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  try {
    writeFileSync(dataPathFile, `${dataDir}\n`, { flag: 'wx' });
  } catch (writeError) {
    if (writeError.code !== 'EEXIST') throw writeError;
  }
}

function databaseDirectory() {
  const directory = readFileSync(dataPathFile, 'utf8').trim();
  if (!isAbsolute(directory))
    throw new Error(`Enter an absolute folder path in ${dataPathFile}.`);
  return resolve(directory);
}

function portSetting() {
  const file = join(dataDir, 'server-port.txt');
  let saved;
  try {
    saved = readFileSync(file, 'utf8').trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    saved = 'auto';
  }
  if (saved === 'auto') return { mode: 'auto', port: null };
  const port = Number(saved);
  if (!/^\d+$/.test(saved) || port < 1024 || port > 65535)
    throw new Error(`Enter a port from 1024 to 65535 in ${file}.`);
  return { mode: 'fixed', port };
}

function readSession() {
  try {
    return JSON.parse(readFileSync(sessionFile, 'utf8'));
  } catch {
    return null;
  }
}

function openBrowser(url) {
  const browser = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  browser.on('error', (error) =>
    console.error(`Could not open the browser: ${error.message}`),
  );
  browser.unref();
}

async function healthy(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function availablePort(preferred = 0) {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(preferred, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

const session = readSession();
if (process.argv.includes('--stop')) {
  if (!session) process.exit(0);
  try {
    const command = readFileSync(`/proc/${session.pid}/cmdline`, 'utf8');
    if (!command.includes('launcher.mjs')) throw new Error('Stale session');
    process.kill(session.pid, 'SIGTERM');
  } catch {
    rmSync(sessionFile, { force: true });
  }
  process.exit(0);
}

if (session && (await healthy(session.port))) {
  openBrowser(`http://127.0.0.1:${session.port}/`);
} else {
  if (session) rmSync(sessionFile, { force: true });
  const selectedDataDir = databaseDirectory();
  const selectedPort = portSetting();
  let port;
  try {
    port = await availablePort(selectedPort.port ?? 0);
  } catch (error) {
    if (selectedPort.mode === 'fixed' && error.code === 'EADDRINUSE')
      throw new Error(
        `Port ${selectedPort.port} is already in use. Choose another port in Server address settings.`,
      );
    throw error;
  }
  const log = openSync(join(dataDir, 'server.log'), 'a');
  const server = spawn(join(root, 'node'), ['dist/server/index.js'], {
    cwd: appDir,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_PATH: join(selectedDataDir, 'dashboards.db'),
      DESKTOP_DATA_DIR: dataDir,
      DESKTOP_PORT_MODE: selectedPort.mode,
      DESKTOP_LAUNCHER: '1',
    },
    stdio: ['pipe', log, log],
  });
  closeSync(log);
  let closing = false;
  function shutdown() {
    if (closing) return;
    closing = true;
    server.stdin.end();
    setTimeout(() => server.kill('SIGKILL'), 5000).unref();
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  server.on('exit', () => {
    const current = readSession();
    if (current?.pid === process.pid) rmSync(sessionFile, { force: true });
    process.exit(0);
  });

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await healthy(port)) {
      ready = true;
      break;
    }
    if (server.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) {
    console.error(
      selectedPort.mode === 'fixed'
        ? `PhasePanel could not start on port ${port}. It may already be in use. See ${join(dataDir, 'server.log')}`
        : `PhasePanel did not start. See ${join(dataDir, 'server.log')}`,
    );
    shutdown();
  } else {
    writeFileSync(sessionFile, JSON.stringify({ pid: process.pid, port }));
    openBrowser(`http://127.0.0.1:${port}/`);
  }
}
