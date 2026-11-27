import { describe, it, expect, beforeEach, vi } from "vitest";
import { Store } from "../src/store.ts";
import { LiveRuns } from "../src/live.ts";
import { Supervisor, buildPrompt, classify, NO_TASK_MARKER } from "../src/supervisor.ts";
import type { AgentRequest } from "../src/agents.ts";
import type { RunResult as PiResult } from "../src/runner.ts";
import { factoryInput } from "./helpers.ts";

/** A promise we can resolve from the test. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("buildPrompt", () => {
  it("appends the no-task instruction to the factory prompt", () => {
    const prompt = buildPrompt("Pick the next GitHub issue.");

    expect(prompt.startsWith("Pick the next GitHub issue.")).toBe(true);
    expect(prompt).toContain(NO_TASK_MARKER);
  });
});

describe("classify", () => {
  it("is 'done' when pi exits 0 without the marker", () => {
    expect(classify({ exitCode: 0, finalText: "Implemented #12" })).toBe("done");
  });

  it("is 'idle' when pi exits 0 and its final message ends with the marker", () => {
    expect(classify({ exitCode: 0, finalText: `Nothing open.\n${NO_TASK_MARKER}\n` })).toBe("idle");
  });

  it("is 'done' when the marker only shows up earlier in the log, not in the final message", () => {
    expect(classify({ exitCode: 0, finalText: "Picked up issue #3 and fixed it." })).toBe("done");
  });

  it("is 'failed' when pi exits non-zero", () => {
    expect(classify({ exitCode: 1, finalText: NO_TASK_MARKER })).toBe("failed");
  });

  it("is 'failed' when the agent exits 0 without a final message, so the elf waits instead of looping", () => {
    expect(classify({ exitCode: 0, finalText: "" })).toBe("failed");
    expect(classify({ exitCode: 0, finalText: "  \n" })).toBe("failed");
  });

  it("is 'failed' when pi was killed (no exit code)", () => {
    expect(classify({ exitCode: null, finalText: "" })).toBe("failed");
  });
});

const idle: PiResult = { exitCode: 0, output: NO_TASK_MARKER, finalText: NO_TASK_MARKER };
const did = (text: string): PiResult => ({ exitCode: 0, output: text, finalText: text });

describe("Supervisor", () => {
  const IDLE_MS = 2 * 60_000;
  let store: Store;
  let factoryId: number;
  let piCalls: AgentRequest[];
  let piResults: Array<PiResult | Error>;
  let sleeps: Array<{ ms: number; signal: AbortSignal; done: () => void }>;
  let supervisor: Supervisor;
  let live: LiveRuns;

  beforeEach(() => {
    live = new LiveRuns();
    store = new Store(":memory:");
    factoryId = store.createFactory(
      factoryInput({ prompt: "Do work", directory: "/work", agent: "claude", model: "claude-opus-5-5", idleMinutes: 2, maxRunMinutes: 15 }),
    );
    piCalls = [];
    piResults = [];
    sleeps = [];

    supervisor = new Supervisor({
      store,
      live,
      runAgent: async (request) => {
        piCalls.push(request);
        const next = piResults.shift() ?? idle;
        if (next instanceof Error) throw next;
        return next;
      },
      // Sleeps never end by themselves; the test ends them, or an abort does.
      sleep: (ms, signal) => {
        const { promise, resolve } = deferred();
        sleeps.push({ ms, signal, done: resolve });
        signal.addEventListener("abort", () => resolve());
        return promise;
      },
    });
  });

  it("runs the factory's agent and model with its prompt, directory and max run time", async () => {
    supervisor.start(factoryId);

    await vi.waitFor(() => expect(piCalls).toHaveLength(1));
    expect(piCalls[0]).toMatchObject({
      agent: "claude",
      model: "claude-opus-5-5",
      prompt: buildPrompt("Do work"),
      directory: "/work",
      timeoutMs: 15 * 60_000,
    });
  });

  it("records each run in the store", async () => {
    piResults.push(did("did a task"));
    supervisor.start(factoryId);

    await vi.waitFor(() => expect(sleeps).toHaveLength(1));
    const [idleRun, doneRun] = store.listRuns(factoryId);
    expect(doneRun).toMatchObject({ status: "done", exitCode: 0, output: "did a task" });
    expect(idleRun).toMatchObject({ status: "idle" });
  });

  it("runs again straight away after a task was done", async () => {
    piResults.push(did("task 1"), did("task 2"));
    supervisor.start(factoryId);

    await vi.waitFor(() => expect(sleeps).toHaveLength(1));
    expect(piCalls).toHaveLength(3);
  });

  it("sleeps for the idle delay when there is no task, then runs again", async () => {
    supervisor.start(factoryId);

    await vi.waitFor(() => expect(sleeps).toHaveLength(1));
    expect(sleeps[0].ms).toBe(IDLE_MS);
    expect(piCalls).toHaveLength(1);

    sleeps[0].done();
    await vi.waitFor(() => expect(piCalls).toHaveLength(2));
  });

  it("sleeps after a failed run", async () => {
    piResults.push({ exitCode: 1, output: "crash", finalText: "" });
    supervisor.start(factoryId);

    await vi.waitFor(() => expect(sleeps).toHaveLength(1));
    expect(store.listRuns(factoryId)[0]).toMatchObject({ status: "failed", exitCode: 1 });
  });

  it("records a failed run when pi cannot be started", async () => {
    piResults.push(new Error("spawn pi ENOENT"));
    supervisor.start(factoryId);

    await vi.waitFor(() => expect(sleeps).toHaveLength(1));
    expect(store.listRuns(factoryId)[0]).toMatchObject({
      status: "failed",
      exitCode: null,
      output: "spawn pi ENOENT",
    });
  });

  it("streams pi's output to live watchers while the run is going", async () => {
    const pi = deferred<PiResult>();
    let onOutput: (text: string) => void = () => {};
    let calls = 0;
    supervisor = new Supervisor({
      store,
      live,
      // The first run waits for the test; later runs never finish, so the loop doesn't spin.
      runAgent: (request) => {
        if (calls++ > 0) return new Promise(() => {});
        onOutput = request.onOutput!;
        return pi.promise;
      },
      sleep: () => new Promise(() => {}),
    });
    supervisor.start(factoryId);
    const runId = store.listRuns(factoryId)[0].id;
    const seen: string[] = [];
    let ended = false;
    live.watch(runId, (text) => seen.push(text), () => (ended = true));

    onOutput("working on it");
    expect(seen).toEqual(["working on it"]);

    pi.resolve(did("done"));
    await vi.waitFor(() => expect(ended).toBe(true));
    expect(store.getRun(runId)?.status).toBe("done");
  });

  it("ends the live run when pi cannot be started", async () => {
    piResults.push(new Error("nope"));
    supervisor.start(factoryId);

    await vi.waitFor(() => expect(sleeps).toHaveLength(1));
    const runId = store.listRuns(factoryId)[0].id;
    expect(live.watch(runId, () => {}, () => {})).toBeUndefined();
  });

  it("uses the latest prompt on each run", async () => {
    supervisor.start(factoryId);
    await vi.waitFor(() => expect(sleeps).toHaveLength(1));

    store.updateFactory(factoryId, { ...store.getFactory(factoryId)!, prompt: "New prompt" });
    sleeps[0].done();

    await vi.waitFor(() => expect(piCalls).toHaveLength(2));
    expect(piCalls[1].prompt).toBe(buildPrompt("New prompt"));
  });

  it("marks the factory as enabled when started", () => {
    supervisor.start(factoryId);

    expect(store.getFactory(factoryId)?.enabled).toBe(true);
  });

  it("does not start a second loop for a running factory", async () => {
    supervisor.start(factoryId);
    supervisor.start(factoryId);

    await vi.waitFor(() => expect(sleeps).toHaveLength(1));
    expect(piCalls).toHaveLength(1);
  });

  describe("status", () => {
    it("is 'stopped' for a factory that was never started", () => {
      expect(supervisor.status(factoryId)).toEqual({ state: "stopped" });
    });

    it("is 'working' while pi runs", async () => {
      const pi = deferred<PiResult>();
      supervisor = new Supervisor({
        store,
        live,
        runAgent: () => pi.promise,
        sleep: () => new Promise(() => {}),
      });

      supervisor.start(factoryId);

      expect(supervisor.status(factoryId)).toEqual({ state: "working" });
    });

    it("is 'sleeping' with a wake-up time while waiting", async () => {
      const before = Date.now();
      supervisor.start(factoryId);

      await vi.waitFor(() => expect(sleeps).toHaveLength(1));
      const status = supervisor.status(factoryId);
      expect(status.state).toBe("sleeping");
      expect(status.state === "sleeping" && status.until.getTime()).toBeGreaterThanOrEqual(before + IDLE_MS);
    });
  });

  describe("stop", () => {
    it("wakes a sleeping factory and ends its loop", async () => {
      supervisor.start(factoryId);
      await vi.waitFor(() => expect(sleeps).toHaveLength(1));

      supervisor.stop(factoryId);

      await vi.waitFor(() => expect(supervisor.status(factoryId)).toEqual({ state: "stopped" }));
      expect(sleeps[0].signal.aborted).toBe(true);
      expect(piCalls).toHaveLength(1);
      expect(store.getFactory(factoryId)?.enabled).toBe(false);
    });

    it("lets the current run finish, then stops", async () => {
      const pi = deferred<PiResult>();
      supervisor = new Supervisor({
        store,
        live,
        runAgent: () => pi.promise,
        sleep: () => new Promise(() => {}),
      });
      supervisor.start(factoryId);

      supervisor.stop(factoryId);
      expect(supervisor.status(factoryId)).toEqual({ state: "stopping" });

      pi.resolve(did("finished task"));
      await vi.waitFor(() => expect(supervisor.status(factoryId)).toEqual({ state: "stopped" }));
      expect(store.listRuns(factoryId)[0]).toMatchObject({ status: "done", output: "finished task" });
    });

    it("can be started again after stopping", async () => {
      supervisor.start(factoryId);
      await vi.waitFor(() => expect(sleeps).toHaveLength(1));
      supervisor.stop(factoryId);
      await vi.waitFor(() => expect(supervisor.status(factoryId)).toEqual({ state: "stopped" }));

      supervisor.start(factoryId);

      await vi.waitFor(() => expect(piCalls).toHaveLength(2));
    });
  });

  describe("forceStop", () => {
    it("kills the current run right away and marks it interrupted", async () => {
      let signal: AbortSignal | undefined;
      supervisor = new Supervisor({
        store,
        live,
        // Like the real runner: ends when its signal is aborted.
        runAgent: (request) => {
          signal = request.signal;
          return new Promise((resolve) =>
            request.signal!.addEventListener("abort", () =>
              resolve({ exitCode: null, output: "[force stopped]", finalText: "" }),
            ),
          );
        },
        sleep: () => new Promise(() => {}),
      });
      supervisor.start(factoryId);
      supervisor.stop(factoryId);
      expect(supervisor.status(factoryId)).toEqual({ state: "stopping" });

      supervisor.forceStop(factoryId);

      expect(signal?.aborted).toBe(true);
      await vi.waitFor(() => expect(supervisor.status(factoryId)).toEqual({ state: "stopped" }));
      expect(store.listRuns(factoryId)[0]).toMatchObject({ status: "interrupted", output: "[force stopped]" });
      expect(store.getFactory(factoryId)?.enabled).toBe(false);
    });

    it("stops a sleeping elf like a normal stop", async () => {
      supervisor.start(factoryId);
      await vi.waitFor(() => expect(sleeps).toHaveLength(1));

      supervisor.forceStop(factoryId);

      await vi.waitFor(() => expect(supervisor.status(factoryId)).toEqual({ state: "stopped" }));
      expect(piCalls).toHaveLength(1);
    });
  });

  describe("resume", () => {
    it("starts every enabled factory and marks leftover runs interrupted", async () => {
      const leftover = store.startRun(factoryId);
      store.setEnabled(factoryId, true);
      const disabledId = store.createFactory(factoryInput({ name: "b", prompt: "p", directory: "/b" }));

      supervisor.resume();

      await vi.waitFor(() => expect(piCalls).toHaveLength(1));
      expect(piCalls[0].directory).toBe("/work");
      expect(store.getRun(leftover)?.status).toBe("interrupted");
      expect(supervisor.status(disabledId)).toEqual({ state: "stopped" });
    });
  });
});
