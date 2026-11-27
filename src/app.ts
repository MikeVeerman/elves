import { Hono } from "hono";
import { html, raw } from "hono/html";
import { streamSSE } from "hono/streaming";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Store, FactoryInput, Run } from "./store.ts";
import type { Supervisor, Status } from "./supervisor.ts";
import type { LiveRuns } from "./live.ts";

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

export function createApp({ store, supervisor, live }: { store: Store; supervisor: Supervisor; live: LiveRuns }) {
  const app = new Hono();

  app.get("/", (c) =>
    c.html(
      page(
        "Factories",
        html`
          <h1>Factories</h1>
          <table>
            <tr><th>Name</th><th>Directory</th><th>Status</th></tr>
            ${store.listFactories().map(
              (f) => html`<tr>
                <td><a href="/factories/${f.id}">${f.name}</a></td>
                <td><code>${f.directory}</code></td>
                <td>${statusLabel(supervisor.status(f.id))}</td>
              </tr>`,
            )}
          </table>
          <h2>Add a factory</h2>
          ${factoryForm("/factories", { name: "", prompt: "", directory: "" }, "Add factory")}
        `,
      ),
    ),
  );

  app.post("/factories", async (c) => {
    const input = await readFactoryForm(c.req.raw);
    if (!input) return c.text("Name, prompt and directory are all required.", 400);
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
          <h2>Settings</h2>
          ${factoryForm(`/factories/${factory.id}`, factory, "Save")}
          <h2>Runs</h2>
          ${runsTable(store.listRuns(factory.id))}
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
    if (!input) return c.text("Name, prompt and directory are all required.", 400);
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
  const input = { name: field("name"), prompt: field("prompt"), directory: field("directory") };
  return input.name && input.prompt && input.directory ? input : undefined;
}

function statusLabel(status: Status): string {
  if (status.state !== "sleeping") return status.state;
  return `sleeping until ${status.until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function factoryForm(action: string, factory: FactoryInput, button: string): Html {
  return html`
    <form method="post" action="${action}">
      <label>Name <input name="name" value="${factory.name}" required></label>
      <label>Working directory <input name="directory" value="${factory.directory}" required></label>
      <label>Prompt <textarea name="prompt" rows="8" required>${factory.prompt}</textarea></label>
      <button>${button}</button>
    </form>
  `;
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
          input, textarea { display: block; width: 100%; font: inherit; padding: .3rem; box-sizing: border-box; }
          pre { background: #f4f4f4; padding: 1rem; overflow-x: auto; white-space: pre-wrap; }
          form.inline { display: inline; margin-left: .5rem; }
        </style>
      </head>
      <body>${body}</body>
    </html>`;
}
