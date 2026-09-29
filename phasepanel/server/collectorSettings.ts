import { z } from 'zod';

export const collectorSettingsSchema = z
  .object({
    intervalSeconds: z.number().int().min(1).max(3600),
    eventIntervalMinutes: z.number().int().min(1).max(1440).default(30),
    retentionDays: z.number().int().min(1).max(35),
  })
  .strict();

export type CollectorSettings = z.infer<typeof collectorSettingsSchema>;

export const defaultCollectorSettings: CollectorSettings = {
  intervalSeconds: 5,
  eventIntervalMinutes: 30,
  retentionDays: 7,
};

const legacyCollectorSettingsSchema = z
  .object({
    intervalSeconds: z.number().int().min(1).max(3600),
    retentionHours: z.number().int().min(1).max(168),
  })
  .strict();

export function parseStoredCollectorSettings(raw: unknown, revision: number) {
  if (raw && typeof raw === 'object' && 'retentionHours' in raw) {
    const legacy = legacyCollectorSettingsSchema.parse(raw);
    return {
      settings: collectorSettingsSchema.parse({
        intervalSeconds: legacy.intervalSeconds,
        retentionDays:
          revision === 1
            ? defaultCollectorSettings.retentionDays
            : Math.ceil(legacy.retentionHours / 24),
      }),
      migrated: true,
    };
  }
  const settings = collectorSettingsSchema.parse(raw);
  const previousDefault = revision === 1 && settings.eventIntervalMinutes === 5;
  const missingInterval =
    raw !== null && typeof raw === 'object' && !('eventIntervalMinutes' in raw);
  return {
    settings: previousDefault
      ? {
          ...settings,
          eventIntervalMinutes: defaultCollectorSettings.eventIntervalMinutes,
        }
      : settings,
    migrated: previousDefault || missingInterval,
  };
}

export const collectorSettingsInput = collectorSettingsSchema.extend({
  revision: z.number().int().positive(),
});
