import { openSync } from "node:fs";
import { ReadStream } from "node:tty";

/**
 * Pick the Node stream Ink should read keystrokes from. When the consumer was
 * piped into (`echo x | tool ...`), `process.stdin` is a drained pipe; Ink's
 * internal `setRawMode` fails on a non-TTY fd. Opening `/dev/tty` fresh gives
 * the dialog a real tty for keyboard input regardless of how the tool was
 * invoked. Returns `{ stream: process.stdin, fd: null }` when the parent
 * already has a TTY, or when `/dev/tty` can't be opened (headless contexts).
 */
export function chooseDialogStdin(deps?: {
  isTTY?: boolean | undefined;
  tryOpenTty?: () => number;
}): { stream: NodeJS.ReadStream; fd: number | null } {
  const isTTY = deps ? deps.isTTY : process.stdin.isTTY;
  if (isTTY) return { stream: process.stdin, fd: null };
  const open = deps?.tryOpenTty ?? (() => openSync("/dev/tty", "r"));
  try {
    const fd = open();
    const stream = new ReadStream(fd);
    (stream as unknown as { isTTY: boolean }).isTTY = true;
    return { stream: stream as unknown as NodeJS.ReadStream, fd };
  } catch {
    return { stream: process.stdin, fd: null };
  }
}

export const DIALOG_INK_OPTIONS = {
  stdout: process.stderr,
  patchConsole: false,
  alternateScreen: true,
  exitOnCtrlC: false,
} as const;
