import { PiLog, ClaudeLog, CodexLog, OpencodeLog, type EventLog } from "./parsers.ts";
import { runCommand, type RunResult } from "./runner.ts";

export const AGENTS = ["pi", "claude", "codex", "opencode"] as const;
export type AgentName = (typeof AGENTS)[number];

export type AgentRequest = {
  agent: AgentName;
  model: string;
  prompt: string;
  directory: string;
  timeoutMs: number;
  onOutput?: (text: string) => void;
};
export type RunAgent = (request: AgentRequest) => Promise<RunResult>;

export const runAgent: RunAgent = ({ agent, model, prompt, ...rest }) =>
  runCommand({ ...agentCommand(agent, prompt, model), log: createLog(agent), ...rest });

/**
 * The command line that runs an agent once, without a human in the loop.
 * Every agent gets full access (no permission prompts), like pi has by default:
 * nobody is there to answer a prompt, so a factory would stall otherwise.
 */
export function agentCommand(agent: AgentName, prompt: string, model: string): { bin: string; args: string[] } {
  const modelArgs = model ? ["--model", model] : [];
  switch (agent) {
    case "pi":
      return { bin: "pi", args: ["--mode", "json", ...modelArgs, "-p", prompt] };
    case "claude":
      return {
        bin: "claude",
        args: ["-p", prompt, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", ...modelArgs],
      };
    case "codex":
      return {
        bin: "codex",
        args: ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", ...modelArgs, prompt],
      };
    case "opencode":
      return { bin: "opencode", args: ["run", "--format", "json", ...modelArgs, prompt] };
  }
}

export function createLog(agent: AgentName): EventLog {
  switch (agent) {
    case "pi":
      return new PiLog();
    case "claude":
      return new ClaudeLog();
    case "codex":
      return new CodexLog();
    case "opencode":
      return new OpencodeLog();
  }
}
