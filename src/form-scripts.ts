import { html, raw } from "hono/html";
import type { Html } from "./layout.ts";
import type { ModelLists } from "./models.ts";

// Browser scripts for the elf form. The page works without them; they make it nicer to use.

/** When a different agent is picked, swap the model list for that agent's models. */
export function followAgentChoice(models: ModelLists): Html {
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
export function followScheduleChoices(): Html {
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
