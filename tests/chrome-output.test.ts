import { describe, expect, test } from "bun:test";
import { chromeRaw, writeChromeLine } from "../src/chrome/output.ts";

/** Minimal writable stream that records every write. */
function fakeStream(): { writes: string[]; stream: NodeJS.WritableStream } {
  const writes: string[] = [];
  const stream = {
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return { writes, stream };
}

describe("writeChromeLine", () => {
  test("writes icon + space + text + newline when an icon is given", () => {
    const { writes, stream } = fakeStream();
    writeChromeLine("Done.", "✓", stream);
    expect(writes).toEqual(["✓ Done.\n"]);
  });

  test("writes text + newline when no icon", () => {
    const { writes, stream } = fakeStream();
    writeChromeLine("Done.", undefined, stream);
    expect(writes).toEqual(["Done.\n"]);
  });

  test("defaults to process.stderr", () => {
    const original = process.stderr.write.bind(process.stderr);
    const writes: string[] = [];
    process.stderr.write = ((s: string) => {
      writes.push(s);
      return true;
    }) as typeof process.stderr.write;
    try {
      writeChromeLine("hi");
    } finally {
      process.stderr.write = original;
    }
    expect(writes).toEqual(["hi\n"]);
  });
});

describe("chromeRaw", () => {
  test("writes the message verbatim with no trailing newline", () => {
    const { writes, stream } = fakeStream();
    chromeRaw("\x1b[2K\rspinner", stream);
    expect(writes).toEqual(["\x1b[2K\rspinner"]);
  });

  test("defaults to process.stderr", () => {
    const original = process.stderr.write.bind(process.stderr);
    const writes: string[] = [];
    process.stderr.write = ((s: string) => {
      writes.push(s);
      return true;
    }) as typeof process.stderr.write;
    try {
      chromeRaw("raw");
    } finally {
      process.stderr.write = original;
    }
    expect(writes).toEqual(["raw"]);
  });
});
