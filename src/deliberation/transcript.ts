/**
 * Deliberation transcript — capture the exact prompt+output per worker so a prompt can be
 * debugged/optimized by tracing "which clause drove this output", and so the worker can be
 * re-questioned (interrogate) by replaying its own conversation plus a follow-up.
 *
 * The captured `messages` are the canonical pre-adapter form (system block included); replaying
 * them through the same chat adapter re-splits the system block identically, so an interrogation
 * is faithful to how the engine itself continues a worker across rounds.
 *
 * Fidelity limit (inherent, not a bug): stored history is text-only. `<think>` reasoning is
 * stripped before storage, and tool_use / web-search observations are not persisted — only the
 * final text response. Interrogation therefore probes the text output, not hidden reasoning state.
 */

import type { ChatMessage, FileAccess } from "../llm/types";
import type { FileIO } from "../report/types";

/** The exact knobs a worker ran under, re-applied verbatim when debugging it (interrogate). */
interface WorkerSettings {
  readonly system?: string;
  readonly reasoning_effort?: number;
  readonly webAccess?: boolean;
  readonly fileAccess?: FileAccess;
}

/** One worker's full input + output for a single round. Keyed by round + workerIndex. */
export interface TranscriptEntry {
  readonly round: number;
  readonly workerIndex: number;
  /** The model that actually produced the output (the final model after any fallback swap). */
  readonly model: string;
  /** Provider session id, so interrogate can re-enter the real session (undefined if none captured). */
  readonly sessionId?: string;
  /** The settings the worker ran under; interrogate re-applies them so the call matches the original. */
  readonly settings?: WorkerSettings;
  /** Exact messages sent to the worker, including the system block (pre-adapter form). */
  readonly messages: ChatMessage[];
  readonly output: string;
}

/** Sink invoked by the engine after each successful worker call. Synchronous (accumulate, don't I/O). */
export type TranscriptRecorder = (entry: TranscriptEntry) => void;

/** `r<round>_w<workerIndex>_<model>.json` — workerIndex keeps duplicate-model slots distinct. */
export function transcriptEntryFilename(entry: { round: number; workerIndex: number; model: string }): string {
  const safeModel = entry.model.replace(/[^a-zA-Z0-9._-]/g, "-");
  return `r${entry.round}_w${entry.workerIndex}_${safeModel}.json`;
}

/**
 * Reconstruct the worker's session for interrogation: its own prior messages, then its output as an
 * assistant turn, then the follow-up question. Replay this through the chat adapter (config.chatFn).
 */
export function buildInterrogationMessages(
  entry: { messages: ChatMessage[]; output: string },
  question: string,
): ChatMessage[] {
  return [
    ...entry.messages,
    { role: "assistant", content: entry.output },
    { role: "user", content: question },
  ];
}

/** Persist all captured entries (one file each) plus the deliberate result, under `dir`. */
export async function writeTranscript(
  dir: string,
  entries: readonly TranscriptEntry[],
  result: unknown,
  fileIO: FileIO,
): Promise<void> {
  await fileIO.mkdir(dir);
  for (const e of entries) {
    await fileIO.writeFile(`${dir}/${transcriptEntryFilename(e)}`, JSON.stringify(e, null, 2));
  }
  await fileIO.writeFile(`${dir}/result.json`, JSON.stringify(result, null, 2));
}

/** Load a single captured entry by round + workerIndex (model is read from the file). */
export async function loadTranscriptEntry(
  dir: string,
  round: number,
  workerIndex: number,
  fileIO: FileIO,
): Promise<TranscriptEntry> {
  const matches = await fileIO.glob(`${dir}/r${round}_w${workerIndex}_*.json`);
  const path = matches[0];
  if (!path) {
    throw new Error(`no transcript entry for round ${round} worker ${workerIndex} in ${dir}`);
  }
  return JSON.parse(await fileIO.readFile(path)) as TranscriptEntry;
}
