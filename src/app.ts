import { Hono } from "hono";
import { html, raw } from "hono/html";
import { streamSSE } from "hono/streaming";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Store, FactoryInput, Run } from "./store.ts";
import type { Supervisor, Status } from "./supervisor.ts";
import type { LiveRuns } from "./live.ts";
import type { ModelLists } from "./models.ts";
import { AGENTS, type AgentName } from "./agents.ts";

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

type Deps = { store: Store; supervisor: Supervisor; live: LiveRuns; models: ModelLists };

const NEW_FACTORY: FactoryInput = {
  name: "",
  prompt: "",
  directory: "",
  agent: "pi",
  model: "",
  idleMinutes: 30,
  maxRunMinutes: 60,
};

const INVALID_FORM =
  "Please fill in a name, prompt and directory, pick an agent, and use whole minutes of at least 1.";

export function createApp({ store, supervisor, live, models }: Deps) {
  const app = new Hono();

  app.get("/", (c) =>
    c.html(
      page(
        "Factories",
        html`
          <h1>Factories</h1>
          <p><a class="button" href="/factories/new">+ New factory</a></p>
          <table>
            <tr><th>Name</th><th>Agent</th><th>Model</th><th>Directory</th><th>Status</th></tr>
            ${store.listFactories().map(
              (f) => html`<tr>
                <td><a href="/factories/${f.id}">${f.name}</a></td>
                <td>${f.agent}</td>
                <td>${f.model || "default"}</td>
                <td><code>${f.directory}</code></td>
                <td>${statusLabel(supervisor.status(f.id))}</td>
              </tr>`,
            )}
          </table>
        `,
      ),
    ),
  );

  // Registered before /factories/:id, so "new" isn't taken for an id.
  app.get("/factories/new", (c) =>
    c.html(
      page(
        "New factory",
        html`
          <p><a href="/">&larr; All factories</a></p>
          <h1>New factory</h1>
          ${factoryForm("/factories", NEW_FACTORY, "Create factory", models)}
        `,
      ),
    ),
  );

  app.post("/factories", async (c) => {
    const input = await readFactoryForm(c.req.raw);
    if (!input) return c.text(INVALID_FORM, 400);
    const id = store.createFactory(input);
    return c.redirect(`/factories/${id}`, 303);
  });

  app.get("/factories/:id", (c) => {
    const factory = store.getFactory(Number(c.req.param("id")));
    if (!factory) return c.notFound();
    const status = supervisor.status(factory.id);
    const running = status.state !== "stopped";

    return c.html(
      page(
        factory.name,
        html`
          <p><a href="/">&larr; All factories</a></p>
          <h1>${factory.name}</h1>
          <p>
            Status: <strong>${statusLabel(status)}</strong>
            <form method="post" action="/factories/${factory.id}/${running ? "stop" : "start"}" class="inline">
              <button>${running ? "Stop" : "Start"}</button>
            </form>
          </p>
          <h2>Runs</h2>
          ${runsTable(store.listRuns(factory.id))}
          <h2>Settings</h2>
          ${factoryForm(`/factories/${factory.id}`, factory, "Save", models)}
          <h2>Danger zone</h2>
          <form method="post" action="/factories/${factory.id}/delete">
            <button>Delete factory and its runs</button>
          </form>
        `,
      ),
    );
  });

  app.post("/factories/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const input = await readFactoryForm(c.req.raw);
    if (!input) return c.text(INVALID_FORM, 400);
    store.updateFactory(id, input);
    return c.redirect(`/factories/${id}`, 303);
  });

  app.post("/factories/:id/start", (c) => {
    const id = Number(c.req.param("id"));
    supervisor.start(id);
    return c.redirect(`/factories/${id}`, 303);
  });

  app.post("/factories/:id/stop", (c) => {
    const id = Number(c.req.param("id"));
    supervisor.stop(id);
    return c.redirect(`/factories/${id}`, 303);
  });

  app.post("/factories/:id/delete", (c) => {
    const id = Number(c.req.param("id"));
    supervisor.stop(id);
    store.deleteFactory(id);
    return c.redirect("/", 303);
  });

  app.get("/runs/:id", (c) => {
    const run = store.getRun(Number(c.req.param("id")));
    if (!run) return c.notFound();

    return c.html(
      page(
        `Run ${run.id}`,
        html`
          <p><a href="/factories/${run.factoryId}">&larr; Back to factory</a></p>
          <h1>Run ${run.id}</h1>
          <p>
            Status: <strong>${run.status}</strong> &middot; exit code: ${run.exitCode ?? "–"} &middot;
            started ${run.startedAt} &middot; finished ${run.finishedAt ?? "–"}
          </p>
          <pre id="output">${run.output}</pre>
          ${run.status === "running" ? followLive(run.id) : ""}
        `,
      ),
    );
  });

  // Server-Sent Events: the output so far, then each new piece, then an "end" event.
  app.get("/runs/:id/stream", (c) =>
    streamSSE(c, async (stream) => {
      await new Promise<void>((resolve) => {
        const unwatch = live.watch(
          Number(c.req.param("id")),
          (text) => void stream.writeSSE({ data: JSON.stringify(text) }),
          resolve,
        );
        if (!unwatch) return resolve();
        stream.onAbort(() => {
          unwatch();
          resolve();
        });
      });
      await stream.writeSSE({ event: "end", data: "" });
    }),
  );

  return app;
}

