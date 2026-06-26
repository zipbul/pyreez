import { describe, it, expect } from "bun:test";
import { resolveStdinFlags } from "./cli";

describe("resolveStdinFlags", () => {
  it("does nothing and does not read stdin when no flag is '-'", async () => {
    let called = 0;
    const flags = { task: "hello", models: "m1" };
    await resolveStdinFlags(flags, async () => { called++; return "PIPED"; });
    expect(called).toBe(0);
    expect(flags).toEqual({ task: "hello", models: "m1" });
  });

  it("substitutes the single '-' flag with stdin content (reads once)", async () => {
    let called = 0;
    const flags: Record<string, string> = { task: "ask", subject: "-", models: "m1" };
    await resolveStdinFlags(flags, async () => { called++; return "PIPED SUBJECT"; });
    expect(called).toBe(1);
    expect(flags.subject).toBe("PIPED SUBJECT");
    expect(flags.task).toBe("ask"); // untouched
  });

  it("resolves '-' on any content flag (e.g. task, deliberate)", async () => {
    const f1: Record<string, string> = { task: "-" };
    await resolveStdinFlags(f1, async () => "T");
    expect(f1.task).toBe("T");

    const f2: Record<string, string> = { deliberate: "-" };
    await resolveStdinFlags(f2, async () => "D");
    expect(f2.deliberate).toBe("D");
  });

  it("rejects more than one '-' flag (stdin can be read only once)", async () => {
    const flags: Record<string, string> = { subject: "-", criteria: "-" };
    await expect(
      resolveStdinFlags(flags, async () => "X"),
    ).rejects.toThrow(/only one flag may read from stdin/i);
  });

  it("does not treat a non-content flag '-' as stdin", async () => {
    let called = 0;
    const flags: Record<string, string> = { models: "-", judge: "-" };
    await resolveStdinFlags(flags, async () => { called++; return "X"; });
    expect(called).toBe(0);
    expect(flags.models).toBe("-"); // unchanged: "models" is not a content flag
  });
});
