// Decision model from the challenge starter.
// Each enum lives once as a runtime array; the type is derived from it so
// validation (decision.ts) and the model's output schema (agent.ts) can't drift.

export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export const OWNER_TEAMS = ["platform", "wms", "integrations", "qa", "ops"] as const;
export const NEXT_ACTIONS = ["investigate", "hotfix", "schedule", "needs_human", "reject"] as const;

export type Priority = (typeof PRIORITIES)[number];
export type OwnerTeam = (typeof OWNER_TEAMS)[number];
export type NextAction = (typeof NEXT_ACTIONS)[number];

export type TriageDecision = {
  ticketId: string;
  priority: Priority;
  ownerTeam: OwnerTeam;
  nextAction: NextAction;
  rationale: string;
  confidence: number; // 0..1
  requiresHumanApproval: boolean;
};

// What the tools return. Shapes match data.json.

export type Ticket = {
  id: string;
  title: string;
  description: string;
  labels: string[];
  reporter: string;
  created_at: string;
  service: string;
};

export type Incident = {
  id: string;
  title: string;
  service: string;
  severity: "SEV1" | "SEV2" | "SEV3";
  resolved_at: string;
  tags: string[];
};

export type ServiceHealth = {
  name: string;
  status: "healthy" | "degraded" | "down";
  error_rate: number;
};

// One entry per tool call, appended by the executor.
export type ToolLogEntry = {
  tool: string;
  input: unknown;
  ok: boolean;
  error?: string;
};
