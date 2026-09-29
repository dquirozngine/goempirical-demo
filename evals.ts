// Evals: every ticket through triageTicket with the mock model, plus the three
// failure modes. Asserts invariants the harness must guarantee, never specific
// judgments. Deterministic, no API key.   npm run evals
import { triageTicket } from "./agent";
import { mockModel } from "./model";
import { validateDecision, requiresHitl } from "./decision";
import { listTicketIds, registry } from "./tools";
import type { TriageDecision, ToolLogEntry } from "./types";

type Check = [name: string, ok: boolean];
const invariants = (d: TriageDecision, log: ToolLogEntry[], ticketId: string): Check[] => [
  ["decision is a valid TriageDecision", (() => { try { validateDecision(d); return true; } catch { return false; } })()],
  ["ticketId matches the request", d.ticketId === ticketId],
  ["HITL flag is at least what the policy requires", d.requiresHumanApproval || !requiresHitl(d)],
  ["first successful call is get_ticket", log.find((e) => e.ok)?.tool === "get_ticket"],
  ["no unregistered tool ever succeeded", log.every((e) => e.tool === "submit_triage_decision" || e.tool in registry || !e.ok)],
  ["submit, if present, was the last call", !log.some((e) => e.tool === "submit_triage_decision") || log.at(-1)?.tool === "submit_triage_decision"],
];

async function run() {
  let failures = 0;
  const report = (label: string, checks: Check[]) => {
    const bad = checks.filter(([, ok]) => !ok);
    failures += bad.length;
    console.log(`${bad.length ? "FAIL" : "PASS"}  ${label}${bad.length ? "\n        " + bad.map(([n]) => n).join("\n        ") : ""}`);
  };

  console.log("== every ticket, mock model");
  for (const { id } of listTicketIds()) {
    const { decision: d, toolCalls } = await triageTicket(id, mockModel);
    report(`${id}  ${d.priority} ${d.ownerTeam} ${d.nextAction} conf=${d.confidence} hitl=${d.requiresHumanApproval}`, invariants(d, toolCalls, id));
  }

  console.log("\n== failure modes");
  const modes: [string, string, (d: TriageDecision, log: ToolLogEntry[]) => Check[]][] = [
    ["garbage", "T-1842", (d) => [["fell back to needs_human", d.nextAction === "needs_human" && d.requiresHumanApproval && d.confidence === 0]]],
    ["silent",  "T-1842", (d) => [["fell back to needs_human", d.nextAction === "needs_human" && d.requiresHumanApproval]]],
    ["rogue",   "T-1901", (d, log) => [
      ["unknown tool was refused and logged", log.some((e) => e.tool === "approve_hotfix" && !e.ok)],
      ["triage still completed", d.nextAction !== "needs_human"],
    ]],
  ];
  for (const [mode, id, extra] of modes) {
    process.env.MOCK_MODE = mode;
    const { decision: d, toolCalls } = await triageTicket(id, mockModel);
    report(`${mode.padEnd(8)} ${id}  ${d.priority} ${d.nextAction} hitl=${d.requiresHumanApproval}`, [...invariants(d, toolCalls, id), ...extra(d, toolCalls)]);
  }
  delete process.env.MOCK_MODE;

  console.log(failures ? `\n${failures} invariant(s) violated` : "\nall invariants hold");
  process.exit(failures ? 1 : 0);
}
run();
