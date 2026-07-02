/**
 * Unit tests for the model availability cache: merge (deprecate only on ok), prune, available, staleness.
 */

import { describe, it, expect, mock } from "bun:test";
import {
  mergeCache,
  pruneDeprecated,
  availableModels,
  isStale,
  loadModelCache,
  writeModelCache,
  refreshModelCache,
  EMPTY_CACHE,
  type ModelCache,
} from "./model-cache";
import type { ProbeResult } from "./discovery";
import type { DiscoveryResult } from "./discovery";
import type { FileIO } from "../report/types";

function mockFileIO(over: Partial<FileIO> = {}): FileIO {
  return {
    appendFile: mock(async () => {}), readFile: mock(async () => ""), writeFile: mock(async () => {}),
    mkdir: mock(async () => {}), glob: mock(async () => []), removeGlob: mock(async () => {}),
    rename: mock(async () => {}), ...over,
  };
}

describe("mergeCache", () => {
  const now = 1000;

  it("adds discovered models as available with lastSeen", () => {
    const disc: DiscoveryResult = { models: [{ id: "openai/gpt-5.5", provider: "openai" }], status: { openai: "ok" } };
    const merged = mergeCache(EMPTY_CACHE, disc, now);
    expect(merged.models).toEqual([{ id: "openai/gpt-5.5", provider: "openai", status: "available", lastSeen: now }]);
    expect(merged.refreshedAt).toBe(now);
  });

  it("deprecates a cached model absent from an OK provider's list", () => {
    const prev: ModelCache = { refreshedAt: 1, models: [
      { id: "openai/gpt-5.4", provider: "openai", status: "available", lastSeen: 1 },
    ] };
    const disc: DiscoveryResult = { models: [{ id: "openai/gpt-5.5", provider: "openai" }], status: { openai: "ok" } };
    const merged = mergeCache(prev, disc, now);
    const gone = merged.models.find((m) => m.id === "openai/gpt-5.4")!;
    expect(gone.status).toBe("deprecated");
    expect(gone.lastSeen).toBe(1); // lastSeen frozen at last time it was seen
    expect(merged.models.find((m) => m.id === "openai/gpt-5.5")!.status).toBe("available");
  });

  it("does NOT deprecate cached models when the provider FAILED (resilience)", () => {
    const prev: ModelCache = { refreshedAt: 1, models: [
      { id: "openai/gpt-5.4", provider: "openai", status: "available", lastSeen: 1 },
    ] };
    const disc: DiscoveryResult = { models: [], status: { openai: "failed" } };
    const merged = mergeCache(prev, disc, now);
    expect(merged.models.find((m) => m.id === "openai/gpt-5.4")!.status).toBe("available");
  });

  it("does NOT deprecate cached models when the provider is EMPTY", () => {
    const prev: ModelCache = { refreshedAt: 1, models: [
      { id: "xai/grok-build", provider: "xai", status: "available", lastSeen: 1 },
    ] };
    const disc: DiscoveryResult = { models: [], status: { xai: "empty" } };
    expect(mergeCache(prev, disc, now).models[0]!.status).toBe("available");
  });

  it("revives a deprecated model that reappears in an ok list", () => {
    const prev: ModelCache = { refreshedAt: 1, models: [
      { id: "openai/gpt-5.4", provider: "openai", status: "deprecated", lastSeen: 1 },
    ] };
    const disc: DiscoveryResult = { models: [{ id: "openai/gpt-5.4", provider: "openai" }], status: { openai: "ok" } };
    const m = mergeCache(prev, disc, now).models[0]!;
    expect(m.status).toBe("available");
    expect(m.lastSeen).toBe(now);
  });
});

