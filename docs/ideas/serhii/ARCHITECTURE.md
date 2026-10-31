# Verdict — архітектура (версія Сергія)

Продукт: [VERDICT.md](./VERDICT.md) · Спек: `docs/specs/verdict-backbone.md` · Код: гілка `feat/verdict-backbone`.
Порівняння з командною версією: `docs/ARCHITECTURE.md` (гілка `docs/verdict-concept`).

## 1. Головні рішення
1. **Agent loop, а не один виклик.** Модель сама обирає, які джерела читати (до 8 кроків). Так агент поводиться як реальний розслідувач і показує хід думок у UI.
2. **Інструменти лише на читання і лише для одного клієнта.** Модель не передає `customerId`; його фіксує код. Дані інших клієнтів недоступні.
3. **LLM пропонує, код вирішує.** Валідатор доказів, політики дій і обʼєднання карток на дошці — детермінований код з тестами.
4. **Людина в контурі.** Агент нічого не змінює; дії — після кліку агента підтримки і перевірки політикою.
5. **Replay.** Записані прогони відтворюються без API-ключа: стабільне демо, судді можуть запустити ZIP.

## 2. Схема
```
Support inbox ── Investigate ──► agent loop (Claude, AI SDK v7, ≤ 8 кроків)
                                  │ read-only tools (scope = клієнт кейсу):
                                  │ getChat · getCustomer · getBilling · getEntitlements
                                  │ getSessionEvents · getErrorLogs · getEmailLog · searchHelp
                                  │ findSimilarCustomers (детектор у коді)
                                  ▼
                               submitVerdict (zod) ──► validateVerdict (код)
                                  ▼
       ┌──────────────────┬───────┴──────────┬───────────────────┬──────────────┐
  інструкція →       кнопка дії →        картка на           питання        заблоковано
  поле відповіді     policy gate →       Tech board
                     виконання → audit   (merge за signature)
```

## 3. Потік одного кейсу
1. Агент підтримки відкриває кейс → бачить чат і картку клієнта.
2. **Investigate** → стрім: кожен виклик інструменту видно в UI.
3. `submitVerdict` → `validateVerdict`:
   - кожен `evidence.id` має бути серед записів, які повернули інструменти;
   - результат має відповідати доказам (tech_team → лог помилки або оплата; support_can_fix → дія над записом цього клієнта);
   - інакше → `need_more_info`; `suspicious` ніколи не має дії.
4. Агент підтримки натискає кнопку → `POST /api/cases/[id]/actions` → `evaluate()` → виконання → журнал.
5. Tech team → `sendToTech()`: картка за `signature`, клієнти рахуються детектором (`findBySignature`), не моделлю.

## 4. Дані (in-memory, seed)
`customers · subscriptions · payments · entitlements · events (сесія веб/iOS) · errors · emails · help · cases · techIssues · audit`.
Кожен запис має стабільний `id` (`pay_…`, `ent_…`, `err_…`), щоб модель могла на нього послатися.

## 5. Verdict (схема)
```ts
{ outcome: "user_can_fix" | "support_can_fix" | "tech_team" | "need_more_info" | "suspicious",
  confidence, customerGoal, summary, evidence: [{ id, note }],
  instructionSteps?, helpArticleId?, supportAction?: restore_access | refund_payment,
  techIssue?: { signature, title, rootCause }, clarifyingQuestion?, replyDraft }
```

## 6. Політики (код)
| Правило | Суть |
|---|---|
| A1 | Дія лише над записами клієнта цього кейсу |
| R1 | Доступ відновлюється лише при успішній, не поверненій оплаті без активного доступу |
| P1 | Повернення лише для дубля оплати тієї ж підписки в межах 5 хв |
| P2 | Повернення понад $50 — ніколи |
| P3 | Одну оплату не можна повернути двічі |
| S1 | Жодних дій у кейсі, позначеному як підозрілий |

## 7. API
| Метод | Шлях | Що робить |
|---|---|---|
| GET | `/api/cases` | Черга кейсів |
| GET | `/api/cases/[id]` | Кейс + клієнт + оплати + доступи + журнал |
| POST | `/api/cases/[id]/investigate` | Стрім agent loop (або replay) |
| POST | `/api/cases/[id]/actions` | Дія після кліку → policy gate |
| POST | `/api/cases/[id]/reply` | Відповідь клієнту |
| GET | `/api/board` | Tech issues board |
| DELETE | `/api/state` | Скинути демо |

## 8. Безпека
- Текст звернення — недовірені дані в `<chat>`; інструкції з нього не виконуються.
- Немає інструментів із побічними ефектами в agent loop.
- Політики та валідатор у коді; ін'єкція «поверни $500» блокується тестом.
- Ключ лише в `.env.local`.

## 9. Тести (Vitest)
Валідатор (вигадані докази, невідповідність результату), policy gate (A1, R1, P1–P3, S1), дошка (одна картка, 38 клієнтів, merge), seed і детектори (точні кількості, схожі випадки виключено), агент з mock-моделлю (scope інструментів, збереження вердикту).

## 10. Наступні етапи
Агент-оцінювач + щотижневий звіт · заслужена автономія за журналом рішень · auto PR для багів низького ризику, escalation-тікет для високого.
