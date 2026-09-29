# CLAUDE.md

Ticket triage agent for a live coding challenge. TypeScript, console only, one JSON file
as the data source. Read `README.md` first; it has the run commands, the design and the
requirements checklist. This file is the short version for working in the repo.

## Run and verify

```
npm install
npm start          # console; type a ticket id, "list", or "exit"
npm run evals      # all tickets + failure modes through the harness, mock model, deterministic
npm test           # decision gate unit tests
npx tsc            # type check (noEmit)
```

No API key needed: `model.ts` picks the mock when `ANTHROPIC_API_KEY` is unset.
With a key in `.env` it uses the real model. `MOCK=1` forces the mock.
`MOCK_MODE=garbage|silent|rogue` makes the mock misbehave to exercise the fail-safe paths.

## Map

- `types.ts` — `TriageDecision` + enum arrays. Types, model schema and validator derive from the arrays.
- `data.json` — tickets, incidents, services. Loaded once in `tools.ts`. Never written.
- `tools.ts` — §1 tool specs the model sees, §2 `parse`/`run` per tool + `registry`, §3 executor `runTool` + `toolLog`.
- `decision.ts` — `validateDecision`, `enforceHitl`, `fallbackDecision`.
- `model.ts` — `selectModel`, `mockModel`. Same call signature as the Anthropic client.
- `agent.ts` — system prompt blocks, `runAgent` loop, `triageTicket`, console `main`.
- `evals.ts` — harness invariants. `tests/` — gate unit tests.

## Invariants to keep

- Every model tool call goes through `runTool`. It never throws; errors return as results.
- `submit_triage_decision` is not in `registry`. The loop intercepts it; nothing executes.
- `validateDecision` is the only place an untyped object becomes a `TriageDecision`.
- `enforceHitl` runs in code after validation. The model can raise the flag, never lower it.
- `triageTicket` never throws. Any failure returns `fallbackDecision`.
- No tool mutates anything. Adding a write tool means adding an approval step, not a registry entry.

## Conventions

- Plain TypeScript, no framework. One abstraction (`parse`/`run` pairs) and it exists so the
  executor validates every tool the same way.
- Keep files small and readable top to bottom. Comments say why, not what.
- New tests go in `tests/*.test.ts`. New invariants go in `evals.ts`.
- After any change: `npx tsc && npm test && npm run evals`.
