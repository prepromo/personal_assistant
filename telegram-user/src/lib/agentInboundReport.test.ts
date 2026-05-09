import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAgentReportLlmJson } from "./agentInboundReport.js";

describe("parseAgentReportLlmJson", () => {
  it("parses plain JSON", () => {
    const p = parseAgentReportLlmJson(
      '{"owner_report":"Кам ответил да.","all_steps_done":true,"confidence":0.8}',
    );
    assert.ok(p);
    assert.equal(p!.all_steps_done, true);
    assert.equal(p!.confidence, 0.8);
    assert.ok(p!.owner_report.includes("Кам"));
  });

  it("parses fenced JSON", () => {
    const p = parseAgentReportLlmJson("```json\n{\"owner_report\":\"Ок\",\"all_steps_done\":false,\"confidence\":0.1}\n```");
    assert.ok(p);
    assert.equal(p!.all_steps_done, false);
  });

  it("returns null for empty owner_report", () => {
    assert.equal(parseAgentReportLlmJson('{"owner_report":"","all_steps_done":false}'), null);
  });
});
