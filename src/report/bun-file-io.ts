/**
 * BunFileIO — production FileIO implementation using node:fs/promises.
 * Bun natively implements node:fs as optimized native code.
 *
 * Used by FileReporter for persistent JSONL storage.
 * Bun-first: Bun recommends node:fs for mkdir/readdir. appendFile/readFile/unlink
 * also Bun-native. Uniform module enables mock.module() in unit tests.
 */

import {
  appendFile,
  readFile,
  mkdir,
  readdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import * as fsp from "node:fs/promises";
import { join } from "node:path";
import type { FileIO } from "./types";

export class BunFileIO implements FileIO {
  async appendFile(path: string, data: string): Promise<void> {
    await appendFile(path, data, "utf-8");
  }

  async readFile(path: string): Promise<string> {
    return readFile(path, "utf-8");
  }

  async writeFile(path: string, data: string): Promise<void> {
    await writeFile(path, data, "utf-8");
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  /**
   * Simple glob for single-'*' patterns like "dir/*.ext" or "dir/r2_w1_*.json".
   * Matches BOTH the prefix before '*' and the suffix after it. Returns sorted paths.
   */
  async glob(pattern: string): Promise<string[]> {
    const sep = pattern.lastIndexOf("/");
    const dir = sep >= 0 ? pattern.slice(0, sep) : ".";
    const base = sep >= 0 ? pattern.slice(sep + 1) : pattern;
    // Filtering on the suffix alone made "r2_w1_*.json" match every "*.json" in the dir (so
    // loadTranscriptEntry always returned the first sorted entry regardless of --round/--worker).
    const star = base.indexOf("*");
    const prefix = star >= 0 ? base.slice(0, star) : base;
    const suffix = star >= 0 ? base.slice(star + 1) : "";

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }

    return entries
      .filter(
        (e) =>
          e.startsWith(prefix) &&
          e.endsWith(suffix) &&
          e.length >= prefix.length + suffix.length,
      )
      .map((e) => (dir === "." && sep < 0 ? e : join(dir, e)))
      .sort();
  }

  async rename(from: string, to: string): Promise<void> {
    await fsp.rename(from, to);
  }

  async removeGlob(pattern: string): Promise<void> {
    const files = await this.glob(pattern);
    for (const file of files) {
      await unlink(file);
    }
  }
}
