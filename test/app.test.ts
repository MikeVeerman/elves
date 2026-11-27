import { describe, it, expect, beforeEach, vi } from "vitest";
import { Store } from "../src/store.ts";
import { Supervisor } from "../src/supervisor.ts";
import { createApp } from "../src/app.ts";
import { LiveRuns } from "../src/live.ts";
import type { ModelLists } from "../src/models.ts";
import { homedir } from "node:os";
import { factoryInput } from "./helpers.ts";

const AUTH = { username: "mike", password: "s3cret-elves", secret: "test-secret" };

async function logIn(app: ReturnType<typeof createApp>): Promise<string> {
  const res = await app.request("/login", form({ username: AUTH.username, password: AUTH.password }));
  return res.headers.get("set-cookie")!.split(";")[0];
}

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
  let cookie: string;

  beforeEach(async () => {
    store = new Store(":memory:");
    live = new LiveRuns();
    // The agent only finishes when force-stopped, so a started factory stays "working".
    supervisor = new Supervisor({
      store,
      live,
      runAgent: ({ signal }) =>
        new Promise((resolve) =>
          signal?.addEventListener("abort", () => resolve({ exitCode: null, output: "", finalText: "" })),
        ),
      sleep: () => new Promise(() => {}),
    });
    app = createApp({ store, supervisor, live, models, auth: AUTH });
    cookie = await logIn(app);
  });

  /** A request from a logged-in browser on Elves' own pages. */
  const req = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin", ...init.headers } });

  describe("look", () => {
    it("is branded Elves, with pixel-art elves in the header", async () => {
      const html = await (await req("/")).text();

      expect(html).toContain("<title>Elves</title>");
      expect(html).toContain('class="elf elf-working"');
      expect(html).toContain('class="elf elf-sleeping"');
    });

    it("greets an empty workshop", async () => {
      expect(await (await req("/")).text()).toContain("No elves yet");
    });

    it("shows an elf for each factory, matching its status", async () => {
      const id = store.createFactory(factoryInput({ name: "busy" }));
      supervisor.start(id);
      store.createFactory(factoryInput({ name: "idle" }));

      const html = await (await req("/")).text();
      const rows = html.split("<tr").slice(2);

      expect(rows[0]).toContain("elf-working");
      expect(rows[1]).toContain("elf-off");
    });

    it("shows a big elf on the factory page", async () => {
      const id = store.createFactory(factoryInput());

      expect(await (await req(`/factories/${id}`)).text()).toContain('class="elf elf-off"');
    });
  });

  describe("factory list", () => {
    it("shows each factory with its agent, model and status", async () => {
      store.createFactory(factoryInput({ name: "docs-writer", agent: "codex", model: "gpt-6.2-sol" }));

      const html = await (await req("/")).text();

      expect(html).toContain("docs-writer");
      expect(html).toContain("codex");
      expect(html).toContain("gpt-6.2-sol");
      expect(html).toContain("stopped");
    });

    it("says 'default' for a factory without a model", async () => {
      store.createFactory(factoryInput({ model: "" }));

      expect(await (await req("/")).text()).toContain("default");
    });

    it("links to the new factory screen instead of showing the form", async () => {
      const html = await (await req("/")).text();

      expect(html).toContain('href="/factories/new"');
      expect(html).not.toContain('action="/factories"');
    });

    it("escapes factory names", async () => {
      store.createFactory(factoryInput({ name: "<script>x</script>" }));

      const html = await (await req("/")).text();

      expect(html).not.toContain("<script>x</script>");
      expect(html).toContain("&lt;script&gt;");
    });
  });

  describe("new factory screen", () => {
    it("shows the form with all settings", async () => {
      const html = await (await req("/factories/new")).text();

      expect(html).toContain('action="/factories"');
      for (const field of ["name", "agent", "model", "directory", "idleMinutes", "maxRunMinutes", "prompt"]) {
        expect(html).toContain(`name="${field}"`);
      }
    });

    it("offers every agent, with pi selected", async () => {
      const html = await (await req("/factories/new")).text();

      expect(html).toContain('<option value="pi" selected>pi</option>');
      for (const agent of ["claude", "codex", "opencode"]) expect(html).toContain(`<option value="${agent}">`);
    });

    it("offers pi's models plus the agent default", async () => {
      const html = await (await req("/factories/new")).text();

      expect(html).toContain('<option value="" selected>agent default</option>');
      expect(html).toContain('<option value="fw/deepseek">fw/deepseek</option>');
    });

    it("limits the minutes to one week", async () => {
      const html = await (await req("/factories/new")).text();

      expect(html.match(/max="10080"/g)).toHaveLength(2);
    });

    it("accepts exactly one week", async () => {
      const res = await req("/factories", form({ ...validForm, idleMinutes: "10080", maxRunMinutes: "10080" }));

      expect(res.status).toBe(303);
    });

    it("fills in the default wait and max run times", async () => {
      const html = await (await req("/factories/new")).text();

      expect(html).toContain('name="idleMinutes" value="30"');
      expect(html).toContain('name="maxRunMinutes" value="60"');
    });

    it("includes every agent's models, so the model list can follow the agent", async () => {
      const html = await (await req("/factories/new")).text();

      expect(html).toContain('"codex":["gpt-6.2-sol"]');
    });
  });

  describe("adding a factory", () => {
    it("creates it and redirects to its page", async () => {
      const res = await req("/factories", form(validForm));

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
      await req("/factories", form({ ...validForm, model: "" }));

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
      ["a wait time over a week", { idleMinutes: "10081" }],
      ["a max run time over a week", { maxRunMinutes: "10081" }],
    ])("rejects %s", async (_, change) => {
      const res = await req("/factories", form({ ...validForm, ...change }));

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

      const html = await (await req(`/factories/${id}`)).text();

      expect(html).toContain("Take the next issue");
      expect(html).toContain("/w");
      expect(html).toContain('<option value="claude" selected>claude</option>');
      expect(html).toContain('<option value="claude-sonnet-5-5" selected>claude-sonnet-5-5</option>');
      expect(html).toContain(`/runs/${runId}`);
      expect(html).toContain("done");
    });

    it("keeps a model that is no longer in the agent's list", async () => {
      store.updateFactory(id, factoryInput({ agent: "claude", model: "claude-old-1" }));

      const html = await (await req(`/factories/${id}`)).text();

      expect(html).toContain('<option value="claude-old-1" selected>claude-old-1</option>');
    });

    it("says when only the latest runs are shown", async () => {
      for (let i = 0; i < 51; i++) store.startRun(id);

      const html = await (await req(`/factories/${id}`)).text();

      expect(html).toContain("Showing the latest 50 of 51 runs.");
    });

    it("warns when another elf works in the same folder", async () => {
      store.updateFactory(id, factoryInput({ directory: "~/projects/shop" }));
      store.createFactory(factoryInput({ name: "Twin", directory: `${homedir()}/projects/shop/` }));
      store.createFactory(factoryInput({ name: "Elsewhere", directory: "~/projects/other" }));

      const html = await (await req(`/factories/${id}`)).text();

      expect(html).toContain("Twin");
      expect(html).toContain("also works in this folder");
      expect(html).not.toContain("Elsewhere");
    });

    it("doesn't warn when the folder is not shared", async () => {
      const html = await (await req(`/factories/${id}`)).text();

      expect(html).not.toContain("also works in this folder");
    });

    it("returns 404 for an unknown factory", async () => {
      expect((await req("/factories/999")).status).toBe(404);
    });

    it("updates the settings", async () => {
      const res = await req(`/factories/${id}`, form({ ...validForm, name: "b", agent: "codex", model: "" }));

      expect(res.status).toBe(303);
      expect(store.getFactory(id)).toMatchObject({ name: "b", agent: "codex", model: "", idleMinutes: 10 });
    });

    it("rejects an update with missing fields", async () => {
      const res = await req(`/factories/${id}`, form({ ...validForm, name: "" }));

      expect(res.status).toBe(400);
      expect(store.getFactory(id)?.name).toBe("a");
    });

    it("starts and stops the factory", async () => {
      await req(`/factories/${id}/start`, { method: "POST" });
      expect(supervisor.status(id).state).toBe("working");

      await req(`/factories/${id}/stop`, { method: "POST" });
      expect(supervisor.status(id).state).toBe("stopping");
    });

    it("won't fire an elf that is still working, so its agent can't outlive it", async () => {
      supervisor.start(id);

      const res = await req(`/factories/${id}/delete`, { method: "POST" });

      expect(res.status).toBe(409);
      expect(store.getFactory(id)).toBeDefined();
    });

    it("only offers the fire button when the elf is stopped", async () => {
      supervisor.start(id);

      const html = await (await req(`/factories/${id}`)).text();

      expect(html).not.toContain("Fire this elf");
      expect(html).toContain("Stop this elf first");
    });

    it("offers Stop while working, and Force stop while stopping", async () => {
      supervisor.start(id);
      const working = await (await req(`/factories/${id}`)).text();
      expect(working).toContain(`action="/factories/${id}/stop"`);
      expect(working).not.toContain("Force stop");

      supervisor.stop(id);
      const stopping = await (await req(`/factories/${id}`)).text();
      expect(stopping).toContain(`action="/factories/${id}/force-stop"`);
      expect(stopping).toContain("Force stop");
    });

    it("force stops the factory", async () => {
      supervisor.start(id);
      supervisor.stop(id);

      const res = await req(`/factories/${id}/force-stop`, { method: "POST" });

      expect(res.status).toBe(303);
      await vi.waitFor(() => expect(supervisor.status(id).state).toBe("stopped"));
      expect(store.listRuns(id)[0].status).toBe("interrupted");
    });

    it("deletes the factory", async () => {
      const res = await req(`/factories/${id}/delete`, { method: "POST" });

      expect(res.headers.get("location")).toBe("/");
      expect(store.getFactory(id)).toBeUndefined();
    });
  });

  describe("run page", () => {
    it("shows the run's full output", async () => {
      const factoryId = store.createFactory(factoryInput());
      const runId = store.startRun(factoryId);
      store.finishRun(runId, { status: "failed", exitCode: 2, output: "line one\nline <two>" });

      const html = await (await req(`/runs/${runId}`)).text();

      expect(html).toContain("line one\nline &lt;two&gt;");
      expect(html).toContain("failed");
    });

    it("returns 404 for an unknown run", async () => {
      expect((await req("/runs/999")).status).toBe(404);
    });

    it("follows a running run live", async () => {
      const runId = store.startRun(store.createFactory(factoryInput()));

      const html = await (await req(`/runs/${runId}`)).text();

      expect(html).toContain(`new EventSource("/runs/${runId}/stream")`);
    });

    it("does not follow a finished run", async () => {
      const runId = store.startRun(store.createFactory(factoryInput()));
      store.finishRun(runId, { status: "done", exitCode: 0, output: "x" });

      const html = await (await req(`/runs/${runId}`)).text();

      expect(html).not.toContain("EventSource");
    });
  });

  describe("live stream", () => {
    it("sends the output so far, new output, then an end event", async () => {
      live.start(7);
      live.append(7, "line one\n");

      const res = await req("/runs/7/stream");
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      live.append(7, "line <two>");
      live.finish(7);
      const body = await res.text();

      expect(body).toContain(`data: ${JSON.stringify("line one\n")}`);
      expect(body).toContain(`data: ${JSON.stringify("line <two>")}`);
      expect(body).toContain("event: end");
    });

    it("ends right away for a run that is not live", async () => {
      const body = await (await req("/runs/123/stream")).text();

      expect(body).toContain("event: end");
    });
  });

  describe("login", () => {
    it("sends a visitor without a session to the login page", async () => {
      const res = await app.request("/");

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });

    it("shows the login page without a session", async () => {
      const html = await (await app.request("/login")).text();

      expect(html).toContain('action="/login"');
      expect(html).toContain('name="password"');
      expect(html).not.toContain("Log out");
    });

    it("rejects a wrong password", async () => {
      const res = await app.request("/login", form({ username: "mike", password: "nope" }));

      expect(res.status).toBe(401);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(await res.text()).toContain("Wrong username or password");
    });

    it("rejects a wrong username", async () => {
      const res = await app.request("/login", form({ username: "someone", password: AUTH.password }));

      expect(res.status).toBe(401);
    });

    it("logs in with the right password, using a cookie other sites can't use", async () => {
      const res = await app.request("/login", form({ username: "mike", password: AUTH.password }));

      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/");
      const setCookie = res.headers.get("set-cookie")!;
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
    });

    it("lets a logged-in visitor in, with a logout button", async () => {
      const html = await (await req("/")).text();

      expect(html).toContain("Your elves");
      expect(html).toContain('action="/logout"');
    });

    it("refuses changes without a session", async () => {
      const res = await app.request("/factories", form(validForm));

      expect(res.status).toBe(401);
      expect(store.listFactories()).toHaveLength(0);
    });

    it("refuses the live stream without a session", async () => {
      expect((await app.request("/runs/1/stream")).status).toBe(401);
    });

    it("refuses a forged session cookie", async () => {
      const res = await app.request("/", { headers: { Cookie: "elves_session=mike" } });

      expect(res.status).toBe(302);
    });

    it("refuses a session signed with another secret, e.g. from before a restart", async () => {
      const other = createApp({ store, supervisor, live, models, auth: { ...AUTH, secret: "old-secret" } });
      const oldCookie = await logIn(other);

      expect((await app.request("/", { headers: { Cookie: oldCookie } })).status).toBe(302);
    });

    it("refuses a change sent from another website, even with a session", async () => {
      const res = await app.request("/factories", {
        ...form(validForm),
        headers: { Cookie: cookie, "Sec-Fetch-Site": "cross-site" },
      });

      expect(res.status).toBe(403);
      expect(store.listFactories()).toHaveLength(0);
    });

    it("logs out", async () => {
      const res = await req("/logout", { method: "POST" });

      expect(res.headers.get("location")).toBe("/login");
      expect(res.headers.get("set-cookie")).toContain("elves_session=;");
    });
  });
});
