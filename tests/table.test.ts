import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { stripAnsi } from "../src/ansi/index.ts";
import { DARK_CORE } from "../src/theme/index.ts";
import { __setInkForTests } from "../src/tui/ink-runtime.ts";
import { printInline } from "../src/tui/print-inline.ts";
import { padCell, Table, tableColumnWidths } from "../src/tui/table.tsx";

describe("tableColumnWidths", () => {
  test("sizes each column to the widest of its header and cells", () => {
    const columns = [{ header: "PKG" }, { header: "SOURCE" }];
    const rows = [
      ["a", "github.com"],
      ["longer-slug", "x.io"],
    ];
    expect(tableColumnWidths(columns, rows)).toEqual([11, 10]); // "longer-slug", "github.com"
  });

  test("header wins when wider than every cell", () => {
    const columns = [{ header: "LAST RAN" }];
    const rows = [["a"], ["bb"]];
    expect(tableColumnWidths(columns, rows)).toEqual([8]);
  });

  test("no rows falls back to header widths", () => {
    expect(tableColumnWidths([{ header: "X" }, { header: "yyy" }], [])).toEqual([1, 3]);
  });

  test("measures display width of wide glyphs, not code units", () => {
    // "✓" is width 1; a CJK char is width 2.
    const [w] = tableColumnWidths([{ header: "h" }], [["世"]]);
    expect(w).toBe(2);
  });

  test("treats a missing cell as empty", () => {
    expect(tableColumnWidths([{ header: "" }, { header: "" }], [["ab"]])).toEqual([2, 0]);
  });
});

describe("padCell", () => {
  test("left-aligns by default, trailing the pad", () => {
    expect(padCell("ab", 5)).toBe("ab   ");
  });

  test("right-aligns, leading the pad", () => {
    expect(padCell("ab", 5, "right")).toBe("   ab");
  });

  test("no padding when text already fills the width", () => {
    expect(padCell("abcde", 5)).toBe("abcde");
  });

  test("never pads negative when text overflows the width", () => {
    expect(padCell("abcdef", 3)).toBe("abcdef");
  });

  test("pads by display width for wide glyphs", () => {
    // "世" is width 2, so to reach width 4 it needs 2 trailing spaces.
    expect(padCell("世", 4)).toBe("世  ");
  });
});

describe("Table (real Ink render)", () => {
  // Render through printInline + real Ink so the JSX layout contract — column
  // alignment and the last-column-unpadded rule — is pinned in wrap-core itself,
  // not only transitively by consumers. afterEach clears the shared Ink cache so
  // we don't leave the real runtime injected for other suites.
  afterEach(() => __setInkForTests(null));

  /** A writable stream that just accumulates what Ink writes. */
  function capture() {
    const chunks: string[] = [];
    const stream = {
      write: (s: string) => {
        chunks.push(s);
        return true;
      },
      columns: 80,
      rows: 24,
      isTTY: false,
    } as unknown as NodeJS.WriteStream;
    return { stream, text: () => stripAnsi(chunks.join("")) };
  }

  test("renders aligned columns to the stream with no trailing whitespace", async () => {
    const cap = capture();
    const columns = [{ header: "PKG" }, { header: "SOURCE" }, { header: "WHEN" }];
    const rows = [
      ["a", "github.com", "2026-05-20"],
      ["longer", "x.io", "2026-05-19"],
    ];

    await printInline(createElement(Table, { columns, rows }), {
      theme: DARK_CORE,
      nerdFonts: false,
      stream: cap.stream,
    });

    const raw = cap.text();
    const content = raw.split("\n").filter((l) => l.length > 0);

    // Exact aligned layout: each column padded to its widest cell, two-space gap,
    // the last (left-aligned) column unpadded so no line has trailing whitespace.
    expect(content).toEqual([
      "PKG     SOURCE      WHEN",
      "a       github.com  2026-05-20",
      "longer  x.io        2026-05-19",
    ]);
    // Non-TTY stream → no ANSI at all (safe to pipe/grep).
    expect(raw).toBe(stripAnsi(raw));
  });
});
