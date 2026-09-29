import type { Store } from './store.js';
import nodemailer from 'nodemailer';
import type { NotificationSettings } from './notificationSettings.js';

export type NotificationProvider =
  'telegram' | 'pushover' | 'email' | 'discord';
export type NotificationSender = (
  provider: NotificationProvider,
  message: string,
  settings: NotificationSettings,
) => Promise<void>;

export function emailDelivery(
  message: string,
  config: NotificationSettings['email'],
) {
  const [heading, dashboard] = message.split('\n');
  const subject = [
    heading,
    dashboard?.startsWith('Dashboard: ') ? dashboard.slice(11) : '',
  ]
    .filter(Boolean)
    .join(' — ')
    .replace(/[\r\n]/g, ' ')
    .slice(0, 180);
  return {
    transport: {
      host: config.host,
      port: config.port,
      secure: config.security === 'tls',
      requireTLS: config.security === 'starttls',
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
      ...(config.username
        ? { auth: { user: config.username, pass: config.password } }
        : {}),
    },
    mail: {
      from: config.from,
      to: config.recipients,
      subject,
      text: message,
    },
  };
}

export class DiscordRateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super('Discord rate limit');
  }
}

export const sendNotification: NotificationSender = async (
  provider,
  message,
  settings,
) => {
  if (provider === 'email') {
    const { transport, mail } = emailDelivery(message, settings.email);
    const result = await nodemailer.createTransport(transport).sendMail(mail);
    if (result.rejected.length) throw new Error('SMTP rejected recipients');
    return;
  }
  if (provider === 'discord') {
    const url = new URL(settings.discord.webhookUrl);
    url.searchParams.set('wait', 'true');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: message,
        allowed_mentions: { parse: [] },
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (response.status === 429) {
      const body: unknown = await response.json().catch(() => null);
      const seconds = Number(
        response.headers.get('retry-after') ||
          (body && typeof body === 'object' && 'retry_after' in body
            ? body.retry_after
            : 30),
      );
      throw new DiscordRateLimitError(
        Number.isFinite(seconds) && seconds > 0
          ? Math.ceil(seconds * 1000)
          : 30_000,
      );
    }
    if (!response.ok)
      throw new Error(`Discord returned HTTP ${response.status}`);
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('id' in result))
      throw new Error('Discord returned an invalid response');
    return;
  }
  const credentials =
    provider === 'telegram'
      ? {
          token: settings.telegram.botToken,
          recipient: settings.telegram.chatId,
        }
      : {
          token: settings.pushover.appToken,
          recipient: settings.pushover.userKey,
        };
  const url =
    provider === 'telegram'
      ? `https://api.telegram.org/bot${credentials.token}/sendMessage`
      : 'https://api.pushover.net/1/messages.json';
  const body =
    provider === 'telegram'
      ? { chat_id: credentials.recipient, text: message }
      : { token: credentials.token, user: credentials.recipient, message };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  });
  if (!response.ok)
    throw new Error(`${provider} returned HTTP ${response.status}`);
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== 'object' ||
    !('ok' in result || 'status' in result)
  )
    throw new Error(`${provider} returned an invalid response`);
  if (provider === 'telegram' && !('ok' in result && result.ok === true))
    throw new Error('Telegram rejected the message');
  if (provider === 'pushover' && !('status' in result && result.status === 1))
    throw new Error('Pushover rejected the message');
};

export class NotificationDispatcher {
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private stopped = false;

  constructor(
    private store: Store,
    private sender: NotificationSender = sendNotification,
    private now: () => number = Date.now,
  ) {}

  start() {
    this.schedule(0);
  }
  private schedule(delay: number) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.dispatchOnce()
        .catch(() => {})
        .finally(() => this.schedule(5_000));
    }, delay);
  }
  dispatchOnce(): Promise<void> {
    if (this.pending) return this.pending;
    const pending = this.dispatch();
    this.pending = pending;
    void pending
      .finally(() => {
        if (this.pending === pending) this.pending = undefined;
      })
      .catch(() => {});
    return pending;
  }
  private async dispatch() {
    for (const item of this.store.pendingNotifications(this.now())) {
      const { settings } = this.store.getNotificationSettings();
      const provider = item.provider as NotificationProvider;
      const config = settings[provider];
      if (!config.enabled) continue;
      if (
        provider === 'discord'
          ? !settings.discord.webhookUrl
          : provider === 'email'
            ? !settings.email.host ||
              !settings.email.from ||
              !settings.email.recipients.length ||
              (Boolean(settings.email.username) && !settings.email.password)
            : provider === 'telegram'
              ? !settings.telegram.botToken || !settings.telegram.chatId
              : !settings.pushover.appToken || !settings.pushover.userKey
      )
        continue;
      try {
        await this.sender(provider, item.message, settings);
        this.store.finishNotification(
          item.id,
          true,
          item.attempts + 1,
          this.now(),
          null,
        );
      } catch (error) {
        // Provider responses can contain secrets; expose only a fixed error.
        this.store.finishNotification(
          item.id,
          false,
          item.attempts + 1,
          this.now(),
          `${provider} delivery failed`,
          error instanceof DiscordRateLimitError ? error.retryAfterMs : 0,
        );
      }
    }
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.pending?.catch(() => {});
  }
}
