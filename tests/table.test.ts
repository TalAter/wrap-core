import { describe, expect, test } from "bun:test";
import { padCell, tableColumnWidths } from "../src/tui/table.tsx";

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
