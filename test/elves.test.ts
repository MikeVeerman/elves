import { describe, it, expect } from "vitest";
import { elf, moodFor, SPRITE } from "../src/elves.ts";

const svg = async (mood: Parameters<typeof elf>[0], size?: number) => String(await elf(mood, size));

describe("SPRITE", () => {
  it("has rows of equal width", () => {
    const widths = new Set(SPRITE.map((row) => row.length));
    expect(widths.size).toBe(1);
  });
});

describe("elf", () => {
  it("draws crisp pixels as an SVG", async () => {
    const out = await svg("off");

    expect(out).toMatch(/^<svg/);
    expect(out).toContain('shape-rendering="crispEdges"');
    expect(out).toContain("<rect");
  });

  it("uses the requested size", async () => {
    expect(await svg("off", 96)).toContain('height="96"');
  });

  it("swings a hammer when working, in two frames", async () => {
    const out = await svg("working");

    expect(out).toContain('class="elf elf-working"');
    expect(out).toContain('class="frame-up"');
    expect(out).toContain('class="frame-down"');
  });

  it("snores when sleeping", async () => {
    const out = await svg("sleeping");

    expect(out).toContain('class="elf elf-sleeping"');
    expect(out).toContain(">z</text>");
  });

  it("is greyed out when off", async () => {
    expect(await svg("off")).toContain('class="elf elf-off"');
  });

  it("hides the drawing from screen readers but gives it a label", async () => {
    expect(await svg("sleeping")).toContain('role="img" aria-label="Sleeping elf"');
  });
});

describe("moodFor", () => {
  it("maps each factory status to an elf mood", () => {
    expect(moodFor({ state: "working" })).toBe("working");
    expect(moodFor({ state: "stopping" })).toBe("working");
    expect(moodFor({ state: "sleeping", until: new Date() })).toBe("sleeping");
    expect(moodFor({ state: "stopped" })).toBe("off");
  });
});
