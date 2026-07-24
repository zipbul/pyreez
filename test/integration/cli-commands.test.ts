/**
 * Integration test — CLI commands: main(argv, deps) through command routing to the handlers.
 *
 * SUT boundary (real implementations):
 *   cli.ts (main, parseArgs, resolveStdinFlags, usageText) + handlers.ts (handleDeliberate,
 *   handleAcceptance) + validation/schemas.ts (--workers JSON schema) + cli-anonymize.ts (the
 *   output-boundary relabeling deliberate/interrogate apply before printing).
 *
 * Outside SUT (test-doubled):
 *   deps.config — a stub HandlersConfig (deliberateFn / chatFn / filteredRegistry), bypassing
 *   buildConfig()'s real discovery + provider + file-IO wiring entirely (zero real provider calls,
 *   zero cost). deps.readStdin / deps.stdout / deps.stderr / deps.exit — capture I/O instead of
 *   touching the real process (deps.exit throws, so a "die" path halts main() the same way
 *   process.exit does in production, without killing the test runner).
 */

import { describe, it, expect } from "bun:test";
import { main, parseArgs } from "../../src/cli";
import type { CliDeps } from "../../src/cli";
import type { HandlersConfig } from "../../src/handlers";
import type { DeliberateOutput } from "../../src/deliberation/types";
import { TeamDegradedError } from "../../src/deliberation/engine";
import type { FileIO } from "../../src/report/types";
import type { TranscriptEntry } from "../../src/deliberation/transcript";
import { EMPTY_RATINGS, recordObservation, ScoredProtocol } from "../../src/model/ratings";
import { RATINGS_PATH } from "../../src/quality/scoring";

class CliExitError extends Error {
  constructor(readonly code: number) {
    super(`process would exit(${code})`);
  }
}

function harness(config: HandlersConfig = {}) {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const deps: CliDeps = {
    config,
    stdout: (t) => stdoutLines.push(t),
    stderr: (t) => stderrLines.push(t),
    exit: (code): never => { throw new CliExitError(code); },
  };
  return { deps, stdoutLines, stderrLines };
}

/**
 * In-memory FileIO — no real disk access. Mirrors BunFileIO's glob semantics (single '*' per
 * pattern, prefix+suffix match within one directory) closely enough for interrogate/ratings,
 * whose lookups are all single-directory, single-wildcard.
 */
function makeMemoryFileIO(initialFiles: Record<string, string> = {}): FileIO {
  const files = new Map<string, string>(Object.entries(initialFiles));
  function splitDir(path: string): { dir: string; base: string } {
    const sep = path.lastIndexOf("/");
    return sep >= 0 ? { dir: path.slice(0, sep), base: path.slice(sep + 1) } : { dir: ".", base: path };
  }
  const io: FileIO = {
    async appendFile(path, data) { files.set(path, (files.get(path) ?? "") + data); },
    async readFile(path) {
      const v = files.get(path);
      if (v === undefined) throw new Error(`ENOENT: no such file, open '${path}'`);
      return v;
    },
    async writeFile(path, data) { files.set(path, data); },
    async mkdir(_path) {},
    async glob(pattern) {
      const { dir: patDir, base: patBase } = splitDir(pattern);
      const star = patBase.indexOf("*");
      const prefix = star >= 0 ? patBase.slice(0, star) : patBase;
      const suffix = star >= 0 ? patBase.slice(star + 1) : "";
      const results: string[] = [];
      for (const key of files.keys()) {
        const { dir: keyDir, base: keyBase } = splitDir(key);
        if (keyDir === patDir && keyBase.startsWith(prefix) && keyBase.endsWith(suffix) && keyBase.length >= prefix.length + suffix.length) {
          results.push(key);
        }
      }
      return results.sort();
    },
    async rename(from, to) {
      const v = files.get(from);
      if (v !== undefined) { files.set(to, v); files.delete(from); }
    },
  };
  return io;
}

const CANNED_OUTPUT: DeliberateOutput = {
  roundsExecuted: 1,
  totalLLMCalls: 2,
  modelsUsed: ["openai/gpt-4.1", "google/gemini-pro"],
  protocol: "shared_convergence",
};

