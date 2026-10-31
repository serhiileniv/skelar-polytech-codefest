# Criteria → proof

Fill the right column once the product is picked. Each row needs a concrete moment in the demo or a file in the repo.

| Criterion                                                            | How we prove it |
| -------------------------------------------------------------------- | --------------- |
| Operational Impact                                                   | case_104: 1 complaint → tech card with 38 affected customers; 103/105 fixed in one click instead of digging through 5 systems. |
| Innovation                                                           | Investigate routes a case (customer / support / tech) instead of drafting chat replies; one complaint surfaces a silent bug. |
| Use of AI                                                            | Agent loop (≤ 8 steps) picks its own read-only tools and must `submitVerdict`; trace streamed live (SSE). |
| Reasoning & Context Handling                                         | Every verdict cites evidence ids the tools returned; validator downgrades invented ids; click an id → highlighted record. |
| Technical Execution (AI architecture, code quality, security, tests) | Go `controller → usecase → repo`; tools scoped to the case's customer; policy gate (S1 R1 P1–P3 T1) + human click + audit; table tests both sides. |
| Presentation & Demo                                                  | 103 restore → 104 board (38) → 107 injection blocked → metrics strip; replay mode so the demo never depends on network. |

## Required capabilities → feature

| Capability                             | Feature |
| -------------------------------------- | ------- |
| 1. Understand request + real goal      | Verdict `customerGoal` + `summary` (e.g. 101: "stop being charged", not "delete app"). |
| 2. Propose / initiate actions          | Next step block: restore / refund / send to tech, through the policy gate after a human click. |
| 3. Help agents decide                  | Outcome + confidence + clickable evidence + prefilled reply. |
| 4. Analyze interactions, score support | Metrics strip: outcome mix, kept from tech, downgrades, actions done/blocked, eval accuracy. |
