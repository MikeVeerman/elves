export const MAX_TOOL_RESULT_CHARS = 1000;

type Content = { type: string; text?: string };

/**
 * Turns pi's `--mode json` output (one JSON event per line) into a readable log.
 * Feed it raw chunks with push(); it returns the readable text for those chunks.
 */
export class Transcript {
  finalText = "";
  private pending = "";

  push(chunk: string): string {
    const lines = (this.pending + chunk).split("\n");
    this.pending = lines.pop()!;
    return lines.map((l) => this.render(l + "\n")).join("");
  }

  /** Call when the output has ended, to flush a last line without a newline. */
  end(): string {
    const rest = this.pending;
    this.pending = "";
    return rest && this.render(rest);
  }

  private render(line: string): string {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return line;
    }

    switch (event.type) {
      case "message_update": {
        const update = event.assistantMessageEvent;
        if (update?.type === "text_delta") return update.delta;
        if (update?.type === "text_end") return "\n";
        return "";
      }
      case "tool_execution_start": {
        const args = event.args?.command ?? JSON.stringify(event.args);
        return `\n$ ${event.toolName}: ${args}\n`;
      }
      case "tool_execution_end": {
        const text = textOf(event.result?.content);
        const body = shorten(text);
        // Always end with a blank line, so the next part of the log stands apart.
        return `${event.isError ? "[error] " : ""}${body}${body.endsWith("\n") ? "" : "\n"}\n`;
      }
      case "message_end":
        if (event.message?.role === "assistant") this.finalText = textOf(event.message.content);
        return "";
      default:
        return "";
    }
  }
}

function textOf(content: Content[] = []): string {
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
}

function shorten(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  const more = text.length - MAX_TOOL_RESULT_CHARS;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n… (${more} more characters)\n`;
}
