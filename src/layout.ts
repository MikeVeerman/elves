import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { elf } from "./elves.ts";

export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

/** The page shell: header with the elf crew, and a logout button when logged in. */
export function page(title: string | undefined, body: Html, { loggedIn = true } = {}): Html {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${title ? `${title} · Elves` : "Elves"}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet">
        <style>${raw(STYLE)}</style>
      </head>
      <body>
        <header class="site-header">
          <a href="/" class="brand">
            <span class="crew">${elf("working", 52)}${elf("sleeping", 52, "timed")}${elf("working", 52)}</span>
            <span>
              <span class="logo">ELVES</span>
              <span class="tagline">Your backlog gets done while you sleep.</span>
            </span>
          </a>
          ${loggedIn
            ? html`<form method="post" action="/logout" class="logout"><button>Log out</button></form>`
            : ""}
        </header>
        <main>${body}</main>
      </body>
    </html>`;
}

const STYLE = `
  :root {
    --bg: #fbf6ec; --card: #fffdf8; --ink: #2b2118; --muted: #7a6a58; --line: #e6dccb;
    --pine: #1f3b2d; --green: #2e8b57; --red: #c0392b; --gold: #e0b43c; --sky: #3f6e9e;
    --pixel: "Press Start 2P", ui-monospace, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 60rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
  a { color: var(--green); }
  h1, h2 { font-family: var(--pixel); font-weight: normal; line-height: 1.4; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  h2 { font-size: .8rem; margin: 2.5rem 0 1rem; color: var(--pine); }

  .site-header { background: var(--pine); border-bottom: 6px solid var(--gold); position: relative; }
  .logout { position: absolute; top: 1rem; right: 1rem; }
  .logout button { background: transparent; color: var(--bg); box-shadow: none; border-color: var(--bg);
    font-size: .55rem; padding: .5rem .7rem; }
  .login { max-width: 22rem; margin: 2rem auto; }
  .brand { display: flex; align-items: center; gap: 1.25rem; max-width: 60rem; margin: 0 auto;
    padding: 1rem; text-decoration: none; }
  .crew { display: flex; gap: .25rem; align-items: flex-end; }
  .logo { display: block; font-family: var(--pixel); font-size: 1.6rem; color: var(--gold);
    text-shadow: 3px 3px 0 #0f1f17; }
  .tagline { display: block; color: var(--bg); font-size: .9rem; margin-top: .4rem; opacity: .85; }
  .site-header .z { fill: var(--gold); }

  .title-row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin: .5rem 0 1rem; }
  .title-row h1 { margin: 0; }
  .hero { display: flex; align-items: center; gap: 1.25rem; margin: .5rem 0 1rem; }
  .status-line { display: flex; align-items: center; gap: .75rem; }
  .warning { background: #fff3cd; border: 2px solid var(--gold); padding: .6rem .8rem; }
  .note { color: var(--muted); font-size: .9rem; }
  .empty { text-align: center; padding: 2.5rem 1rem; border: 2px dashed var(--line); background: var(--card); }

  table { border-collapse: collapse; width: 100%; background: var(--card); border: 2px solid var(--ink);
    box-shadow: 4px 4px 0 var(--ink); }
  th { font-family: var(--pixel); font-size: .6rem; font-weight: normal; background: #f1e8d6; }
  th, td { text-align: left; padding: .5rem .7rem; border-bottom: 1px solid var(--line); vertical-align: middle; }
  td.avatar { width: 1%; padding: .25rem .5rem; }
  code { font-size: .85em; }

  .pill { display: inline-block; padding: .1rem .55rem; font-size: .8rem; color: white; border: 2px solid var(--ink); }
  .pill-working { background: var(--green); }
  .pill-sleeping { background: var(--sky); }
  .pill-off { background: var(--muted); }

  button, a.button { display: inline-block; font-family: var(--pixel); font-size: .65rem; padding: .7rem 1rem;
    background: var(--red); color: white; border: 2px solid var(--ink); box-shadow: 3px 3px 0 var(--ink);
    text-decoration: none; cursor: pointer; }
  button:hover, a.button:hover { transform: translate(1px, 1px); box-shadow: 2px 2px 0 var(--ink); }
  button:active, a.button:active { transform: translate(3px, 3px); box-shadow: none; }
  button.danger { background: var(--ink); }

  label { display: block; margin-bottom: 1rem; font-weight: 600; font-size: .9rem; }
  input, textarea, select { display: block; width: 100%; margin-top: .3rem; font: 400 1rem system-ui, sans-serif;
    padding: .45rem .55rem; background: white; border: 2px solid var(--ink); border-radius: 0; }
  input:focus, textarea:focus, select:focus { outline: 3px solid var(--gold); outline-offset: 0; }
  .row { display: flex; gap: 1rem; flex-wrap: wrap; }
  [hidden] { display: none !important; }
  fieldset { border: 2px solid var(--ink); background: var(--card); margin: 0 0 1rem; padding: .8rem 1rem .4rem; }
  legend { font-family: var(--pixel); font-size: .6rem; padding: 0 .4rem; }
  .choice { display: flex; gap: .6rem; align-items: baseline; font-weight: 400; }
  .choice input { width: auto; margin: 0; }
  .schedule { border-color: #3f6fd1; }
  .preview { background: #eef3fc; border-left: 4px solid #3f6fd1; padding: .2rem .8rem; margin-bottom: .8rem; }
  .preview p { margin: .4rem 0; }
  .bad { color: var(--red); font-weight: 600; }
  .kind-line { color: var(--muted); margin: 0 0 .5rem; }
  code.dir { color: var(--muted); font-size: .75rem; }
  .row > label { flex: 1; }

  pre { background: #1d1a16; color: #f3ead8; padding: 1rem; overflow-x: auto; white-space: pre-wrap;
    border: 2px solid var(--ink); box-shadow: 4px 4px 0 var(--ink); }

  .elf { display: block; }
  .elf-working .frame-up { animation: hammer-up .6s steps(1) infinite; }
  .elf-working .frame-down { animation: hammer-down .6s steps(1) infinite; }
  @keyframes hammer-up { 0% { visibility: visible; } 50% { visibility: hidden; } }
  @keyframes hammer-down { 0% { visibility: hidden; } 50% { visibility: visible; } }
  .elf .z { font: 4px var(--pixel); fill: var(--pine); animation: float 2.4s ease-in-out infinite; }
  .elf .z2 { animation-delay: 1.2s; }
  @keyframes float { 0% { opacity: 0; transform: translateY(2px); } 30% { opacity: 1; }
    100% { opacity: 0; transform: translateY(-3px); } }
  .elf-off { filter: grayscale(1); opacity: .55; }
  .elf-alert .exclaim { animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { visibility: hidden; } }

  dialog { max-width: 34rem; width: calc(100% - 2rem); padding: 1.5rem; background: var(--card); color: var(--ink);
    border: 3px solid var(--ink); box-shadow: 6px 6px 0 var(--ink); }
  dialog::backdrop { background: rgba(15, 31, 23, .75); }
  dialog h2 { margin-top: .5rem; color: var(--red); text-align: center; }
  dialog p { margin: .8rem 0; }
  dialog form { text-align: center; margin-top: 1.25rem; }
  .warning-elf { display: flex; justify-content: center; }
  @media (prefers-reduced-motion: reduce) {
    .elf * { animation: none !important; }
    .elf-working .frame-down { visibility: hidden; }
  }

  @media (max-width: 40rem) {
    .row { flex-direction: column; gap: 0; }
    .crew .elf:nth-child(n + 2) { display: none; }
    .logo { font-size: 1.2rem; }
    table { font-size: .85rem; }
    th:nth-child(5), td:nth-child(5) { display: none; }
  }
`;
