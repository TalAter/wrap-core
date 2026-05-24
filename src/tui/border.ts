import stringWidth from "string-width";
import type { Color } from "../ansi/index.ts";
import { gradientRow, interpolateGradient } from "./gradient.ts";
import { type BorderSegment, type PillSegment, pillSegments, pillWidth } from "./pill.tsx";

export type { BorderSegment } from "./pill.tsx";

export type TopBadge = {
  segs: PillSegment[];
  narrowSegs?: PillSegment[];
  align: "left" | "right";
};

export type PreparedTop = {
  segments: BorderSegment[];
  align: "left" | "right";
  width: number;
};

export function fitTop(
  top: TopBadge | undefined,
  budget: number,
  nerd: boolean,
  fullWidth?: number,
): PreparedTop | undefined {
  if (!top || top.segs.length === 0) return undefined;
  const full = fullWidth ?? pillWidth(top.segs, nerd, false);
  if (full <= budget) {
    return { segments: pillSegments(top.segs, nerd, false), align: top.align, width: full };
  }
  const candidates = top.narrowSegs?.length ? [top.narrowSegs] : [top.segs];
  for (const segs of candidates) {
    for (const narrow of [false, true]) {
      if (narrow === false && segs === top.segs) continue;
      const w = pillWidth(segs, nerd, narrow);
      if (w <= budget) {
        return { segments: pillSegments(segs, nerd, narrow), align: top.align, width: w };
      }
    }
  }
  return undefined;
}

export function topBorderSegments(
  totalWidth: number,
  stops: Color[],
  fallbackColor: string | undefined,
  prepared?: PreparedTop,
): BorderSegment[] {
  if (totalWidth <= 0) return [];
  const colors = gradientRow(totalWidth, stops, fallbackColor);
  const pillW = prepared?.width ?? 0;
  const pillStart = !prepared ? 1 : prepared.align === "right" ? totalWidth - 2 - pillW : 2;

  const out: BorderSegment[] = [];
  out.push({ key: "top-0", text: "╭", color: colors[0] });
  if (totalWidth === 1) return out;

  let col = 1;
  while (col < pillStart && col < totalWidth - 1) {
    out.push({ key: `top-${col}`, text: "─", color: colors[col] });
    col++;
  }
  if (prepared) {
    prepared.segments.forEach((seg, k) => {
      out.push({ ...seg, key: `top-pill-${k}` });
    });
    col += pillW;
  }
  while (col < totalWidth - 1) {
    out.push({ key: `top-${col}`, text: "─", color: colors[col] });
    col++;
  }
  out.push({ key: `top-${totalWidth - 1}`, text: "╮", color: colors[totalWidth - 1] });
  return out;
}

function truncateToWidth(text: string, maxWidth: number): string | null {
  if (stringWidth(text) <= maxWidth) return text;
  if (maxWidth < 2) return null;
  let cut = text;
  while (cut.length > 0 && stringWidth(cut) + 1 > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return cut.length > 0 ? `${cut}…` : null;
}

export function bottomBorderSegments(
  totalWidth: number,
  stops: Color[],
  fallbackColor: string | undefined,
  statusColor: string,
  status?: string,
): BorderSegment[] {
  const color = interpolateGradient(stops.length - 1, stops.length, stops, fallbackColor);

  if (totalWidth <= 1) {
    return [{ key: "bottom-left", text: "╰", color }];
  }

  if (status) {
    const maxStatusWidth = totalWidth - 6;
    const fitted = truncateToWidth(status, maxStatusWidth);
    if (fitted) {
      const trailingDashes = totalWidth - 5 - stringWidth(fitted);
      return [
        { key: "bottom-left", text: "╰", color },
        { key: "bottom-mid-lead", text: "─ ", color },
        { key: "bottom-status", text: fitted, color: statusColor },
        { key: "bottom-mid-tail", text: ` ${"─".repeat(trailingDashes)}`, color },
        { key: "bottom-right", text: "╯", color },
      ];
    }
  }

  return [
    { key: "bottom-left", text: "╰", color },
    { key: "bottom-mid", text: "─".repeat(Math.max(0, totalWidth - 2)), color },
    { key: "bottom-right", text: "╯", color },
  ];
}
