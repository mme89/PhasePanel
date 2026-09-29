import { buildApp } from './app.js';
import { readConfig } from './config.js';
const config = readConfig();
const app = await buildApp(config, { logger: true });
await app.listen({ host: config.HOST, port: config.PORT });
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  void app.close().then(() => process.exit(0));
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, close);
if (process.env.DESKTOP_LAUNCHER === '1') {
  process.stdin.on('end', close);
  process.stdin.resume();
}
