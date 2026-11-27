import { DatabaseSync } from "node:sqlite";

export type Factory = {
  id: number;
  name: string;
  prompt: string;
  directory: string;
  enabled: boolean;
};

export type FactoryInput = Pick<Factory, "name" | "prompt" | "directory">;

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
  status: Exclude<RunStatus, "running" | "interrupted">;
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
`;

const RUN_COLUMNS = `id, factory_id AS factoryId, status, exit_code AS exitCode, output,
  started_at AS startedAt, finished_at AS finishedAt`;

export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  createFactory(input: FactoryInput): number {
    const result = this.db
      .prepare("INSERT INTO factories (name, prompt, directory) VALUES (?, ?, ?)")
      .run(input.name, input.prompt, input.directory);
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
      .prepare("UPDATE factories SET name = ?, prompt = ?, directory = ? WHERE id = ?")
      .run(input.name, input.prompt, input.directory, id);
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

  listRuns(factoryId: number): Run[] {
    return this.db
      .prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE factory_id = ? ORDER BY id DESC`)
      .all(factoryId) as Run[];
  }

  markUnfinishedRunsInterrupted(): void {
    this.db
      .prepare("UPDATE runs SET status = 'interrupted', finished_at = ? WHERE status = 'running'")
      .run(now());
  }
}

function toFactory(row: Record<string, unknown>): Factory {
  return {
    id: row.id as number,
    name: row.name as string,
    prompt: row.prompt as string,
    directory: row.directory as string,
    enabled: row.enabled === 1,
  };
}

function now(): string {
  return new Date().toISOString();
}
