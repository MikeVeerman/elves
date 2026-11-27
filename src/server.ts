import { serve } from "@hono/node-server";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Store } from "./store.ts";
import { Supervisor } from "./supervisor.ts";
import { runAgent } from "./agents.ts";
import { killAllRuns } from "./runner.ts";
import { loadModels } from "./models.ts";
import { createApp } from "./app.ts";
import { LiveRuns } from "./live.ts";

const port = Number(process.env.PORT ?? 3000);
// Only listen on localhost unless told otherwise. On a tailnet, `tailscale serve` can expose it.
const hostname = process.env.HOST ?? "127.0.0.1";

// Whoever can log in can make agents run anything, so there is no way to run without a login.
const username = process.env.ELVES_USERNAME;
const password = process.env.ELVES_PASSWORD;
if (!username || !password) {
  console.error("Set ELVES_USERNAME and ELVES_PASSWORD to choose the login for the web interface.");
  process.exit(1);
}
// A new secret on every start: restarting the server logs everyone out.
const auth = { username, password, secret: randomBytes(32).toString("hex") };
const store = new Store(process.env.DB_PATH ?? "factory.db");

const live = new LiveRuns();
const supervisor = new Supervisor({
  store,
  live,
  runAgent,
  // Stopping a factory aborts its sleep; that ends the wait early instead of being an error.
  sleep: (ms, signal) => sleep(ms, undefined, { signal }).catch(() => {}),
});

// Read once at startup; restart the server to pick up new models.
const models = await loadModels();
supervisor.resume();

serve({ fetch: createApp({ store, supervisor, live, models, auth }).fetch, port, hostname }, () => {
  console.log(`Elves running on http://${hostname}:${port}`);
});

// Agents run in their own process group, so Ctrl-C doesn't reach them. Stop them ourselves.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    killAllRuns();
    process.exit(0);
  });
}
