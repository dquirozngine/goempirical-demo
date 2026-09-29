// Gate tests. Not required by the exercise; kept as the proof for the HITL rule.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDecision, enforceHitl, fallbackDecision, DecisionError } from "../decision";
import type { TriageDecision } from "../types";

const base: TriageDecision = {
  ticketId: "T-0", priority: "P2", ownerTeam: "wms", nextAction: "investigate",
  rationale: "x", confidence: 0.9, requiresHumanApproval: false,
};
const hitl = (patch: Partial<TriageDecision>) => enforceHitl({ ...base, ...patch }).requiresHumanApproval;

test("HITL: nothing trips on a confident P2 investigate", () => assert.equal(hitl({}), false));
test("HITL: P0 and P1 force approval", () => {
  assert.equal(hitl({ priority: "P0", confidence: 1 }), true);
  assert.equal(hitl({ priority: "P1", confidence: 0.99 }), true);
});
test("HITL: hotfix forces approval at any priority", () => assert.equal(hitl({ priority: "P3", nextAction: "hotfix", confidence: 0.95 }), true));
test("HITL: confidence floor is exclusive at 0.6", () => {
  assert.equal(hitl({ priority: "P3", nextAction: "schedule", confidence: 0.6 }), false);
  assert.equal(hitl({ priority: "P3", nextAction: "schedule", confidence: 0.59 }), true);
});
test("HITL: model can raise the flag but never lower it", () => {
  assert.equal(hitl({ priority: "P3", nextAction: "schedule", requiresHumanApproval: true }), true);
  assert.equal(hitl({ priority: "P0", nextAction: "hotfix", requiresHumanApproval: false }), true);
});

test("validate: accepts a well-formed decision and coerces numeric-string confidence", () => {
  const d = validateDecision({ ...base, confidence: "0.7" });
  assert.equal(d.confidence, 0.7);
});
test("validate: rejects bad enum, out-of-range confidence, empty field, non-object", () => {
  assert.throws(() => validateDecision({ ...base, priority: "critical" }), DecisionError);
  assert.throws(() => validateDecision({ ...base, confidence: 1.4 }), DecisionError);
  assert.throws(() => validateDecision({ ...base, rationale: "" }), DecisionError);
  assert.throws(() => validateDecision("lol"), DecisionError);
});
test("fallback: needs_human, approval required, reason in rationale", () => {
  const d = fallbackDecision("T-1", new Error("boom"));
  assert.equal(d.nextAction, "needs_human");
  assert.equal(d.requiresHumanApproval, true);
  assert.equal(d.confidence, 0);
  assert.match(d.rationale, /boom/);
});
