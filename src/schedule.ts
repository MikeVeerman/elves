import { Cron } from "croner";
import cronstrue from "cronstrue";

/**
 * Timed elves run on a cron schedule. People pick a schedule from simple choices
 * ("weekdays at 07:45"); this module turns those choices into a cron expression and back.
 */
export const REPEATS = ["minutes", "hourly", "daily", "weekdays", "weekly", "monthly", "custom"] as const;
export type Repeat = (typeof REPEATS)[number];

export type ScheduleForm = {
  repeat: Repeat;
  /** For "minutes": every N minutes. */
  everyMinutes: number;
  /** For "hourly": at this minute past the hour. */
  minute: number;
  /** For daily, weekdays, weekly and monthly: "HH:MM", 24-hour clock. */
  time: string;
  /** For "weekly": 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  /** For "monthly": day of the month. */
  monthDay: number;
  /** For "custom": the cron expression itself. */
  cron: string;
};

export const DEFAULT_SCHEDULE_FORM: ScheduleForm = {
  repeat: "daily",
  everyMinutes: 15,
  minute: 0,
  time: "09:00",
  weekday: 1,
  monthDay: 1,
  cron: "0 9 * * *",
};

/** The cron expression for the chosen options, or undefined when an option is out of range. */
export function toCron(form: ScheduleForm): string | undefined {
  const time = parseTime(form.time);
  const within = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;

  const cron = (() => {
    switch (form.repeat) {
      case "minutes":
        return within(form.everyMinutes, 1, 59) ? `*/${form.everyMinutes} * * * *` : undefined;
      case "hourly":
        return within(form.minute, 0, 59) ? `${form.minute} * * * *` : undefined;
      case "daily":
        return time && `${time.minute} ${time.hour} * * *`;
      case "weekdays":
        return time && `${time.minute} ${time.hour} * * 1-5`;
      case "weekly":
        return time && within(form.weekday, 0, 6) ? `${time.minute} ${time.hour} * * ${form.weekday}` : undefined;
      case "monthly":
        return time && within(form.monthDay, 1, 31) ? `${time.minute} ${time.hour} ${form.monthDay} * *` : undefined;
      case "custom":
        return form.cron.trim().replace(/\s+/g, " ");
    }
  })();
  return cron && isValidCron(cron) ? cron : undefined;
}

/** The options that produce this expression; "custom" when it isn't one of the simple patterns. */
export function fromCron(cron: string): ScheduleForm {
  const base = { ...DEFAULT_SCHEDULE_FORM, cron };
  const time = (minute: string, hour: string) => `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  let m;
  if ((m = cron.match(/^\*\/(\d+) \* \* \* \*$/))) return { ...base, repeat: "minutes", everyMinutes: Number(m[1]) };
  if ((m = cron.match(/^(\d+) \* \* \* \*$/))) return { ...base, repeat: "hourly", minute: Number(m[1]) };
  if ((m = cron.match(/^(\d+) (\d+) \* \* \*$/))) return { ...base, repeat: "daily", time: time(m[1], m[2]) };
  if ((m = cron.match(/^(\d+) (\d+) \* \* 1-5$/))) return { ...base, repeat: "weekdays", time: time(m[1], m[2]) };
  if ((m = cron.match(/^(\d+) (\d+) \* \* (\d)$/))) {
    return { ...base, repeat: "weekly", time: time(m[1], m[2]), weekday: Number(m[3]) };
  }
  if ((m = cron.match(/^(\d+) (\d+) (\d+) \* \*$/))) {
    return { ...base, repeat: "monthly", time: time(m[1], m[2]), monthDay: Number(m[3]) };
  }
  return { ...base, repeat: "custom" };
}

/** Five parts (minute hour day month weekday) that croner accepts. */
export function isValidCron(cron: string): boolean {
  if (cron.trim().split(/\s+/).length !== 5) return false;
  try {
    new Cron(cron, { paused: true });
    return true;
  } catch {
    return false;
  }
}

export function describeCron(cron: string): string {
  return cronstrue.toString(cron, { use24HourTimeFormat: true });
}

/** The next times the schedule fires after `from`, in the server's local time. */
export function nextRuns(cron: string, count: number, from = new Date()): Date[] {
  return new Cron(cron, { paused: true }).nextRuns(count, from);
}

function parseTime(time: string): { hour: number; minute: number } | undefined {
  const m = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const [hour, minute] = [Number(m[1]), Number(m[2])];
  return hour <= 23 && minute <= 59 ? { hour, minute } : undefined;
}
