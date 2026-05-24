import { Box, Text, useInput, usePaste } from "ink";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { resolveColorHex } from "../ansi/index.ts";
import { clampBufferSize } from "./clamp-buffer.ts";
import { Cursor } from "./cursor.ts";
import { useTheme } from "./theme-context.tsx";

export function InputFrame({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const bg = resolveColorHex(theme.input.surface);
  return (
    <Box width="100%" paddingX={1} backgroundColor={bg}>
      {children}
    </Box>
  );
}

type BaseEditable = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
};

export type TextInputProps =
  | { readOnly: true; value: string; editingExternal?: never }
  | (BaseEditable & {
      readOnly?: false;
      editingExternal?: boolean;
      multiline?: false;
      /** Render each character as a bullet. Cursor state keeps the real text. Single-line only. */
      masked?: boolean;
    })
  | (BaseEditable & {
      readOnly?: false;
      editingExternal?: boolean;
      multiline: true;
      /** Fires when a paste or editor-return had to be trimmed to fit the 256KB cap. */
      onTruncate?: () => void;
      /** Max visible VISUAL rows (after hard-wrapping each logical line to
       *  `wrapWidth`). When content exceeds this, the view scrolls to keep
       *  the cursor visible. Unset = grow without clipping. */
      maxRows?: number;
      /** Column width at which to hard-wrap long logical lines so one 80KB
       *  paste becomes many visual rows instead of one Ink-wrapped blob. Omit
       *  to fall back to logical-line windowing. */
      wrapWidth?: number;
    });

type SingleLineEditableProps = BaseEditable & { multiline?: false; masked?: boolean };
type MultilineEditableProps = BaseEditable & {
  multiline: true;
  onTruncate?: () => void;
  maxRows?: number;
  wrapWidth?: number;
};

type KeyHandler = (c: Cursor) => Cursor;

const ctrlKeys = new Map<string, KeyHandler>([
  ["a", (c) => c.home()],
  ["e", (c) => c.end()],
  ["u", (c) => c.killToHome()],
  ["k", (c) => c.killToEnd()],
]);

const metaKeys = new Map<string, KeyHandler>([
  ["b", (c) => c.wordLeft()],
  ["f", (c) => c.wordRight()],
]);

function mask(text: string): string {
  return "•".repeat(text.length);
}

function stripNewlines(s: string): string {
  return s.replace(/[\r\n]/g, "");
}

/**
 * Sanitize a pasted string: collapse CRLF to LF, drop other control bytes
 * (keeps tab, LF). One regex, one allocation.
 */
function sanitizePaste(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the whole point is to filter control chars
  return s.replace(/\r\n|[\x00-\x08\x0B-\x1F\x7F]/g, (m) => (m === "\r\n" ? "\n" : ""));
}

