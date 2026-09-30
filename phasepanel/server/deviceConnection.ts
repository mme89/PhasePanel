import { spawn } from 'node:child_process';
import { Client } from 'basic-ftp';

export type ConnectionCheck = {
  status: 'ok' | 'failed' | 'skipped' | 'unavailable';
  message: string;
};

export function pingTimeMs(output: string): string | null {
  const match = output.match(/\btime\s*([=<])\s*(\d+(?:[.,]\d+)?)\s*ms\b/i);
  return match
    ? `${match[1] === '<' ? '<' : ''}${match[2].replace(',', '.')} ms`
    : null;
}

export function pingHost(
  host: string,
  timeoutMs: number,
): Promise<ConnectionCheck> {
  return new Promise((resolve) => {
    const args =
      process.platform === 'win32' ? ['-n', '1', host] : ['-c', '1', host];
    const child = spawn('ping', args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      env:
        process.platform === 'win32'
          ? process.env
          : { ...process.env, LC_ALL: 'C' },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (output.length < 4096)
        output += chunk.toString().slice(0, 4096 - output.length);
    });
    let settled = false;
    const finish = (result: ConnectionCheck) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ status: 'failed', message: 'Ping timed out.' }),
      timeoutMs,
    );
    child.once('error', () =>
      finish({
        status: 'unavailable',
        message: 'Ping is unavailable on the server.',
      }),
    );
    child.once('close', (code) =>
      finish(
        code === 0
          ? {
              status: 'ok',
              message:
                pingTimeMs(output) ?? 'Ping succeeded; time unavailable.',
            }
          : { status: 'failed', message: 'No ping reply from the device.' },
      ),
    );
  });
}

export async function checkFtpLogin(
  host: string,
  port: number,
  username: string,
  password: string,
  timeoutMs: number,
): Promise<boolean> {
  const client = new Client(timeoutMs);
  try {
    await client.access({
      host,
      port,
      user: username,
      password,
      secure: false,
    });
    return true;
  } catch {
    return false;
  } finally {
    client.close();
  }
}
