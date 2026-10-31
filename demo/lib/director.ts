import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "playwright";

export interface Frame { file: string; t: number }
export type Mark =
  | { t: number; kind: "fast"; on: boolean; speed?: number }
  | { t: number; kind: "caption"; text: string; sub?: string; holdMs: number };

const FRAME_DIR = "frames";
const MOVE_HZ = 60;

/** Records JPEG frames + a timeline of marks; drives the page like a human. */
export class Director {
  readonly frames: Frame[] = [];
  readonly marks: Mark[] = [];
  private mouse = { x: 720, y: 450 };
  private stopCast: (() => Promise<void>) | null = null;

  constructor(readonly page: Page, readonly outDir: string) {}

  async start(size: { width: number; height: number }): Promise<void> {
    const dir = join(this.outDir, FRAME_DIR);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    // Raw CDP screencast: Playwright's page.screencast caps frames at CSS-pixel size; CDP gives device pixels.
    const cdp = await this.page.context().newCDPSession(this.page);
    let n = 0;
    cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
      const file = join(FRAME_DIR, `${String(n++).padStart(6, "0")}.jpg`);
      writeFileSync(join(this.outDir, file), Buffer.from(data, "base64"));
      this.frames.push({ file, t: Date.now() });
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg", quality: 82, maxWidth: size.width, maxHeight: size.height, everyNthFrame: 2,
    });
    this.stopCast = async () => { await cdp.send("Page.stopScreencast"); await cdp.detach(); };
  }

  async stop(): Promise<void> {
    await this.stopCast?.();
    writeFileSync(
      join(this.outDir, "timeline.json"),
      JSON.stringify({ frames: this.frames, marks: this.marks, end: Date.now() }, null, 1),
    );
  }

  /** Waiting segments (agent streaming) get sped up in post. */
  fast(on: boolean, speed?: number): void { this.marks.push({ t: Date.now(), kind: "fast", on, speed }); }
  caption(text: string, sub?: string, holdMs = 3800): void {
    this.marks.push({ t: Date.now(), kind: "caption", text, sub, holdMs });
  }

  pause(ms: number): Promise<void> { return this.page.waitForTimeout(ms); }

  /** Eased mouse glide; duration scales with distance. */
  async glide(x: number, y: number): Promise<void> {
    const { x: x0, y: y0 } = this.mouse;
    const dist = Math.hypot(x - x0, y - y0);
    const ms = Math.min(1100, Math.max(350, dist * 0.9));
    const steps = Math.max(8, Math.round((ms / 1000) * MOVE_HZ));
    for (let i = 1; i <= steps; i++) {
      const p = i / steps;
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      // slight arc so the path is not a ruler line
      const arc = Math.sin(p * Math.PI) * Math.min(40, dist * 0.06);
      await this.page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e - arc);
      await this.page.waitForTimeout(1000 / MOVE_HZ);
    }
    this.mouse = { x, y };
  }

  async hover(target: Locator): Promise<void> {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error(`no box for ${target}`);
    await this.glide(box.x + box.width / 2, box.y + Math.min(box.height / 2, 22));
  }

  /** Wheel-scroll the target's container until the target sits inside the viewport. */
  async reveal(target: Locator, margin = 90): Promise<void> {
    const vh = this.page.viewportSize()?.height ?? 900;
    for (let i = 0; i < 60; i++) {
      const box = await target.boundingBox();
      if (!box) return;
      const below = box.y + box.height - (vh - margin);
      const above = margin + 40 - box.y;
      if (below <= 0 && above <= 0) break;
      const y = Math.min(vh - 120, Math.max(160, box.y + box.height / 2));
      if (Math.hypot(this.mouse.x - (box.x + box.width / 2), this.mouse.y - y) > 40) {
        await this.glide(box.x + box.width / 2, y);
      }
      await this.page.mouse.wheel(0, below > 0 ? Math.min(90, below + 10) : -Math.min(90, above + 10));
      await this.page.waitForTimeout(30);
    }
    await this.pause(250);
  }

  async click(target: Locator, after = 700): Promise<void> {
    await target.waitFor({ state: "visible", timeout: 90_000 });
    await this.reveal(target);
    await this.hover(target);
    await this.pause(220);
    await this.page.mouse.down();
    await this.pause(90);
    await this.page.mouse.up();
    await this.pause(after);
  }

  /** Smooth wheel scroll over whatever is under the cursor. */
  async scroll(dy: number, over?: Locator): Promise<void> {
    if (over) await this.hover(over);
    const step = Math.sign(dy) * 40;
    for (let done = 0; Math.abs(done) < Math.abs(dy); done += step) {
      await this.page.mouse.wheel(0, step);
      await this.page.waitForTimeout(16);
    }
    await this.pause(400);
  }

  /** Screen Studio-style zoom on an element, hold, zoom back. */
  async spotlight(target: Locator, scale = 1.6, holdMs = 2200): Promise<void> {
    const box = await target.boundingBox();
    if (!box) return;
    await this.page.evaluate(([r, s]) => (window as never as { __demo: { zoom: (r: unknown, s: number) => void } }).__demo.zoom(r, s), [box, scale] as const);
    await this.pause(900 + holdMs);
    await this.page.evaluate(() => (window as never as { __demo: { unzoom: () => void } }).__demo.unzoom());
    await this.pause(1000);
  }
}
