# Idea (Serhii): Verdict — "can the user fix it, or is it on us?"

## Problem
Every support case starts with one question: can the customer fix this himself, or is it our issue?
Answering it means digging through payments, access, app logs and help docs, then pinging other teams.
Wrong answers cost both ways: a real bug answered with a template (angry customer, chargeback, bug keeps spreading),
or a customer mistake escalated to engineers (wasted dev time).

## Solution
Support inbox with an **Investigate** button. It starts a read-only AI agent loop that pulls the customer's
production context (chat, DB, session events, error logs, help center) and returns an outcome with confidence and evidence:

| Outcome | Who resolves | What the support member gets |
|---|---|---|
| User can fix it | Customer | Step-by-step instruction inserted into the reply |
| Support can fix it | Support team | One-click action (e.g. restore access), checked by a policy gate in code |
| Tech team | Engineering | Card on the Tech issues board, merged by root cause with affected-customer count |
| Need more info | Support | Drafted clarifying question |
| Suspicious | Nobody | Blocked, nothing proposed |

Goal: less between-team back-and-forth, faster resolution, less load on engineers.

## Architecture
```
Support inbox ── Investigate ──► agent loop (Claude, AI SDK, max 8 steps)
                                  │ read-only tools, scoped to this customer:
                                  │ chat · customer · billing · entitlements · session events · error logs · help · similar cases
                                  ▼
                               submitVerdict (zod schema)
                                  ▼
                               validator (code): evidence ids must exist, outcome must match evidence
                                  ▼
          ┌───────────────┬───────┴─────────┬────────────────────┐
     instruction     action button      tech issue card     question / blocked
     → reply box     → policy gate      → board (merged)
                       → execute → audit
```
- LLM proposes, code disposes: policy, validation and merging are deterministic and tested.
- Agent never writes; actions need a human click and pass the gate.
- Replay cache: recorded runs replay without an API key (stable demo, judges can run the ZIP).

## Later
Evaluator agent grading every run + weekly report · earned autonomy per action type from the decision record ·
auto-drafted PR for low-risk bugs.
