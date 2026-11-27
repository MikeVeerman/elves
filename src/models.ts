import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentName } from "./agents.ts";

export type ModelLists = Record<AgentName, string[]>;

// Claude Code has no command that lists models.
export const CLAUDE_MODELS = ["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

/** `pi --list-models` prints a table: provider, model, ... */
export function parsePiModels(output: string): string[] {
  return output
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((columns) => columns.length >= 2)
    .map(([provider, model]) => `${provider}/${model}`);
}

/** `opencode models` prints one provider/model per line. */
export function parseOpencodeModels(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Codex keeps the models it can use in ~/.codex/models_cache.json. */
export function parseCodexModels(json: string): string[] {
  return (JSON.parse(json).models as { slug: string }[]).map((m) => m.slug);
}

type Deps = {
  run: (bin: string, args: string[]) => Promise<string>;
  readFile: (path: string) => Promise<string>;
};

const defaultDeps: Deps = {
  run: async (bin, args) => (await promisify(execFile)(bin, args, { timeout: 30_000 })).stdout,
  readFile: (path) => readFile(path, "utf8"),
};

/**
 * Reads the models each agent offers. An agent whose list can't be read gets an empty list
 * (the factory screen then only offers "agent default"), and the reason is logged.
 */
export async function loadModels(deps: Deps = defaultDeps): Promise<ModelLists> {
  const attempt = async (agent: string, read: () => Promise<string[]>) => {
    try {
      return await read();
    } catch (error) {
      console.warn(`Could not list models for ${agent}:`, (error as Error).message);
      return [];
    }
  };

  const [pi, codex, opencode] = await Promise.all([
    attempt("pi", async () => parsePiModels(await deps.run("pi", ["--list-models"]))),
    attempt("codex", async () => parseCodexModels(await deps.readFile(join(homedir(), ".codex", "models_cache.json")))),
    attempt("opencode", async () => parseOpencodeModels(await deps.run("opencode", ["models"]))),
  ]);
  return { pi, claude: CLAUDE_MODELS, codex, opencode };
}
