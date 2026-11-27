import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, realpathSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { runCommand, killAllRuns } from "../src/runner.ts";
import { PiLog } from "../src/parsers.ts";

describe("runCommand", () => {
  let fakeAgent: string;
  let workDir: string;

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), "fake-agent-"));
    fakeAgent = join(dir, "agent");
    // Prints its args and working dir as plain lines, then a final assistant message as pi JSON events.
    writeFileSync(
      fakeAgent,
      `#!/bin/sh
echo "args: $*"
echo "cwd: $(pwd)"
echo "oops" >&2
[ -n "$FAKE_SLEEP" ] && sleep "$FAKE_SLEEP"
echo '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"All done."}}'
echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"All done."}]}}'
exit \${FAKE_EXIT:-0}
`,
    );
    chmodSync(fakeAgent, 0o755);
    workDir = realpathSync(mkdtempSync(join(tmpdir(), "work-")));
  });

  const run = (overrides: Partial<Parameters<typeof runCommand>[0]> = {}) =>
    runCommand({ bin: fakeAgent, args: ["one", "two"], directory: workDir, log: new PiLog(), timeoutMs: 10_000, ...overrides });

  it("runs the command with its args, inside the directory", async () => {
    const result = await run();

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("args: one two");
    expect(result.output).toContain(`cwd: ${workDir}`);
  });

  it("turns JSON events into a readable log", async () => {
    const result = await run();

    expect(result.output).toContain("All done.");
    expect(result.output).not.toContain('"type"');
  });

  it("returns the final assistant message", async () => {
    expect((await run()).finalText).toBe("All done.");
  });

  it("reports output while it runs", async () => {
    const pieces: string[] = [];

    const result = await run({ onOutput: (t) => pieces.push(t) });

    expect(pieces.join("")).toBe(result.output);
  });

  it("captures stderr in the output", async () => {
    expect((await run()).output).toContain("oops");
  });

  it("returns a non-zero exit code", async () => {
    process.env.FAKE_EXIT = "3";
    try {
      expect((await run()).exitCode).toBe(3);
    } finally {
      delete process.env.FAKE_EXIT;
    }
  });

  it("kills the run when it takes longer than the timeout", async () => {
    process.env.FAKE_SLEEP = "5";
    try {
      const result = await run({ timeoutMs: 200 });

      expect(result.exitCode).toBeNull();
      expect(result.output).toContain("[killed: the run took longer than the max run time]");
      expect(result.output).not.toContain("All done.");
    } finally {
      delete process.env.FAKE_SLEEP;
    }
  });

  it("force-kills a command that ignores the stop request", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stubborn-"));
    const stubborn = join(dir, "agent");
    writeFileSync(stubborn, "#!/bin/sh\ntrap '' TERM\nsleep 5\n");
    chmodSync(stubborn, 0o755);

    const started = Date.now();
    const result = await run({ bin: stubborn, timeoutMs: 100, killGraceMs: 100 });

    expect(result.exitCode).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("can kill every running command, e.g. when the server shuts down", async () => {
    process.env.FAKE_SLEEP = "5";
    try {
      const running = run();
      await new Promise((r) => setTimeout(r, 100));

      killAllRuns();

      expect((await running).exitCode).toBeNull();
    } finally {
      delete process.env.FAKE_SLEEP;
    }
  });

  it("expands a leading ~ to the home directory", async () => {
    const home = realpathSync(homedir());

    expect((await run({ directory: "~" })).output).toContain(`cwd: ${home}`);
  });

  it("rejects with a clear message when the directory does not exist", async () => {
    await expect(run({ directory: "/does/not/exist" })).rejects.toThrow(
      "Working directory does not exist: /does/not/exist",
    );
  });

  it("rejects when the command cannot be started", async () => {
    await expect(run({ bin: "/no/such/agent" })).rejects.toThrow("ENOENT");
  });
});
