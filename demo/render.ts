// Turns out/frames + out/timeline.json into out/resolly-demo.mp4 (+ GIF and poster).
// Speed-ramps agent waits, overlays captions, adds title/end cards. Usage: pnpm render
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { caption, endCard, speedBadge, titleCard } from "./lib/cards.ts";
import type { Frame, Mark } from "./lib/director.ts";
import { HOOK_S, hookScene } from "./lib/hook.ts";

const OUT = join(import.meta.dirname, "out");
const URL_ON_END = process.env.DEMO_URL ?? "verdict-vert-two.vercel.app";
const W = Number(process.env.OUT_WIDTH ?? 1920);
const H = Math.round((W * 900) / 1440 / 2) * 2;
const FPS = 30;
const TITLE_S = 3.5;
const END_S = 4;
const XFADE_S = 0.6;
const MAX_S = Number(process.env.MAX_SECONDS ?? 168);
const FAST_DEFAULT = Number(process.env.FAST_SPEED ?? 3);
const FAST_CAP = 12;
const CAPTION_FADE = 0.35;

interface Segment { a: number; b: number; speed: number }
interface Timeline { frames: Frame[]; marks: Mark[]; end: number }

const tl: Timeline = JSON.parse(readFileSync(join(OUT, "timeline.json"), "utf8"));
const t0 = tl.frames[0].t;
const rel = (t: number): number => (t - t0) / 1000;

function fastSegments(): Segment[] {
  const segs: Segment[] = [];
  let open: { a: number; speed: number } | null = null;
  for (const m of tl.marks) {
    if (m.kind !== "fast") continue;
    if (m.on) open = { a: rel(m.t), speed: m.speed ?? FAST_DEFAULT };
    else if (open) { segs.push({ ...open, b: rel(m.t) }); open = null; }
  }
  return segs;
}

/** Scale the default-speed segments up until the cut fits the time budget. */
function fitBudget(segs: Segment[], wall: number): Segment[] {
  const budget = MAX_S - HOOK_S - TITLE_S - END_S + 3 * XFADE_S;
  const out = (s: Segment[]): number => wall - s.reduce((acc, x) => acc + (x.b - x.a) * (1 - 1 / x.speed), 0);
  if (out(segs) <= budget) return segs;
  const flex = segs.filter((s) => s.speed === FAST_DEFAULT);
  const fixedOut = out(segs.filter((s) => s.speed !== FAST_DEFAULT).concat(flex.map((s) => ({ ...s, speed: 1e9 }))));
  const flexWall = flex.reduce((acc, s) => acc + s.b - s.a, 0);
  const need = Math.min(FAST_CAP, flexWall / Math.max(0.1, budget - fixedOut));
  const speed = Math.round(Math.max(FAST_DEFAULT, need) * 10) / 10;
  process.stdout.write(`over budget: fast segments sped up to ${speed}×\n`);
  return segs.map((s) => (s.speed === FAST_DEFAULT ? { ...s, speed } : s));
}

const wall = rel(tl.end);
const segs = fitBudget(fastSegments(), wall);

/** Wall-clock seconds → output seconds. */
function outT(t: number): number {
  let lost = 0;
  for (const s of segs) {
    const inside = Math.min(Math.max(t - s.a, 0), s.b - s.a);
    lost += inside * (1 - 1 / s.speed);
  }
  return t - lost;
}

function writeConcat(): number {
  const lines = ["ffconcat version 1.0"];
  const f = tl.frames;
  for (let i = 0; i < f.length; i++) {
    const next = i + 1 < f.length ? rel(f[i + 1].t) : wall;
    const dur = Math.max(0.001, outT(next) - outT(rel(f[i].t)));
    lines.push(`file '${join(OUT, f[i].file)}'`, `duration ${dur.toFixed(4)}`);
  }
  lines.push(`file '${join(OUT, f[f.length - 1].file)}'`);
  writeFileSync(join(OUT, "frames.ffconcat"), lines.join("\n"));
  return outT(wall);
}

async function renderPngs(items: { name: string; html: string; transparent: boolean }[]): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: W / 1440 });
  for (const it of items) {
    await page.setContent(it.html);
    await page.screenshot({ path: join(OUT, `${it.name}.png`), omitBackground: it.transparent });
  }
  await browser.close();
}

/** Hook intro: seek the JS timeline per frame and screenshot (2× for crisp text). */
async function renderHook(): Promise<string> {
  const dir = join(OUT, "hook");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.setContent(hookScene(), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const n = Math.round(HOOK_S * FPS);
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => (window as unknown as { __seek: (t: number) => void }).__seek(t), i / FPS);
    await page.screenshot({ path: join(dir, `${String(i).padStart(5, "0")}.jpg`), type: "jpeg", quality: 92 });
  }
  await browser.close();
  return join(dir, "%05d.jpg");
}