describe("CLI commands — main(argv, deps)", () => {
  // ----------------------------------------------------------
  // Top-level dispatch
  // ----------------------------------------------------------
  describe("top-level dispatch", () => {
    it("prints usage and exits 1 when no command is given", async () => {
      const { deps, stderrLines } = harness();
      await expect(main(["bun", "cli.ts"], deps)).rejects.toThrow(CliExitError);
      expect(stderrLines.join("\n")).toContain("Usage: bun run src/cli.ts");
    });

    it.each([["help"], ["--help"]])("prints usage and exits 1 for '%s'", async (helpArg) => {
      const { deps, stderrLines } = harness();
      await expect(main(["bun", "cli.ts", helpArg], deps)).rejects.toThrow(CliExitError);
      expect(stderrLines.join("\n")).toContain("Usage: bun run src/cli.ts");
    });

    it("dies with Unknown command for an unrecognized command", async () => {
      const { deps, stderrLines } = harness();
      await expect(main(["bun", "cli.ts", "bogus-command"], deps)).rejects.toThrow(CliExitError);
      expect(stderrLines.join("\n")).toContain("Unknown command: bogus-command");
    });
  });

  // ----------------------------------------------------------
  // parseArgs (pure flag parsing)
  // ----------------------------------------------------------
  describe("parseArgs", () => {
    it("parses a valued flag and a boolean flag", () => {
      const { command, flags } = parseArgs(["bun", "cli.ts", "deliberate", "--task", "hello", "--refresh"]);
      expect(command).toBe("deliberate");
      expect(flags["task"]).toBe("hello");
      expect(flags["refresh"]).toBe("true");
    });

    it("returns an empty command for a bare argv (boundary)", () => {
      const { command, flags } = parseArgs(["bun", "cli.ts"]);
      expect(command).toBe("");
      expect(flags).toEqual({});
    });
  });

  // ----------------------------------------------------------
  // stdin resolution
  // ----------------------------------------------------------
  describe("stdin resolution", () => {
    it("resolves --task - into stdin content before dispatch", async () => {
      let receivedTask: string | undefined;
      const config: HandlersConfig = {
        deliberateFn: async (input) => { receivedTask = input.task; return CANNED_OUTPUT; },
      };
      const { deps } = harness(config);
      deps.readStdin = async () => "piped task content";

      await main(["bun", "cli.ts", "deliberate", "--task", "-", "--models", "openai/gpt-4.1", "--no-debug-capture"], deps);

      expect(receivedTask).toBe("piped task content");
    });

    it("rejects more than one flag reading from stdin in the same invocation", async () => {
      const { deps } = harness({});
      deps.readStdin = async () => "content";

      await expect(
        main(["bun", "cli.ts", "acceptance", "--task", "-", "--synthesis", "-", "--workers", "[]"], deps),
      ).rejects.toThrow(/Only one flag may read from stdin/);
    });
  });

  // ----------------------------------------------------------
  // models command
  // ----------------------------------------------------------
  describe("models command", () => {
    it("prints available models as JSON", async () => {
      const config: HandlersConfig = {
        filteredRegistry: {
          getAvailable: () => [
            { id: "openai/gpt-4.1", name: "GPT-4.1", provider: "openai", supportsToolCalling: true } as any,
          ],
          getById: () => undefined,
        },
      };
      const { deps, stdoutLines } = harness(config);

      await main(["bun", "cli.ts", "models"], deps);

      const printed = JSON.parse(stdoutLines.join(""));
      expect(printed.total).toBe(1);
      expect(printed.models[0].id).toBe("openai/gpt-4.1");
    });

    it("dies when the registry is not available", async () => {
      const { deps, stderrLines } = harness({}); // no filteredRegistry
      await expect(main(["bun", "cli.ts", "models"], deps)).rejects.toThrow(CliExitError);
      expect(stderrLines.join("\n")).toContain("Registry not available");
    });
  });

  // ----------------------------------------------------------
  // deliberate command
  // ----------------------------------------------------------
  describe("deliberate command", () => {
    it.each([
      [["bun", "cli.ts", "deliberate"], "--task is required for deliberate"],
      [["bun", "cli.ts", "deliberate", "--task", "t"], "--models is required for deliberate"],
    ])("dies with the expected message for incomplete args", async (argv, expectedMessage) => {
      const { deps, stderrLines } = harness({});
      await expect(main(argv, deps)).rejects.toThrow(CliExitError);
      expect(stderrLines.join("\n")).toContain(expectedMessage);
    });

    it("rejects --reasoning-effort outside the 1-10 range (boundary)", async () => {
      const { deps, stderrLines } = harness({});
      await expect(
        main(["bun", "cli.ts", "deliberate", "--task", "t", "--models", "m/a", "--reasoning-effort", "11"], deps),
      ).rejects.toThrow(CliExitError);
      expect(stderrLines.join("\n")).toContain("--reasoning-effort must be an integer 1");
    });

    it("rejects an invalid --file-access value", async () => {
      const { deps, stderrLines } = harness({});
      await expect(
        main(["bun", "cli.ts", "deliberate", "--task", "t", "--models", "m/a", "--file-access", "bogus"], deps),
      ).rejects.toThrow(CliExitError);
      expect(stderrLines.join("\n")).toContain(`--file-access must be "read" or "write"`);
    });

    it("routes through handleDeliberate to the stub deliberateFn and prints its JSON output", async () => {
      let receivedModels: readonly string[] | undefined;
      let receivedProtocol: string | undefined;
      const config: HandlersConfig = {
        deliberateFn: async (input) => {
          receivedModels = input.models;
          receivedProtocol = input.protocol;
          return CANNED_OUTPUT;
        },
      };
      const { deps, stdoutLines } = harness(config);

      await main([
        "bun", "cli.ts", "deliberate",
        "--task", "Write a function",
        "--models", "openai/gpt-4.1,google/gemini-pro",
        "--protocol", "shared_convergence",
        "--no-debug-capture",
      ], deps);

      expect(receivedModels).toEqual(["openai/gpt-4.1", "google/gemini-pro"]);
      expect(receivedProtocol).toBe("shared_convergence");
      const printed = JSON.parse(stdoutLines.join(""));
      expect(printed.roundsExecuted).toBe(1);
      expect(printed.protocol).toBe("shared_convergence");
      expect(printed.next_required_action).toBeDefined();
    });

    it("anonymizes real model identity consistently across streaming (onRound) and the final payload", async () => {
      const config: HandlersConfig = {
        deliberateFn: async (input) => {
          // Round 1 streams with the requested team's first member + a fallback that already took
          // over the second member's slot after it failed.
          input.onRound?.({
            number: 1,
            responses: [
              { model: "openai/gpt-4.1", content: "a" },
              { model: "xai/grok-x", content: "b" },
            ],
            failedWorkers: [{ model: "google/gemini-pro", error: "timeout", errorCode: "TIMEOUT", retryable: true }],
          });
          return {
            roundsExecuted: 1,
            totalLLMCalls: 3,
            modelsUsed: ["openai/gpt-4.1", "xai/grok-x"],
            protocol: "shared_convergence",
            rounds: [
              {
                number: 1,
                protocol: "shared_convergence",
                responses: [
                  { model: "openai/gpt-4.1", content: "a", workerIndex: 0 },
                  { model: "xai/grok-x", content: "b", workerIndex: 1 },
                ],
                failedWorkers: [{ model: "google/gemini-pro", error: "timeout" }],
              },
            ],
            modelSwaps: [{ original: "google/gemini-pro", replacement: "xai/grok-x", round: 1, error: "timeout" }],
          } as DeliberateOutput;
        },
      };
      const { deps, stdoutLines, stderrLines } = harness(config);

      await main([
        "bun", "cli.ts", "deliberate",
        "--task", "t",
        "--models", "openai/gpt-4.1,google/gemini-pro",
        "--no-debug-capture",
      ], deps);

      const roundLine = stderrLines.find((l) => l.startsWith("[pyreez] round"));
      expect(roundLine).toContain("worker-0"); // openai/gpt-4.1 -- team position 0
      expect(roundLine).toContain("fallback-0"); // xai/grok-x -- first non-team model seen

      const printed = JSON.parse(stdoutLines.join(""));
      expect(printed.modelsUsed).toEqual(["worker-0", "fallback-0"]);
      expect(printed.rounds[0].responses).toEqual([
        { model: "worker-0", content: "a", workerIndex: 0 },
        { model: "fallback-0", content: "b", workerIndex: 1 },
      ]);
      expect(printed.rounds[0].failedWorkers[0].model).toBe("worker-1"); // google/gemini-pro -- team position 1
      expect(printed.modelSwaps[0]).toMatchObject({ original: "worker-1", replacement: "fallback-0" });

      const everything = JSON.stringify({ out: stdoutLines, err: stderrLines });
      for (const real of ["openai/gpt-4.1", "google/gemini-pro", "xai/grok-x", "openai", "google", "xai"]) {
        expect(everything).not.toContain(real);
      }
    });

    it("anonymizes real model identity in error JSON (TeamDegradedError's modelSwaps + top-level lostSlots)", async () => {
      const config: HandlersConfig = {
        deliberateFn: async () => {
          throw new TeamDegradedError(
            3,
            2,
            [{ model: "xai/grok-x", reason: "cooldown" }],
            [{ original: "xai/grok-x", replacement: "anthropic/opus", round: 1, error: "down" }],
          );
        },
      };
      const { deps, stderrLines } = harness(config);

      await expect(main([
        "bun", "cli.ts", "deliberate",
        "--task", "t",
        "--models", "openai/gpt-4.1,google/gemini-pro",
        "--no-debug-capture",
      ], deps)).rejects.toThrow(CliExitError);

      const errLine = stderrLines.join("\n");
      const parsed = JSON.parse(errLine);
      expect(parsed.lostSlots[0].model).toBe("fallback-0");
      expect(parsed.modelSwaps[0]).toMatchObject({ original: "fallback-0", replacement: "fallback-1" });
      for (const real of ["xai/grok-x", "anthropic/opus"]) {
        expect(errLine).not.toContain(real);
      }
    });
  });

  // ----------------------------------------------------------
  // acceptance command
  // ----------------------------------------------------------
  describe("acceptance command", () => {
    it.each([
      [["bun", "cli.ts", "acceptance"], "--task is required for acceptance"],
      [["bun", "cli.ts", "acceptance", "--task", "t"], "--synthesis is required for acceptance"],
      [["bun", "cli.ts", "acceptance", "--task", "t", "--synthesis", "s"], "--workers is required for acceptance"],
    ])("dies with the expected message for incomplete args", async (argv, expectedMessage) => {
      const { deps, stderrLines } = harness({});
      await expect(main(argv, deps)).rejects.toThrow(CliExitError);
      expect(stderrLines.join("\n")).toContain(expectedMessage);
    });

    it("dies when --workers is not a valid JSON array matching the schema", async () => {
      const { deps, stderrLines } = harness({});
      await expect(
        main(["bun", "cli.ts", "acceptance", "--task", "t", "--synthesis", "s", "--workers", "not json"], deps),
      ).rejects.toThrow(CliExitError);
      expect(stderrLines.join("\n").length).toBeGreaterThan(0);
    });

    it("routes through handleAcceptance to the stub chatFn and prints its JSON output", async () => {
      const config: HandlersConfig = {
        chatFn: async (_model, _messages) => ({
          content: "<verdict>accept</verdict><misrepresented>None.</misrepresented><unresolved>None.</unresolved>",
        }),
      };
      const { deps, stdoutLines } = harness(config);
      const workers = JSON.stringify([{ model: "anthropic/claude", original_position: "answer", alignment: "on-task" }]);

      await main(["bun", "cli.ts", "acceptance", "--task", "t", "--synthesis", "s", "--workers", workers], deps);

      const printed = JSON.parse(stdoutLines.join(""));
      expect(printed.workers[0].model).toBe("anthropic/claude");
      expect(printed.workers[0].verdict).toBe("accept");
    });
  });

  // ----------------------------------------------------------
  // rank command — generic ad-hoc JSON array parsing (--candidates)
  // ----------------------------------------------------------
  describe("rank command", () => {
    it.each([
      [["bun", "cli.ts", "rank"], "--task is required for rank"],
      [["bun", "cli.ts", "rank", "--task", "t"], "--candidates is required"],
      [["bun", "cli.ts", "rank", "--task", "t", "--candidates", "[]"], "--judge is required"],
    ])("dies with the expected message for incomplete args", async (argv, expectedMessage) => {
      const { deps, stderrLines } = harness({});
      await expect(main(argv, deps)).rejects.toThrow(CliExitError);
      expect(stderrLines.join("\n")).toContain(expectedMessage);
    });

    it("dies with a parse-failed message when --candidates is malformed JSON", async () => {
      const { deps, stderrLines } = harness({});
      await expect(
        main(["bun", "cli.ts", "rank", "--task", "t", "--candidates", "{not valid", "--judge", "m/a"], deps),
      ).rejects.toThrow(CliExitError);
      expect(stderrLines.join("\n")).toContain("--candidates parse failed");
    });

    it("dies when chat function is not available for rank", async () => {
      const { deps, stderrLines } = harness({}); // no chatFn
      const candidates = JSON.stringify([{ id: "a", content: "x" }]);
      await expect(
        main(["bun", "cli.ts", "rank", "--task", "t", "--candidates", candidates, "--judge", "m/a"], deps),
      ).rejects.toThrow(CliExitError);
      expect(stderrLines.join("\n")).toContain("chat function not available");
    });
  });

  // ----------------------------------------------------------
  // interrogate command — real file IO through the injected FileIO (in-memory, zero disk access)
  // ----------------------------------------------------------
  describe("interrogate command", () => {
    const DIR = ".test-transcripts/run1";

    function fixtureEntry(overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
      return {
        round: 1,
        workerIndex: 0,
        model: "openai/gpt-4.1",
        settings: { system: "Be terse.", reasoning_effort: 5 },
        messages: [{ role: "user", content: "Q1" }],
        output: "A1",
        ...overrides,
      };
    }

    function fixtureFileIO(entry: TranscriptEntry): FileIO {
      // Filename mirrors transcriptEntryFilename: r<round>_w<workerIndex>_<safeModel>.json
      const safeModel = entry.model.replace(/[^a-zA-Z0-9._-]/g, "-");
      return makeMemoryFileIO({ [`${DIR}/r${entry.round}_w${entry.workerIndex}_${safeModel}.json`]: JSON.stringify(entry) });
    }

    it.each([
      [["bun", "cli.ts", "interrogate"], "--transcript <dir> or --run <id> is required"],
      [["bun", "cli.ts", "interrogate", "--transcript", DIR, "--round", "0", "--worker", "0", "--question", "q"], "--round must be an integer >= 1"],
      [["bun", "cli.ts", "interrogate", "--transcript", DIR, "--round", "1", "--worker", "-1", "--question", "q"], "--worker must be an integer >= 0"],
      [["bun", "cli.ts", "interrogate", "--transcript", DIR, "--round", "1", "--worker", "0"], "--question is required"],
    ])("dies with the expected message for invalid args", async (argv, expectedMessage) => {
      const { deps, stderrLines } = harness({});
      await expect(main(argv, deps)).rejects.toThrow(CliExitError);
      expect(stderrLines.join("\n")).toContain(expectedMessage);
    });

    it("dies when chat function is not available", async () => {
      const { deps, stderrLines } = harness({}); // no chatFn
      deps.fileIO = fixtureFileIO(fixtureEntry());
      await expect(
        main(["bun", "cli.ts", "interrogate", "--transcript", DIR, "--round", "1", "--worker", "0", "--question", "q"], deps),
      ).rejects.toThrow(CliExitError);
      expect(stderrLines.join("\n")).toContain("chat function not available");
    });

    it("rejects (propagates) when no transcript entry exists for the given round/worker", async () => {
      const config: HandlersConfig = { chatFn: async () => ({ content: "unreachable" }) };
      const { deps } = harness(config);
      deps.fileIO = makeMemoryFileIO(); // empty — no matching file
      await expect(
        main(["bun", "cli.ts", "interrogate", "--transcript", DIR, "--round", "1", "--worker", "0", "--question", "q"], deps),
      ).rejects.toThrow(/no transcript entry/);
    });

    it("reconstructs the answer by replaying the transcript when no sessionId was captured", async () => {
      const calls: unknown[] = [];
      const config: HandlersConfig = {
        chatFn: async (model, messages, params, opts) => {
          calls.push({ model, messages, params, opts });
          return { content: "Reconstructed answer" };
        },
      };
      const { deps, stdoutLines } = harness(config);
      deps.fileIO = fixtureFileIO(fixtureEntry()); // no sessionId

      await main(["bun", "cli.ts", "interrogate", "--transcript", DIR, "--round", "1", "--worker", "0", "--question", "Follow-up?"], deps);

      expect(calls).toHaveLength(1);
      expect((calls[0] as any).opts).toBeUndefined();
      const printed = JSON.parse(stdoutLines.join(""));
      expect(printed.mode).toBe("reconstructed");
      expect(printed.answer).toBe("Reconstructed answer");
    });

    it("resumes the captured provider session when a sessionId is present", async () => {
      const calls: unknown[] = [];
      const config: HandlersConfig = {
        chatFn: async (model, messages, params, opts) => {
          calls.push({ model, messages, params, opts });
          return { content: "Resumed answer" };
        },
      };
      const { deps, stdoutLines } = harness(config);
      deps.fileIO = fixtureFileIO(fixtureEntry({ sessionId: "S1" }));

      await main(["bun", "cli.ts", "interrogate", "--transcript", DIR, "--round", "1", "--worker", "0", "--question", "Follow-up?"], deps);

      expect(calls).toHaveLength(1);
      expect((calls[0] as any).opts).toEqual({ resumeSessionId: "S1" });
      const printed = JSON.parse(stdoutLines.join(""));
      expect(printed.mode).toBe("resumed");
      expect(printed.sessionId).toBe("S1");
      expect(printed.answer).toBe("Resumed answer");
    });

    it("falls back to reconstruction when resuming the session throws", async () => {
      let callCount = 0;
      const config: HandlersConfig = {
        chatFn: async (_model, _messages, _params, opts) => {
          callCount++;
          if (opts?.resumeSessionId) throw new Error("session expired");
          return { content: "Reconstructed after resume failure" };
        },
      };
      const { deps, stdoutLines } = harness(config);
      deps.fileIO = fixtureFileIO(fixtureEntry({ sessionId: "S-gone" }));

      await main(["bun", "cli.ts", "interrogate", "--transcript", DIR, "--round", "1", "--worker", "0", "--question", "Follow-up?"], deps);

      expect(callCount).toBe(2); // resume attempt, then reconstruction
      const printed = JSON.parse(stdoutLines.join(""));
      expect(printed.mode).toBe("reconstructed");
      expect(printed.answer).toBe("Reconstructed after resume failure");
    });

    it("never includes a model field in the output (host already identified the worker by coordinate)", async () => {
      const config: HandlersConfig = { chatFn: async () => ({ content: "Reconstructed answer" }) };
      const { deps, stdoutLines } = harness(config);
      deps.fileIO = fixtureFileIO(fixtureEntry()); // model: "openai/gpt-4.1"

      await main(["bun", "cli.ts", "interrogate", "--transcript", DIR, "--round", "1", "--worker", "0", "--question", "q"], deps);

      const printed = JSON.parse(stdoutLines.join(""));
      expect(printed.model).toBeUndefined();
      expect("model" in printed).toBe(false);
      expect(stdoutLines.join("")).not.toContain("openai/gpt-4.1");
    });
  });

  // ----------------------------------------------------------
  // ratings command — read-only internal diagnostic, real file IO through the injected FileIO.
  // Real model names ARE expected here (v5 §1.5: outside the documented host interface).
  // ----------------------------------------------------------
  describe("ratings command", () => {
    it("prints an empty cell list when no ratings file exists yet", async () => {
      const { deps, stdoutLines } = harness({});
      deps.fileIO = makeMemoryFileIO();

      await main(["bun", "cli.ts", "ratings"], deps);

      expect(JSON.parse(stdoutLines.join(""))).toEqual({ updatedAt: 0, cells: [] });
    });

    it("prints (model, protocol, topicPath, axis) -> mean/n for every recorded cell", async () => {
      let file = EMPTY_RATINGS;
      file = recordObservation(file, { model: "openai/gpt-4.1", protocol: ScoredProtocol.SharedConvergence, topicPath: "software/testing", axis: "accuracy" }, 90, 5);
      file = recordObservation(file, { model: "openai/gpt-4.1", protocol: ScoredProtocol.SharedConvergence, topicPath: "software/testing", axis: "accuracy" }, 80, 6);
      const { deps, stdoutLines } = harness({});
      deps.fileIO = makeMemoryFileIO({ [RATINGS_PATH]: JSON.stringify(file) });

      await main(["bun", "cli.ts", "ratings"], deps);

      const printed = JSON.parse(stdoutLines.join(""));
      expect(printed.cells).toHaveLength(1);
      expect(printed.cells[0]).toMatchObject({
        model: "openai/gpt-4.1",
        protocol: "shared_convergence",
        topicPath: "software/testing",
        axis: "accuracy",
        n: 2,
      });
      expect(printed.cells[0].mean).toBeCloseTo(85);
    });

    it("surfaces a malformed cell key defensively instead of dropping its data", async () => {
      const file = { v: 1, updatedAt: 1, cells: { "not-a-valid-key": { mean: 50, n: 1, m2: 0 } } };
      const { deps, stdoutLines } = harness({});
      deps.fileIO = makeMemoryFileIO({ [RATINGS_PATH]: JSON.stringify(file) });

      await main(["bun", "cli.ts", "ratings"], deps);

      const printed = JSON.parse(stdoutLines.join(""));
      expect(printed.cells[0]).toEqual({ key: "not-a-valid-key", mean: 50, n: 1 });
    });
  });
});
