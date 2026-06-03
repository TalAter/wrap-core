/**
 * Leaf text-output primitives for "chrome" — the human-narration channel that
 * renders to stderr (status lines, spinner escapes), kept separate from the
 * command's product on stdout. These are the lowest layer: no bus, no router,
 * no config. Consumers layer their own notification/interception plumbing on
 * top and delegate the actual byte writes here.
 */

/** Default narration stream. stdout is reserved for the command's product. */
const DEFAULT_STREAM: NodeJS.WritableStream = process.stderr;

/**
 * Format a chrome status line (`${icon} ${text}\n`, or `${text}\n` when no
 * icon) and write it to `stream` (defaults to stderr). The terminal newline is
 * always appended.
 */
export function writeChromeLine(
  text: string,
  icon?: string,
  stream: NodeJS.WritableStream = DEFAULT_STREAM,
): void {
  const line = icon ? `${icon} ${text}\n` : `${text}\n`;
  stream.write(line);
}

/** Write raw chrome bytes to `stream` (defaults to stderr) — no trailing newline. For ANSI escapes, partial writes. */
export function chromeRaw(msg: string, stream: NodeJS.WritableStream = DEFAULT_STREAM): void {
  stream.write(msg);
}
