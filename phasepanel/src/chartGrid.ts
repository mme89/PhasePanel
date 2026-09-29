const TIME_STEPS = [
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10_800, 21_600,
  43_200, 86_400, 172_800, 432_000,
].map((seconds) => seconds * 1000);

export function timeGrid(start: number, end: number) {
  const duration = end - start;
  const majorStep =
    TIME_STEPS.find((step) => step >= duration / 7) ??
    TIME_STEPS[TIME_STEPS.length - 1];
  const minorStep = majorStep / 10;
  const ticks: { time: number; major: boolean }[] = [];
  for (
    let index = Math.ceil(start / minorStep);
    index * minorStep <= end;
    index++
  ) {
    const time = index * minorStep;
    ticks.push({ time, major: index % 10 === 0 });
  }
  return ticks;
}

export function timeGridLabel(time: number, duration: number) {
  const date = new Date(time);
  if (duration < 2 * 60_000) return date.toLocaleTimeString();
  if (duration < 86_400_000)
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  if (duration < 2 * 86_400_000)
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
