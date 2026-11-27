import { html, raw } from "hono/html";
import type { FactoryInput, ElfKind } from "./store.ts";
import type { ModelLists } from "./models.ts";
import { AGENTS, type AgentName } from "./agents.ts";
import type { Html } from "./layout.ts";
import {
  DEFAULT_SCHEDULE_FORM,
  REPEATS,
  describeCron,
  fromCron,
  nextRuns,
  toCron,
  type Repeat,
  type ScheduleForm,
} from "./schedule.ts";

export const NEW_FACTORY: FactoryInput = {
  name: "",
  prompt: "",
  directory: "",
  kind: "loop",
  schedule: "",
  agent: "pi",
  model: "",
  idleMinutes: 30,
  maxRunMinutes: 60,
};

// Node timers can't wait longer than ~24.8 days; longer values fire right away. One week is plenty.
const MAX_MINUTES = 7 * 24 * 60;

export const INVALID_FORM =
  `Please fill in a name, prompt and directory, pick an agent, use whole minutes from 1 to ${MAX_MINUTES}, ` +
  "and give a timed elf a valid schedule.";

const REPEAT_LABELS: Record<Repeat, string> = {
  minutes: "Every few minutes",
  hourly: "Every hour",
  daily: "Every day",
  weekdays: "Every weekday (Mon–Fri)",
  weekly: "Every week",
  monthly: "Every month",
  custom: "Custom (cron expression)",
};
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MINUTE_STEPS = [5, 10, 15, 20, 30];

/** The submitted settings, or undefined when something is missing or out of range. */
export async function readFactoryForm(request: Request): Promise<FactoryInput | undefined> {
  const body = await request.formData();
  const field = (key: string) => String(body.get(key) ?? "").trim();
  const minutes = (key: string) => (/^\d+$/.test(field(key)) ? Number(field(key)) : 0);
  const inRange = (m: number) => m >= 1 && m <= MAX_MINUTES;

  const kind = field("kind") as ElfKind;
  const schedule = kind === "timed" ? toCron(readScheduleForm(field)) : "";
  const idleMinutes = minutes("idleMinutes");

  const input = {
    name: field("name"),
    prompt: field("prompt"),
    directory: field("directory"),
    kind,
    schedule: schedule ?? "",
    agent: field("agent") as AgentName,
    model: field("model"),
    // A timed elf doesn't nap between runs, so its wait time only has to make sense for a loop elf.
    idleMinutes: kind === "timed" && !inRange(idleMinutes) ? NEW_FACTORY.idleMinutes : idleMinutes,
    maxRunMinutes: minutes("maxRunMinutes"),
  };
  const valid =
    input.name &&
    input.prompt &&
    input.directory &&
    (kind === "loop" || (kind === "timed" && schedule !== undefined)) &&
    AGENTS.includes(input.agent) &&
    inRange(input.idleMinutes) &&
    inRange(input.maxRunMinutes);
  return valid ? input : undefined;
}

/** The schedule choices from a form or query string. */
export function readScheduleForm(field: (key: string) => string): ScheduleForm {
  const number = (key: string) => (/^\d+$/.test(field(key)) ? Number(field(key)) : NaN);
  return {
    repeat: REPEATS.includes(field("repeat") as Repeat) ? (field("repeat") as Repeat) : "custom",
    everyMinutes: number("everyMinutes"),
    minute: number("minute"),
    time: field("time"),
    weekday: number("weekday"),
    monthDay: number("monthDay"),
    cron: field("cron"),
  };
}

export type SchedulePreview = { cron: string; description: string; next: string[] } | { error: string };

export function schedulePreview(schedule: ScheduleForm): SchedulePreview {
  const cron = toCron(schedule);
  if (!cron) {
    return {
      error:
        schedule.repeat === "custom"
          ? `"${schedule.cron}" is not a valid schedule. Use five parts: minute hour day month weekday.`
          : "These settings are not a valid schedule.",
    };
  }
  return { cron, description: describeCron(cron), next: nextRuns(cron, 3).map(formatWhen) };
}

