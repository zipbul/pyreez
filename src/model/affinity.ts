/**
 * Model-affinity store — learned, per-repo record of which model is strong at which topic, on which
 * capability axis, from actual deliberation outcomes.
 *
 * Two representations (see docs/): an append-only JSONL LOG (cheap, multi-writer-safe write path) and a
 * compacted nested TREE (host read path). This module holds the pure logic: fold the log into the tree,
 * roll a thin node's score up its ancestor chain, and shape a host read view. I/O is one thin helper.
 *
 * Design invariants:
 * - Topics form an arbitrary-depth tree under a fixed protocol root. Axes are per-node (topic-specific),
 *   NOT global and NOT inherited — rollup combines only exact same-axis matches up the ancestor chain.
 * - A node may hold both children and its own scores; rollup never aggregates descendants upward.
 */

import type { FileIO } from "../report/types";

/** Below this observation count a node's axis score is blended with its nearest ancestor's. */
export const THIN_N = 3;

/** One deliberation outcome: a model's per-axis scores at one topic path. Appended to the log. */
export interface AffinityLogRecord {
  readonly v: 1;
  readonly ts: number;
  readonly protocol: string;
  readonly path: readonly string[];
  readonly model: string;
  /** axis name → 1-100 score for this run. */
  readonly axes: Readonly<Record<string, number>>;
}

export interface AxisScore {
  readonly mean: number;
  readonly n: number;
}

export interface AffinityNode {
  children: Record<string, AffinityNode>;
  /** Axes observed at this node (topic-specific). */
  axes: string[];
  /** model → axis → aggregated score. */
  scores: Record<string, Record<string, AxisScore>>;
}

/** protocol → root node (its children are the level-1 topics). */
export type AffinityTree = Record<string, AffinityNode>;

function emptyNode(): AffinityNode {
  return { children: {}, axes: [], scores: {} };
}

/** Fold all log records into the nested tree, aggregating per (node, model, axis) into mean + n. */
export function compactAffinityLog(records: readonly AffinityLogRecord[]): AffinityTree {
  const tree: AffinityTree = {};
  for (const r of records) {
    let node = (tree[r.protocol] ??= emptyNode());
    for (const seg of r.path) {
      node = (node.children[seg] ??= emptyNode());
    }
    for (const [axis, score] of Object.entries(r.axes)) {
      const byAxis = (node.scores[r.model] ??= {});
      const cur = byAxis[axis];
      byAxis[axis] = cur
        ? { mean: (cur.mean * cur.n + score) / (cur.n + 1), n: cur.n + 1 }
        : { mean: score, n: 1 };
      if (!node.axes.includes(axis)) node.axes.push(axis);
    }
  }
  return tree;
}

/** Nodes along the path, root-first: [protocolRoot, ...each path node]. Empty if the path breaks. */
function nodeChain(tree: AffinityTree, protocol: string, path: readonly string[]): AffinityNode[] {
  const root = tree[protocol];
  if (!root) return [];
  const chain = [root];
  let node = root;
  for (const seg of path) {
    const next = node.children[seg];
    if (!next) return [];
    chain.push(next);
    node = next;
  }
  return chain;
}

export interface RollupResult {
  readonly mean: number;
  readonly n: number;
  readonly rolledUp: boolean;
}

/**
 * Score for (model, axis) at a topic path, blended with the nearest ancestor when the node is thin.
 * - local n >= THIN_N → local score.
 * - 0 < local n < THIN_N → blend with nearest same-axis ancestor (if any), count-weighted to THIN_N.
 * - no local → nearest same-axis ancestor, else undefined.
 */
export function rollupAxisScore(
  tree: AffinityTree,
  protocol: string,
  path: readonly string[],
  model: string,
  axis: string,
): RollupResult | undefined {
  const chain = nodeChain(tree, protocol, path);
  if (chain.length === 0) return undefined;
  const target = chain[chain.length - 1]!;
  const local = target.scores[model]?.[axis];

  // nearest ancestor (excluding target), nearest-first, with a score for this (model, axis)
  const nearestAncestor = (): AxisScore | undefined => {
    for (let i = chain.length - 2; i >= 0; i--) {
      const s = chain[i]!.scores[model]?.[axis];
      if (s) return s;
    }
    return undefined;
  };

  if (!local) {
    const anc = nearestAncestor();
    return anc ? { mean: anc.mean, n: anc.n, rolledUp: true } : undefined;
  }
  if (local.n >= THIN_N) {
    return { mean: local.mean, n: local.n, rolledUp: false };
  }
  const anc = nearestAncestor();
  if (!anc) return { mean: local.mean, n: local.n, rolledUp: false };
  const blended = (local.mean * local.n + anc.mean * (THIN_N - local.n)) / THIN_N;
  return { mean: blended, n: local.n, rolledUp: true };
}