describe("pruneDeprecated", () => {
  it("drops deprecated models older than ttl, keeps available regardless of age", () => {
    const cache: ModelCache = { refreshedAt: 100, models: [
      { id: "a/old-dep", provider: "openai", status: "deprecated", lastSeen: 0 },
      { id: "a/recent-dep", provider: "openai", status: "deprecated", lastSeen: 95 },
      { id: "a/avail", provider: "openai", status: "available", lastSeen: 0 },
    ] };
    const pruned = pruneDeprecated(cache, 100, 10);
    expect(pruned.models.map((m) => m.id)).toEqual(["a/recent-dep", "a/avail"]);
  });
});

describe("availableModels", () => {
  it("returns only available models as bare DiscoveredModel", () => {
    const cache: ModelCache = { refreshedAt: 1, models: [
      { id: "a/x", provider: "openai", status: "available", lastSeen: 1 },
      { id: "a/y", provider: "openai", status: "deprecated", lastSeen: 1 },
    ] };
    expect(availableModels(cache)).toEqual([{ id: "a/x", provider: "openai" }]);
  });
});

describe("isStale", () => {
  it("is true when older than ttl or never refreshed", () => {
    expect(isStale(EMPTY_CACHE, 1000, 100)).toBe(true);
    expect(isStale({ refreshedAt: 950, models: [] }, 1000, 100)).toBe(false);
    expect(isStale({ refreshedAt: 800, models: [] }, 1000, 100)).toBe(true);
  });
});

describe("refreshModelCache", () => {
  const okProbe = (): Promise<ProbeResult> => Promise.resolve({ models: [{ id: "openai/gpt-5.5", provider: "openai" }], status: "ok" });

  it("returns the cached value without probing when fresh", async () => {
    const fresh: ModelCache = { refreshedAt: 990, models: [] };
    const probe = mock(okProbe);
    const io = mockFileIO({ readFile: mock(async () => JSON.stringify(fresh)) });
    const out = await refreshModelCache(io, "/tmp/mc.json", { openai: probe }, { now: 1000, ttlMs: 100, pruneTtlMs: 999 });
    expect(out).toEqual(fresh);
    expect(probe).not.toHaveBeenCalled();
    expect(io.writeFile).not.toHaveBeenCalled();
  });

  it("probes, merges, and writes when stale", async () => {
    const stale: ModelCache = { refreshedAt: 0, models: [] };
    const probe = mock(okProbe);
    const io = mockFileIO({ readFile: mock(async () => JSON.stringify(stale)) });
    const out = await refreshModelCache(io, "/tmp/mc.json", { openai: probe }, { now: 1000, ttlMs: 100, pruneTtlMs: 999 });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(out.models.map((m) => m.id)).toEqual(["openai/gpt-5.5"]);
    expect(io.rename).toHaveBeenCalled();
  });

  it("force refreshes even when fresh", async () => {
    const fresh: ModelCache = { refreshedAt: 999, models: [] };
    const probe = mock(okProbe);
    const io = mockFileIO({ readFile: mock(async () => JSON.stringify(fresh)) });
    await refreshModelCache(io, "/tmp/mc.json", { openai: probe }, { now: 1000, ttlMs: 100, pruneTtlMs: 999, force: true });
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe("load/write", () => {
  it("loads EMPTY_CACHE when missing", async () => {
    const io = mockFileIO({ readFile: mock(async () => { throw new Error("ENOENT"); }) });
    expect(await loadModelCache(io, "/tmp/mc.json")).toEqual(EMPTY_CACHE);
  });

  it("writes atomically via temp + rename", async () => {
    const io = mockFileIO();
    await writeModelCache(io, "/tmp/dir/mc.json", EMPTY_CACHE);
    const [tmp] = (io.writeFile as ReturnType<typeof mock>).mock.calls[0]!;
    expect(tmp).toMatch(/^\/tmp\/dir\/mc\.json\..+\.tmp$/); // unique temp suffix
    const [from, to] = (io.rename as ReturnType<typeof mock>).mock.calls[0]!;
    expect(from).toBe(tmp);
    expect(to).toBe("/tmp/dir/mc.json");
  });
});
