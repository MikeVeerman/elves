import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, realpathSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { runPi } from "../src/pi.ts";

describe("runPi", () => {
  let fakePi: string;
  let workDir: string;

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), "fake-pi-"));
    fakePi = join(dir, "pi");
    // Prints its args and working dir as plain lines, then a final assistant message as a JSON event.
    writeFileSync(
      fakePi,
      `#!/bin/sh
echo "args: $*"
echo "cwd: $(pwd)"
echo "oops" >&2
echo '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"All done."}}'
echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"All done."}]}}'
exit \${FAKE_EXIT:-0}
`,
    );
    chmodSync(fakePi, 0o755);
    workDir = realpathSync(mkdtempSync(join(tmpdir(), "work-")));
  });

  it("runs pi in JSON print mode with the prompt, inside the directory", async () => {
    const result = await runPi({ bin: fakePi, prompt: "do the thing", directory: workDir });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("args: --mode json -p do the thing");
    expect(result.output).toContain(`cwd: ${workDir}`);
  });

  it("turns JSON events into a readable log", async () => {
    const result = await runPi({ bin: fakePi, prompt: "x", directory: workDir });

    expect(result.output).toContain("All done.");
    expect(result.output).not.toContain('"type"');
  });

  it("returns the final assistant message", async () => {
    const result = await runPi({ bin: fakePi, prompt: "x", directory: workDir });

    expect(result.finalText).toBe("All done.");
  });

  it("reports output while it runs", async () => {
    const pieces: string[] = [];

    const result = await runPi({ bin: fakePi, prompt: "x", directory: workDir, onOutput: (t) => pieces.push(t) });

    expect(pieces.join("")).toBe(result.output);
  });

  it("captures stderr in the output", async () => {
    const result = await runPi({ bin: fakePi, prompt: "x", directory: workDir });

    expect(result.output).toContain("oops");
  });

  it("returns a non-zero exit code", async () => {
    process.env.FAKE_EXIT = "3";
    try {
      const result = await runPi({ bin: fakePi, prompt: "x", directory: workDir });
      expect(result.exitCode).toBe(3);
    } finally {
      delete process.env.FAKE_EXIT;
    }
  });

  it("expands a leading ~ to the home directory", async () => {
    const home = realpathSync(homedir());

    const result = await runPi({ bin: fakePi, prompt: "x", directory: "~" });

    expect(result.output).toContain(`cwd: ${home}`);
  });

  it("rejects with a clear message when the directory does not exist", async () => {
    await expect(
      runPi({ bin: fakePi, prompt: "x", directory: "/does/not/exist" }),
    ).rejects.toThrow("Working directory does not exist: /does/not/exist");
  });

  it("rejects when pi cannot be started", async () => {
    await expect(
      runPi({ bin: "/no/such/pi", prompt: "x", directory: workDir }),
    ).rejects.toThrow("ENOENT");
  });
});
