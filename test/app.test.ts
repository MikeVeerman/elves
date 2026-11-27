import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "../src/store.ts";
import { Supervisor } from "../src/supervisor.ts";
import { createApp } from "../src/app.ts";
import { LiveRuns } from "../src/live.ts";
import type { ModelLists } from "../src/models.ts";
import { factoryInput } from "./helpers.ts";

function form(fields: Record<string, string>) {
  return { method: "POST", body: new URLSearchParams(fields) };
}

const validForm = {
  name: "docs",
  agent: "claude",
  model: "claude-opus-5-5",
  directory: "/w",
  idleMinutes: "10",
  maxRunMinutes: "45",
  prompt: "Take the next issue",
};

const models: ModelLists = {
  pi: ["fw/deepseek"],
  claude: ["claude-opus-5-5", "claude-sonnet-5-5"],
  codex: ["gpt-6.2-sol"],
  opencode: [],
};

describe("web app", () => {
  let store: Store;
  let supervisor: Supervisor;
  let app: ReturnType<typeof createApp>;
  let live: LiveRuns;

  beforeEach(() => {
    store = new Store(":memory:");
    live = new LiveRuns();
    // The agent never finishes, so a started factory stays "working".
    supervisor = new Supervisor({
      store,
      live,
      runAgent: () => new Promise(() => {}),
      sleep: () => new Promise(() => {}),
    });
    app = createApp({ store, supervisor, live, models });
  });

  describe("look", () => {
    it("is branded Elves, with pixel-art elves in the header", async () => {
      const html = await (await app.request("/")).text();

      expect(html).toContain("<title>Elves</title>");
      expect(html).toContain('class="elf elf-working"');
      expect(html).toContain('class="elf elf-sleeping"');
    });

    it("greets an empty workshop", async () => {
      expect(await (await app.request("/")).text()).toContain("No elves yet");
    });

    it("shows an elf for each factory, matching its status", async () => {
      const id = store.createFactory(factoryInput({ name: "busy" }));
      supervisor.start(id);
      store.createFactory(factoryInput({ name: "idle" }));

      const html = await (await app.request("/")).text();
      const rows = html.split("<tr").slice(2);

      expect(rows[0]).toContain("elf-working");
      expect(rows[1]).toContain("elf-off");
    });

    it("shows a big elf on the factory page", async () => {
      const id = store.createFactory(factoryInput());

      expect(await (await app.request(`/factories/${id}`)).text()).toContain('class="elf elf-off"');
    });
  });

  describe("factory list", () => {
    it("shows each factory with its agent, model and status", async () => {
      store.createFactory(factoryInput({ name: "docs-writer", agent: "codex", model: "gpt-6.2-sol" }));

      const html = await (await app.request("/")).text();

      expect(html).toContain("docs-writer");
      expect(html).toContain("codex");
      expect(html).toContain("gpt-6.2-sol");
      expect(html).toContain("stopped");
    });

    it("says 'default' for a factory without a model", async () => {
      store.createFactory(factoryInput({ model: "" }));

      expect(await (await app.request("/")).text()).toContain("default");
    });

    it("links to the new factory screen instead of showing the form", async () => {
      const html = await (await app.request("/")).text();

      expect(html).toContain('href="/factories/new"');
      expect(html).not.toContain('action="/factories"');
    });

    it("escapes factory names", async () => {
      store.createFactory(factoryInput({ name: "<script>x</script>" }));

      const html = await (await app.request("/")).text();

      expect(html).not.toContain("<script>x</script>");
      expect(html).toContain("&lt;script&gt;");
    });
  });

  describe("new factory screen", () => {
    it("shows the form with all settings", async () => {
      const html = await (await app.request("/factories/new")).text();

      expect(html).toContain('action="/factories"');
      for (const field of ["name", "agent", "model", "directory", "idleMinutes", "maxRunMinutes", "prompt"]) {
        expect(html).toContain(`name="${field}"`);
      }
    });

    it("offers every agent, with pi selected", async () => {
      const html = await (await app.request("/factories/new")).text();

      expect(html).toContain('<option value="pi" selected>pi</option>');
      for (const agent of ["claude", "codex", "opencode"]) expect(html).toContain(`<option value="${agent}">`);
    });

    it("offers pi's models plus the agent default", async () => {
      const html = await (await app.request("/factories/new")).text();

      expect(html).toContain('<option value="" selected>agent default</option>');
      expect(html).toContain('<option value="fw/deepseek">fw/deepseek</option>');
    });

    it("fills in the default wait and max run times", async () => {
      const html = await (await app.request("/factories/new")).text();

      expect(html).toContain('name="idleMinutes" value="30"');
      expect(html).toContain('name="maxRunMinutes" value="60"');
    });

    it("includes every agent's models, so the model list can follow the agent", async () => {
      const html = await (await app.request("/factories/new")).text();

      expect(html).toContain('"codex":["gpt-6.2-sol"]');
    });
  });

  describe("adding a factory", () => {
    it("creates it and redirects to its page", async () => {
      const res = await app.request("/factories", form(validForm));

      const [factory] = store.listFactories();
      expect(factory).toMatchObject({
        name: "docs",
        agent: "claude",
        model: "claude-opus-5-5",
        directory: "/w",
        idleMinutes: 10,
        maxRunMinutes: 45,
        prompt: "Take the next issue",
        enabled: false,
      });
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(`/factories/${factory.id}`);
    });

    it("accepts the agent default model", async () => {
      await app.request("/factories", form({ ...validForm, model: "" }));

      expect(store.listFactories()[0].model).toBe("");
    });

    it.each([
      ["a missing name", { name: "" }],
      ["a missing prompt", { prompt: " " }],
      ["a missing directory", { directory: "" }],
      ["an unknown agent", { agent: "gpt-cli" }],
      ["a wait time of zero", { idleMinutes: "0" }],
      ["a max run time that is not a number", { maxRunMinutes: "soon" }],
      ["a fractional wait time", { idleMinutes: "1.5" }],
    ])("rejects %s", async (_, change) => {
      const res = await app.request("/factories", form({ ...validForm, ...change }));

      expect(res.status).toBe(400);
      expect(store.listFactories()).toHaveLength(0);
    });
  });

  describe("factory page", () => {
    let id: number;

    beforeEach(() => {
      id = store.createFactory(
        factoryInput({ name: "a", prompt: "Take the next issue", directory: "/w", agent: "claude", model: "claude-sonnet-5-5" }),
      );
    });

    it("shows the factory's settings and its runs", async () => {
      const runId = store.startRun(id);
      store.finishRun(runId, { status: "done", exitCode: 0, output: "x" });

      const html = await (await app.request(`/factories/${id}`)).text();

      expect(html).toContain("Take the next issue");
      expect(html).toContain("/w");
      expect(html).toContain('<option value="claude" selected>claude</option>');
      expect(html).toContain('<option value="claude-sonnet-5-5" selected>claude-sonnet-5-5</option>');
      expect(html).toContain(`/runs/${runId}`);
      expect(html).toContain("done");
    });

    it("keeps a model that is no longer in the agent's list", async () => {
      store.updateFactory(id, factoryInput({ agent: "claude", model: "claude-old-1" }));

      const html = await (await app.request(`/factories/${id}`)).text();

      expect(html).toContain('<option value="claude-old-1" selected>claude-old-1</option>');
    });

    it("returns 404 for an unknown factory", async () => {
      expect((await app.request("/factories/999")).status).toBe(404);
    });

    it("updates the settings", async () => {
      const res = await app.request(`/factories/${id}`, form({ ...validForm, name: "b", agent: "codex", model: "" }));

      expect(res.status).toBe(303);
      expect(store.getFactory(id)).toMatchObject({ name: "b", agent: "codex", model: "", idleMinutes: 10 });
    });

    it("rejects an update with missing fields", async () => {
      const res = await app.request(`/factories/${id}`, form({ ...validForm, name: "" }));

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
      const factoryId = store.createFactory(factoryInput());
      const runId = store.startRun(factoryId);
      store.finishRun(runId, { status: "failed", exitCode: 2, output: "line one\nline <two>" });

      const html = await (await app.request(`/runs/${runId}`)).text();

      expect(html).toContain("line one\nline &lt;two&gt;");
      expect(html).toContain("failed");
    });

    it("returns 404 for an unknown run", async () => {
      expect((await app.request("/runs/999")).status).toBe(404);
    });

    it("follows a running run live", async () => {
      const runId = store.startRun(store.createFactory(factoryInput()));

      const html = await (await app.request(`/runs/${runId}`)).text();

      expect(html).toContain(`new EventSource("/runs/${runId}/stream")`);
    });

    it("does not follow a finished run", async () => {
      const runId = store.startRun(store.createFactory(factoryInput()));
      store.finishRun(runId, { status: "done", exitCode: 0, output: "x" });

      const html = await (await app.request(`/runs/${runId}`)).text();

      expect(html).not.toContain("EventSource");
    });
  });

  describe("live stream", () => {
    it("sends the output so far, new output, then an end event", async () => {
      live.start(7);
      live.append(7, "line one\n");

      const res = await app.request("/runs/7/stream");
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      live.append(7, "line <two>");
      live.finish(7);
      const body = await res.text();

      expect(body).toContain(`data: ${JSON.stringify("line one\n")}`);
      expect(body).toContain(`data: ${JSON.stringify("line <two>")}`);
      expect(body).toContain("event: end");
    });

    it("ends right away for a run that is not live", async () => {
      const body = await (await app.request("/runs/123/stream")).text();

      expect(body).toContain("event: end");
    });
  });
});
