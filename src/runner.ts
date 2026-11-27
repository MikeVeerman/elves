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
  /** After the stop request at timeout, how long to wait before force-killing. */
  killGraceMs?: number;
  /** Aborting it stops the command right away (force stop). */
  signal?: AbortSignal;
  onOutput?: (text: string) => void;
};
export type RunResult = { exitCode: number | null; output: string; finalText: string };

// Process group ids of the commands that are running now.
const running = new Set<number>();

/** Kills every running command and what it started. Agents run in their own process group, so Ctrl-C doesn't reach them. */
export function killAllRuns(): void {
  for (const pid of running) killGroup(pid);
}

function killGroup(pid: number, signal: NodeJS.Signals = "SIGTERM"): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
}

/** "~" means the home directory. No shell is involved, so we expand it ourselves. */
export function expandHome(directory: string): string {
  return directory.replace(/^~(?=$|\/)/, homedir());
}

/**
 * Runs an agent command in the given directory. Returns a readable log (also streamed
 * through onOutput) and the agent's final message. Kills the command after timeoutMs.
 */
export const runCommand = ({
  bin,
  args,
  directory,
  log,
  timeoutMs,
  killGraceMs = 5000,
  signal,
  onOutput,
}: CommandRequest): Promise<RunResult> =>
  new Promise((resolve, reject) => {
    const cwd = expandHome(directory);
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
    let forceKill: NodeJS.Timeout | undefined;
    const stop = (reason: string) => {
      emit(`\n[${reason}]\n`);
      killGroup(pid!);
      // An agent may ignore the stop request. Then it doesn't get a choice.
      forceKill = setTimeout(() => killGroup(pid!, "SIGKILL"), killGraceMs);
    };
    const timer = setTimeout(() => stop("killed: the run took longer than the max run time"), timeoutMs);
    const onAbort = () => stop("force stopped");
    signal?.addEventListener("abort", onAbort, { once: true });

    // Decode as UTF-8 per stream, so a character split across two chunks stays intact.
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => emit(log.push(chunk)));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => emit(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      clearTimeout(forceKill);
      signal?.removeEventListener("abort", onAbort);
      if (pid) running.delete(pid);
      emit(log.end());
      resolve({ exitCode, output, finalText: log.finalText });
    });
  });
