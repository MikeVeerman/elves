import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/store.ts";
import { factoryInput } from "./helpers.ts";

describe("Store", () => {
  let store: Store;

  beforeEach(() => {
    store = new Store(":memory:");
  });

  describe("factories", () => {
    it("creates a factory and reads it back", () => {
      const input = factoryInput({
        name: "docs",
        prompt: "Write docs",
        directory: "/tmp/docs",
        agent: "claude",
        model: "claude-sonnet-5-5",
        idleMinutes: 10,
        maxRunMinutes: 45,
      });

      const id = store.createFactory(input);

      expect(store.getFactory(id)).toEqual({ id, ...input, enabled: false });
    });

    it("returns undefined for an unknown factory", () => {
      expect(store.getFactory(999)).toBeUndefined();
    });

    it("lists factories in creation order", () => {
      store.createFactory(factoryInput({ name: "a", prompt: "p", directory: "/a" }));
      store.createFactory(factoryInput({ name: "b", prompt: "p", directory: "/b" }));

      expect(store.listFactories().map((f) => f.name)).toEqual(["a", "b"]);
    });

    it("updates the settings", () => {
      const id = store.createFactory(factoryInput());
      const changed = factoryInput({ name: "b", agent: "codex", model: "gpt-6.2-sol", idleMinutes: 5, maxRunMinutes: 90 });

      store.updateFactory(id, changed);

      expect(store.getFactory(id)).toMatchObject(changed);
    });

    it("remembers whether a factory is enabled", () => {
      const id = store.createFactory(factoryInput({ name: "a", prompt: "p", directory: "/a" }));

      store.setEnabled(id, true);
      expect(store.getFactory(id)?.enabled).toBe(true);

      store.setEnabled(id, false);
      expect(store.getFactory(id)?.enabled).toBe(false);
    });

    it("deletes a factory and its runs", () => {
      const id = store.createFactory(factoryInput({ name: "a", prompt: "p", directory: "/a" }));
      const runId = store.startRun(id);

      store.deleteFactory(id);

      expect(store.getFactory(id)).toBeUndefined();
      expect(store.getRun(runId)).toBeUndefined();
    });
  });

  describe("runs", () => {
    let factoryId: number;

    beforeEach(() => {
      factoryId = store.createFactory(factoryInput({ name: "a", prompt: "p", directory: "/a" }));
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

    it("lists at most the latest 50 runs by default", () => {
      const ids = Array.from({ length: 60 }, () => store.startRun(factoryId));

      const runs = store.listRuns(factoryId);

      expect(runs).toHaveLength(50);
      expect(runs[0].id).toBe(ids[59]);
    });

    it("counts all runs of a factory", () => {
      for (let i = 0; i < 60; i++) store.startRun(factoryId);

      expect(store.countRuns(factoryId)).toBe(60);
    });

    it("marks runs left 'running' as 'interrupted'", () => {
      const runId = store.startRun(factoryId);

      store.markUnfinishedRunsInterrupted();

      expect(store.getRun(runId)).toMatchObject({ status: "interrupted" });
      expect(store.getRun(runId)?.finishedAt).toBeTypeOf("string");
    });
  });

  it("adds the new settings to a database made before they existed", () => {
    const path = join(mkdtempSync(join(tmpdir(), "store-")), "old.db");
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE factories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL,
      directory TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0)`);
    old.exec("INSERT INTO factories (name, prompt, directory) VALUES ('old', 'p', '/d')");
    old.close();

    const [factory] = new Store(path).listFactories();

    expect(factory).toMatchObject({ name: "old", agent: "pi", model: "", idleMinutes: 30, maxRunMinutes: 60 });
  });
});
