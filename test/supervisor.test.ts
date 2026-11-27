import { describe, it, expect, beforeEach, vi } from "vitest";
import { Store } from "../src/store.ts";
import { Supervisor, buildPrompt, classify, NO_TASK_MARKER } from "../src/supervisor.ts";
import type { PiRequest, PiResult } from "../src/pi.ts";

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
    expect(classify({ exitCode: 0, output: "Implemented #12" })).toBe("done");
  });

  it("is 'idle' when pi exits 0 and ends with the marker", () => {
    expect(classify({ exitCode: 0, output: `Nothing open.\n${NO_TASK_MARKER}\n` })).toBe("idle");
  });

  it("is 'failed' when pi exits non-zero", () => {
    expect(classify({ exitCode: 1, output: NO_TASK_MARKER })).toBe("failed");
  });

  it("is 'failed' when pi was killed (no exit code)", () => {
    expect(classify({ exitCode: null, output: "" })).toBe("failed");
  });
});

describe("Supervisor", () => {
  const IDLE_MS = 1000;
  let store: Store;
  let factoryId: number;
  let piCalls: PiRequest[];
  let piResults: Array<PiResult | Error>;
  let sleeps: Array<{ ms: number; signal: AbortSignal; done: () => void }>;
  let supervisor: Supervisor;

  beforeEach(() => {
    store = new Store(":memory:");
    factoryId = store.createFactory({ name: "a", prompt: "Do work", directory: "/work" });
    piCalls = [];
    piResults = [];
    sleeps = [];

    supervisor = new Supervisor({
      store,
      piBin: "pi",
      idleDelayMs: IDLE_MS,
      runPi: async (request) => {
        piCalls.push(request);
        const next = piResults.shift() ?? { exitCode: 0, output: NO_TASK_MARKER };
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

  it("runs pi with the factory's prompt in its directory", async () => {
    supervisor.start(factoryId);

    await vi.waitFor(() => expect(piCalls).toHaveLength(1));
    expect(piCalls[0]).toEqual({ bin: "pi", prompt: buildPrompt("Do work"), directory: "/work" });
  });

  it("records each run in the store", async () => {
    piResults.push({ exitCode: 0, output: "did a task" });
    supervisor.start(factoryId);

    await vi.waitFor(() => expect(sleeps).toHaveLength(1));
    const [idleRun, doneRun] = store.listRuns(factoryId);
    expect(doneRun).toMatchObject({ status: "done", exitCode: 0, output: "did a task" });
    expect(idleRun).toMatchObject({ status: "idle" });
  });

  it("runs again straight away after a task was done", async () => {
    piResults.push({ exitCode: 0, output: "task 1" }, { exitCode: 0, output: "task 2" });
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
    piResults.push({ exitCode: 1, output: "crash" });
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

  it("uses the latest prompt on each run", async () => {
    supervisor.start(factoryId);
    await vi.waitFor(() => expect(sleeps).toHaveLength(1));

    store.updateFactory(factoryId, { name: "a", prompt: "New prompt", directory: "/work" });
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
        piBin: "pi",
        idleDelayMs: IDLE_MS,
        runPi: () => pi.promise,
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
        piBin: "pi",
        idleDelayMs: IDLE_MS,
        runPi: () => pi.promise,
        sleep: () => new Promise(() => {}),
      });
      supervisor.start(factoryId);

      supervisor.stop(factoryId);
      expect(supervisor.status(factoryId)).toEqual({ state: "stopping" });

      pi.resolve({ exitCode: 0, output: "finished task" });
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

  describe("resume", () => {
    it("starts every enabled factory and marks leftover runs interrupted", async () => {
      const leftover = store.startRun(factoryId);
      store.setEnabled(factoryId, true);
      const disabledId = store.createFactory({ name: "b", prompt: "p", directory: "/b" });

      supervisor.resume();

      await vi.waitFor(() => expect(piCalls).toHaveLength(1));
      expect(piCalls[0].directory).toBe("/work");
      expect(store.getRun(leftover)?.status).toBe("interrupted");
      expect(supervisor.status(disabledId)).toEqual({ state: "stopped" });
    });
  });
});
