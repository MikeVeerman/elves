export const MAX_TOOL_RESULT_CHARS = 1000;

type Event = any;
type Content = { type: string; text?: string };

/**
 * Turns an agent's JSON output (one event per line) into a readable log.
 * Feed it raw chunks with push(); it returns the readable text for those chunks.
 * Each agent has its own event format, handled by a subclass.
 */
export abstract class EventLog {
  /** The agent's final message: used to spot the "no task" marker. */
  finalText = "";
  private pending = "";

  push(chunk: string): string {
    const lines = (this.pending + chunk).split("\n");
    this.pending = lines.pop()!;
    return lines.map((l) => this.renderLine(l + "\n")).join("");
  }

  /** Call when the output has ended, to flush a last line without a newline. */
  end(): string {
    const rest = this.pending;
    this.pending = "";
    return rest && this.renderLine(rest);
  }

  private renderLine(line: string): string {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return line;
    }
    return this.render(event);
  }

  protected abstract render(event: Event): string;
}

export class PiLog extends EventLog {
  protected render(event: Event): string {
    switch (event.type) {
      case "message_update": {
        const update = event.assistantMessageEvent;
        if (update?.type === "text_delta") return update.delta;
        if (update?.type === "text_end") return "\n";
        return "";
      }
      case "tool_execution_start":
        return toolCall(event.toolName, event.args);
      case "tool_execution_end":
        return toolResult(textOf(event.result?.content), event.isError);
      case "message_end":
        if (event.message?.role === "assistant") this.finalText = textOf(event.message.content);
        return "";
      default:
        return "";
    }
  }
}

/** `claude -p --output-format stream-json --verbose` */
export class ClaudeLog extends EventLog {
  protected render(event: Event): string {
    switch (event.type) {
      case "assistant":
        return (event.message?.content ?? [])
          .map((c: Event) => {
            if (c.type === "text") return c.text + "\n";
            if (c.type === "tool_use") return toolCall(c.name, c.input);
            return "";
          })
          .join("");
      case "user":
        return (event.message?.content ?? [])
          .filter((c: Event) => c.type === "tool_result")
          .map((c: Event) => toolResult(typeof c.content === "string" ? c.content : textOf(c.content), c.is_error))
          .join("");
      case "result":
        this.finalText = event.result ?? "";
        return event.is_error ? error(event.result) : "";
      default:
        return "";
    }
  }
}

/** `codex exec --json` */
export class CodexLog extends EventLog {
  protected render(event: Event): string {
    const item = event.item;
    switch (event.type) {
      case "item.started":
        return item?.type === "command_execution" ? toolCall("shell", { command: item.command }) : "";
      case "item.completed":
        if (item?.type === "agent_message") {
          this.finalText = item.text;
          return item.text + "\n";
        }
        if (item?.type === "command_execution") {
          const output = item.aggregated_output || `(exit code ${item.exit_code})`;
          return toolResult(output, item.exit_code !== 0);
        }
        if (item?.type === "file_change") {
          return item.changes.map((c: Event) => `\n$ edit: ${c.kind} ${c.path}\n`).join("");
        }
        return "";
      case "error":
        return error(event.message);
      case "turn.failed":
        return error(event.error?.message);
      default:
        return "";
    }
  }
}

/** `opencode run --format json` */
export class OpencodeLog extends EventLog {
  protected render(event: Event): string {
    const part = event.part;
    switch (event.type) {
      case "text":
        this.finalText = part.text;
        return part.text + "\n";
      case "tool_use": {
        const state = part.state ?? {};
        const failed = state.status === "error";
        return toolCall(part.tool, state.input) + toolResult(failed ? state.error : (state.output ?? ""), failed);
      }
      case "error":
        return error(event.error?.data?.message ?? event.error?.message ?? JSON.stringify(event.error));
      default:
        return "";
    }
  }
}

function toolCall(name: string, args: Event): string {
  return `\n$ ${name}: ${args?.command ?? JSON.stringify(args)}\n`;
}

function toolResult(text: string, isError: boolean): string {
  const body = shorten(text);
  // Always end with a blank line, so the next part of the log stands apart.
  return `${isError ? "[error] " : ""}${body}${body.endsWith("\n") ? "" : "\n"}\n`;
}

function error(message: string): string {
  return `[error] ${message}\n`;
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
