import type { Store, RunResult } from "./store.ts";
import type { RunAgent } from "./agents.ts";
import type { RunResult as AgentResult } from "./runner.ts";
import type { LiveRuns } from "./live.ts";

export const NO_TASK_MARKER = "NO_TASK_AVAILABLE";

export function buildPrompt(factoryPrompt: string): string {
  return `${factoryPrompt}

If there is no task to pick up, do nothing and end your reply with exactly ${NO_TASK_MARKER} on its own line.`;
}

export function classify(result: Pick<AgentResult, "exitCode" | "finalText">): RunResult["status"] {
  if (result.exitCode !== 0) return "failed";
  return result.finalText.trimEnd().endsWith(NO_TASK_MARKER) ? "idle" : "done";
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
};

type LoopState = { phase: "working" } | { phase: "sleeping"; until: Date; wake: AbortController };

/** Runs one loop per enabled factory: run its agent, record the run, sleep when there was nothing to do. */
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

  status(factoryId: number): Status {
    const state = this.loops.get(factoryId);
    if (!state) return { state: "stopped" };
    if (state.phase === "sleeping") return { state: "sleeping", until: state.until };
    return this.isEnabled(factoryId) ? { state: "working" } : { state: "stopping" };
  }

  private async loop(factoryId: number): Promise<void> {
    const { store, sleep } = this.options;

    while (this.isEnabled(factoryId)) {
      this.loops.set(factoryId, { phase: "working" });
      const status = await this.runOnce(factoryId);

      if (status !== "done" && this.isEnabled(factoryId)) {
        const idleDelayMs = store.getFactory(factoryId)!.idleMinutes * 60_000;
        const wake = new AbortController();
        this.loops.set(factoryId, { phase: "sleeping", until: new Date(Date.now() + idleDelayMs), wake });
        await sleep(idleDelayMs, wake.signal);
      }
    }

    this.loops.delete(factoryId);
  }

  private async runOnce(factoryId: number): Promise<RunResult["status"]> {
    const { store, live, runAgent } = this.options;
    const factory = store.getFactory(factoryId)!;
    const runId = store.startRun(factoryId);
    live.start(runId);

    let result: RunResult;
    try {
      const run = await runAgent({
        agent: factory.agent,
        model: factory.model,
        prompt: buildPrompt(factory.prompt),
        directory: factory.directory,
        timeoutMs: factory.maxRunMinutes * 60_000,
        onOutput: (text) => live.append(runId, text),
      });
      result = { status: classify(run), exitCode: run.exitCode, output: run.output };
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
