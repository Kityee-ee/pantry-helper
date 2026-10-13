// Week helpers. A week is identified by its Monday as a "YYYY-MM-DD" string,
// which is what the `week_start` date columns hold.
//
// "Today" is evaluated in APP_TIME_ZONE so the server (often UTC) and the
// office agree on which week it is.
//
// Cache Components note: these read the current time. In a Server Component,
// call them only after a request-time read (e.g. `await requireUser()`), never
// at module scope or in a prerendered component.

export const APP_TIME_ZONE = process.env.APP_TIME_ZONE ?? "Australia/Sydney";

/** Calendar date of "now" in the app time zone, "YYYY-MM-DD". */
export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Add (or subtract) whole days to a "YYYY-MM-DD" date. */
export function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing the given "YYYY-MM-DD" date. */
export function weekStartOf(dateISO: string): string {
  const dow = new Date(`${dateISO}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(dateISO, -((dow + 6) % 7));
}

/** Monday of the current week. */
export function thisWeekStart(now: Date = new Date()): string {
  return weekStartOf(todayISO(now));
}

/** Monday of last week. */
export function lastWeekStart(now: Date = new Date()): string {
  return addDays(thisWeekStart(now), -7);
}

/** Monday of next week (the week the next order supplies). */
export function nextWeekStart(now: Date = new Date()): string {
  return addDays(thisWeekStart(now), 7);
}

/** "Mon 12 Oct" style label for a "YYYY-MM-DD" date. */
export function formatDay(dateISO: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${dateISO}T00:00:00Z`));
}

/** "Week of 12 Oct" label for a week_start. */
export function formatWeek(weekStart: string): string {
  const label = new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(new Date(`${weekStart}T00:00:00Z`));
  return `Week of ${label}`;
}
