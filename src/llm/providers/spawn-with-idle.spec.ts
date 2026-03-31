/**
 * Tests for spawnWithIdleTimeout — kills subprocess when stdout/stderr go idle.
 */

import { describe, it, expect } from "bun:test";
import { spawnWithIdleTimeout, IdleTimeoutError } from "./spawn-with-idle";

describe("spawnWithIdleTimeout", () => {
  it("should return stdout/stderr/exitCode for a normal process", async () => {
    const result = await spawnWithIdleTimeout(
      ["echo", "hello"],
      { stdout: "pipe", stderr: "pipe" },
      { idleMs: 5000 },
    );
    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
  });

  it("should capture stderr", async () => {
    const result = await spawnWithIdleTimeout(
      ["bash", "-c", "echo err >&2"],
      { stdout: "pipe", stderr: "pipe" },
      { idleMs: 5000 },
    );
    expect(result.stderr.trim()).toBe("err");
  });

  it("should kill process and throw IdleTimeoutError when idle exceeds threshold", async () => {
    // sleep 60 produces no output — should be killed after short idle
    await expect(
      spawnWithIdleTimeout(
        ["sleep", "60"],
        { stdout: "pipe", stderr: "pipe" },
        { idleMs: 200 },
      ),
    ).rejects.toThrow(IdleTimeoutError);
  });

  it("should NOT kill a process that streams continuously", async () => {
    // Emit data every 50ms for 500ms total — idle timeout is 300ms
    const result = await spawnWithIdleTimeout(
      ["bash", "-c", "for i in 1 2 3 4 5; do echo $i; sleep 0.05; done"],
      { stdout: "pipe", stderr: "pipe" },
      { idleMs: 300 },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().split("\n").length).toBe(5);
  });

  it("should pass through non-zero exit codes", async () => {
    const result = await spawnWithIdleTimeout(
      ["bash", "-c", "exit 42"],
      { stdout: "pipe", stderr: "pipe" },
      { idleMs: 5000 },
    );
    expect(result.exitCode).toBe(42);
  });

  it("should pass spawn options (cwd, env, stdin)", async () => {
    const result = await spawnWithIdleTimeout(
      ["pwd"],
      { stdout: "pipe", stderr: "pipe", cwd: "/tmp" },
      { idleMs: 5000 },
    );
    expect(result.stdout.trim()).toBe("/tmp");
  });
});