async function readFactoryForm(request: Request): Promise<FactoryInput | undefined> {
  const body = await request.formData();
  const field = (key: string) => String(body.get(key) ?? "").trim();
  const minutes = (key: string) => (/^\d+$/.test(field(key)) ? Number(field(key)) : 0);

  const input = {
    name: field("name"),
    prompt: field("prompt"),
    directory: field("directory"),
    agent: field("agent") as AgentName,
    model: field("model"),
    idleMinutes: minutes("idleMinutes"),
    maxRunMinutes: minutes("maxRunMinutes"),
  };
  const valid =
    input.name &&
    input.prompt &&
    input.directory &&
    AGENTS.includes(input.agent) &&
    input.idleMinutes >= 1 &&
    input.maxRunMinutes >= 1;
  return valid ? input : undefined;
}

function statusLabel(status: Status): string {
  if (status.state !== "sleeping") return status.state;
  return `sleeping until ${status.until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function factoryForm(action: string, factory: FactoryInput, button: string, models: ModelLists): Html {
  return html`
    <form method="post" action="${action}">
      <label>Name <input name="name" value="${factory.name}" required></label>
      <div class="row">
        <label>Agent
          <select name="agent" id="agent">
            ${AGENTS.map((a) => option(a, a, a === factory.agent))}
          </select>
        </label>
        <label>Model
          <select name="model" id="model">${modelOptions(models[factory.agent], factory.model)}</select>
        </label>
      </div>
      <label>Working directory <input name="directory" value="${factory.directory}" required></label>
      <div class="row">
        <label>Wait when there's nothing to do (minutes)
          <input type="number" min="1" step="1" name="idleMinutes" value="${factory.idleMinutes}" required>
        </label>
        <label>Max run time (minutes)
          <input type="number" min="1" step="1" name="maxRunMinutes" value="${factory.maxRunMinutes}" required>
        </label>
      </div>
      <label>Prompt <textarea name="prompt" rows="8" required>${factory.prompt}</textarea></label>
      <button>${button}</button>
    </form>
    ${followAgentChoice(models)}
  `;
}

/** The agent's models, plus "agent default". A saved model that's no longer listed is kept as an option. */
function modelOptions(available: string[], selected: string): Html {
  const models = selected && !available.includes(selected) ? [selected, ...available] : available;
  return html`${option("", "agent default", selected === "")}${models.map((m) => option(m, m, m === selected))}`;
}

function option(value: string, label: string, selected: boolean): Html {
  return selected
    ? html`<option value="${value}" selected>${label}</option>`
    : html`<option value="${value}">${label}</option>`;
}

/** When a different agent is picked, swap the model list for that agent's models. */
function followAgentChoice(models: ModelLists): Html {
  // "<" escaped so a model name can never close the script tag.
  const json = JSON.stringify(models).replaceAll("<", "\\u003c");
  return html`<script>
    (() => {
      const models = ${raw(json)};
      const agent = document.getElementById("agent");
      const model = document.getElementById("model");
      agent.addEventListener("change", () => {
        model.replaceChildren(new Option("agent default", ""), ...models[agent.value].map((m) => new Option(m, m)));
      });
    })();
  </script>`;
}

function runsTable(runs: Run[]): Html {
  if (runs.length === 0) return html`<p>No runs yet.</p>`;
  return html`
    <table>
      <tr><th>Run</th><th>Status</th><th>Started</th><th>Finished</th></tr>
      ${runs.map(
        (r) => html`<tr>
          <td><a href="/runs/${r.id}">#${r.id}</a></td>
          <td>${r.status}</td>
          <td>${r.startedAt}</td>
          <td>${r.finishedAt ?? "–"}</td>
        </tr>`,
      )}
    </table>
  `;
}

/** Appends live output to the page; reloads it when the run ends, to show the final status. */
function followLive(runId: number): Html {
  return html`<p><em>Live — this run is still going.</em></p>
    <script>
      const output = document.getElementById("output");
      const events = new EventSource("/runs/${raw(String(runId))}/stream");
      events.onmessage = (e) => {
        const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 20;
        output.textContent += JSON.parse(e.data);
        if (atBottom) window.scrollTo(0, document.body.scrollHeight);
      };
      events.addEventListener("end", () => {
        events.close();
        location.reload();
      });
    </script>`;
}

function page(title: string, body: Html): Html {
  return html`<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${title} · Software Factory</title>
        <style>
          body { font-family: system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; }
          table { border-collapse: collapse; width: 100%; }
          th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #ddd; }
          label { display: block; margin-bottom: .8rem; }
          input, textarea, select { display: block; width: 100%; font: inherit; padding: .3rem; box-sizing: border-box; }
          .row { display: flex; gap: 1rem; }
          .row > label { flex: 1; }
          pre { background: #f4f4f4; padding: 1rem; overflow-x: auto; white-space: pre-wrap; }
          form.inline { display: inline; margin-left: .5rem; }
          a.button { display: inline-block; padding: .4rem .8rem; border: 1px solid #888; border-radius: 4px;
            text-decoration: none; color: inherit; }
        </style>
      </head>
      <body>${body}</body>
    </html>`;
}
