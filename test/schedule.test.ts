import { describe, it, expect } from "vitest";
import {
  toCron,
  fromCron,
  isValidCron,
  describeCron,
  nextRuns,
  DEFAULT_SCHEDULE_FORM,
  type ScheduleForm,
} from "../src/schedule.ts";

const form = (overrides: Partial<ScheduleForm>): ScheduleForm => ({ ...DEFAULT_SCHEDULE_FORM, ...overrides });

describe("toCron", () => {
  it.each([
    ["every 15 minutes", { repeat: "minutes", everyMinutes: 15 }, "*/15 * * * *"],
    ["every hour at minute 30", { repeat: "hourly", minute: 30 }, "30 * * * *"],
    ["every day at 09:00", { repeat: "daily", time: "09:00" }, "0 9 * * *"],
    ["weekdays at 07:45", { repeat: "weekdays", time: "07:45" }, "45 7 * * 1-5"],
    ["every Sunday at 18:00", { repeat: "weekly", weekday: 0, time: "18:00" }, "0 18 * * 0"],
    ["on the 1st of every month at 06:30", { repeat: "monthly", monthDay: 1, time: "06:30" }, "30 6 1 * *"],
    ["a custom expression", { repeat: "custom", cron: "  0 */2 * * 1-5 " }, "0 */2 * * 1-5"],
  ] as const)("builds %s", (_, overrides, expected) => {
    expect(toCron(form(overrides))).toBe(expected);
  });

  it.each([
    ["minutes out of range", { repeat: "minutes", everyMinutes: 0 }],
    ["minute of the hour out of range", { repeat: "hourly", minute: 60 }],
    ["a malformed time", { repeat: "daily", time: "9am" }],
    ["an hour out of range", { repeat: "daily", time: "24:00" }],
    ["a weekday out of range", { repeat: "weekly", weekday: 7 }],
    ["a day of the month out of range", { repeat: "monthly", monthDay: 32 }],
    ["an invalid custom expression", { repeat: "custom", cron: "every day" }],
  ] as const)("returns undefined for %s", (_, overrides) => {
    expect(toCron(form(overrides))).toBeUndefined();
  });
});

describe("fromCron", () => {
  it.each([
    "*/15 * * * *",
    "30 * * * *",
    "0 9 * * *",
    "45 7 * * 1-5",
    "0 18 * * 0",
    "30 6 1 * *",
  ])("turns %s back into the same choices", (cron) => {
    expect(toCron(fromCron(cron))).toBe(cron);
  });

  it("recognizes the choices behind an expression", () => {
    expect(fromCron("45 7 * * 1-5")).toMatchObject({ repeat: "weekdays", time: "07:45" });
    expect(fromCron("0 18 * * 0")).toMatchObject({ repeat: "weekly", weekday: 0, time: "18:00" });
  });

  it("falls back to custom for anything else", () => {
    expect(fromCron("0 9,17 * * *")).toMatchObject({ repeat: "custom", cron: "0 9,17 * * *" });
  });
});

describe("isValidCron", () => {
  it("accepts a five-part expression", () => {
    expect(isValidCron("0 9 * * 1-5")).toBe(true);
  });

  it.each(["", "every day", "61 * * * *", "0 0 9 * * *"])("rejects %j", (cron) => {
    expect(isValidCron(cron)).toBe(false);
  });
});

describe("describeCron", () => {
  it("says it in words, with a 24-hour clock", () => {
    expect(describeCron("0 9 * * 1-5")).toBe("At 09:00, Monday through Friday");
    expect(describeCron("*/15 * * * *")).toBe("Every 15 minutes");
  });
});

describe("nextRuns", () => {
  it("lists the next times the schedule fires", () => {
    const from = new Date(2026, 10, 27, 12, 0); // Friday 27 Nov 2026, 12:00 local time

    const runs = nextRuns("0 9 * * 1-5", 3, from);

    expect(runs.map((d) => [d.getDate(), d.getHours(), d.getMinutes()])).toEqual([
      [30, 9, 0],
      [1, 9, 0],
      [2, 9, 0],
    ]);
  });
});
