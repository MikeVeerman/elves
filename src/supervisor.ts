import type { Store, RunResult } from "./store.ts";
import type { RunAgent } from "./agents.ts";
import type { RunResult as AgentResult } from "./runner.ts";
import type { LiveRuns } from "./live.ts";
import { nextRuns } from "./schedule.ts";

export const NO_TASK_MARKER = "NO_TASK_AVAILABLE";

export function buildPrompt(factoryPrompt: string): string {
  return `${factoryPrompt}

If there is no task to pick up, do nothing and end your reply with exactly ${NO_TASK_MARKER} on its own line.`;
}

export function classify(result: Pick<AgentResult, "exitCode" | "finalText">): RunResult["status"] {
  const finalText = result.finalText.trim();
  // No final message means something went wrong, even with exit code 0. Counting that as
  // "done" would make the elf run again straight away, over and over.
  if (result.exitCode !== 0 || !finalText) return "failed";
  return finalText.endsWith(NO_TASK_MARKER) ? "idle" : "done";
}

export type Status =
  | { state: "stopped" }
  | { state: "working" }
  | { state: "stopping" }
  | { state: "sleeping"; until: Date };

type Options = {
  store: Store;
  live: LiveRuns;
  runAgent: RunAgent;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** The clock, in ms. Tests pass a fake one. */
  now?: () => number;
};

// Timers can't wait longer than ~24.8 days, and long waits drift. Timed elves sleep a day at most at a time.
const MAX_SLEEP_MS = 24 * 60 * 60_000;

type LoopState = { phase: "working"; abort: AbortController } | { phase: "sleeping"; until: Date; wake: AbortController };

/**
 * Runs one loop per enabled factory.
 * Loop elves: run the agent, record the run, nap when there was nothing to do.
 * Timed elves: wait for the next time on the schedule, run once, repeat.
 */
export class Supervisor {
  private loops = new Map<number, LoopState>();
  private options: Options;

  constructor(options: Options) {
    this.options = options;
  }

  /** On server start: clean up runs from the last process and restart enabled factories. */
  resume(): void {
    this.options.store.markUnfinishedRunsInterrupted();
    for (const factory of this.options.store.listFactories()) {
      if (factory.enabled) this.start(factory.id);
    }
  }

  start(factoryId: number): void {
    this.options.store.setEnabled(factoryId, true);
    if (!this.loops.has(factoryId)) void this.loop(factoryId);
  }

  stop(factoryId: number): void {
    this.options.store.setEnabled(factoryId, false);
    const state = this.loops.get(factoryId);
    if (state?.phase === "sleeping") state.wake.abort();
  }

  /** Stop now: kills the agent of the current run instead of letting it finish. */
  forceStop(factoryId: number): void {
    this.stop(factoryId);
    const state = this.loops.get(factoryId);
    if (state?.phase === "working") state.abort.abort();
  }

  /** A timed elf that is waiting recalculates its next run, so a new schedule applies right away. */
  settingsChanged(factoryId: number): void {
    const state = this.loops.get(factoryId);
    if (state?.phase === "sleeping" && this.options.store.getFactory(factoryId)?.kind === "timed") state.wake.abort();
  }

  status(factoryId: number): Status {
    const state = this.loops.get(factoryId);
    if (!state) return { state: "stopped" };
    if (state.phase === "sleeping") return { state: "sleeping", until: state.until };
    return this.isEnabled(factoryId) ? { state: "working" } : { state: "stopping" };
  }

  private async loop(factoryId: number): Promise<void> {
    const { store, sleep } = this.options;

    while (this.isEnabled(factoryId)) {
      const factory = store.getFactory(factoryId)!;

      if (factory.kind === "timed") {
        const due = nextRuns(factory.schedule, 1, new Date(this.now()))[0];
        if (await this.sleepUntil(factoryId, due)) await this.work(factoryId);
        continue;
      }

      const status = await this.work(factoryId);
      if (status !== "done" && this.isEnabled(factoryId)) {
        const idleDelayMs = factory.idleMinutes * 60_000;
        const wake = new AbortController();
        this.loops.set(factoryId, { phase: "sleeping", until: new Date(this.now() + idleDelayMs), wake });
        await sleep(idleDelayMs, wake.signal);
      }
    }

    this.loops.delete(factoryId);
  }

  private work(factoryId: number): Promise<RunResult["status"]> {
    const abort = new AbortController();
    this.loops.set(factoryId, { phase: "working", abort });
    return this.runOnce(factoryId, abort.signal);
  }

  /** True when the time came; false when the elf was stopped or woken early (e.g. a new schedule). */
  private async sleepUntil(factoryId: number, due: Date): Promise<boolean> {
    while (this.isEnabled(factoryId)) {
      const left = due.getTime() - this.now();
      if (left <= 0) return true;
      const wake = new AbortController();
      this.loops.set(factoryId, { phase: "sleeping", until: due, wake });
      await this.options.sleep(Math.min(left, MAX_SLEEP_MS), wake.signal);
      if (wake.signal.aborted) return false;
    }
    return false;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private async runOnce(factoryId: number, signal: AbortSignal): Promise<RunResult["status"]> {
    const { store, live, runAgent } = this.options;
    const factory = store.getFactory(factoryId)!;
    const runId = store.startRun(factoryId);
    live.start(runId);

    let result: RunResult;
    try {
      const run = await runAgent({
        agent: factory.agent,
        model: factory.model,
        // A timed elf isn't working through a backlog, so it doesn't need the "no task" instruction.
        prompt: factory.kind === "loop" ? buildPrompt(factory.prompt) : factory.prompt,
        directory: factory.directory,
        timeoutMs: factory.maxRunMinutes * 60_000,
        signal,
        onOutput: (text) => live.append(runId, text),
      });
      result = { status: signal.aborted ? "interrupted" : classify(run), exitCode: run.exitCode, output: run.output };
    } catch (error) {
      result = { status: "failed", exitCode: null, output: (error as Error).message };
    }

    // Save first, so a watcher that reloads on "end" finds the finished run.
    store.finishRun(runId, result);
    live.finish(runId);
    return result.status;
  }

  private isEnabled(factoryId: number): boolean {
    return this.options.store.getFactory(factoryId)?.enabled ?? false;
  }
}