function EditableTextInput(
  props: (SingleLineEditableProps | MultilineEditableProps) & {
    editingExternal?: boolean;
  },
) {
  const theme = useTheme();
  const { value, onChange, onSubmit, placeholder } = props;
  const multiline = props.multiline === true;
  const masked = !multiline && (props as SingleLineEditableProps).masked === true;
  const editingExternal = props.editingExternal === true;

  const [cursor, setCursor] = useState(() => new Cursor(value, value.length));
  const killRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    setCursor((prev) => (prev.text === value ? prev : new Cursor(value, value.length)));
  }, [value]);

  const apply = (next: Cursor) => {
    if (next.killed !== undefined) killRef.current = next.killed;
    setCursor(next);
    if (next.text !== cursor.text) onChange(next.text);
  };

  usePaste(
    (raw) => {
      const cleaned = multiline ? sanitizePaste(raw) : stripNewlines(raw);
      const combined =
        cursor.text.slice(0, cursor.offset) + cleaned + cursor.text.slice(cursor.offset);
      const clamped = clampBufferSize(combined);
      if (multiline && clamped.truncated) {
        (props as MultilineEditableProps).onTruncate?.();
      }
      const newOffset = Math.min(cursor.offset + cleaned.length, clamped.value.length);
      apply(new Cursor(clamped.value, newOffset));
    },
    { isActive: !editingExternal },
  );

  useInput(
    (input, key) => {
      if (key.return) {
        if (multiline && key.shift) {
          apply(cursor.insert("\n"));
          return;
        }
        if (multiline && cursor.text.endsWith("\\") && cursor.offset === cursor.text.length) {
          const stripped = cursor.text.slice(0, -1);
          apply(new Cursor(`${stripped}\n`, stripped.length + 1));
          return;
        }
        if (multiline && cursor.text.length === 0) return;
        onSubmit(cursor.text);
        return;
      }
      if (multiline && !key.return && input === "\n") {
        apply(cursor.insert("\n"));
        return;
      }
      if (key.backspace && key.meta) {
        apply(cursor.deleteWord());
        return;
      }
      if (key.delete) {
        apply(cursor.delete());
        return;
      }
      if (key.backspace) {
        apply(cursor.backspace());
        return;
      }
      if (key.leftArrow) {
        apply(key.meta ? cursor.wordLeft() : cursor.left());
        return;
      }
      if (key.rightArrow) {
        apply(key.meta ? cursor.wordRight() : cursor.right());
        return;
      }
      if (multiline && key.upArrow) {
        apply(cursor.upLine());
        return;
      }
      if (multiline && key.downArrow) {
        apply(cursor.downLine());
        return;
      }
      if (key.ctrl) {
        if (multiline && input === "j") {
          apply(cursor.insert("\n"));
          return;
        }
        const handler = input === "y" ? () => cursor.yank(killRef.current) : ctrlKeys.get(input);
        if (handler) apply(handler(cursor));
        return;
      }
      if (key.meta) {
        const handler = metaKeys.get(input);
        if (handler) apply(handler(cursor));
        return;
      }
      if (input) {
        const toInsert = multiline ? input : stripNewlines(input);
        if (toInsert.length === 0) return;
        const inserted = cursor.insert(toInsert);
        if (multiline) {
          const clamped = clampBufferSize(inserted.text);
          if (clamped.truncated) {
            (props as MultilineEditableProps).onTruncate?.();
            const newOffset = Math.min(inserted.offset, clamped.value.length);
            apply(new Cursor(clamped.value, newOffset));
            return;
          }
        }
        apply(inserted);
      }
    },
    { isActive: !editingExternal },
  );

  if (editingExternal) {
    return (
      <InputFrame>
        <Box width="100%" justifyContent="center">
          <Text color={resolveColorHex(theme.input.editorStatus)}>
            ... Save and close editor to continue ...
          </Text>
        </Box>
      </InputFrame>
    );
  }

  const showPlaceholder = cursor.text === "" && Boolean(placeholder);
  const maxRows = multiline ? (props as MultilineEditableProps).maxRows : undefined;
  const wrapWidth = multiline ? (props as MultilineEditableProps).wrapWidth : undefined;

  if (multiline && maxRows !== undefined) {
    const logicalLines = cursor.text.split("\n");
    type VisualRow = { text: string; startOffset: number; len: number };
    const visualRows: VisualRow[] = [];
    let offsetWalk = 0;
    for (const line of logicalLines) {
      if (line.length === 0) {
        visualRows.push({ text: "", startOffset: offsetWalk, len: 0 });
      } else if (!wrapWidth || line.length <= wrapWidth) {
        visualRows.push({ text: line, startOffset: offsetWalk, len: line.length });
      } else {
        for (let i = 0; i < line.length; i += wrapWidth) {
          const chunk = line.slice(i, i + wrapWidth);
          visualRows.push({ text: chunk, startOffset: offsetWalk + i, len: chunk.length });
        }
      }
      offsetWalk += line.length + 1;
    }
    let cursorVisualRow = visualRows.length - 1;
    for (let i = 0; i < visualRows.length; i++) {
      const row = visualRows[i] as VisualRow;
      const nextStart = visualRows[i + 1]?.startOffset ?? Number.POSITIVE_INFINITY;
      if (cursor.offset >= row.startOffset && cursor.offset < nextStart) {
        cursorVisualRow = i;
        break;
      }
    }
    const top = Math.max(
      0,
      Math.min(Math.max(0, visualRows.length - maxRows), cursorVisualRow - maxRows + 1),
    );
    const clampedTop = Math.max(0, Math.min(top, cursorVisualRow));
    const visible = visualRows.slice(clampedTop, clampedTop + maxRows);
    const localRow = cursorVisualRow - clampedTop;
    const visRow = visible[localRow];
    const localCol = visRow ? Math.min(cursor.offset - visRow.startOffset, visRow.len) : 0;
    const flat = visible.map((v) => v.text).join("\n");
    let flatOffset = 0;
    for (let i = 0; i < localRow; i++) flatOffset += (visible[i]?.len ?? 0) + 1;
    flatOffset += localCol;
    const rawAt = flat.charAt(flatOffset);
    const cursorOnNewline = rawAt === "\n";
    const before = flat.slice(0, flatOffset);
    const at = rawAt === "" || cursorOnNewline ? " " : rawAt;
    const after = cursorOnNewline ? flat.slice(flatOffset) : flat.slice(flatOffset + 1);
    return (
      <InputFrame>
        <Text color={resolveColorHex(theme.input.text)} wrap="truncate-end">
          {before}
          <Text inverse>{at}</Text>
          {after}
          {showPlaceholder ? (
            <Text color={resolveColorHex(theme.input.placeholder)}>{placeholder}</Text>
          ) : null}
        </Text>
      </InputFrame>
    );
  }

  const renderedBefore = masked ? mask(cursor.beforeCursor) : cursor.beforeCursor;
  const renderedCursor = masked ? (cursor.charAtCursor === " " ? " " : "•") : cursor.charAtCursor;
  const renderedAfter = masked ? mask(cursor.afterCursor) : cursor.afterCursor;

  return (
    <InputFrame>
      <Text color={resolveColorHex(theme.input.text)}>
        {renderedBefore}
        <Text inverse>{renderedCursor}</Text>
        {renderedAfter}
        {showPlaceholder ? (
          <Text color={resolveColorHex(theme.input.placeholder)}>{placeholder}</Text>
        ) : null}
      </Text>
    </InputFrame>
  );
}

export function TextInput(props: TextInputProps) {
  const theme = useTheme();
  if (props.readOnly) {
    return (
      <InputFrame>
        <Text color={resolveColorHex(theme.input.text)}>{props.value || " "}</Text>
      </InputFrame>
    );
  }
  return <EditableTextInput {...props} />;
}
