import { describe, it, expect } from "vitest";
import { PiLog, ClaudeLog, CodexLog, OpencodeLog, MAX_TOOL_RESULT_CHARS } from "../src/parsers.ts";

const line = (event: object) => JSON.stringify(event) + "\n";
const textDelta = (delta: string) =>
  line({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta } });

describe("PiLog", () => {
  it("turns assistant text deltas into text", () => {
    const t = new PiLog();

    expect(t.push(textDelta("Hello") + textDelta(" world"))).toBe("Hello world");
  });

  it("ends a text block with a newline", () => {
    const t = new PiLog();

    expect(t.push(line({ type: "message_update", assistantMessageEvent: { type: "text_end" } }))).toBe("\n");
  });

  it("skips thinking", () => {
    const t = new PiLog();

    const text = t.push(
      line({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "hmm" } }),
    );

    expect(text).toBe("");
  });

  it("shows a bash tool call as its command", () => {
    const t = new PiLog();

    const text = t.push(line({ type: "tool_execution_start", toolName: "bash", args: { command: "ls -la" } }));

    expect(text).toBe("\n$ bash: ls -la\n");
  });

  it("shows other tool calls with their arguments", () => {
    const t = new PiLog();

    const text = t.push(line({ type: "tool_execution_start", toolName: "read", args: { path: "a.ts" } }));

    expect(text).toBe('\n$ read: {"path":"a.ts"}\n');
  });

  it("shows tool results", () => {
    const t = new PiLog();

    const text = t.push(
      line({
        type: "tool_execution_end",
        toolName: "bash",
        result: { content: [{ type: "text", text: "a.ts\nb.ts\n" }] },
        isError: false,
      }),
    );

    expect(text).toBe("a.ts\nb.ts\n\n");
  });

  it("marks failed tool results", () => {
    const t = new PiLog();

    const text = t.push(
      line({ type: "tool_execution_end", result: { content: [{ type: "text", text: "boom" }] }, isError: true }),
    );

    expect(text).toBe("[error] boom\n\n");
  });

  it("cuts off long tool results", () => {
    const t = new PiLog();
    const long = "x".repeat(MAX_TOOL_RESULT_CHARS + 50);

    const text = t.push(
      line({ type: "tool_execution_end", result: { content: [{ type: "text", text: long }] }, isError: false }),
    );

    expect(text).toBe("x".repeat(MAX_TOOL_RESULT_CHARS) + "\n… (50 more characters)\n\n");
  });

  it("waits for a complete line before parsing", () => {
    const t = new PiLog();
    const full = textDelta("Hi");

    expect(t.push(full.slice(0, 10))).toBe("");
    expect(t.push(full.slice(10))).toBe("Hi");
  });

  it("passes non-JSON lines through as-is", () => {
    const t = new PiLog();

    expect(t.push("Error: no API key\n")).toBe("Error: no API key\n");
  });

  it("ignores other events", () => {
    const t = new PiLog();

    expect(t.push(line({ type: "turn_start" }) + line({ type: "session", id: "x" }))).toBe("");
  });

  it("flushes an unfinished last line at the end", () => {
    const t = new PiLog();
    t.push("partial line without newline");

    expect(t.end()).toBe("partial line without newline");
  });

  describe("finalText", () => {
    const assistantMessage = (text: string) =>
      line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } });

    it("is the text of the last assistant message", () => {
      const t = new PiLog();
      t.push(assistantMessage("first"));
      t.push(line({ type: "message_end", message: { role: "toolResult", content: [{ type: "text", text: "x" }] } }));
      t.push(assistantMessage("last"));

      expect(t.finalText).toBe("last");
    });

    it("ignores thinking and tool calls in the message", () => {
      const t = new PiLog();
      t.push(
        line({
          type: "message_end",
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "hmm" },
              { type: "text", text: "Done." },
              { type: "toolCall", name: "bash" },
            ],
          },
        }),
      );

      expect(t.finalText).toBe("Done.");
    });

    it("is empty before any assistant message", () => {
      expect(new PiLog().finalText).toBe("");
    });
  });
});

