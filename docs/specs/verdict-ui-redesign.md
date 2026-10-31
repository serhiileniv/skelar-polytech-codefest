# Spec: Verdict UI redesign (demo-ready)

## Goal
Make the support console look like a product we can sell in a 3-minute demo. The hero is the
Investigate flow: live agent trace → verdict → evidence → one-click action + suggested reply.
Raises "Presentation & Demo" and "Use of AI" (`docs/criteria.md`); maps to capabilities 2–4.

## Non-goals
- Dark mode, mobile layout — the demo runs on one laptop screen (≥1280px).
- New dependencies (no framer-motion, no new UI kit) — `tw-animate-css` + Tailwind are enough, less risk before 17:00.
- Any change to `src/api/**`, the contract or business rules — thin client stays thin.
- Landing / marketing page — the deck covers the pitch.

## Current state
- Layout: `app/page.tsx` → `TopBar` + `MetricsStrip` + `Inbox` (case list | `ChatThread` | 380px aside with `CustomerCard` then `InvestigatePanel`).
- Font bug: `app/globals.css:10` sets `--font-sans: var(--font-sans)` (self-reference) → browser falls back to serif; `layout.tsx` defines `--font-geist-sans`.
- Styling: hard-coded zinc/indigo Tailwind classes per component; tokens in `globals.css` (shadcn) are mostly unused.
- Verdict card (`verdict-card.tsx`) sits below the customer card, so on a 800px-high screen the verdict is below the fold.
- Board (`components/board/tech-board.tsx`): 3 kanban columns, affected count is small text.
- Tests: reducer/view/mock tests only; no component tests.

## Proposed design

**Foundation**
- Fix `--font-sans: var(--font-geist-sans)`; Geist for UI, Geist Mono for ids.
- One accent (indigo-600) + outcome colours from `OUTCOME_META`; neutral zinc surfaces, `rounded-xl`, soft shadows, 4px spacing grid.
- No shared primitives file: each subagent styles its own files, so they don't collide in parallel.

**Inspiration** — look like a support console (Intercom / Zendesk), not like X; X only as a source of design ideas.
- Intercom inbox: calm 3-pane layout, white panels on light gray, thin borders, generous whitespace; Fin Copilot in the right sidebar, every suggestion shows its sources → our clickable evidence ids.
- Zendesk agent workspace: ticket header with status/meta, context panel on the right; Copilot auto assist proposes a reply **and** an action, the agent approves each → "Next step" block + policy rule chip.

**Inbox layout** (≥1280px)
```
TopBar  [Verdict logo · Inbox · Tech board (badge: open cards) ············ Mode: mock|live · Reset]
Metrics [Investigated · Outcome mix bar + legend · Kept from tech · Actions done/blocked · Eval]
┌ Cases 300px ┬ Conversation (flex) ───────────┬ Copilot 440px ─────────────┐
│ outcome pill│ header: subject, customer, status│ Investigate (hero)          │
│ status dot  │ messages                         │ Live trace (timeline)       │
│             │ composer: "Suggested by Verdict" │ Verdict card                │
│             │   badge when prefilled           │ Customer records (below)    │
└─────────────┴──────────────────────────────────┴─────────────────────────────┘
```
- Copilot order: Investigate → trace → verdict → customer records. Records stay mounted so evidence highlight still scrolls to them.

**Investigate hero**
- Idle: large button "Investigate" + sub-line "Agent checks chat, billing, access and logs".
- Running: vertical timeline, one node per step `n/8`: tool icon, label, running shimmer, returned ids as small clickable `IdChip`s; agent thought in muted italic above its tool. Header shows `step n of 8` and a `replay` / `live` badge.
- Done: full timeline stays visible (shows the agent loop on video); header switches to "Done · n steps".

**Verdict card**
- Coloured header band per outcome: icon, label, confidence as a 0–100 bar.
- "Next step" block first: the primary action (Restore / Refund / Send to tech / Insert instruction / Ask question) + "Use suggested reply" (fills composer). Policy result shown inline with rule chip (`R1`, `S1` …) + toast.
- Then "Customer wants", "What happened", "Evidence" (clickable ids, existing highlight).
- `tech_team` after send: impact callout "38 customers affected · View on tech board →".
- `suspicious`: red banner "Prompt injection blocked — no action proposed"; evidence `msg_0010` chip highlights the message in chat.
- `downgraded`: amber notice stays.

**Tech board**
- Card hero: big affected-customer number, signature chip, root cause, linked cases, first 5 customer ids + "+33".
- Empty state: "No tech issues yet — investigate case_104".

**Metrics strip**
- Tiles with label + big number; outcome mix bar gets a legend.

**Execution**: 3 parallel subagents with disjoint files — (A) foundation + shell + metrics + case list + chat, (B) investigate panel + trace + verdict card + customer records, (C) board. Then ECC review + browser pass on 103/104/107.

## Acceptance criteria
- [ ] Body text renders in Geist (computed `font-family` starts with Geist) on `/` and `/board`.
- [ ] At 1440×900, after investigating case_103 the verdict header and primary action are visible without scrolling the copilot.
- [ ] Trace shows `step n of 8` while running and every tool row shows its returned ids as chips.
- [ ] case_103: Restore → toast + inline `R1`; composer filled via "Use suggested reply".
- [ ] case_104: Send to tech → impact callout with "38 customers"; board card shows 38 as the largest number.
- [ ] case_107: red "Prompt injection blocked" banner; no action button rendered; `msg_0010` chip highlights the chat message.
- [ ] No file in `src/api/**` changed; `pnpm typecheck && pnpm lint && pnpm test` pass.
- [ ] No console errors during the 103 → 104 → board → 107 click-through.

## Decisions
Approved 2026-10-31: indigo accent, English copy, full timeline kept after done.
