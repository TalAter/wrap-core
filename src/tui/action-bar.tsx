import { Text } from "ink";
import { resolveColorHex } from "../ansi/index.ts";
import { useTheme } from "./theme-context.tsx";

export type ActionItem = {
  /**
   * Display glyph. A single ASCII letter (A-Z) matching `label[0]`
   * case-insensitively renders approve-style (underlined hotkey inside the
   * label, e.g. `Yes` with `Y` underlined). Anything else renders as a
   * combo prefix: `<glyph> <label>`.
   */
  glyph: string;
  label: string;
  /** Highlight color on the glyph/letter -- marks a first-tier action. */
  primary?: boolean;
  /** Approve-style only; tints head + tail uniformly and drops the head's
   *  hotkey underline (e.g. flash `Copied` green as a status, not a hint). */
  flashColor?: string;
};

type ActionBarProps = {
  items: readonly ActionItem[];
  /**
   * Visual-only. When set, the item at this index renders with the selection
   * highlight background. ActionBar owns no keys -- arrow nav and Enter-on-focus
   * are wired by the caller's `useKeyBindings`.
   */
  focusedIndex?: number;
  /**
   * When omitted: render a divider between every adjacent pair of items.
   * When provided: render a divider ONLY after the listed item indices.
   */
  dividerAfter?: readonly number[];
};

const LETTER_RE = /^[A-Za-z]$/;

function isApproveStyle(item: ActionItem): boolean {
  return (
    LETTER_RE.test(item.glyph) &&
    item.label.length > 0 &&
    (item.label[0] as string).toLowerCase() === item.glyph.toLowerCase()
  );
}

export function ActionBar({ items, focusedIndex, dividerAfter }: ActionBarProps) {
  const t = useTheme();
  const selected = resolveColorHex(t.actionBar.selected);
  const divider = resolveColorHex(t.actionBar.separator);
  const shortcutPrimary = resolveColorHex(t.actionBar.shortcutPrimary);
  const shortcut = resolveColorHex(t.actionBar.shortcut);
  const label = resolveColorHex(t.actionBar.label);
  const selectedBg = resolveColorHex(t.actionBar.selectedBg);
  const selectedShortcut = resolveColorHex(t.actionBar.selectedShortcut);
  const selectedShortcutPrimary = resolveColorHex(t.actionBar.selectedShortcutPrimary);
  const hasDivider = (i: number): boolean =>
    i > 0 && (dividerAfter === undefined ? true : dividerAfter.includes(i - 1));

  return (
    <Text>
      {items.map((item, i) => {
        const isFocused = focusedIndex === i;
        const bg = isFocused ? selectedBg : undefined;
        const dividerNode = hasDivider(i) ? <Text color={divider}>{" │ "}</Text> : null;

        if (isApproveStyle(item)) {
          const defaultAccent = item.primary
            ? isFocused
              ? selectedShortcutPrimary
              : shortcutPrimary
            : isFocused
              ? selectedShortcut
              : shortcut;
          const defaultTail = isFocused ? selected : label;
          const accent = item.flashColor ?? defaultAccent;
          const tail = item.flashColor ?? defaultTail;
          const head = item.label[0] as string;
          const rest = item.label.slice(1);
          const headUnderline = item.flashColor === undefined;
          return (
            <Text key={`${item.glyph}:${item.label}`}>
              {dividerNode}
              <Text backgroundColor={bg}>
                {" "}
                <Text bold underline={headUnderline} color={accent}>
                  {head}
                </Text>
                <Text color={tail} bold={isFocused}>
                  {rest}
                </Text>{" "}
              </Text>
            </Text>
          );
        }

        const glyphColor = item.primary ? shortcutPrimary : shortcut;
        return (
          <Text key={`${item.glyph}:${item.label}`}>
            {dividerNode}
            <Text backgroundColor={bg}>
              <Text bold color={glyphColor}>
                {item.glyph}
              </Text>
              <Text color={label}>{` ${item.label}`}</Text>
            </Text>
          </Text>
        );
      })}
    </Text>
  );
}
