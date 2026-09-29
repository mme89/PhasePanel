import { omitRetiredTiles } from './legacyDashboard.js';
import { z } from 'zod';
import { dashboardInput, type Dashboard } from './model.js';

export const MAX_DASHBOARD_FILE_BYTES = 4 * 1024 * 1024;
const exportSchema = z
  .object({
    format: z.literal('gridvis-dashboard'),
    version: z.literal(1),
    dashboard: dashboardInput,
  })
  .strict();
const bundleSchema = z
  .object({
    format: z.literal('gridvis-dashboard-bundle'),
    version: z.literal(1),
    dashboards: z.array(dashboardInput).min(2).max(500),
  })
  .strict();

function portableDashboard(dashboard: Dashboard) {
  const { id: _, revision: __, updatedAt: ___, ...config } = dashboard;
  return config;
}

export function exportDashboard(dashboard: Dashboard): string {
  return (
    JSON.stringify(
      exportSchema.parse({
        format: 'gridvis-dashboard',
        version: 1,
        dashboard: portableDashboard(dashboard),
      }),
      null,
      2,
    ) + '\n'
  );
}

export function exportDashboards(dashboards: Dashboard[]): string {
  if (dashboards.length === 1) return exportDashboard(dashboards[0]);
  return (
    JSON.stringify(
      bundleSchema.parse({
        format: 'gridvis-dashboard-bundle',
        version: 1,
        dashboards: dashboards.map(portableDashboard),
      }),
      null,
      2,
    ) + '\n'
  );
}

export function importDashboards(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }
  if (value && typeof value === 'object' && 'dashboard' in value) {
    value = { ...value, dashboard: omitRetiredTiles(value.dashboard) };
  } else if (
    value &&
    typeof value === 'object' &&
    'dashboards' in value &&
    Array.isArray(value.dashboards)
  ) {
    value = {
      ...value,
      dashboards: value.dashboards.map(omitRetiredTiles),
    };
  }
  const single = exportSchema.safeParse(value);
  if (single.success) return [single.data.dashboard];
  const bundle = bundleSchema.safeParse(value);
  if (bundle.success) return bundle.data.dashboards;
  throw new Error(
    'Invalid or unsupported dashboard file. Select a version 1 PhasePanel dashboard export.',
  );
}

export function importDashboard(text: string) {
  const dashboards = importDashboards(text);
  if (dashboards.length !== 1)
    throw new Error('This file contains multiple dashboards.');
  return dashboards[0];
}
