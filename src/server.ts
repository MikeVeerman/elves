import { serve } from "@hono/node-server";
import { setTimeout as sleep } from "node:timers/promises";
import { Store } from "./store.ts";
import { Supervisor } from "./supervisor.ts";
import { runPi } from "./pi.ts";
import { createApp } from "./app.ts";

const port = Number(process.env.PORT ?? 3000);
const store = new Store(process.env.DB_PATH ?? "factory.db");

const supervisor = new Supervisor({
  store,
  runPi,
  piBin: process.env.PI_BIN ?? "pi",
  idleDelayMs: 30 * 60 * 1000,
  // Stopping a factory aborts its sleep; that ends the wait early instead of being an error.
  sleep: (ms, signal) => sleep(ms, undefined, { signal }).catch(() => {}),
});
supervisor.resume();

serve({ fetch: createApp({ store, supervisor }).fetch, port }, () => {
  console.log(`Software factory running on http://localhost:${port}`);
});