/** "Mon 30 Nov, 09:00", in the server's time zone. */
export function formatWhen(date: Date): string {
  return date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function factoryForm(action: string, factory: FactoryInput, button: string, models: ModelLists): Html {
  const schedule = factory.kind === "timed" ? fromCron(factory.schedule) : DEFAULT_SCHEDULE_FORM;
  return html`
    <form method="post" action="${action}" id="elf-form">
      <label>Name <input name="name" value="${factory.name}" required></label>

      <fieldset class="kind">
        <legend>Type</legend>
        <label class="choice">${radio("kind", "loop", factory.kind === "loop")}
          <span><strong>Loop</strong> — keeps working through a backlog, naps when it's empty</span></label>
        <label class="choice">${radio("kind", "timed", factory.kind === "timed")}
          <span><strong>Timed</strong> — runs its prompt on a schedule, like a cron job</span></label>
      </fieldset>

      <fieldset data-kind="timed" class="schedule">
        <legend>Schedule</legend>
        <label>Repeat
          <select name="repeat">${REPEATS.map((r) => option(r, REPEAT_LABELS[r], r === schedule.repeat))}</select>
        </label>
        <div class="row">
          <label data-repeat="minutes">Every
            <select name="everyMinutes">
              ${MINUTE_STEPS.map((m) => option(String(m), `${m} minutes`, m === schedule.everyMinutes))}
            </select>
          </label>
          <label data-repeat="hourly">At minute
            <input type="number" name="minute" min="0" max="59" value="${schedule.minute}">
          </label>
          <label data-repeat="weekly">On
            <select name="weekday">${WEEKDAYS.map((d, i) => option(String(i), d, i === schedule.weekday))}</select>
          </label>
          <label data-repeat="monthly">On day
            <input type="number" name="monthDay" min="1" max="31" value="${schedule.monthDay}">
          </label>
          <label data-repeat="daily weekdays weekly monthly">At
            <input type="time" name="time" value="${schedule.time}">
          </label>
          <label data-repeat="custom">Cron expression
            <input name="cron" value="${schedule.cron}" placeholder="minute hour day month weekday" spellcheck="false">
          </label>
        </div>
        <div id="schedule-preview" class="preview">${previewHtml(schedulePreview(schedule))}</div>
      </fieldset>

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
        <label data-kind="loop">Wait when there's nothing to do (minutes)
          <input type="number" min="1" max="${MAX_MINUTES}" step="1" name="idleMinutes" value="${factory.idleMinutes}">
        </label>
        <label>Max run time (minutes)
          <input type="number" min="1" max="${MAX_MINUTES}" step="1" name="maxRunMinutes" value="${factory.maxRunMinutes}" required>
        </label>
      </div>
      <label>Prompt <textarea name="prompt" rows="8" required>${factory.prompt}</textarea></label>
      <button>${button}</button>
    </form>
    ${followAgentChoice(models)}
    ${followScheduleChoices()}
  `;
}

function previewHtml(preview: SchedulePreview): Html {
  if ("error" in preview) return html`<p class="bad">${preview.error}</p>`;
  return html`<p><strong>${preview.description}</strong></p>
    <p>Next runs: ${preview.next.join(" · ")}</p>
    <p class="note">cron: <code>${preview.cron}</code></p>`;
}

function radio(name: string, value: string, checked: boolean): Html {
  return checked
    ? html`<input type="radio" name="${name}" value="${value}" checked>`
    : html`<input type="radio" name="${name}" value="${value}">`;
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

/**
 * Shows only the fields that fit the chosen type and repeat, and refreshes the schedule preview
 * (description, next runs, cron expression) from the server as the choices change.
 */
function followScheduleChoices(): Html {
  return html`<script>
    (() => {
      const form = document.getElementById("elf-form");
      const box = document.getElementById("schedule-preview");
      const fields = ["repeat", "everyMinutes", "minute", "time", "weekday", "monthDay", "cron"];

      const show = () => {
        for (const el of form.querySelectorAll("[data-kind]")) el.hidden = el.dataset.kind !== form.kind.value;
        for (const el of form.querySelectorAll("[data-repeat]")) {
          el.hidden = !el.dataset.repeat.split(" ").includes(form.repeat.value);
        }
      };

      let timer;
      const preview = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const params = new URLSearchParams(fields.map((f) => [f, form[f].value]));
          const res = await fetch("/schedule/preview?" + params);
          const body = await res.json();
          box.replaceChildren();
          const line = (text, className) => {
            const p = document.createElement("p");
            p.textContent = text;
            if (className) p.className = className;
            return box.appendChild(p);
          };
          if (!res.ok) return line(body.error, "bad");
          if (form.repeat.value !== "custom") form.cron.value = body.cron;
          line(body.description).style.fontWeight = "bold";
          line("Next runs: " + body.next.join(" · "));
          line("cron: " + body.cron, "note");
        }, 150);
      };

      const update = (e) => {
        show();
        if (e.target.closest("[data-kind=timed]")) preview();
      };
      form.addEventListener("input", update);
      form.addEventListener("change", update);
      show();
    })();
  </script>`;
}
