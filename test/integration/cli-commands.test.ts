/**
 * Integration test — CLI commands: main(argv, deps) through command routing to the handlers.
 *
 * SUT boundary (real implementations):
 *   cli.ts (main, parseArgs, resolveStdinFlags, usageText) + handlers.ts (handleDeliberate,
 *   handleAcceptance) + validation/schemas.ts (--workers JSON schema).
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
import type { FileIO } from "../../src/report/types";
import type { TranscriptEntry } from "../../src/deliberation/transcript";

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
 * pattern, prefix+suffix match within one directory) closely enough for interrogate/affinity/
 * affinity-compact, whose lookups are all single-directory, single-wildcard.
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
    async removeGlob(pattern) {
      const matches = await io.glob(pattern);
      for (const m of matches) files.delete(m);
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
  totalTokens: { input: 10, output: 20 },
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
          getAll: () => [],
          getAvailable: () => [
            { id: "openai/gpt-4.1", name: "GPT-4.1", provider: "openai", contextWindow: 128000, cost: { inputPer1M: 2, outputPer1M: 8 }, supportsToolCalling: true } as any,
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
          inputTokens: 10,
          outputTokens: 10,
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
      const config: HandlersConfig = { chatFn: async () => ({ content: "unreachable", inputTokens: 0, outputTokens: 0 }) };
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
          return { content: "Reconstructed answer", inputTokens: 5, outputTokens: 5 };
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
          return { content: "Resumed answer", inputTokens: 5, outputTokens: 5 };
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
          return { content: "Reconstructed after resume failure", inputTokens: 5, outputTokens: 5 };
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
  });

  // ----------------------------------------------------------
  // affinity command — read-only, real file IO through the injected FileIO
  // ----------------------------------------------------------
  describe("affinity command", () => {
    it("prints an empty tree when no affinity file exists yet", async () => {
      const { deps, stdoutLines } = harness({});
      deps.fileIO = makeMemoryFileIO();

      await main(["bun", "cli.ts", "affinity"], deps);

      expect(JSON.parse(stdoutLines.join(""))).toEqual({});
    });

    it("prints the parsed tree when an affinity file exists", async () => {
      const tree = { adversarial_debate: { children: {}, scores: { "openai/gpt-4.1": { "정확성": { mean: 80, n: 1 } } } } };
      const { deps, stdoutLines } = harness({});
      deps.fileIO = makeMemoryFileIO({ ".pyreez/affinity.json": JSON.stringify(tree) });

      await main(["bun", "cli.ts", "affinity"], deps);

      expect(JSON.parse(stdoutLines.join(""))).toEqual(tree);
    });
  });

  // ----------------------------------------------------------
  // affinity-compact command — folds the JSONL log into the tree
  // ----------------------------------------------------------
  describe("affinity-compact command", () => {
    it("compacts an empty (missing) log into an empty tree", async () => {
      const { deps, stdoutLines } = harness({});
      deps.fileIO = makeMemoryFileIO();

      await main(["bun", "cli.ts", "affinity-compact"], deps);

      expect(JSON.parse(stdoutLines.join(""))).toEqual({ compacted: true, protocols: [] });
    });

    it("compacts a populated log into a tree with the recorded protocols", async () => {
      const records = [
        { v: 1, ts: 1, protocol: "adversarial_debate", path: ["보안"], model: "openai/gpt-4.1", axes: { "정확성": 80 } },
        { v: 1, ts: 2, protocol: "shared_convergence", path: ["아키텍처"], model: "google/gemini-pro", axes: { "창의력": 60 } },
      ];
      const logText = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
      const { deps, stdoutLines } = harness({});
      deps.fileIO = makeMemoryFileIO({ ".pyreez/affinity-log.jsonl": logText });

      await main(["bun", "cli.ts", "affinity-compact"], deps);

      const printed = JSON.parse(stdoutLines.join(""));
      expect(printed.compacted).toBe(true);
      expect(printed.protocols.sort()).toEqual(["adversarial_debate", "shared_convergence"]);
    });
  });
});
