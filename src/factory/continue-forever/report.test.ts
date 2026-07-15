import { describe, expect, it } from "vitest";
import { buildStopReport, renderFinalReport } from "./report";

describe("final report rendering", () => {
  it("renders a stop report with the required owner-facing lines", () => {
    const report = buildStopReport({
      stopCode: "NO_CURRENT_TASK",
      reasons: ["No packet is marked as the current task; nothing to continue."],
      executionMode: "live",
      taskPacketId: "none",
      missionTitle: "Continue Forever — current task resolution",
    });
    const text = renderFinalReport(report);
    expect(text).toContain("Continue Forever — final report");
    expect(text).toContain("NO_CURRENT_TASK");
    expect(text).toContain("Execution mode:     live");
    expect(text).toContain("Next task started:  no");
    expect(text).toContain("Automatic merge:    disabled");
    expect(report.nextTaskStarted).toBe(false);
    expect(report.automaticMerge).toBe(false);
  });

  it("marks a fake-mode report as HERMETIC_TEST / TEST_ONLY in the rendered text", () => {
    const report = buildStopReport({
      stopCode: "NO_CURRENT_TASK",
      reasons: ["none"],
      executionMode: "fake",
      taskPacketId: "none",
      missionTitle: "x",
    });
    const text = renderFinalReport(report);
    expect(text).toContain("Execution mode:     fake");
    expect(text).toContain("HERMETIC_TEST");
    expect(text).toContain("TEST_ONLY");
  });

  it("keeps redaction on stop-report blockers", () => {
    const report = buildStopReport({
      stopCode: "CURRENT_TASK_INVALID",
      reasons: ["problem with token Bearer sk-LEAKED123 present"],
      executionMode: "live",
      taskPacketId: "FACTORY-X",
      missionTitle: "x",
    });
    expect(report.blockers.join(" ")).not.toContain("sk-LEAKED123");
  });
});
