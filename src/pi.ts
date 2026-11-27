import { spawn } from "node:child_process";

export type PiRequest = { bin: string; prompt: string; directory: string };
export type PiResult = { exitCode: number | null; output: string };
export type RunPi = (request: PiRequest) => Promise<PiResult>;

/** Runs `pi -p <prompt>` in the given directory and collects stdout + stderr. */
export const runPi: RunPi = ({ bin, prompt, directory }) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, ["-p", prompt], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, output }));
  });
