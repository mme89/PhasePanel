import { buildApp } from './app.js';
import { readConfig } from './config.js';
const config = readConfig();
const app = await buildApp(config, { logger: true });
await app.listen({ host: config.HOST, port: config.PORT });
let closing = false;
function close() {
  if (closing) {
    process.exit(1);
    return;
  }
  closing = true;
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  void app
    .close()
    .then(() => process.exit(0))
    .catch((error) => {
      app.log.error(error);
      process.exit(1);
    });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, close);
if (process.env.DESKTOP_LAUNCHER === '1') {
  process.stdin.on('end', close);
  process.stdin.resume();
}
