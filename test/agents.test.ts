import { describe, it, expect } from "vitest";
import { agentCommand, createLog, AGENTS } from "../src/agents.ts";
import { PiLog, ClaudeLog, CodexLog, OpencodeLog } from "../src/parsers.ts";

describe("agentCommand", () => {
  it("runs pi in JSON print mode", () => {
    expect(agentCommand("pi", "do it", "")).toEqual({ bin: "pi", args: ["--mode", "json", "-p", "do it"] });
    expect(agentCommand("pi", "do it", "framework-ai/deepseek").args).toEqual([
      "--mode", "json", "--model", "framework-ai/deepseek", "-p", "do it",
    ]);
  });

  it("runs claude headless with streamed JSON and no permission prompts", () => {
    expect(agentCommand("claude", "do it", "")).toEqual({
      bin: "claude",
      args: ["-p", "do it", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"],
    });
    expect(agentCommand("claude", "do it", "claude-opus-5-5").args).toContain("--model");
    expect(agentCommand("claude", "do it", "claude-opus-5-5").args).toContain("claude-opus-5-5");
  });

  it("runs codex exec with JSON events and no approval prompts", () => {
    expect(agentCommand("codex", "do it", "")).toEqual({
      bin: "codex",
      args: ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "do it"],
    });
    expect(agentCommand("codex", "do it", "gpt-6.2-sol").args).toEqual([
      "exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check",
      "--model", "gpt-6.2-sol", "do it",
    ]);
  });

  it("runs opencode with JSON output", () => {
    expect(agentCommand("opencode", "do it", "")).toEqual({ bin: "opencode", args: ["run", "--format", "json", "do it"] });
    expect(agentCommand("opencode", "do it", "opencode/big-pickle").args).toEqual([
      "run", "--format", "json", "--model", "opencode/big-pickle", "do it",
    ]);
  });
});

describe("createLog", () => {
  it("picks the parser that matches the agent", () => {
    expect(createLog("pi")).toBeInstanceOf(PiLog);
    expect(createLog("claude")).toBeInstanceOf(ClaudeLog);
    expect(createLog("codex")).toBeInstanceOf(CodexLog);
    expect(createLog("opencode")).toBeInstanceOf(OpencodeLog);
  });

  it("covers every agent", () => {
    expect(AGENTS).toEqual(["pi", "claude", "codex", "opencode"]);
  });
});
