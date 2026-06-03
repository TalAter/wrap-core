import { Box, Text } from "ink";
import stringWidth from "string-width";
import { type ColorRef, resolveColorHex } from "../ansi/index.ts";
import { useTheme } from "./theme-context.tsx";

/** Visual gap rendered between adjacent columns. */
const COLUMN_GAP = "  ";

export type TableColumn = {
  header: string;
  /** Cell alignment within the column. Defaults to `"left"`. */
  align?: "left" | "right";
  /** Cell text color. Defaults to `theme.copy.body`. */
  color?: ColorRef;
  /** Header text color. Defaults to `theme.copy.supporting`. */
  headerColor?: ColorRef;
};

export type TableProps = {
  columns: TableColumn[];
  /** One string per column, indexed parallel to `columns`. */
  rows: string[][];
};

/**
 * The display width of each column: the widest of its header and any cell,
 * measured with `string-width` so wide/emoji glyphs align correctly.
 */
export function tableColumnWidths(columns: { header: string }[], rows: string[][]): number[] {
  return columns.map((col, c) => {
    let width = stringWidth(col.header);
    for (const row of rows) {
      const cell = stringWidth(row[c] ?? "");
      if (cell > width) width = cell;
    }
    return width;
  });
}

/** Pad `text` to `width` columns. Left-align trails spaces, right-align leads. */
export function padCell(text: string, width: number, align: "left" | "right" = "left"): string {
  const pad = " ".repeat(Math.max(0, width - stringWidth(text)));
  return align === "right" ? pad + text : text + pad;
}

/**
 * A plain aligned table: a bold header row over text rows, columns sized to
 * their widest content and separated by a fixed gap. Pure layout — no borders,
 * no interactivity, no stdin. Colors come from the theme context (or per-column
 * overrides), so it must render inside a `ThemeProvider` (e.g. via `printInline`).
 *
 * The final column is never right-padded when left-aligned, so piped output
 * carries no trailing whitespace.
 */
export function Table({ columns, rows }: TableProps) {
  const t = useTheme();
  const widths = tableColumnWidths(columns, rows);

  const renderRow = (cells: string[], key: string, header: boolean) => (
    <Text key={key}>
      {columns.map((col, c) => {
        const isLast = c === columns.length - 1;
        const align = col.align ?? "left";
        const raw = cells[c] ?? "";
        // The last left-aligned cell stays unpadded to avoid trailing spaces.
        const text = isLast && align === "left" ? raw : padCell(raw, widths[c] ?? 0, align);
        const color = resolveColorHex(
          header ? (col.headerColor ?? t.copy.supporting) : (col.color ?? t.copy.body),
        );
        return (
          <Text key={`${key}-${col.header}`}>
            <Text color={color} bold={header}>
              {text}
            </Text>
            {isLast ? null : COLUMN_GAP}
          </Text>
        );
      })}
    </Text>
  );

  return (
    <Box flexDirection="column">
      {renderRow(
        columns.map((col) => col.header),
        "__header",
        true,
      )}
      {rows.map((row, i) => renderRow(row, `row-${i}`, false))}
    </Box>
  );
}
