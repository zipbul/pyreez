/**
 * Spawn a subprocess with idle timeout.
 * Monitors stdout/stderr activity — kills the process if no data flows for `idleMs`.
 */

// Bun.spawn options — use inline type to avoid deprecated SpawnOptions generic issues

export class IdleTimeoutError extends Error {
  constructor(idleMs: number) {
    super(`Process killed: no stdout/stderr activity for ${idleMs}ms`);
    this.name = "IdleTimeoutError";
  }
}

export interface SpawnIdleOptions {
  /** Kill process after this many ms of no stdout/stderr activity. */
  idleMs: number;
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function spawnWithIdleTimeout(
  cmd: string[],
  spawnOpts: Record<string, unknown>,
  { idleMs }: SpawnIdleOptions,
): Promise<SpawnResult> {
  const proc = Bun.spawn(cmd, {
    ...spawnOpts,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timer: ReturnType<typeof setTimeout>;
  let killed = false;

  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      killed = true;
      proc.kill();
    }, idleMs);
  };

  resetTimer();

  // Read streams while resetting idle timer on each chunk
  const readWithActivity = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        resetTimer();
      }
    } finally {
      reader.releaseLock();
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  };

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readWithActivity(proc.stdout as unknown as ReadableStream<Uint8Array>),
      readWithActivity(proc.stderr as unknown as ReadableStream<Uint8Array>),
      proc.exited,
    ]);

    clearTimeout(timer!);

    if (killed) {
      throw new IdleTimeoutError(idleMs);
    }

    return { stdout, stderr, exitCode };
  } catch (error) {
    clearTimeout(timer!);
    if (killed || error instanceof IdleTimeoutError) {
      throw new IdleTimeoutError(idleMs);
    }
    throw error;
  }
}
