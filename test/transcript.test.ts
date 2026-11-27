import { describe, it, expect } from "vitest";
import { Transcript, MAX_TOOL_RESULT_CHARS } from "../src/transcript.ts";

const line = (event: object) => JSON.stringify(event) + "\n";
const textDelta = (delta: string) =>
  line({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta } });

describe("Transcript", () => {
  it("turns assistant text deltas into text", () => {
    const t = new Transcript();

    expect(t.push(textDelta("Hello") + textDelta(" world"))).toBe("Hello world");
  });

  it("ends a text block with a newline", () => {
    const t = new Transcript();

    expect(t.push(line({ type: "message_update", assistantMessageEvent: { type: "text_end" } }))).toBe("\n");
  });

  it("skips thinking", () => {
    const t = new Transcript();

    const text = t.push(
      line({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "hmm" } }),
    );

    expect(text).toBe("");
  });

  it("shows a bash tool call as its command", () => {
    const t = new Transcript();

    const text = t.push(line({ type: "tool_execution_start", toolName: "bash", args: { command: "ls -la" } }));

    expect(text).toBe("\n$ bash: ls -la\n");
  });

  it("shows other tool calls with their arguments", () => {
    const t = new Transcript();

    const text = t.push(line({ type: "tool_execution_start", toolName: "read", args: { path: "a.ts" } }));

    expect(text).toBe('\n$ read: {"path":"a.ts"}\n');
  });

  it("shows tool results", () => {
    const t = new Transcript();

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
    const t = new Transcript();

    const text = t.push(
      line({ type: "tool_execution_end", result: { content: [{ type: "text", text: "boom" }] }, isError: true }),
    );

    expect(text).toBe("[error] boom\n\n");
  });

  it("cuts off long tool results", () => {
    const t = new Transcript();
    const long = "x".repeat(MAX_TOOL_RESULT_CHARS + 50);

    const text = t.push(
      line({ type: "tool_execution_end", result: { content: [{ type: "text", text: long }] }, isError: false }),
    );

    expect(text).toBe("x".repeat(MAX_TOOL_RESULT_CHARS) + "\n… (50 more characters)\n\n");
  });

  it("waits for a complete line before parsing", () => {
    const t = new Transcript();
    const full = textDelta("Hi");

    expect(t.push(full.slice(0, 10))).toBe("");
    expect(t.push(full.slice(10))).toBe("Hi");
  });

  it("passes non-JSON lines through as-is", () => {
    const t = new Transcript();

    expect(t.push("Error: no API key\n")).toBe("Error: no API key\n");
  });

  it("ignores other events", () => {
    const t = new Transcript();

    expect(t.push(line({ type: "turn_start" }) + line({ type: "session", id: "x" }))).toBe("");
  });

  it("flushes an unfinished last line at the end", () => {
    const t = new Transcript();
    t.push("partial line without newline");

    expect(t.end()).toBe("partial line without newline");
  });

  describe("finalText", () => {
    const assistantMessage = (text: string) =>
      line({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } });

    it("is the text of the last assistant message", () => {
      const t = new Transcript();
      t.push(assistantMessage("first"));
      t.push(line({ type: "message_end", message: { role: "toolResult", content: [{ type: "text", text: "x" }] } }));
      t.push(assistantMessage("last"));

      expect(t.finalText).toBe("last");
    });

    it("ignores thinking and tool calls in the message", () => {
      const t = new Transcript();
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
      expect(new Transcript().finalText).toBe("");
    });
  });
});
