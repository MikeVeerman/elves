import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

export type PiRequest = { bin: string; prompt: string; directory: string };
export type PiResult = { exitCode: number | null; output: string };
export type RunPi = (request: PiRequest) => Promise<PiResult>;

/** Runs `pi -p <prompt>` in the given directory and collects stdout + stderr. */
export const runPi: RunPi = ({ bin, prompt, directory }) =>
  new Promise((resolve, reject) => {
    // No shell is involved, so expand "~" ourselves.
    const cwd = directory.replace(/^~(?=$|\/)/, homedir());
    // Node reports a missing cwd as "spawn pi ENOENT", which looks like pi is missing. Say what's wrong.
    if (!existsSync(cwd)) return reject(new Error(`Working directory does not exist: ${cwd}`));

    const child = spawn(bin, ["-p", prompt], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, output }));
  });
