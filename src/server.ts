import { serve } from "@hono/node-server";
import { setTimeout as sleep } from "node:timers/promises";
import { Store } from "./store.ts";
import { Supervisor } from "./supervisor.ts";
import { runAgent } from "./agents.ts";
import { killAllRuns } from "./runner.ts";
import { loadModels } from "./models.ts";
import { createApp } from "./app.ts";
import { LiveRuns } from "./live.ts";

const port = Number(process.env.PORT ?? 3000);
// No login, and a factory can run any prompt: only listen on localhost unless told otherwise.
const hostname = process.env.HOST ?? "127.0.0.1";
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

serve({ fetch: createApp({ store, supervisor, live, models }).fetch, port, hostname }, () => {
  console.log(`Software factory running on http://${hostname}:${port}`);
});

// Agents run in their own process group, so Ctrl-C doesn't reach them. Stop them ourselves.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    killAllRuns();
    process.exit(0);
  });
}
