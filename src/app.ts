import { Hono } from "hono";
import { html, raw } from "hono/html";
import { streamSSE } from "hono/streaming";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Store, FactoryInput, Run } from "./store.ts";
import type { Supervisor, Status } from "./supervisor.ts";
import type { LiveRuns } from "./live.ts";
import type { ModelLists } from "./models.ts";
import { AGENTS, type AgentName } from "./agents.ts";
import { elf, moodFor } from "./elves.ts";
import { expandHome } from "./runner.ts";
import { resolve } from "node:path";

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

// Node timers can't wait longer than ~24.8 days; longer values fire right away. One week is plenty.
const MAX_MINUTES = 7 * 24 * 60;

const INVALID_FORM = `Please fill in a name, prompt and directory, pick an agent, and use whole minutes from 1 to ${MAX_MINUTES}.`;

export function createApp({ store, supervisor, live, models }: Deps) {
  const app = new Hono();

  app.get("/", (c) => {
    const factories = store.listFactories();
    return c.html(
      page(
        undefined,
        html`
          <div class="title-row">
            <h1>Your elves</h1>
            <a class="button" href="/factories/new">+ New elf</a>
          </div>
          ${factories.length === 0
            ? html`<div class="empty">
                ${elf("sleeping", 64)}
                <p>No elves yet. Hire your first one to start on the backlog.</p>
              </div>`
            : html`<table>
                <tr><th></th><th>Elf</th><th>Agent</th><th>Model</th><th>Directory</th><th>Status</th></tr>
                ${factories.map((f) => {
                  const status = supervisor.status(f.id);
                  return html`<tr>
                    <td class="avatar">${elf(moodFor(status), 32)}</td>
                    <td><a href="/factories/${f.id}">${f.name}</a></td>
                    <td>${f.agent}</td>
                    <td>${f.model || "default"}</td>
                    <td><code>${f.directory}</code></td>
                    <td>${statusPill(status)}</td>
                  </tr>`;
                })}
              </table>`}
        `,
      ),
    );
  });

  // Registered before /factories/:id, so "new" isn't taken for an id.
  app.get("/factories/new", (c) =>
    c.html(
      page(
        "New elf",
        html`
          <p><a href="/">&larr; All elves</a></p>
          <h1>New elf</h1>
          ${factoryForm("/factories", NEW_FACTORY, "Hire elf", models)}
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
    const runs = store.listRuns(factory.id);
    const runCount = store.countRuns(factory.id);
    const neighbours = store
      .listFactories()
      .filter((f) => f.id !== factory.id && sameFolder(f.directory, factory.directory));

    return c.html(
      page(
        factory.name,
        html`
          <p><a href="/">&larr; All elves</a></p>
          <div class="hero">
            ${elf(moodFor(status), 96)}
            <div>
              <h1>${factory.name}</h1>
              <div class="status-line">
                ${statusPill(status)}
                <form method="post" action="/factories/${factory.id}/${running ? "stop" : "start"}">
                  <button>${running ? "Stop" : "Start"}</button>
                </form>
              </div>
            </div>
          </div>
          ${neighbours.length > 0
            ? html`<p class="warning">
                ⚠ ${neighbours.map((f, i) => html`${i > 0 ? ", " : ""}<a href="/factories/${f.id}">${f.name}</a>`)}
                also works in this folder. Two agents working in one folder at the same time can get in
                each other's way.
              </p>`
            : ""}
          <h2>Runs</h2>
          ${runsTable(runs)}
          ${runCount > runs.length ? html`<p class="note">Showing the latest ${runs.length} of ${runCount} runs.</p>` : ""}
          <h2>Settings</h2>
          ${factoryForm(`/factories/${factory.id}`, factory, "Save", models)}
          <h2>Danger zone</h2>
          ${running
            ? html`<p>Stop this elf first. You can fire it once its current run has finished.</p>`
            : html`<form method="post" action="/factories/${factory.id}/delete">
                <button class="danger">Fire this elf (deletes its runs too)</button>
              </form>`}
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
    // A working elf's agent would keep running, and its run would be deleted from under it.
    if (supervisor.status(id).state !== "stopped") {
      return c.text("Stop this elf and wait for its current run to finish before firing it.", 409);
    }
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
          <p><a href="/factories/${run.factoryId}">&larr; Back to elf</a></p>
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
    [input.idleMinutes, input.maxRunMinutes].every((m) => m >= 1 && m <= MAX_MINUTES);
  return valid ? input : undefined;
}

function sameFolder(a: string, b: string): boolean {
  return resolve(expandHome(a)) === resolve(expandHome(b));
}

function statusPill(status: Status): Html {
  const label =
    status.state === "sleeping"
      ? `sleeping until ${status.until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : status.state;
  return html`<span class="pill pill-${moodFor(status)}">${label}</span>`;
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
          <input type="number" min="1" max="${MAX_MINUTES}" step="1" name="idleMinutes" value="${factory.idleMinutes}" required>
        </label>
        <label>Max run time (minutes)
          <input type="number" min="1" max="${MAX_MINUTES}" step="1" name="maxRunMinutes" value="${factory.maxRunMinutes}" required>
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

function page(title: string | undefined, body: Html): Html {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${title ? `${title} · Elves` : "Elves"}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet">
        <style>${raw(STYLE)}</style>
      </head>
      <body>
        <header class="site-header">
          <a href="/" class="brand">
            <span class="crew">${elf("working", 52)}${elf("sleeping", 52)}${elf("working", 52)}</span>
            <span>
              <span class="logo">ELVES</span>
              <span class="tagline">Your backlog gets done while you sleep.</span>
            </span>
          </a>
        </header>
        <main>${body}</main>
      </body>
    </html>`;
}

const STYLE = `
  :root {
    --bg: #fbf6ec; --card: #fffdf8; --ink: #2b2118; --muted: #7a6a58; --line: #e6dccb;
    --pine: #1f3b2d; --green: #2e8b57; --red: #c0392b; --gold: #e0b43c; --sky: #3f6e9e;
    --pixel: "Press Start 2P", ui-monospace, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 60rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
  a { color: var(--green); }
  h1, h2 { font-family: var(--pixel); font-weight: normal; line-height: 1.4; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  h2 { font-size: .8rem; margin: 2.5rem 0 1rem; color: var(--pine); }

  .site-header { background: var(--pine); border-bottom: 6px solid var(--gold); }
  .brand { display: flex; align-items: center; gap: 1.25rem; max-width: 60rem; margin: 0 auto;
    padding: 1rem; text-decoration: none; }
  .crew { display: flex; gap: .25rem; align-items: flex-end; }
  .logo { display: block; font-family: var(--pixel); font-size: 1.6rem; color: var(--gold);
    text-shadow: 3px 3px 0 #0f1f17; }
  .tagline { display: block; color: var(--bg); font-size: .9rem; margin-top: .4rem; opacity: .85; }
  .site-header .z { fill: var(--gold); }

  .title-row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin: .5rem 0 1rem; }
  .title-row h1 { margin: 0; }
  .hero { display: flex; align-items: center; gap: 1.25rem; margin: .5rem 0 1rem; }
  .status-line { display: flex; align-items: center; gap: .75rem; }
  .warning { background: #fff3cd; border: 2px solid var(--gold); padding: .6rem .8rem; }
  .note { color: var(--muted); font-size: .9rem; }
  .empty { text-align: center; padding: 2.5rem 1rem; border: 2px dashed var(--line); background: var(--card); }

  table { border-collapse: collapse; width: 100%; background: var(--card); border: 2px solid var(--ink);
    box-shadow: 4px 4px 0 var(--ink); }
  th { font-family: var(--pixel); font-size: .6rem; font-weight: normal; background: #f1e8d6; }
  th, td { text-align: left; padding: .5rem .7rem; border-bottom: 1px solid var(--line); vertical-align: middle; }
  td.avatar { width: 1%; padding: .25rem .5rem; }
  code { font-size: .85em; }

  .pill { display: inline-block; padding: .1rem .55rem; font-size: .8rem; color: white; border: 2px solid var(--ink); }
  .pill-working { background: var(--green); }
  .pill-sleeping { background: var(--sky); }
  .pill-off { background: var(--muted); }

  button, a.button { display: inline-block; font-family: var(--pixel); font-size: .65rem; padding: .7rem 1rem;
    background: var(--red); color: white; border: 2px solid var(--ink); box-shadow: 3px 3px 0 var(--ink);
    text-decoration: none; cursor: pointer; }
  button:hover, a.button:hover { transform: translate(1px, 1px); box-shadow: 2px 2px 0 var(--ink); }
  button:active, a.button:active { transform: translate(3px, 3px); box-shadow: none; }
  button.danger { background: var(--ink); }

  label { display: block; margin-bottom: 1rem; font-weight: 600; font-size: .9rem; }
  input, textarea, select { display: block; width: 100%; margin-top: .3rem; font: 400 1rem system-ui, sans-serif;
    padding: .45rem .55rem; background: white; border: 2px solid var(--ink); border-radius: 0; }
  input:focus, textarea:focus, select:focus { outline: 3px solid var(--gold); outline-offset: 0; }
  .row { display: flex; gap: 1rem; }
  .row > label { flex: 1; }

  pre { background: #1d1a16; color: #f3ead8; padding: 1rem; overflow-x: auto; white-space: pre-wrap;
    border: 2px solid var(--ink); box-shadow: 4px 4px 0 var(--ink); }

  .elf { display: block; }
  .elf-working .frame-up { animation: hammer-up .6s steps(1) infinite; }
  .elf-working .frame-down { animation: hammer-down .6s steps(1) infinite; }
  @keyframes hammer-up { 0% { visibility: visible; } 50% { visibility: hidden; } }
  @keyframes hammer-down { 0% { visibility: hidden; } 50% { visibility: visible; } }
  .elf .z { font: 4px var(--pixel); fill: var(--pine); animation: float 2.4s ease-in-out infinite; }
  .elf .z2 { animation-delay: 1.2s; }
  @keyframes float { 0% { opacity: 0; transform: translateY(2px); } 30% { opacity: 1; }
    100% { opacity: 0; transform: translateY(-3px); } }
  .elf-off { filter: grayscale(1); opacity: .55; }
  @media (prefers-reduced-motion: reduce) {
    .elf * { animation: none !important; }
    .elf-working .frame-down { visibility: hidden; }
  }

  @media (max-width: 40rem) {
    .row { flex-direction: column; gap: 0; }
    .crew .elf:nth-child(n + 2) { display: none; }
    .logo { font-size: 1.2rem; }
    table { font-size: .85rem; }
    th:nth-child(5), td:nth-child(5) { display: none; }
  }
`;
