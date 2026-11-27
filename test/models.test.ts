import { describe, it, expect, vi } from "vitest";
import { parsePiModels, parseOpencodeModels, parseCodexModels, loadModels, CLAUDE_MODELS } from "../src/models.ts";

describe("parsePiModels", () => {
  it("turns the table into provider/model ids", () => {
    const output = `provider      model                 context  max-out  thinking  images
framework-ai  deepseek-v4-flash     65.5K    16.4K    yes       no
runpod-l40s   qwen3.8-27b-q8-l40s   131.1K   32.8K    yes       no
`;

    expect(parsePiModels(output)).toEqual(["framework-ai/deepseek-v4-flash", "runpod-l40s/qwen3.8-27b-q8-l40s"]);
  });
});

describe("parseOpencodeModels", () => {
  it("takes one model per line", () => {
    expect(parseOpencodeModels("opencode/big-pickle\n\nanthropic/claude-sonnet-5-5\n")).toEqual([
      "opencode/big-pickle",
      "anthropic/claude-sonnet-5-5",
    ]);
  });
});

describe("parseCodexModels", () => {
  it("takes the slugs from codex's model cache", () => {
    const cache = JSON.stringify({ fetched_at: "x", models: [{ slug: "gpt-6.2-sol" }, { slug: "gpt-6-luna" }] });

    expect(parseCodexModels(cache)).toEqual(["gpt-6.2-sol", "gpt-6-luna"]);
  });
});

describe("loadModels", () => {
  it("asks each agent for its models, and uses a fixed list for claude", async () => {
    const run = vi.fn(async (bin: string) =>
      bin === "pi" ? "provider model\nfw m1\n" : "opencode/big-pickle\n",
    );
    const readFile = vi.fn(async () => JSON.stringify({ models: [{ slug: "gpt-6.2-sol" }] }));

    const models = await loadModels({ run, readFile });

    expect(models).toEqual({
      pi: ["fw/m1"],
      claude: CLAUDE_MODELS,
      codex: ["gpt-6.2-sol"],
      opencode: ["opencode/big-pickle"],
    });
    expect(run).toHaveBeenCalledWith("pi", ["--list-models"]);
    expect(run).toHaveBeenCalledWith("opencode", ["models"]);
  });

  it("gives an empty list for an agent whose models can't be read, and logs why", async () => {
    const run = vi.fn(async () => {
      throw new Error("spawn pi ENOENT");
    });
    const readFile = vi.fn(async () => {
      throw new Error("no such file");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const models = await loadModels({ run, readFile });

    expect(models).toMatchObject({ pi: [], codex: [], opencode: [] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("pi"), expect.anything());
    warn.mockRestore();
  });
});
