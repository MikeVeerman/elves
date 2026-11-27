type Watcher = { onText: (text: string) => void; onEnd: () => void };
type LiveRun = { output: string; watchers: Set<Watcher> };

/** Holds the output of runs that are still going, and passes new output on to whoever is watching. */
export class LiveRuns {
  private runs = new Map<number, LiveRun>();

  start(runId: number): void {
    this.runs.set(runId, { output: "", watchers: new Set() });
  }

  append(runId: number, text: string): void {
    const run = this.runs.get(runId);
    if (!run || !text) return;
    run.output += text;
    for (const watcher of run.watchers) watcher.onText(text);
  }

  finish(runId: number): void {
    const run = this.runs.get(runId);
    this.runs.delete(runId);
    for (const watcher of run?.watchers ?? []) watcher.onEnd();
  }

  /** Sends the output so far, then each new piece. Returns an unsubscribe function, or undefined if the run isn't live. */
  watch(runId: number, onText: (text: string) => void, onEnd: () => void): (() => void) | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    const watcher = { onText, onEnd };
    run.watchers.add(watcher);
    if (run.output) onText(run.output);
    return () => run.watchers.delete(watcher);
  }
}
