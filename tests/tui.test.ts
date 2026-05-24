import { describe, expect, test } from "bun:test";
import { openSync } from "node:fs";
import { clampBufferSize, MAX_BUFFER_BYTES } from "../src/tui/clamp-buffer.ts";
import { formatContinuationBadge } from "../src/tui/continuation-badge.ts";
import { Cursor } from "../src/tui/cursor.ts";
import { chooseDialogStdin } from "../src/tui/dialog-host.ts";
import type { KeyTrigger } from "../src/tui/key-bindings.ts";
import { matches } from "../src/tui/key-bindings.ts";
import { pillSegments, pillWidth } from "../src/tui/pill.tsx";

// ── Cursor ──────────────────────────────────────────────────────────

describe("Cursor", () => {
  test("insert at beginning", () => {
    const c = new Cursor("hello", 0).insert("X");
    expect(c.text).toBe("Xhello");
    expect(c.offset).toBe(1);
  });

  test("insert at end", () => {
    const c = new Cursor("hello", 5).insert(" world");
    expect(c.text).toBe("hello world");
    expect(c.offset).toBe(11);
  });

  test("insert in middle", () => {
    const c = new Cursor("hllo", 1).insert("e");
    expect(c.text).toBe("hello");
    expect(c.offset).toBe(2);
  });

  test("backspace removes preceding grapheme", () => {
    const c = new Cursor("hello", 5).backspace();
    expect(c.text).toBe("hell");
    expect(c.offset).toBe(4);
  });

  test("backspace at start is noop", () => {
    const c = new Cursor("hello", 0).backspace();
    expect(c.text).toBe("hello");
    expect(c.offset).toBe(0);
  });

  test("delete removes grapheme at cursor", () => {
    const c = new Cursor("hello", 0).delete();
    expect(c.text).toBe("ello");
    expect(c.offset).toBe(0);
  });

  test("delete at end is noop", () => {
    const c = new Cursor("hello", 5).delete();
    expect(c.text).toBe("hello");
    expect(c.offset).toBe(5);
  });

  test("left/right movement", () => {
    const c = new Cursor("abc", 1);
    expect(c.left().offset).toBe(0);
    expect(c.right().offset).toBe(2);
  });

  test("home/end", () => {
    const c = new Cursor("hello world", 5);
    expect(c.home().offset).toBe(0);
    expect(c.end().offset).toBe(11);
  });

  test("wordLeft jumps to start of word", () => {
    const c = new Cursor("hello world", 11).wordLeft();
    expect(c.offset).toBe(6);
  });

  test("wordRight jumps to end of word", () => {
    const c = new Cursor("hello world", 0).wordRight();
    expect(c.offset).toBe(5);
  });

  test("deleteWord removes preceding word", () => {
    const c = new Cursor("hello world", 11).deleteWord();
    expect(c.text).toBe("hello ");
    expect(c.offset).toBe(6);
    expect(c.killed).toBe("world");
  });

  test("killToHome removes text before cursor", () => {
    const c = new Cursor("hello world", 5).killToHome();
    expect(c.text).toBe(" world");
    expect(c.offset).toBe(0);
    expect(c.killed).toBe("hello");
  });

  test("killToEnd removes text after cursor", () => {
    const c = new Cursor("hello world", 5).killToEnd();
    expect(c.text).toBe("hello");
    expect(c.offset).toBe(5);
    expect(c.killed).toBe(" world");
  });

  test("yank inserts killed text", () => {
    const c = new Cursor("hello ", 6).yank("world");
    expect(c.text).toBe("hello world");
    expect(c.offset).toBe(11);
  });

  test("yank with undefined is noop", () => {
    const c = new Cursor("hello", 5).yank(undefined);
    expect(c.text).toBe("hello");
  });

  test("beforeCursor / charAtCursor / afterCursor", () => {
    const c = new Cursor("hello", 2);
    expect(c.beforeCursor).toBe("he");
    expect(c.charAtCursor).toBe("l");
    expect(c.afterCursor).toBe("lo");
  });

  test("charAtCursor at end returns space", () => {
    const c = new Cursor("hi", 2);
    expect(c.charAtCursor).toBe(" ");
  });

  test("row and col for multiline text", () => {
    const c = new Cursor("abc\ndef\nghi", 5);
    expect(c.row).toBe(1);
    expect(c.col).toBe(1);
  });

  test("upLine moves to previous line", () => {
    const c = new Cursor("abc\ndef", 5).upLine();
    expect(c.offset).toBe(1); // col 1 on first line
  });

  test("downLine moves to next line", () => {
    const c = new Cursor("abc\ndef", 1).downLine();
    expect(c.offset).toBe(5); // col 1 on second line
  });

  test("upLine on first line is noop", () => {
    const c = new Cursor("abc", 1).upLine();
    expect(c.offset).toBe(1);
  });

  test("downLine on last line is noop", () => {
    const c = new Cursor("abc", 1).downLine();
    expect(c.offset).toBe(1);
  });

  test("offset is clamped to valid range", () => {
    const c = new Cursor("hi", 100);
    expect(c.offset).toBe(2);
    const c2 = new Cursor("hi", -5);
    expect(c2.offset).toBe(0);
  });

  test("handles emoji graphemes", () => {
    const c = new Cursor("a👋b", 1);
    const moved = c.right();
    expect(moved.offset).toBe(3); // emoji is 2 code units
    expect(moved.charAtCursor).toBe("b");
  });
});

