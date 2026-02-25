/**
 * StepBtScoringSystem tests — S1-b: step-based BT calibration scoring.
 */
import { describe, it, expect } from "bun:test";
import { StepBtScoringSystem } from "./wrappers";

describe("StepBtScoringSystem", () => {
  const scoring = new StepBtScoringSystem();

  it("returns ModelScore[] with correct length for valid model IDs", async () => {
    const scores = await scoring.getScores(["openai/gpt-4.1", "openai/gpt-4.1-mini"]);
    expect(scores).toHaveLength(2);
  });

  it("returns ModelScore with modelId, dimensions, and overall > 0", async () => {
    const [score] = await scoring.getScores(["openai/gpt-4.1"]);
    expect(score!.modelId).toBe("openai/gpt-4.1");
    expect(score!.overall).toBeGreaterThan(0);
    expect(Object.keys(score!.dimensions).length).toBeGreaterThan(0);
  });

  it("returns empty array for unknown model IDs", async () => {
    const scores = await scoring.getScores(["unknown/no-such-model"]);
    expect(scores).toHaveLength(0);
  });

  it("dimensions have mu and sigma fields", async () => {
    const [score] = await scoring.getScores(["openai/gpt-4.1"]);
    const someKey = Object.keys(score!.dimensions)[0]!;
    expect(score!.dimensions[someKey]).toHaveProperty("mu");
    expect(score!.dimensions[someKey]).toHaveProperty("sigma");
    expect(score!.dimensions[someKey]!.mu).toBeGreaterThan(0);
  });

  it("overall is average of dimension mu values", async () => {
    const [score] = await scoring.getScores(["openai/gpt-4.1"]);
    const dims = Object.values(score!.dimensions);
    const expectedOverall = dims.reduce((sum, d) => sum + d.mu, 0) / dims.length;
    // Allow small floating-point tolerance
    expect(Math.abs(score!.overall - expectedOverall)).toBeLessThan(1);
  });

  it("update() resolves without throwing (stub)", async () => {
    await expect(scoring.update([])).resolves.toBeUndefined();
  });
});
