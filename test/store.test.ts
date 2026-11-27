import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "../src/store.ts";

describe("Store", () => {
  let store: Store;

  beforeEach(() => {
    store = new Store(":memory:");
  });

  describe("factories", () => {
    it("creates a factory and reads it back", () => {
      const id = store.createFactory({ name: "docs", prompt: "Write docs", directory: "/tmp/docs" });

      expect(store.getFactory(id)).toEqual({
        id,
        name: "docs",
        prompt: "Write docs",
        directory: "/tmp/docs",
        enabled: false,
      });
    });

    it("returns undefined for an unknown factory", () => {
      expect(store.getFactory(999)).toBeUndefined();
    });

    it("lists factories in creation order", () => {
      store.createFactory({ name: "a", prompt: "p", directory: "/a" });
      store.createFactory({ name: "b", prompt: "p", directory: "/b" });

      expect(store.listFactories().map((f) => f.name)).toEqual(["a", "b"]);
    });

    it("updates name, prompt and directory", () => {
      const id = store.createFactory({ name: "a", prompt: "p", directory: "/a" });

      store.updateFactory(id, { name: "b", prompt: "q", directory: "/b" });

      expect(store.getFactory(id)).toMatchObject({ name: "b", prompt: "q", directory: "/b" });
    });

    it("remembers whether a factory is enabled", () => {
      const id = store.createFactory({ name: "a", prompt: "p", directory: "/a" });

      store.setEnabled(id, true);
      expect(store.getFactory(id)?.enabled).toBe(true);

      store.setEnabled(id, false);
      expect(store.getFactory(id)?.enabled).toBe(false);
    });

    it("deletes a factory and its runs", () => {
      const id = store.createFactory({ name: "a", prompt: "p", directory: "/a" });
      const runId = store.startRun(id);

      store.deleteFactory(id);

      expect(store.getFactory(id)).toBeUndefined();
      expect(store.getRun(runId)).toBeUndefined();
    });
  });

  describe("runs", () => {
    let factoryId: number;

    beforeEach(() => {
      factoryId = store.createFactory({ name: "a", prompt: "p", directory: "/a" });
    });

    it("starts a run with status 'running'", () => {
      const runId = store.startRun(factoryId);

      const run = store.getRun(runId);
      expect(run).toMatchObject({ id: runId, factoryId, status: "running", exitCode: null, output: "" });
      expect(run?.startedAt).toBeTypeOf("string");
      expect(run?.finishedAt).toBeNull();
    });

    it("finishes a run with status, exit code and output", () => {
      const runId = store.startRun(factoryId);

      store.finishRun(runId, { status: "done", exitCode: 0, output: "all good" });

      const run = store.getRun(runId);
      expect(run).toMatchObject({ status: "done", exitCode: 0, output: "all good" });
      expect(run?.finishedAt).toBeTypeOf("string");
    });

    it("lists a factory's runs newest first", () => {
      const first = store.startRun(factoryId);
      const second = store.startRun(factoryId);

      expect(store.listRuns(factoryId).map((r) => r.id)).toEqual([second, first]);
    });

    it("marks runs left 'running' as 'interrupted'", () => {
      const runId = store.startRun(factoryId);

      store.markUnfinishedRunsInterrupted();

      expect(store.getRun(runId)).toMatchObject({ status: "interrupted" });
      expect(store.getRun(runId)?.finishedAt).toBeTypeOf("string");
    });
  });
});
