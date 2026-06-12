// Subprocess plumbing for CLI-backed provider adapters. Private sibling.

export type SpawnResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type SpawnOptions = {
  cwd?: string;
  /** Kills the subprocess on abort — real cancellation, not just discard. */
  signal?: AbortSignal;
};

/** Injection seam so adapter tests never spawn a real CLI binary. */
export type SpawnAndRead = (
  cmd: string[],
  stdin: string,
  opts?: SpawnOptions,
) => Promise<SpawnResult>;

/**
 * Run a subprocess with a piped stdin payload and read all three streams.
 * Non-zero exit is returned, not thrown — the caller decides whether to
 * raise or persist the failed run as wire forensics.
 *
 * An aborted `signal` kills the process (default SIGTERM); the call then
 * settles with the kill's non-zero exit instead of hanging until the
 * subprocess finishes on its own.
 */
export const spawnAndRead: SpawnAndRead = async (cmd, stdin, opts) => {
  const proc = Bun.spawn(cmd, {
    stdin: Buffer.from(stdin),
    cwd: opts?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const signal = opts?.signal;
  const onAbort = () => proc.kill();
  // An already-fired signal would never invoke a fresh listener.
  if (signal?.aborted) proc.kill();
  else signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode };
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
};
