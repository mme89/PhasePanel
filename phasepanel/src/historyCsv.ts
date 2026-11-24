const formulaPrefix = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number')
    return Number.isFinite(value) ? String(value) : '';
  const safe = formulaPrefix.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
