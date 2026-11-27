import { html, raw } from "hono/html";
import type { FactoryInput } from "./store.ts";
import type { ModelLists } from "./models.ts";
import { AGENTS, type AgentName } from "./agents.ts";
import type { Html } from "./layout.ts";

export const NEW_FACTORY: FactoryInput = {
  name: "",
  prompt: "",
  directory: "",
  agent: "pi",
  model: "",
  idleMinutes: 30,
  maxRunMinutes: 60,
};

// Node timers can't wait longer than ~24.8 days; longer values fire right away. One week is plenty.
const MAX_MINUTES = 7 * 24 * 60;

export const INVALID_FORM = `Please fill in a name, prompt and directory, pick an agent, and use whole minutes from 1 to ${MAX_MINUTES}.`;

/** The submitted settings, or undefined when something is missing or out of range. */
export async function readFactoryForm(request: Request): Promise<FactoryInput | undefined> {
  const body = await request.formData();
  const field = (key: string) => String(body.get(key) ?? "").trim();
  const minutes = (key: string) => (/^\d+$/.test(field(key)) ? Number(field(key)) : 0);

  const input = {
    name: field("name"),
    prompt: field("prompt"),
    directory: field("directory"),
    agent: field("agent") as AgentName,
    model: field("model"),
    idleMinutes: minutes("idleMinutes"),
    maxRunMinutes: minutes("maxRunMinutes"),
  };
  const valid =
    input.name &&
    input.prompt &&
    input.directory &&
    AGENTS.includes(input.agent) &&
    [input.idleMinutes, input.maxRunMinutes].every((m) => m >= 1 && m <= MAX_MINUTES);
  return valid ? input : undefined;
}

export function factoryForm(action: string, factory: FactoryInput, button: string, models: ModelLists): Html {
  return html`
    <form method="post" action="${action}">
      <label>Name <input name="name" value="${factory.name}" required></label>
      <div class="row">
        <label>Agent
          <select name="agent" id="agent">
            ${AGENTS.map((a) => option(a, a, a === factory.agent))}
          </select>
        </label>
        <label>Model
          <select name="model" id="model">${modelOptions(models[factory.agent], factory.model)}</select>
        </label>
      </div>
      <label>Working directory <input name="directory" value="${factory.directory}" required></label>
      <div class="row">
        <label>Wait when there's nothing to do (minutes)
          <input type="number" min="1" max="${MAX_MINUTES}" step="1" name="idleMinutes" value="${factory.idleMinutes}" required>
        </label>
        <label>Max run time (minutes)
          <input type="number" min="1" max="${MAX_MINUTES}" step="1" name="maxRunMinutes" value="${factory.maxRunMinutes}" required>
        </label>
      </div>
      <label>Prompt <textarea name="prompt" rows="8" required>${factory.prompt}</textarea></label>
      <button>${button}</button>
    </form>
    ${followAgentChoice(models)}
  `;
}

/** The agent's models, plus "agent default". A saved model that's no longer listed is kept as an option. */
function modelOptions(available: string[], selected: string): Html {
  const models = selected && !available.includes(selected) ? [selected, ...available] : available;
  return html`${option("", "agent default", selected === "")}${models.map((m) => option(m, m, m === selected))}`;
}

function option(value: string, label: string, selected: boolean): Html {
  return selected
    ? html`<option value="${value}" selected>${label}</option>`
    : html`<option value="${value}">${label}</option>`;
}

/** When a different agent is picked, swap the model list for that agent's models. */
function followAgentChoice(models: ModelLists): Html {
  // "<" escaped so a model name can never close the script tag.
  const json = JSON.stringify(models).replaceAll("<", "\\u003c");
  return html`<script>
    (() => {
      const models = ${raw(json)};
      const agent = document.getElementById("agent");
      const model = document.getElementById("model");
      agent.addEventListener("change", () => {
        model.replaceChildren(new Option("agent default", ""), ...models[agent.value].map((m) => new Option(m, m)));
      });
    })();
  </script>`;
}
