# Spec: Copilot as a conversation

## Goal
Investigate reads as a conversation between the support agent and Verdict: the agent says what it checks, what it found and why it decides, every claim tied to evidence ids. Support can ask "why?" and get an evidence-grounded answer. Suggestions (reply, action) arrive animated so it is obvious what the agent proposes. Raises "Use of AI" + "Presentation"; capability 3 (help agents decide).

## Non-goals
- Free-form chat that takes actions — actions stay buttons through the policy gate (anti-drift: not a chatbot).
- Persisting the conversation across reloads — the verdict persists already; demo runs in one session.
- New dependencies — Tailwind + `tw-animate-css` cover the animation.

## Current state
- `components/verdict/investigate-panel.tsx` + `trace.tsx`: numbered timeline of tool steps; agent `text` events shown as muted thoughts.
- `verdict-card.tsx`: verdict summary, evidence chips, Next step buttons; composer prefill in `inbox.tsx` / `chat-thread.tsx` ("Suggested by Verdict" badge).
- No endpoint to ask about a verdict (`docs/api.md` v1).

## Proposed design
**Panel = chat thread** (same column, replaces the timeline look; data stays the SSE trace):
- Agent bubble per step: its `text` as a first-person sentence, then a compact "Checked billing → 2 records" line with id chips (click = existing evidence highlight). Running step shows typing dots.
- Final agent bubble = verdict: "My call: Tech team · 82%", then **Because** — `whatHappened` as bullets, each with its evidence chips; downgrade/injection notices inline.
- Proposal bubble: suggested action button + "Use suggested reply"; both fade/slide in after the verdict (200–300 ms stagger); the action button gets a one-time subtle ring pulse.
- Composer prefill animates in (typewriter, ~1.5 s, skipped on click/typing); "Suggested by Verdict" badge stays.
- Panel bottom: input "Ask Verdict why…" + quick chips "Why this outcome?", "What evidence?", "What if I refund?".

**Ask endpoint (contract v2 addition, additive):** `POST /api/cases/{id}/ask { question: string (1–500) }` → `{ answer: string, evidence: string[] }`.
- Backend: one Claude call with the stored verdict + the records it cites (read-only, scoped to the case's customer); prompt: answer only from these records, cite ids, else say "not in the evidence". Validator drops ids not in the case's records. 409 if no verdict.
- Mock client: canned answers per case built from verdict fields.

## Acceptance criteria
- [ ] During Investigate each step appears as an agent bubble with first-person text and clickable id chips.
- [ ] Verdict bubble lists reasons, each with ≥ 1 evidence chip; clicking a chip highlights the record.
- [ ] Action button and suggested reply animate in after the verdict; prefill types into the composer and stops when support types.
- [ ] "Why this outcome?" on case_104 returns an answer citing `err_0002` (http) / a canned answer (mock); unknown ids never shown.
- [ ] `/ask` before investigate → 409; question > 500 chars → 400.
- [ ] Existing labels/flows (Investigate, Restore access, Send to tech board, Fix it) keep working; typecheck/lint/test + `go vet/test` green.

## Open questions
1. Real Claude call for "Ask why" live in the demo (≈ 3–5 s), or mock-only? Recommend real, mock as fallback.

## Decisions
Approved 2026-10-31: live Claude call for Ask, mock as fallback.
