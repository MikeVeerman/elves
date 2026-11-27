import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { Transcript } from "./transcript.ts";

export type PiRequest = { bin: string; prompt: string; directory: string; onOutput?: (text: string) => void };
export type PiResult = { exitCode: number | null; output: string; finalText: string };
export type RunPi = (request: PiRequest) => Promise<PiResult>;

/**
 * Runs `pi --mode json -p <prompt>` in the given directory.
 * Returns a readable log (also streamed through onOutput) and pi's final message.
 */
export const runPi: RunPi = ({ bin, prompt, directory, onOutput }) =>
  new Promise((resolve, reject) => {
    // No shell is involved, so expand "~" ourselves.
    const cwd = directory.replace(/^~(?=$|\/)/, homedir());
    // Node reports a missing cwd as "spawn pi ENOENT", which looks like pi is missing. Say what's wrong.
    if (!existsSync(cwd)) return reject(new Error(`Working directory does not exist: ${cwd}`));

    const child = spawn(bin, ["--mode", "json", "-p", prompt], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const transcript = new Transcript();
    let output = "";
    const emit = (text: string) => {
      if (!text) return;
      output += text;
      onOutput?.(text);
    };

    // Decode as UTF-8 per stream, so a character split across two chunks stays intact.
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => emit(transcript.push(chunk)));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => emit(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      emit(transcript.end());
      resolve({ exitCode, output, finalText: transcript.finalText });
    });
  });
