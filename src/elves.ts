import { raw } from "hono/html";
import type { Status } from "./supervisor.ts";

export type Mood = "working" | "sleeping" | "off";

const PALETTE: Record<string, string> = {
  B: "#ffd34d", // bell
  H: "#2e8b57", // hat
  h: "#1f5f3b", // hat brim
  S: "#f2c9a0", // skin
  E: "#2b2b2b", // eye
  C: "#b57f5a", // closed eye
  M: "#d9776a", // mouth
  R: "#c0392b", // tunic
  r: "#8e2a20", // tunic hem
  W: "#3b2a1a", // belt
  G: "#ffd34d", // buckle
  L: "#2e8b57", // legs
  K: "#5a3a1a", // boots
  T: "#8b5a2b", // hammer handle
  I: "#9aa3ad", // hammer head
  A: "#4a4f57", // anvil
};

/** The elf, 18 x 16 pixels. "." is transparent. The right side leaves room for the hammer and anvil. */
export const SPRITE = [
  ".........B........",
  "........HH........",
  ".......HHHH.......",
  "......HHHHH.......",
  ".....HHHHHH.......",
  "....hhhhhhhh......",
  "....SSSSSSSS......",
  "..SSSESSSSESSS....",
  "....SSSMMSSS......",
  ".....SSSSSS.......",
  "....RRRRRRRR......",
  "...SRRRRRRRRS.....",
  "....WWWGWWWW......",
  "....rrrrrrrr......",
  ".....LL..LL.......",
  "....KKK..KKK......",
];

const ANVIL = ["..............AAAA", "...............AA.", "..............AAAA"];

// Hammer raised above the right hand, and hammer down on the anvil: [x, y, color].
const HAMMER_UP: [number, number, string][] = [
  [13, 11, "T"], [14, 10, "T"], [14, 9, "T"], [14, 8, "T"], [14, 7, "T"], [13, 6, "I"], [14, 6, "I"], [15, 6, "I"],
  [13, 5, "I"], [14, 5, "I"], [15, 5, "I"],
];
const HAMMER_DOWN: [number, number, string][] = [
  [13, 11, "T"], [14, 11, "T"], [15, 11, "T"], [16, 10, "I"], [16, 11, "I"], [16, 12, "I"], [17, 10, "I"],
  [17, 11, "I"], [17, 12, "I"],
];

const LABELS: Record<Mood, string> = { working: "Working elf", sleeping: "Sleeping elf", off: "Elf off duty" };

export function moodFor(status: Status): Mood {
  if (status.state === "sleeping") return "sleeping";
  if (status.state === "stopped") return "off";
  return "working";
}

/** A pixel-art elf as inline SVG. The animations live in the page's CSS (.elf-working, .elf-sleeping). */
export function elf(mood: Mood, size = 48) {
  const sprite = mood === "sleeping" ? SPRITE.map((row) => row.replaceAll("E", "C")) : SPRITE;
  const parts = [pixels(sprite)];

  if (mood === "working") {
    parts.push(pixels(ANVIL, 13));
    parts.push(`<g class="frame-up">${points(HAMMER_UP)}</g>`, `<g class="frame-down">${points(HAMMER_DOWN)}</g>`);
  }
  if (mood === "sleeping") {
    parts.push(`<text class="z" x="13" y="6">z</text>`, `<text class="z z2" x="15" y="3">z</text>`);
  }

  return raw(
    `<svg class="elf elf-${mood}" role="img" aria-label="${LABELS[mood]}" viewBox="0 0 18 16" ` +
      `width="${Math.round((size * 18) / 16)}" height="${size}" shape-rendering="crispEdges">${parts.join("")}</svg>`,
  );
}

function pixels(rows: string[], top = 0): string {
  return rows
    .flatMap((row, y) => [...row].map((c, x) => (c === "." ? "" : rect(x, y + top, c))))
    .join("");
}

function points(list: [number, number, string][]): string {
  return list.map(([x, y, c]) => rect(x, y, c)).join("");
}

function rect(x: number, y: number, color: string): string {
  return `<rect x="${x}" y="${y}" width="1" height="1" fill="${PALETTE[color]}"/>`;
}