describe("ClaudeLog", () => {
  it("shows text, tool calls and tool results", () => {
    const t = new ClaudeLog();

    const text = t.push(
      line({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls", description: "List" } }] },
      }) +
        line({
          type: "user",
          message: { content: [{ type: "tool_result", content: "a.ts\nb.ts", is_error: false }] },
        }) +
        line({ type: "assistant", message: { content: [{ type: "text", text: "Two files." }] } }),
    );

    expect(text).toBe("\n$ Bash: ls\na.ts\nb.ts\n\nTwo files.\n");
  });

  it("handles tool results given as a list of text blocks", () => {
    const t = new ClaudeLog();

    const text = t.push(
      line({
        type: "user",
        message: { content: [{ type: "tool_result", content: [{ type: "text", text: "nope" }], is_error: true }] },
      }),
    );

    expect(text).toBe("[error] nope\n\n");
  });

  it("takes the final text from the result event", () => {
    const t = new ClaudeLog();

    t.push(line({ type: "result", subtype: "success", is_error: false, result: "All done.\nNO_TASK_AVAILABLE" }));

    expect(t.finalText).toBe("All done.\nNO_TASK_AVAILABLE");
  });

  it("shows a failed result as an error", () => {
    const t = new ClaudeLog();

    expect(t.push(line({ type: "result", is_error: true, result: "Credit balance too low" }))).toBe(
      "[error] Credit balance too low\n",
    );
  });

  it("ignores system and other events", () => {
    const t = new ClaudeLog();

    expect(t.push(line({ type: "system", subtype: "init" }) + line({ type: "rate_limit_event" }))).toBe("");
  });
});

describe("CodexLog", () => {
  it("shows messages, commands and their output", () => {
    const t = new CodexLog();

    const text = t.push(
      line({ type: "item.completed", item: { type: "agent_message", text: "Checking." } }) +
        line({ type: "item.started", item: { type: "command_execution", command: "bash -lc ls", exit_code: null } }) +
        line({
          type: "item.completed",
          item: { type: "command_execution", command: "bash -lc ls", aggregated_output: "a.ts\n", exit_code: 0 },
        }),
    );

    expect(text).toBe("Checking.\n\n$ shell: bash -lc ls\na.ts\n\n");
  });

  it("marks a failed command", () => {
    const t = new CodexLog();

    const text = t.push(
      line({
        type: "item.completed",
        item: { type: "command_execution", command: "false", aggregated_output: "", exit_code: 1 },
      }),
    );

    expect(text).toBe("[error] (exit code 1)\n\n");
  });

  it("shows file changes", () => {
    const t = new CodexLog();

    const text = t.push(
      line({ type: "item.completed", item: { type: "file_change", changes: [{ path: "a.ts", kind: "update" }] } }),
    );

    expect(text).toBe("\n$ edit: update a.ts\n");
  });

  it("uses the last agent message as the final text", () => {
    const t = new CodexLog();
    t.push(line({ type: "item.completed", item: { type: "agent_message", text: "first" } }));
    t.push(line({ type: "item.completed", item: { type: "agent_message", text: "last" } }));

    expect(t.finalText).toBe("last");
  });

  it("shows errors", () => {
    const t = new CodexLog();

    const text = t.push(line({ type: "error", message: "boom" }) + line({ type: "turn.failed", error: { message: "bad" } }));

    expect(text).toBe("[error] boom\n[error] bad\n");
  });
});

describe("OpencodeLog", () => {
  it("shows text and tool use", () => {
    const t = new OpencodeLog();

    const text = t.push(
      line({
        type: "tool_use",
        part: { tool: "bash", state: { status: "completed", input: { command: "ls" }, output: "a.ts\n" } },
      }) + line({ type: "text", part: { type: "text", text: "One file." } }),
    );

    expect(text).toBe("\n$ bash: ls\na.ts\n\nOne file.\n");
    expect(t.finalText).toBe("One file.");
  });

  it("marks a failed tool", () => {
    const t = new OpencodeLog();

    const text = t.push(
      line({ type: "tool_use", part: { tool: "read", state: { status: "error", input: { path: "x" }, error: "missing" } } }),
    );

    expect(text).toBe('\n$ read: {"path":"x"}\n[error] missing\n\n');
  });

  it("shows errors", () => {
    const t = new OpencodeLog();

    expect(t.push(line({ type: "error", error: { name: "APIError", data: { message: "Free usage limit reached" } } }))).toBe(
      "[error] Free usage limit reached\n",
    );
  });
});
