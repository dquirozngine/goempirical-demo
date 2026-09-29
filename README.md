# Ticket Triage Agent

A small tool-calling agent that triages engineering tickets and returns a structured,
validated `TriageDecision`. Built for the live coding challenge. TypeScript, console only.

**Runs without an API key.** A mock model is used unless `ANTHROPIC_API_KEY` is set.

## Run it

```
npm install
npm start            # console. Type a ticket id, "list" to see them, "exit" to quit
npm run evals        # every ticket through the harness, invariants checked, deterministic
npm test             # unit tests for the decision gate
```

Console session:

```
you> list                 # ids and titles from data.json
you> T-1842               # runs triageTicket, prints the decision and the tool log
you> what does P0 mean?   # anything else is a chat turn with the same tools
```

## Mock model vs real model

The choice is made once at startup by `selectModel()` in `model.ts`. The console banner
shows which one is active.

| Situation | Model used |
|---|---|
| No `.env`, or `ANTHROPIC_API_KEY` empty | mock (default, no network) |
| `ANTHROPIC_API_KEY` set in `.env` | real: Anthropic API, `MODEL` from `.env` (default `claude-haiku-4-5`) |
| `MOCK=1 npm start` | mock, even with a key |
| `MOCK_MODE=garbage\|silent\|rogue` | mock, misbehaving on purpose (see below) |

To use the real model: `cp .env.example .env`, fill in `ANTHROPIC_API_KEY`. Evals and tests
always use the mock regardless of the key.

Tickets worth trying: `T-1842` (prompt injection in the description), `T-1910` (service
down, P0), `T-1920` (fake "pre-approved" destructive request), `T-1915` (duplicate).

Failure modes, mock only: `MOCK_MODE=garbage npm start` (model submits an invalid
decision), `MOCK_MODE=silent` (model never submits), `MOCK_MODE=rogue` (model calls a
tool that does not exist). All three end in a safe decision, never a crash.

## What it does

`triageTicket(ticketId)` in `agent.ts`:

1. Starts a fresh conversation with one message, "Triage ticket T-1842."
2. Runs the agent loop. The model calls read-only tools until it calls
   `submit_triage_decision`.
3. Validates the submitted object, applies the human-approval policy, returns the decision
   and the list of tool calls made.
4. On any failure (invalid decision, no submission, turn cap, model error) returns a
   fallback decision: `needs_human`, approval required, confidence 0, reason in the
   rationale. It never throws.

## Files

| File | What is in it |
|---|---|
| `data.json` | The only data source. Tickets, past incidents, service health. Read-only. |
| `types.ts` | `TriageDecision` and its enums. Enums are arrays; the type, the model's schema and the validator all derive from them. |
| `tools.ts` | Tool specs the model sees, `parse` + `run` per tool, the executor `runTool`, the tool log. |
| `decision.ts` | `validateDecision`, `enforceHitl`, `fallbackDecision`. |
| `model.ts` | Model seam: real Anthropic client or the mock, same call signature. |
| `agent.ts` | System prompt blocks, `runAgent` loop, `triageTicket`, console. |
| `evals.ts` | Harness invariants across all tickets and failure modes. |
| `tests/` | Unit tests for the gate (`node:test`, no extra dependency). |

## Design

The model is treated as untrusted, same as the ticket text. Everything it emits crosses
one of two chokepoints.

**Executor, inbound** (`runTool` in `tools.ts`). Every tool call: registry lookup, input
parse, run, log, wrap. Unknown tool names and invalid inputs come back to the model as
error results, not exceptions. Tool bodies are pure lookups against `data.json` and never
see unvalidated input. `get_ticket` results are fenced as untrusted data before they go
back to the model. Nothing in the registry mutates anything, and nothing outside it can
be executed.

**Decision gate, outbound** (`decision.ts`). `validateDecision` checks shape, enums and
ranges and is the only place an untyped object becomes a `TriageDecision`.
`enforceHitl` recomputes `requiresHumanApproval` in code: true when priority is P0 or P1,
confidence is below 0.6, or the action is `hotfix`. The model can raise the flag, never
lower it. `fallbackDecision` is what the caller gets when anything failed.

**Decision channel.** `submit_triage_decision` is a tool by shape only: its input schema is
the `TriageDecision` contract, so the API enforces enums and ranges before the harness
does. It executes nothing. The loop intercepts it and returns its input to the gate.

**System prompt** (`agent.ts`) is assembled from blocks: identity, hard limits, what you
know, how to work, output. The read-only and untrusted-text rules are stated there as
well. The prompt is defence in depth; the chokepoints are the guarantee.

## Requirements checklist

| Requirement | Where |
|---|---|
| `get_ticket`, `search_related_incidents`, `get_service_health`, read-only, validated, structured | `tools.ts` sections 1 and 2 |
| `triageTicket` calls tools, returns a valid decision | `agent.ts` |
| `requiresHumanApproval` for P0/P1, confidence < 0.6, hotfix | `decision.ts` `enforceHitl`, applied in `triageTicket` |
| No write tool exists or can be called | `tools.ts` registry; executor refuses unknown names |
| Invalid decisions rejected, garbage fails safe to `needs_human` | `decision.ts`; `MOCK_MODE=garbage`, `MOCK_MODE=silent` |
| Ticket text treated as untrusted, instructions inside it not executed | executor wrap in `tools.ts`; hard-limits block; `T-1842`, `T-1920` |
| Tool calls logged | `toolLog` in `tools.ts`; printed after every decision |

## The mock model

`mockModel` in `model.ts` has the same call signature as the Anthropic client and returns
the same message shape. It scripts the tool sequence (ticket, health, incidents, submit)
and picks the decision by a few rules on service status and labels. It always submits
`requiresHumanApproval: false` so the gate visibly corrects it. It is deterministic on
purpose: the evals hold the model constant so any failure is in the harness.

## Evals and tests

`npm run evals` runs all nine tickets plus the three failure modes through `triageTicket`
with the mock and checks invariants only: the decision validates, the ticket id matches,
the approval flag is at least what the policy requires, the first successful call is
`get_ticket`, no unregistered tool ever succeeds, submit is the last call. It never asserts
a specific priority, because that is the model's judgment, not the harness's.

`npm test` covers the gate: each approval trigger, the 0.6 boundary, raise-but-never-lower,
validation rejections, and the fallback shape.

## Production notes

- **A write tool with HITL.** Add a registry entry with a side-effect flag. The executor
  refuses to run flagged entries directly and returns a pending action for a human to
  confirm outside the loop. Same chokepoint, one more branch. `requiresHumanApproval` is
  the signal that action would consume.
- **Prompt injection via ticket body or linked docs.** Tool results are data, marked as
  such. No write tool is registered, so there is nothing to hijack. The gate enforces the
  approval policy regardless of what the model says. Linked docs would go through the same
  wrap, with a size cap.
- **Tracing and cost.** The tool log is the trace skeleton: add a run id, per-call timing,
  and the `usage` block from each response summed per ticket. Cap turns (already 8) and
  tokens per ticket.
- **When to use rules instead.** When the decision is a lookup: label to team, service down
  to P0. Route those around the model and keep it for the ambiguous middle.
- **Bounded autonomy.** The loop lets the model pick lookups freely. A stricter variant
  runs the lookups in code and makes one forced decide call; the gate is the same.