// ── clampBuffer ─────────────────────────────────────────────────────

describe("clampBufferSize", () => {
  test("short text passes through", () => {
    const result = clampBufferSize("hello");
    expect(result.truncated).toBe(false);
    expect(result.value).toBe("hello");
  });

  test("long text is truncated", () => {
    const long = "a".repeat(MAX_BUFFER_BYTES + 100);
    const result = clampBufferSize(long);
    expect(result.truncated).toBe(true);
    expect(new TextEncoder().encode(result.value).byteLength).toBeLessThanOrEqual(MAX_BUFFER_BYTES);
  });

  test("exact boundary text is not truncated", () => {
    const exact = "a".repeat(MAX_BUFFER_BYTES);
    const result = clampBufferSize(exact);
    expect(result.truncated).toBe(false);
    expect(result.value).toBe(exact);
  });

  test("multibyte chars are not broken", () => {
    // Each é is 2 UTF-8 bytes
    const text = "é".repeat(MAX_BUFFER_BYTES);
    const result = clampBufferSize(text);
    expect(result.truncated).toBe(true);
    // Should be valid UTF-8 — no broken code points
    const roundTripped = new TextDecoder("utf-8").decode(new TextEncoder().encode(result.value));
    expect(roundTripped).toBe(result.value);
  });
});

// ── Key binding trigger matching ────────────────────────────────────

describe("matches (key trigger)", () => {
  const noMods = {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    meta: false,
    tab: false,
    backspace: false,
    delete: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
  };

  test("named key: return", () => {
    expect(matches("return", "", { ...noMods, return: true })).toBe(true);
    expect(matches("return", "", noMods)).toBe(false);
  });

  test("named key: escape", () => {
    expect(matches("escape", "", { ...noMods, escape: true })).toBe(true);
  });

  test("named key: up/down/left/right", () => {
    expect(matches("up", "", { ...noMods, upArrow: true })).toBe(true);
    expect(matches("down", "", { ...noMods, downArrow: true })).toBe(true);
    expect(matches("left", "", { ...noMods, leftArrow: true })).toBe(true);
    expect(matches("right", "", { ...noMods, rightArrow: true })).toBe(true);
  });

  test("named key: space", () => {
    expect(matches("space", " ", noMods)).toBe(true);
    // space with ctrl should not match bare space trigger
    expect(matches("space", " ", { ...noMods, ctrl: true })).toBe(false);
  });

  test("named key: tab", () => {
    expect(matches("tab", "", { ...noMods, tab: true })).toBe(true);
  });

  test("char trigger case-insensitive", () => {
    expect(matches("y", "Y", noMods)).toBe(true);
    expect(matches("y", "y", noMods)).toBe(true);
    expect(matches("Y", "y", noMods)).toBe(true);
  });

  test("char trigger blocked by ctrl", () => {
    expect(matches("y", "y", { ...noMods, ctrl: true })).toBe(false);
  });

  test("char trigger blocked by meta", () => {
    expect(matches("y", "y", { ...noMods, meta: true })).toBe(false);
  });

  test("char trigger tolerates shift", () => {
    expect(matches("y", "Y", { ...noMods, shift: true })).toBe(true);
  });

  test("object trigger: ctrl+c", () => {
    const trigger: KeyTrigger = { key: "c", ctrl: true };
    expect(matches(trigger, "c", { ...noMods, ctrl: true })).toBe(true);
    expect(matches(trigger, "c", noMods)).toBe(false);
  });

  test("object trigger: ctrl+return", () => {
    const trigger: KeyTrigger = { key: "return", ctrl: true };
    expect(matches(trigger, "", { ...noMods, return: true, ctrl: true })).toBe(true);
    expect(matches(trigger, "", { ...noMods, return: true })).toBe(false);
  });

  test("object trigger: exact modifier match required", () => {
    const trigger: KeyTrigger = { key: "c", ctrl: true };
    // ctrl+meta+c should not match { key: "c", ctrl: true } since meta isn't expected
    expect(matches(trigger, "c", { ...noMods, ctrl: true, meta: true })).toBe(false);
  });
});

