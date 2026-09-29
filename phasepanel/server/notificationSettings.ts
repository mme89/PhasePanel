import { z } from 'zod';
import {
  deviceEventTypes,
  type DeviceEventType,
} from '../shared/deviceEvents.js';

const eventTypeSchema = z.enum(deviceEventTypes);
export function validDiscordWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'discord.com' &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]+$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}
const emailAddress = z.email().max(254);
const emailInput = z
  .object({
    enabled: z.boolean(),
    host: z.string().trim().max(255),
    port: z.number().int().min(1).max(65535),
    security: z.enum(['starttls', 'tls']),
    username: z.string().trim().max(200),
    password: z.string().max(500).nullable().optional(),
    from: z.union([emailAddress, z.literal('')]),
    recipients: z.array(emailAddress).max(20),
  })
  .strict();

export const notificationSettingsInput = z
  .object({
    revision: z.number().int().positive(),
    telegram: z
      .object({
        enabled: z.boolean(),
        chatId: z.string().trim().max(100),
        botToken: z.string().trim().max(200).nullable().optional(),
      })
      .strict(),
    pushover: z
      .object({
        enabled: z.boolean(),
        userKey: z.string().trim().max(100),
        appToken: z.string().trim().max(200).nullable().optional(),
      })
      .strict(),
    email: emailInput.optional(),
    discord: z
      .object({
        enabled: z.boolean(),
        webhookUrl: z
          .string()
          .trim()
          .max(1000)
          .refine(
            (value) => !value || validDiscordWebhookUrl(value),
            'Enter a Discord channel webhook URL.',
          )
          .nullable()
          .optional(),
      })
      .strict()
      .optional(),
    eventTypes: z
      .array(eventTypeSchema)
      .max(deviceEventTypes.length)
      .nullable()
      .optional(),
    deviceKeys: z.array(z.string().max(500)).max(200).nullable().optional(),
    dashboardAlarms: z.boolean().optional(),
    dashboardIds: z.array(z.string().uuid()).max(500).nullable().optional(),
  })
  .strict();

export type NotificationSettings = {
  telegram: { enabled: boolean; chatId: string; botToken: string };
  pushover: { enabled: boolean; userKey: string; appToken: string };
  email: {
    enabled: boolean;
    host: string;
    port: number;
    security: 'starttls' | 'tls';
    username: string;
    password: string;
    from: string;
    recipients: string[];
  };
  discord: { enabled: boolean; webhookUrl: string };
  eventTypes: DeviceEventType[] | null;
  deviceKeys: string[] | null;
  dashboardAlarms: boolean;
  dashboardIds: string[] | null;
  enabledAtMs: number;
};

export const defaultNotificationSettings: NotificationSettings = {
  telegram: { enabled: false, chatId: '', botToken: '' },
  pushover: { enabled: false, userKey: '', appToken: '' },
  email: {
    enabled: false,
    host: '',
    port: 587,
    security: 'starttls',
    username: '',
    password: '',
    from: '',
    recipients: [],
  },
  discord: { enabled: false, webhookUrl: '' },
  eventTypes: null,
  deviceKeys: null,
  dashboardAlarms: true,
  dashboardIds: null,
  enabledAtMs: 0,
};

export function publicNotificationSettings(
  settings: NotificationSettings,
  revision: number,
) {
  return {
    revision,
    telegram: {
      enabled: settings.telegram.enabled,
      chatId: settings.telegram.chatId,
      configured: Boolean(settings.telegram.botToken),
    },
    pushover: {
      enabled: settings.pushover.enabled,
      userKey: settings.pushover.userKey,
      configured: Boolean(settings.pushover.appToken),
    },
    email: {
      enabled: settings.email.enabled,
      host: settings.email.host,
      port: settings.email.port,
      security: settings.email.security,
      username: settings.email.username,
      from: settings.email.from,
      recipients: settings.email.recipients,
      configured: Boolean(
        settings.email.host &&
        settings.email.from &&
        settings.email.recipients.length &&
        (!settings.email.username || settings.email.password),
      ),
      passwordSaved: Boolean(settings.email.password),
    },
    discord: {
      enabled: settings.discord.enabled,
      configured: Boolean(settings.discord.webhookUrl),
    },
    eventTypes: settings.eventTypes,
    deviceKeys: settings.deviceKeys,
    dashboardAlarms: settings.dashboardAlarms,
    dashboardIds: settings.dashboardIds,
  };
}
