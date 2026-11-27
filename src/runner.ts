import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { EventLog } from "./parsers.ts";

export type CommandRequest = {
  bin: string;
  args: string[];
  directory: string;
  log: EventLog;
  timeoutMs: number;
  onOutput?: (text: string) => void;
};
export type RunResult = { exitCode: number | null; output: string; finalText: string };

// Process group ids of the commands that are running now.
const running = new Set<number>();

/** Kills every running command and what it started. Agents run in their own process group, so Ctrl-C doesn't reach them. */
export function killAllRuns(): void {
  for (const pid of running) killGroup(pid);
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

/**
 * Runs an agent command in the given directory. Returns a readable log (also streamed
 * through onOutput) and the agent's final message. Kills the command after timeoutMs.
 */
export const runCommand = ({ bin, args, directory, log, timeoutMs, onOutput }: CommandRequest): Promise<RunResult> =>
  new Promise((resolve, reject) => {
    // No shell is involved, so expand "~" ourselves.
    const cwd = directory.replace(/^~(?=$|\/)/, homedir());
    // Node reports a missing cwd as "spawn <bin> ENOENT", which looks like the agent is missing. Say what's wrong.
    if (!existsSync(cwd)) return reject(new Error(`Working directory does not exist: ${cwd}`));

    // Own process group (detached), so a timeout can kill the agent and every command it started.
    const child = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let output = "";
    const emit = (text: string) => {
      if (!text) return;
      output += text;
      onOutput?.(text);
    };

    const pid = child.pid;
    if (pid) running.add(pid);
    const timer = setTimeout(() => {
      emit("\n[killed: the run took longer than the max run time]\n");
      killGroup(pid!);
    }, timeoutMs);

    // Decode as UTF-8 per stream, so a character split across two chunks stays intact.
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => emit(log.push(chunk)));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => emit(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (pid) running.delete(pid);
      emit(log.end());
      resolve({ exitCode, output, finalText: log.finalText });
    });
  });
