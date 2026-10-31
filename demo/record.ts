// Drives the Resolly demo storyline and records high-res frames + a timeline for render.ts.
// Usage: BASE_URL=http://localhost:3000 API_URL=http://localhost:8080 pnpm record
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import { Director } from "./lib/director.ts";
import { OVERLAY_SCRIPT } from "./lib/overlay.ts";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const API_URL = process.env.API_URL ?? "http://localhost:8080";
const OUT = join(import.meta.dirname, "out");
const VIEW = { width: 1440, height: 900 };
const SCALE = Number(process.env.DSF ?? 2);
const AGENT_TIMEOUT = 180_000;

const copilot = (p: Page): Locator =>
  p.getByRole("complementary").filter({ has: p.getByRole("tablist", { name: "Copilot pane" }) });
const verdictCard = (p: Page): Locator => copilot(p).getByRole("article").filter({ hasText: /Finding:/ });
const nav = (p: Page, name: RegExp): Locator => p.getByRole("navigation").getByRole("link", { name });

async function resetDemo(): Promise<void> {
  const res = await fetch(`${API_URL}/api/state`, { method: "DELETE" });
  if (!res.ok) throw new Error(`reset failed: ${res.status} ${await res.text()}`);
}

/** Waits until the element's text stops changing (streamed answers). */
async function settle(target: Locator, quietMs = 2500, maxMs = 60_000): Promise<void> {
  const end = Date.now() + maxMs;
  let last = "";
  let stableSince = Date.now();
  while (Date.now() < end) {
    const now = await target.innerText().catch(() => "");
    if (now !== last) { last = now; stableSince = Date.now(); }
    else if (Date.now() - stableSince > quietMs) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function openCase(d: Director, p: Page, customer: string): Promise<void> {
  await d.click(p.getByRole("button", { name: new RegExp(`^${customer}`) }), 900);
}

async function investigate(d: Director, p: Page): Promise<void> {
  await d.click(copilot(p).getByRole("button", { name: "Investigate" }), 300);
  d.fast(true);
  await verdictCard(p).waitFor({ timeout: AGENT_TIMEOUT });
  d.fast(false);
  await d.pause(1500);
}

/** Investigates; re-runs once if the live verdict does not match `expect`. */
async function investigateExpect(d: Director, p: Page, expect?: RegExp): Promise<void> {
  await investigate(d, p);
  if (!expect) return;
  const ok = await verdictCard(p).getByText(expect).first().isVisible().catch(() => false);
  if (ok) return;
  process.stdout.write(`unexpected verdict, re-running (wanted ${expect})\n`);
  await d.click(copilot(p).getByRole("button", { name: "Re-run" }), 300);
  d.fast(true);
  await p.waitForTimeout(1500);
  await verdictCard(p).getByText(expect).first().waitFor({ timeout: AGENT_TIMEOUT });
  d.fast(false);
  await d.pause(1500);
}

async function sceneInvestigate(d: Director, p: Page): Promise<void> {
  await openCase(d, p, "Ava Lindqvist");
  await d.pause(1200);
  await investigateExpect(d, p, /Support can fix it/);
  const card = verdictCard(p);
  await d.reveal(card.getByText(/Finding:/), 120);
  d.caption("Agent loop, not a chatbot", "Read-only tools scoped to one customer · ≤ 8 steps · forced verdict");
  await d.spotlight(card, 1.3, 2400);
  await d.click(card.getByRole("group").filter({ hasText: /Evidence/ }).getByText(/Show/).first(), 1600).catch(() => undefined);
}

async function sceneFixIt(d: Director, p: Page): Promise<void> {
  await d.click(copilot(p).getByRole("button", { name: /Fix it for the customer/ }), 300);
  d.fast(true);
  const approve = p.getByRole("button", { name: /Approve & run selected/ });
  await approve.waitFor({ timeout: AGENT_TIMEOUT });
  d.fast(false);
  await d.pause(800);
  const plan = copilot(p).getByRole("article").filter({ hasText: /Fix plan/ });
  await d.reveal(plan.getByText(/Needed/).first(), 140);
  d.caption("Support approves app tool calls", "Each step passes the policy gate and is audited. Nothing runs without a click", 4600);
  await d.spotlight(plan.getByRole("list").first(), 1.35, 2600);
  await d.click(approve, 500);
  await plan.getByText(/Executed/).first().waitFor({ timeout: 60_000 });
  await d.pause(800);
  const done = plan.getByRole("listitem").filter({ hasText: /Executed/ });
  await d.reveal(done.last(), 120);
  await d.spotlight(plan.getByRole("list").first(), 1.35, 2400);
}

async function sceneBoard(d: Director, p: Page): Promise<void> {
  await d.click(nav(p, /^Tech board/), 1500);
  const issue = p.getByRole("article").filter({ hasText: /customers? affected/ }).first();
  await issue.waitFor({ timeout: 20_000 });
  d.caption("Tech gets a ready ticket, not a complaint", "Root cause · evidence with notes · affected customers");
  await d.spotlight(issue, 1.35, 3200);
  await d.click(nav(p, /^Inbox/), 1200);
}

async function sceneTech(d: Director, p: Page): Promise<void> {
  await openCase(d, p, "Liam Novak");
  await d.pause(1000);
  await investigateExpect(d, p, /Tech team/);
  const card = verdictCard(p);
  const notice = card.getByText(/38 customers/).first();
  const target = (await notice.count()) ? notice : card.getByText(/Finding:/).first();
  await d.reveal(target, 120);
  d.caption("One complaint → a bug hitting 38 customers");
  await d.spotlight(target, 1.6, 2600);
}

async function sceneInjection(d: Director, p: Page): Promise<void> {
  await openCase(d, p, "Marcus Webb");
  await d.pause(1200);
  await investigateExpect(d, p, /Suspicious/);
  const blocked = verdictCard(p).getByText(/Prompt injection blocked/).first();
  await d.reveal(blocked, 120);
  d.caption("The model can't be talked into actions", "Policy gate S1 blocks it");
  await d.spotlight(blocked, 1.6, 2600);
}

async function sceneMetrics(d: Director, p: Page): Promise<void> {
  const first = p.getByText("Investigated", { exact: true }).first();
  const last = p.getByText("Eval accuracy", { exact: true }).first();
  const [a, b] = [await first.boundingBox(), await last.boundingBox()];
  await d.hover(first);
  d.caption("Measurable, explainable", "Every answer cites record ids", 7000);
  if (a && b) {
    await p.evaluate(
      (r) => (window as never as { __demo: { zoom: (r: unknown, s: number) => void } }).__demo.zoom(r, 1.7),
      { x: a.x, y: a.y - 10, width: b.x + b.width - a.x, height: a.height + 20 },
    );
    await d.pause(3200);
    await p.evaluate(() => (window as never as { __demo: { unzoom: () => void } }).__demo.unzoom());
    await d.pause(1000);
  }
  const ids = copilot(p).getByRole("button", { name: /^(pay|err|sub|ev|msg|cust)_\d+$/ });
  const before = await ids.count();
  await d.click(copilot(p).getByRole("button", { name: "Which records prove it?" }), 300);
  d.fast(true, 3);
  const end = Date.now() + AGENT_TIMEOUT;
  while ((await ids.count()) <= before && Date.now() < end) await p.waitForTimeout(400);
  await settle(copilot(p), 3000);
  d.fast(false);
  const answer = ids.last()
    .locator("xpath=ancestor::*[self::p or self::li or self::article or self::div[contains(@class,'prose')]][1]");
  if (await answer.count()) {
    await d.reveal(answer, 120).catch(() => undefined);
    await d.spotlight(answer, 1.4, 2800).catch(() => undefined);
  }
  await d.pause(1500);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await resetDemo();
  // Headed on purpose: headless screencast frames come out at CSS-pixel size (1440×900), headed gives 2×.
  // The flags stop macOS from throttling an occluded window, so it can sit behind other windows.
  const browser = await chromium.launch({
    headless: process.env.HEADLESS === "1",
    args: [
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      `--window-size=${VIEW.width},${VIEW.height + 90}`,
    ],
  });
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, colorScheme: "light" });
  await ctx.addInitScript(OVERLAY_SCRIPT);
  const page = await ctx.newPage();
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Ava Lindqvist/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);

  const d = new Director(page, OUT);
  await d.start({ width: VIEW.width * SCALE, height: VIEW.height * SCALE });
  try {
    await page.mouse.move(720, 450);
    await d.pause(1500);
    await sceneInvestigate(d, page);
    await sceneFixIt(d, page);
    await sceneBoard(d, page);
    await sceneTech(d, page);
    await sceneInjection(d, page);
    await sceneMetrics(d, page);
  } catch (err) {
    await page.screenshot({ path: join(OUT, "failure.png") });
    throw err;
  } finally {
    await d.stop();
    await browser.close();
  }
  process.stdout.write(`recorded ${d.frames.length} frames → ${OUT}\n`);
}

await main();
