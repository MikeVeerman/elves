import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPi } from "../src/pi.ts";

describe("runPi", () => {
  let fakePi: string;
  let workDir: string;

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), "fake-pi-"));
    fakePi = join(dir, "pi");
    // Prints its args and working dir, writes to stderr, exits with $FAKE_EXIT.
    writeFileSync(
      fakePi,
      `#!/bin/sh
echo "args: $*"
echo "cwd: $(pwd)"
echo "oops" >&2
exit \${FAKE_EXIT:-0}
`,
    );
    chmodSync(fakePi, 0o755);
    workDir = realpathSync(mkdtempSync(join(tmpdir(), "work-")));
  });

  it("runs pi in print mode with the prompt, inside the directory", async () => {
    const result = await runPi({ bin: fakePi, prompt: "do the thing", directory: workDir });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("args: -p do the thing");
    expect(result.output).toContain(`cwd: ${workDir}`);
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

  it("rejects when pi cannot be started", async () => {
    await expect(
      runPi({ bin: fakePi, prompt: "x", directory: "/does/not/exist" }),
    ).rejects.toThrow();
  });
});