export interface AffinityView {
  readonly node: AffinityNode;
  /** Ancestors nearest-first, each with its path + axes, so the host reuses existing axis/topic names. */
  readonly ancestors: readonly { path: string[]; axes: string[] }[];
}

/** The subtree at `path` plus nearest-first ancestors (with their axes) for host selection + reuse. */
export function readAffinityView(
  tree: AffinityTree,
  protocol: string,
  path: readonly string[],
): AffinityView | undefined {
  const chain = nodeChain(tree, protocol, path);
  if (chain.length === 0) return undefined;
  const node = chain[chain.length - 1]!;
  const ancestors: { path: string[]; axes: string[] }[] = [];
  // chain[0]=protocol root (path []), chain[i]=node at path.slice(0,i). Ancestors = all but target, nearest-first.
  for (let i = chain.length - 2; i >= 0; i--) {
    ancestors.push({ path: path.slice(0, i), axes: chain[i]!.axes });
  }
  return { node, ancestors };
}

function dirOf(filePath: string): string {
  const i = filePath.lastIndexOf("/");
  return i > 0 ? filePath.slice(0, i) : ".";
}

/** Append one record as a JSONL line (multi-writer-safe; compaction owns merging). */
export async function appendAffinityLog(
  fileIO: FileIO,
  logPath: string,
  record: AffinityLogRecord,
): Promise<void> {
  await fileIO.mkdir(dirOf(logPath));
  await fileIO.appendFile(logPath, JSON.stringify(record) + "\n");
}

/** Parse a JSONL affinity log, skipping blank/malformed lines. */
export function parseAffinityLog(text: string): AffinityLogRecord[] {
  const out: AffinityLogRecord[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as AffinityLogRecord);
    } catch {
      // skip malformed line — compaction is best-effort
    }
  }
  return out;
}

/**
 * Drop records whose model is no longer available AND whose observation is stale (older than ttlMs).
 * Keeps a record if the model is still active OR it is recent — so a briefly-unlisted model isn't lost.
 */
export function pruneStaleRecords(
  records: readonly AffinityLogRecord[],
  activeModels: ReadonlySet<string>,
  nowTs: number,
  ttlMs: number,
): AffinityLogRecord[] {
  return records.filter((r) => activeModels.has(r.model) || nowTs - r.ts <= ttlMs);
}

/**
 * Load the compacted tree. A MISSING file returns {} silently (normal first run). A CORRUPT file returns
 * {} but WARNS — the tree is derived, so the append-only log is intact; `affinity-compact` rebuilds it.
 */
export async function loadAffinityTree(fileIO: FileIO, treePath: string): Promise<AffinityTree> {
  let raw: string;
  try {
    raw = await fileIO.readFile(treePath);
  } catch {
    return {}; // missing — normal
  }
  try {
    return JSON.parse(raw) as AffinityTree;
  } catch {
    console.error(`[pyreez] affinity tree at ${treePath} is corrupt; ignoring. Run 'affinity-compact' to rebuild it from the log.`);
    return {};
  }
}

/**
 * Compact the append-only log into the tree and swap it in atomically (temp file + rename), so a host
 * reader never observes a half-written tree. Optionally prunes stale models first. Returns the new tree.
 */
export async function compactAffinity(
  fileIO: FileIO,
  logPath: string,
  treePath: string,
  opts?: { activeModels: ReadonlySet<string>; nowTs: number; ttlMs: number },
): Promise<AffinityTree> {
  let records = parseAffinityLog(await fileIO.readFile(logPath).catch(() => ""));
  if (opts) records = pruneStaleRecords(records, opts.activeModels, opts.nowTs, opts.ttlMs);
  const tree = compactAffinityLog(records);
  await fileIO.mkdir(dirOf(treePath));
  // Unique temp name so concurrent compactions never clobber each other's temp before rename.
  const tmp = `${treePath}.${crypto.randomUUID()}.tmp`;
  await fileIO.writeFile(tmp, JSON.stringify(tree, null, 2));
  await fileIO.rename(tmp, treePath);
  return tree;
}
