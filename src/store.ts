import { DatabaseSync } from "node:sqlite";
import type { AgentName } from "./agents.ts";

export type Factory = {
  id: number;
  name: string;
  prompt: string;
  directory: string;
  agent: AgentName;
  /** Empty means: the agent's own default model. */
  model: string;
  /** How long to wait before checking again when there was nothing to do (or the run failed). */
  idleMinutes: number;
  /** A run that takes longer than this gets killed and marked failed. */
  maxRunMinutes: number;
  enabled: boolean;
};

export type FactoryInput = Omit<Factory, "id" | "enabled">;

export type RunStatus = "running" | "done" | "idle" | "failed" | "interrupted";

export type Run = {
  id: number;
  factoryId: number;
  status: RunStatus;
  exitCode: number | null;
  output: string;
  startedAt: string;
  finishedAt: string | null;
};

export type RunResult = {
  status: Exclude<RunStatus, "running">;
  exitCode: number | null;
  output: string;
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS factories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    directory TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY,
    factory_id INTEGER NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    exit_code INTEGER,
    output TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX IF NOT EXISTS runs_by_factory ON runs (factory_id, id);
`;

// Settings added after the first version. Added to existing databases on startup.
const ADDED_FACTORY_COLUMNS = {
  agent: "TEXT NOT NULL DEFAULT 'pi'",
  model: "TEXT NOT NULL DEFAULT ''",
  idle_minutes: "INTEGER NOT NULL DEFAULT 30",
  max_run_minutes: "INTEGER NOT NULL DEFAULT 60",
};

const RUN_COLUMNS = `id, factory_id AS factoryId, status, exit_code AS exitCode, output,
  started_at AS startedAt, finished_at AS finishedAt`;

export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA);
    this.addMissingColumns();
  }

  private addMissingColumns(): void {
    const existing = new Set(this.db.prepare("PRAGMA table_info(factories)").all().map((c) => c.name));
    for (const [column, definition] of Object.entries(ADDED_FACTORY_COLUMNS)) {
      if (!existing.has(column)) this.db.exec(`ALTER TABLE factories ADD COLUMN ${column} ${definition}`);
    }
  }

  createFactory(input: FactoryInput): number {
    const result = this.db
      .prepare(
        `INSERT INTO factories (name, prompt, directory, agent, model, idle_minutes, max_run_minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...factoryValues(input));
    return Number(result.lastInsertRowid);
  }

  getFactory(id: number): Factory | undefined {
    const row = this.db.prepare("SELECT * FROM factories WHERE id = ?").get(id);
    return row ? toFactory(row) : undefined;
  }

  listFactories(): Factory[] {
    return this.db.prepare("SELECT * FROM factories ORDER BY id").all().map(toFactory);
  }

  updateFactory(id: number, input: FactoryInput): void {
    this.db
      .prepare(
        `UPDATE factories SET name = ?, prompt = ?, directory = ?, agent = ?, model = ?,
         idle_minutes = ?, max_run_minutes = ? WHERE id = ?`,
      )
      .run(...factoryValues(input), id);
  }

  setEnabled(id: number, enabled: boolean): void {
    this.db.prepare("UPDATE factories SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  }

  deleteFactory(id: number): void {
    this.db.prepare("DELETE FROM factories WHERE id = ?").run(id);
  }

  startRun(factoryId: number): number {
    const result = this.db
      .prepare("INSERT INTO runs (factory_id, status, started_at) VALUES (?, 'running', ?)")
      .run(factoryId, now());
    return Number(result.lastInsertRowid);
  }

  finishRun(id: number, result: RunResult): void {
    this.db
      .prepare("UPDATE runs SET status = ?, exit_code = ?, output = ?, finished_at = ? WHERE id = ?")
      .run(result.status, result.exitCode, result.output, now(), id);
  }

  getRun(id: number): Run | undefined {
    return this.db.prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = ?`).get(id) as Run | undefined;
  }

  /** The newest runs first. An idle elf adds a run every wait period, so the list is capped. */
  listRuns(factoryId: number, limit = 50): Run[] {
    return this.db
      .prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE factory_id = ? ORDER BY id DESC LIMIT ?`)
      .all(factoryId, limit) as Run[];
  }

  countRuns(factoryId: number): number {
    return this.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE factory_id = ?").get(factoryId)!.n as number;
  }

  markUnfinishedRunsInterrupted(): void {
    this.db
      .prepare("UPDATE runs SET status = 'interrupted', finished_at = ? WHERE status = 'running'")
      .run(now());
  }
}

function factoryValues(input: FactoryInput) {
  return [input.name, input.prompt, input.directory, input.agent, input.model, input.idleMinutes, input.maxRunMinutes];
}

function toFactory(row: Record<string, unknown>): Factory {
  return {
    id: row.id as number,
    name: row.name as string,
    prompt: row.prompt as string,
    directory: row.directory as string,
    agent: row.agent as AgentName,
    model: row.model as string,
    idleMinutes: row.idle_minutes as number,
    maxRunMinutes: row.max_run_minutes as number,
    enabled: row.enabled === 1,
  };
}

function now(): string {
  return new Date().toISOString();
}