// ── chooseDialogStdin ───────────────────────────────────────────────

describe("chooseDialogStdin", () => {
  test("returns process.stdin when isTTY is true", () => {
    const result = chooseDialogStdin({ isTTY: true });
    expect(result.stream).toBe(process.stdin);
    expect(result.fd).toBeNull();
  });

  test("opens /dev/tty when isTTY is false", () => {
    let opened = false;
    const realFd = openSync("/dev/null", "r");
    const result = chooseDialogStdin({
      isTTY: false,
      tryOpenTty: () => {
        opened = true;
        return realFd;
      },
    });
    expect(opened).toBe(true);
    expect(result.fd).toBe(realFd);
    // Clean up the ReadStream
    if (result.stream !== process.stdin) {
      (result.stream as unknown as { destroy: () => void }).destroy();
    }
  });

  test("falls back to process.stdin when /dev/tty open fails", () => {
    const result = chooseDialogStdin({
      isTTY: false,
      tryOpenTty: () => {
        throw new Error("no tty");
      },
    });
    expect(result.stream).toBe(process.stdin);
    expect(result.fd).toBeNull();
  });
});

// ── formatContinuationBadge ─────────────────────────────────────────

describe("formatContinuationBadge", () => {
  test("returns empty for narrow terminal", () => {
    expect(formatContinuationBadge("hello", 15)).toBe("");
  });

  test("returns empty for blank prompt", () => {
    expect(formatContinuationBadge("   ", 80)).toBe("");
  });

  test("includes prompt when it fits", () => {
    const badge = formatContinuationBadge("test prompt", 80);
    expect(badge).toContain("test prompt");
    expect(badge).toStartWith("↳ Continuing: ");
  });

  test("truncates long prompt with ellipsis", () => {
    const long = "x".repeat(200);
    const badge = formatContinuationBadge(long, 80);
    expect(badge).toEndWith("…");
    expect(badge.length).toBeLessThan(200);
  });

  test("collapses whitespace in prompt", () => {
    const badge = formatContinuationBadge("hello\n  world", 80);
    expect(badge).toContain("hello world");
  });
});

// ── pillWidth / pillSegments ────────────────────────────────────────

describe("pill", () => {
  test("pillWidth with no nerdFonts", () => {
    const segs = [
      {
        label: "Hello",
        fg: [255, 255, 255] as [number, number, number],
        bg: [0, 0, 0] as [number, number, number],
      },
    ];
    const w = pillWidth(segs, false, false);
    // " Hello " = 7 chars, no curves
    expect(w).toBe(7);
  });

  test("pillWidth with nerdFonts", () => {
    const segs = [
      {
        label: "Hello",
        fg: [255, 255, 255] as [number, number, number],
        bg: [0, 0, 0] as [number, number, number],
      },
    ];
    const w = pillWidth(segs, true, false);
    // " Hello " = 7 + 2 curves + 0 flames = 9
    expect(w).toBe(9);
  });

  test("pillWidth with narrow labels", () => {
    const segs = [
      {
        label: "Hello",
        labelNarrow: "Hi",
        fg: [255, 255, 255] as [number, number, number],
        bg: [0, 0, 0] as [number, number, number],
      },
    ];
    const w = pillWidth(segs, false, true);
    // " Hi " = 4 chars
    expect(w).toBe(4);
  });

  test("pillSegments returns correct structure", () => {
    const segs = [
      {
        label: "Test",
        fg: [255, 255, 255] as [number, number, number],
        bg: [0, 0, 0] as [number, number, number],
      },
    ];
    const result = pillSegments(segs, false, false);
    expect(result.length).toBe(1);
    expect(result[0]?.text).toBe(" Test ");
  });

  test("pillSegments empty input", () => {
    expect(pillSegments([], false, false)).toEqual([]);
    expect(pillWidth([], false, false)).toBe(0);
  });
});
