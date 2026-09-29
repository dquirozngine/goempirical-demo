// The decision gate. Everything the model submits passes through here before
// anyone sees it. validateDecision is the only place an untyped object becomes
// a TriageDecision. enforceHitl applies the policy the model is not trusted with.
// fallbackDecision is what the caller gets when anything upstream failed.

import { PRIORITIES, OWNER_TEAMS, NEXT_ACTIONS } from "./types";
import type { TriageDecision, Priority, OwnerTeam, NextAction } from "./types";

export class DecisionError extends Error {}

const HITL_CONFIDENCE_FLOOR = 0.6;

// Shape, enums, ranges. Coerces only what is unambiguous (a numeric string),
// rejects everything else. Throws DecisionError with the field that failed.
export function validateDecision(raw: unknown): TriageDecision {
  if (typeof raw !== "object" || raw === null) throw new DecisionError("decision must be an object");
  const r = raw as Record<string, unknown>;

  const text = (field: string): string => {
    const v = r[field];
    if (typeof v !== "string" || v.trim() === "") throw new DecisionError(`${field} must be a non-empty string`);
    return v.trim();
  };
  const oneOf = <T extends string>(field: string, allowed: readonly T[]): T => {
    const v = text(field);
    if (!allowed.includes(v as T)) throw new DecisionError(`${field} must be one of ${allowed.join(", ")}, got "${v}"`);
    return v as T;
  };

  const confidenceRaw = typeof r.confidence === "string" ? Number(r.confidence) : r.confidence;
  if (typeof confidenceRaw !== "number" || Number.isNaN(confidenceRaw) || confidenceRaw < 0 || confidenceRaw > 1) {
    throw new DecisionError(`confidence must be a number in 0..1, got ${JSON.stringify(r.confidence)}`);
  }
  if (typeof r.requiresHumanApproval !== "boolean") {
    throw new DecisionError("requiresHumanApproval must be a boolean");
  }

  return {
    ticketId: text("ticketId"),
    priority: oneOf<Priority>("priority", PRIORITIES),
    ownerTeam: oneOf<OwnerTeam>("ownerTeam", OWNER_TEAMS),
    nextAction: oneOf<NextAction>("nextAction", NEXT_ACTIONS),
    rationale: text("rationale"),
    confidence: confidenceRaw,
    requiresHumanApproval: r.requiresHumanApproval,
  };
}

// Policy from the challenge: a human signs off when priority is P0/P1, confidence
// is below 0.6, or the action is a hotfix. Computed here, in code. The model may
// raise the flag on its own; it can never lower it.
export function requiresHitl(d: TriageDecision): boolean {
  return (
    d.priority === "P0" ||
    d.priority === "P1" ||
    d.confidence < HITL_CONFIDENCE_FLOOR ||
    d.nextAction === "hotfix"
  );
}

export function enforceHitl(d: TriageDecision): TriageDecision {
  return { ...d, requiresHumanApproval: requiresHitl(d) || d.requiresHumanApproval };
}

// What triageTicket returns when the loop, the parse, or the validation failed.
// Conservative on purpose: a human looks at it, and the reason is in the rationale.
export function fallbackDecision(ticketId: string, reason: unknown): TriageDecision {
  const why = reason instanceof Error ? reason.message : String(reason);
  return {
    ticketId,
    priority: "P1",
    ownerTeam: "ops",
    nextAction: "needs_human",
    rationale: `Automated triage failed: ${why}. Routed to a human.`,
    confidence: 0,
    requiresHumanApproval: true,
  };
}
