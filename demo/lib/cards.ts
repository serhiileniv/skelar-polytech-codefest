// HTML for title/end cards and lower-third captions, rendered to PNG by Playwright
// (the local ffmpeg has no drawtext, and HTML gives real typography anyway).
const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif`;
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const BASE = `*{margin:0;box-sizing:border-box}html,body{width:1440px;height:900px;font-family:${FONT};-webkit-font-smoothing:antialiased}`;

const BG = `background:radial-gradient(1200px 700px at 20% 10%,#3b3f9f 0%,transparent 60%),radial-gradient(900px 600px at 90% 90%,#0f766e 0%,transparent 55%),#0b0c16;color:#fff`;

export function titleCard(): string {
  return `<style>${BASE}
body{${BG};display:flex;flex-direction:column;justify-content:center;padding:0 140px}
.k{font-size:20px;letter-spacing:.24em;text-transform:uppercase;color:#a5b4fc;font-weight:600}
h1{font-size:132px;font-weight:800;letter-spacing:-.04em;margin:18px 0 10px}
p{font-size:36px;line-height:1.3;color:#d4d4e8;max-width:1050px;font-weight:450}
.row{display:flex;gap:14px;margin-top:46px}
.chip{font-size:20px;padding:10px 18px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);color:#e5e7ff}
</style><body>
<div class="k">AI support copilot</div>
<h1>Resolly</h1>
<p>One complaint in, evidence-backed action out</p>
<div class="row"><span class="chip">Understand intent</span><span class="chip">Initiate actions</span><span class="chip">Help agents decide</span><span class="chip">Score support</span></div>
</body>`;
}

export function endCard(url: string): string {
  return `<style>${BASE}
body{${BG};display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}
h1{font-size:110px;font-weight:800;letter-spacing:-.04em}
p{font-size:32px;color:#d4d4e8;margin-top:14px}
.url{margin-top:54px;font-size:40px;font-weight:600;padding:18px 34px;border-radius:18px;background:#fff;color:#1e1b4b}
.s{margin-top:34px;font-size:20px;color:#a5a8c8;letter-spacing:.02em}
</style><body>
<h1>Resolly</h1>
<p>Fewer false escalations. Every action with receipts.</p>
<div class="url">${esc(url)}</div>
<div class="s">Go · Postgres · Claude agent loop · MCP tools · Next.js</div>
</body>`;
}

export function caption(text: string, sub = ""): string {
  return `<style>${BASE}
html,body{background:transparent}
.c{position:absolute;left:36px;bottom:34px;max-width:900px;padding:18px 26px 18px 22px;border-radius:16px;
background:rgba(14,15,28,.9);box-shadow:0 18px 50px rgba(0,0,0,.35);border-left:5px solid #818cf8;color:#fff}
.t{font-size:30px;font-weight:700;letter-spacing:-.01em}
.s{font-size:19px;color:#c7c9e4;margin-top:6px;line-height:1.35}
</style><body><div class="c"><div class="t">${esc(text)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ""}</div></body>`;
}

export function speedBadge(speed: number): string {
  return `<style>${BASE}
html,body{background:transparent}
.b{position:absolute;right:28px;top:110px;padding:8px 16px;border-radius:999px;background:rgba(14,15,28,.82);color:#fff;font-size:18px;font-weight:600}
</style><body><div class="b">▶▶ ${speed}× · live agent run</div></body>`;
}
