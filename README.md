# Simple Software Factory

Each factory is a loop around the [pi](https://github.com/badlogic/pi-mono) coding agent:

```
forever:
  run `pi -p "<factory prompt>"` in the factory's directory
  save the run (status, exit code, output)
  if pi did a task: run again straight away
  otherwise (nothing to do, or failed): sleep 30 minutes
```

A factory has a **name**, a **prompt** and a **working directory**. The prompt tells pi where the
backlog is and how to pick the next item, for example:

> Take the oldest open GitHub issue labeled `factory`, implement it, open a PR and comment on the issue.

Every prompt gets one fixed line added: if there is no task, pi must end its reply with
`NO_TASK_AVAILABLE`. That marker is how the loop knows to sleep.

## Run

```sh
npm install
npm start          # http://localhost:3000
```

Settings (environment variables):

| Variable  | Default      | Meaning                  |
|-----------|--------------|--------------------------|
| `PORT`    | `3000`       | Web interface port       |
| `DB_PATH` | `factory.db` | SQLite file              |
| `PI_BIN`  | `pi`         | Path to the pi binary    |

Factories that were running come back up after a server restart. A run that was cut off by the
restart shows as `interrupted`. Stopping a factory lets the current run finish first.

## Develop

```sh
npm test           # unit tests
npm run coverage   # tests + coverage report (coverage/index.html)
npm run typecheck
```

Needs Node 24+ (uses the built-in `node:sqlite` and runs TypeScript directly, no build step).
