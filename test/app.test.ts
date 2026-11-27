import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "../src/store.ts";
import { Supervisor } from "../src/supervisor.ts";
import { createApp } from "../src/app.ts";

function form(fields: Record<string, string>) {
  return { method: "POST", body: new URLSearchParams(fields) };
}

describe("web app", () => {
  let store: Store;
  let supervisor: Supervisor;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    store = new Store(":memory:");
    // pi never finishes, so a started factory stays "working".
    supervisor = new Supervisor({
      store,
      piBin: "pi",
      idleDelayMs: 1000,
      runPi: () => new Promise(() => {}),
      sleep: () => new Promise(() => {}),
    });
    app = createApp({ store, supervisor });
  });

  describe("factory list", () => {
    it("shows each factory with its status", async () => {
      store.createFactory({ name: "docs-writer", prompt: "p", directory: "/d" });

      const html = await (await app.request("/")).text();

      expect(html).toContain("docs-writer");
      expect(html).toContain("stopped");
    });

    it("shows a form to add a factory", async () => {
      const html = await (await app.request("/")).text();

      expect(html).toContain('action="/factories"');
    });

    it("escapes factory names", async () => {
      store.createFactory({ name: "<script>x</script>", prompt: "p", directory: "/d" });

      const html = await (await app.request("/")).text();

      expect(html).not.toContain("<script>x</script>");
      expect(html).toContain("&lt;script&gt;");
    });
  });

  describe("adding a factory", () => {
    it("creates it and redirects to its page", async () => {
      const res = await app.request("/factories", form({ name: "a", prompt: "Do it", directory: "/w" }));

      const [factory] = store.listFactories();
      expect(factory).toMatchObject({ name: "a", prompt: "Do it", directory: "/w", enabled: false });
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(`/factories/${factory.id}`);
    });

    it("rejects missing fields", async () => {
      const res = await app.request("/factories", form({ name: "a", prompt: "", directory: "/w" }));

      expect(res.status).toBe(400);
      expect(store.listFactories()).toHaveLength(0);
    });
  });

  describe("factory page", () => {
    let id: number;

    beforeEach(() => {
      id = store.createFactory({ name: "a", prompt: "Take the next issue", directory: "/w" });
    });

    it("shows the factory's settings and its runs", async () => {
      const runId = store.startRun(id);
      store.finishRun(runId, { status: "done", exitCode: 0, output: "x" });

      const html = await (await app.request(`/factories/${id}`)).text();

      expect(html).toContain("Take the next issue");
      expect(html).toContain("/w");
      expect(html).toContain(`/runs/${runId}`);
      expect(html).toContain("done");
    });

    it("returns 404 for an unknown factory", async () => {
      expect((await app.request("/factories/999")).status).toBe(404);
    });

    it("updates the settings", async () => {
      const res = await app.request(`/factories/${id}`, form({ name: "b", prompt: "q", directory: "/x" }));

      expect(res.status).toBe(303);
      expect(store.getFactory(id)).toMatchObject({ name: "b", prompt: "q", directory: "/x" });
    });

    it("rejects an update with missing fields", async () => {
      const res = await app.request(`/factories/${id}`, form({ name: "", prompt: "q", directory: "/x" }));

      expect(res.status).toBe(400);
      expect(store.getFactory(id)?.name).toBe("a");
    });

    it("starts and stops the factory", async () => {
      await app.request(`/factories/${id}/start`, { method: "POST" });
      expect(supervisor.status(id).state).toBe("working");

      await app.request(`/factories/${id}/stop`, { method: "POST" });
      expect(supervisor.status(id).state).toBe("stopping");
    });

    it("deletes the factory", async () => {
      const res = await app.request(`/factories/${id}/delete`, { method: "POST" });

      expect(res.headers.get("location")).toBe("/");
      expect(store.getFactory(id)).toBeUndefined();
    });
  });

  describe("run page", () => {
    it("shows the run's full output", async () => {
      const factoryId = store.createFactory({ name: "a", prompt: "p", directory: "/w" });
      const runId = store.startRun(factoryId);
      store.finishRun(runId, { status: "failed", exitCode: 2, output: "line one\nline <two>" });

      const html = await (await app.request(`/runs/${runId}`)).text();

      expect(html).toContain("line one\nline &lt;two&gt;");
      expect(html).toContain("failed");
    });

    it("returns 404 for an unknown run", async () => {
      expect((await app.request("/runs/999")).status).toBe(404);
    });
  });
});
