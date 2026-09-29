// The model seam. runAgent takes a CallModel; this file provides two and picks one.
//   real: the Anthropic client, used when ANTHROPIC_API_KEY is set.
//   mock: scripted tool calls and rule-based decisions, used otherwise (or MOCK=1).
// Both return the same Message shape, so nothing downstream can tell them apart.
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import type { Priority, OwnerTeam, NextAction, Ticket, ServiceHealth } from "./types";

export type CallModel = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

export function selectModel(): { name: string; call: CallModel } {
  const useMock = process.env.MOCK === "1" || !process.env.ANTHROPIC_API_KEY;
  if (useMock) return { name: `mock${process.env.MOCK_MODE ? ` (${process.env.MOCK_MODE})` : ""}`, call: mockModel };
  const client = new Anthropic();
  return { name: process.env.MODEL ?? "claude-haiku-4-5", call: (p) => client.messages.create(p) };
}

// --- mock ----------------------------------------------------------------------
// Reads what the loop has already collected (tool results in `messages`) and
// scripts the next step: get_ticket -> get_service_health -> search -> submit.
// MOCK_MODE=garbage submits an invalid decision; =silent never submits;
// =rogue tries a tool that does not exist before continuing.

let counter = 0;
const message = (content: Anthropic.ContentBlock[], stop: Anthropic.Message["stop_reason"]): Anthropic.Message =>
  ({ id: `msg_mock_${++counter}`, type: "message", role: "assistant", model: "mock", content, stop_reason: stop,
     stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } as unknown as Anthropic.Message);
const toolUse = (name: string, input: unknown): Anthropic.ToolUseBlock =>
  ({ type: "tool_use", id: `toolu_mock_${++counter}`, name, input } as Anthropic.ToolUseBlock);

// Collect { toolName -> parsed result } from the conversation so far.
function seen(messages: Anthropic.MessageParam[]): Record<string, unknown> {
  const idToName = new Map<string, string>();
  const out: Record<string, unknown> = {};
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const b of m.content) {
      if (b.type === "tool_use") idToName.set(b.id, b.name);
      if (b.type === "tool_result" && typeof b.content === "string" && !b.is_error) {
        const name = idToName.get(b.tool_use_id);
        const json = b.content.match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0]; // strip the untrusted wrapper if present
        if (name && json) out[name] = JSON.parse(json);
      }
    }
  }
  return out;
}

export async function mockModel(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
  const first = params.messages[0]?.content;
  const ticketId = (typeof first === "string" ? first : "").match(/T-\d+/)?.[0] ?? "T-0000";
  const got = seen(params.messages);
  const mode = process.env.MOCK_MODE;
  const rogueDone = params.messages.some((m) => typeof m.content !== "string" && m.content.some((b) => b.type === "tool_use" && b.name === "approve_hotfix"));

  if (mode === "rogue" && !rogueDone) return message([toolUse("approve_hotfix", { ticket_id: ticketId })], "tool_use");
  if (!got.get_ticket) return message([toolUse("get_ticket", { ticket_id: ticketId })], "tool_use");
  const ticket = got.get_ticket as Ticket;
  if (!got.get_service_health) return message([toolUse("get_service_health", { service_name: ticket.service })], "tool_use");
  if (!got.search_related_incidents) return message([toolUse("search_related_incidents", { query: ticket.labels.join(" ") })], "tool_use");

  if (mode === "silent") return message([{ type: "text", text: "I have looked at everything.", citations: null } as Anthropic.TextBlock], "end_turn");
  const decision = decide(ticket, got.get_service_health as ServiceHealth);
  if (mode === "garbage") return message([toolUse("submit_triage_decision", { ...decision, priority: "critical", confidence: 7 })], "tool_use");
  return message([toolUse("submit_triage_decision", decision)], "tool_use");
}

// Rules, not judgment. Enough to send different tickets down different paths.
// requiresHumanApproval is deliberately always false: the gate must fix it.
function decide(t: Ticket, h: ServiceHealth) {
  const has = (l: string) => t.labels.includes(l);
  const ownerTeam: OwnerTeam =
    has("ci") ? "qa" : has("ops") ? "ops" : has("integration") ? "integrations" : has("wms") ? "wms" : "platform";
  let priority: Priority = "P2", nextAction: NextAction = "investigate", confidence = 0.7;
  if (h.status === "down")         { priority = "P0"; nextAction = "hotfix";      confidence = 0.9; }
  else if (h.status === "degraded"){ priority = "P1"; nextAction = "investigate"; confidence = 0.8; }
  else if (has("duplicate"))       { priority = "P3"; nextAction = "reject";      confidence = 0.85; }
  else if (has("cleanup"))         { priority = "P2"; nextAction = "needs_human"; confidence = 0.5; }
  else if (has("ci") || has("ops") || has("low")) { priority = "P3"; nextAction = "schedule"; confidence = 0.8; }
  return {
    ticketId: t.id, priority, ownerTeam, nextAction, confidence,
    rationale: `[mock] service ${h.name} is ${h.status} (error_rate ${h.error_rate}); labels ${t.labels.join(", ")}.`,
    requiresHumanApproval: false,
  };
}
