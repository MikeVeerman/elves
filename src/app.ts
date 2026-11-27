import { Hono, type Context } from "hono";
import { html, raw } from "hono/html";
import { streamSSE } from "hono/streaming";
import { resolve } from "node:path";
import type { Store, Run } from "./store.ts";
import type { Supervisor, Status } from "./supervisor.ts";
import type { LiveRuns } from "./live.ts";
import type { ModelLists } from "./models.ts";
import { elf, moodFor } from "./elves.ts";
import { expandHome } from "./runner.ts";
import { credentialsMatch, endSession, requireLogin, startSession, type AuthConfig } from "./auth.ts";
import { page, type Html } from "./layout.ts";
import { NEW_FACTORY, INVALID_FORM, readFactoryForm, factoryForm } from "./form.ts";

type Deps = { store: Store; supervisor: Supervisor; live: LiveRuns; models: ModelLists; auth: AuthConfig };

/** The numeric :id from the URL. */
const idParam = (c: Context) => Number(c.req.param("id"));

export function createApp({ store, supervisor, live, models, auth }: Deps) {
  const app = new Hono();

  // The login page is the only thing reachable without a session.
  app.get("/login", (c) => c.html(loginPage()));

  app.post("/login", async (c) => {
    const body = await c.req.formData();
    const given = { username: String(body.get("username") ?? ""), password: String(body.get("password") ?? "") };
    if (!credentialsMatch(given, auth)) return c.html(loginPage("Wrong username or password."), 401);
    await startSession(c, auth);
    return c.redirect("/", 303);
  });

  app.use("*", requireLogin(auth));

  app.post("/warning/acknowledge", (c) => {
    store.acknowledgeWarning();
    return c.redirect("/", 303);
  });

  app.post("/logout", (c) => {
    endSession(c);
    return c.redirect("/login", 303);
  });

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
          ${store.isWarningAcknowledged() ? "" : permissionsWarning()}
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
    const factory = store.getFactory(idParam(c));
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
                ${controlButton(factory.id, status)}
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
    const id = idParam(c);
    const input = await readFactoryForm(c.req.raw);
    if (!input) return c.text(INVALID_FORM, 400);
    store.updateFactory(id, input);
    return c.redirect(`/factories/${id}`, 303);
  });

  app.post("/factories/:id/start", (c) => {
    const id = idParam(c);
    supervisor.start(id);
    return c.redirect(`/factories/${id}`, 303);
  });

  app.post("/factories/:id/stop", (c) => {
    const id = idParam(c);
    supervisor.stop(id);
    return c.redirect(`/factories/${id}`, 303);
  });

  app.post("/factories/:id/force-stop", (c) => {
    const id = idParam(c);
    supervisor.forceStop(id);
    return c.redirect(`/factories/${id}`, 303);
  });

  app.post("/factories/:id/delete", (c) => {
    const id = idParam(c);
    // A working elf's agent would keep running, and its run would be deleted from under it.
    if (supervisor.status(id).state !== "stopped") {
      return c.text("Stop this elf and wait for its current run to finish before firing it.", 409);
    }
    store.deleteFactory(id);
    return c.redirect("/", 303);
  });

  app.get("/runs/:id", (c) => {
    const run = store.getRun(idParam(c));
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
          idParam(c),
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

function sameFolder(a: string, b: string): boolean {
  return resolve(expandHome(a)) === resolve(expandHome(b));
}

/** Shown after login until someone acknowledges it: elves can do a lot of damage in the wrong hands. */
function permissionsWarning(): Html {
  return html`<dialog id="permissions-warning" aria-labelledby="warning-title">
      <div class="warning-elf">${elf("alert", 96)}</div>
      <h2 id="warning-title">Before you hire any elves</h2>
      <p><strong>Agents run with every permission.</strong> Elves starts Claude Code, Codex, pi and
        opencode without permission prompts. An elf can run any command, change or delete any file
        this user account can reach, and push code.</p>
      <p><strong>Keep network access limited.</strong> Only reach Elves on this machine or over a
        private network like your tailnet. Never expose it to the internet.</p>
      <p><strong>Keep the login safe.</strong> Whoever knows <code>ELVES_USERNAME</code> and
        <code>ELVES_PASSWORD</code> can make agents do anything on this machine. Use a long, unique
        password and don't share it.</p>
      <form method="post" action="/warning/acknowledge">
        <button>I understand</button>
      </form>
    </dialog>
    <script>
      (() => {
        const dialog = document.getElementById("permissions-warning");
        dialog.showModal();
        // Only "I understand" closes it; Escape doesn't.
        dialog.addEventListener("cancel", (e) => e.preventDefault());
      })();
    </script>`;
}

/**
 * Start when stopped, Stop while working or napping. Stop lets the current run finish, so while
 * that happens ("stopping") the button turns into Force stop, which kills the agent right away.
 */
function controlButton(id: number, status: Status): Html {
  const [action, label, style] =
    status.state === "stopped"
      ? ["start", "Start", ""]
      : status.state === "stopping"
        ? ["force-stop", "Force stop", "danger"]
        : ["stop", "Stop", ""];
  return html`<form method="post" action="/factories/${id}/${action}">
    <button class="${style}">${label}</button>
  </form>`;
}

function statusPill(status: Status): Html {
  const label =
    status.state === "sleeping"
      ? `sleeping until ${status.until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : status.state;
  return html`<span class="pill pill-${moodFor(status)}">${label}</span>`;
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

function loginPage(error?: string): Html {
  return page(
    "Log in",
    html`
      <div class="login">
        <h1>Log in</h1>
        ${error ? html`<p class="warning">${error}</p>` : ""}
        <form method="post" action="/login">
          <label>Username <input name="username" autocomplete="username" required autofocus></label>
          <label>Password <input type="password" name="password" autocomplete="current-password" required></label>
          <button>Log in</button>
        </form>
      </div>
    `,
    { loggedIn: false },
  );
}
