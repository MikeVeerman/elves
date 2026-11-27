# Simple Software Factory

Each factory is a loop around a coding agent (pi, Claude Code, Codex or opencode):

```
forever:
  run the agent once, with the factory's prompt, in the factory's directory
  save the run (status, exit code, output)
  if the agent did a task: run again straight away
  otherwise (nothing to do, or failed): wait, then check again
```

A factory has:

| Setting | Meaning |
|---|---|
| Name | Shown in the list |
| Agent | `pi`, `claude`, `codex` or `opencode` |
| Model | Picked from the agent's own model list, or "agent default" |
| Working directory | Where the agent runs. `~` works |
| Wait when there's nothing to do | Minutes to wait before checking again (default 30). Also used after a failed run |
| Max run time | Minutes one run may take before it's killed and marked failed (default 60) |
| Prompt | Tells the agent where the backlog is and how to pick the next item |

Example prompt:

> Take the oldest open GitHub issue labeled `factory`, implement it, open a PR and comment on the issue.

Every prompt gets one fixed line added: if there is no task, the agent must end its reply with
`NO_TASK_AVAILABLE`. That marker is how the loop knows to wait.

**Agents run with full access, without permission prompts** (`--dangerously-skip-permissions` for
claude, `--dangerously-bypass-approvals-and-sandbox` for codex; pi and opencode allow everything by
default). Nobody is there to answer a prompt, so a factory would stall otherwise. Only point a
factory at directories and backlogs you trust.

While a run is going, its page shows the agent's output live.

Model lists come from `pi --list-models`, `opencode models` and `~/.codex/models_cache.json`;
claude has a fixed list. They are read once when the server starts.

## Run

```sh
npm install
npm start          # http://localhost:3000
```

Settings (environment variables):

| Variable  | Default      | Meaning                  |
|-----------|--------------|--------------------------|
| `HOST`    | `127.0.0.1`  | Address to listen on (there is no login, so keep it local) |
| `PORT`    | `3000`       | Web interface port       |
| `DB_PATH` | `factory.db` | SQLite file              |

Factories that were running come back up after a server restart. A run that was cut off by the
restart shows as `interrupted`. Stopping a factory lets the current run finish first.
Stopping the server (Ctrl-C) also stops any agent that is still running.

## Develop

```sh
npm test           # unit tests
npm run coverage   # tests + coverage report (coverage/index.html)
npm run typecheck
```

Needs Node 24+ (uses the built-in `node:sqlite` and runs TypeScript directly, no build step).