function ffmpeg(args: string[]): void {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
}

async function main(): Promise<void> {
  const mainS = writeConcat();
  const caps = tl.marks
    .filter((m): m is Extract<Mark, { kind: "caption" }> => m.kind === "caption")
    .map((m, i) => {
      const a = outT(rel(m.t));
      return { name: `caption_${i}`, a, b: Math.min(mainS, a + m.holdMs / 1000), m };
    });
  const speeds = [...new Set(segs.map((s) => s.speed))];
  await renderPngs([
    { name: "card_title", html: titleCard(), transparent: false },
    { name: "card_end", html: endCard(URL_ON_END), transparent: false },
    ...caps.map((c) => ({ name: c.name, html: caption(c.m.text, c.m.sub), transparent: true })),
    ...speeds.map((s) => ({ name: `speed_${s}`, html: speedBadge(s), transparent: true })),
  ]);
  const hookPattern = await renderHook();

  // Inputs: 0 frames, 1 title, 2 end, 3 hook, then captions, then speed badges.
  const inputs = ["-f", "concat", "-safe", "0", "-i", join(OUT, "frames.ffconcat"),
    "-loop", "1", "-framerate", `${FPS}`, "-t", `${TITLE_S}`, "-i", join(OUT, "card_title.png"),
    "-loop", "1", "-framerate", `${FPS}`, "-t", `${END_S}`, "-i", join(OUT, "card_end.png"),
    "-framerate", `${FPS}`, "-i", hookPattern];
  const overlays: { png: string; a: number; b: number }[] = [
    ...caps.map((c) => ({ png: `${c.name}.png`, a: c.a, b: c.b })),
    ...segs.map((s) => ({ png: `speed_${s.speed}.png`, a: outT(s.a), b: outT(s.b) })),
  ];
  for (const o of overlays) inputs.push("-loop", "1", "-framerate", `${FPS}`, "-t", mainS.toFixed(3), "-i", join(OUT, o.png));

  const f: string[] = [`[0:v]fps=${FPS},scale=${W}:${H}:flags=lanczos,setsar=1,format=yuv420p[m0]`];
  overlays.forEach((o, i) => {
    const k = i + 4;
    const fadeOut = Math.max(o.a, o.b - CAPTION_FADE);
    f.push(`[${k}:v]format=rgba,fade=t=in:st=${o.a.toFixed(3)}:d=${CAPTION_FADE}:alpha=1,fade=t=out:st=${fadeOut.toFixed(3)}:d=${CAPTION_FADE}:alpha=1[o${i}]`);
    f.push(`[m${i}][o${i}]overlay=0:0:enable='between(t,${o.a.toFixed(3)},${o.b.toFixed(3)})':format=auto[m${i + 1}]`);
  });
  const last = `m${overlays.length}`;
  f.push(`[1:v]scale=${W}:${H},setsar=1,format=yuv420p[t]`, `[2:v]scale=${W}:${H},setsar=1,format=yuv420p[e]`);
  f.push(`[3:v]scale=${W}:${H}:flags=lanczos,setsar=1,format=yuv420p[h]`);
  f.push(`[h][t]xfade=transition=fade:duration=${XFADE_S}:offset=${HOOK_S - XFADE_S}[ht]`);
  const hookLead = HOOK_S - XFADE_S;
  f.push(`[ht][${last}]xfade=transition=fade:duration=${XFADE_S}:offset=${(hookLead + TITLE_S - XFADE_S).toFixed(3)}[te]`);
  const endOffset = hookLead + TITLE_S + mainS - 2 * XFADE_S;
  f.push(`[te][e]xfade=transition=fade:duration=${XFADE_S}:offset=${endOffset.toFixed(3)},format=yuv420p[v]`);

  const mp4 = join(OUT, "resolly-demo.mp4");
  ffmpeg([...inputs, "-filter_complex", f.join(";"), "-map", "[v]", "-c:v", "libx264", "-preset", "slow",
    "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", `${FPS}`, mp4]);

  // Poster: the first verdict on screen; GIF: the approve → executed moment.
  const at = (i: number, fallback: number): number => hookLead + TITLE_S - XFADE_S + (caps[i]?.a ?? fallback);
  ffmpeg(["-ss", (at(0, 30) + 1.5).toFixed(2), "-i", mp4, "-frames:v", "1", join(OUT, "poster.png")]);
  ffmpeg(["-ss", (at(1, 60) - 0.5).toFixed(2), "-t", "12", "-i", mp4, "-vf",
    "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a",
    join(OUT, "resolly-demo.gif")]);

  const total = hookLead + TITLE_S + mainS + END_S - 2 * XFADE_S;
  process.stdout.write(`wall ${wall.toFixed(1)}s → video ${total.toFixed(1)}s · speeds ${speeds.join(", ")}× · ${mp4}\n`);
}

await main();
