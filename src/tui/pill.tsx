import { Text } from "ink";
import stringWidth from "string-width";
import { type BadgeColors, resolveColorHex } from "../ansi/index.ts";

const PL_LCURVE = "";
const PL_RCURVE = "";
const PL_RFLAME = "";

export type BorderSegment = {
  key: string;
  text: string;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
};

export type PillSegment = BadgeColors & {
  label: string;
  labelNarrow?: string;
  bold?: boolean;
};

export type PillProps = BadgeColors & {
  icon?: string;
  label: string;
  bold?: boolean;
  nerdFonts: boolean;
};

export function Pill({ icon, label, fg, bg, bold, nerdFonts }: PillProps) {
  const seg: PillSegment = { fg, bg, bold, label: icon ? `${icon} ${label}` : label };
  return (
    <Text>
      {pillSegments([seg], nerdFonts, false).map((s) => (
        <Text key={s.key} color={s.color} backgroundColor={s.backgroundColor} bold={s.bold}>
          {s.text}
        </Text>
      ))}
    </Text>
  );
}

function resolveLabel(seg: PillSegment, narrow: boolean): string {
  return narrow ? (seg.labelNarrow ?? seg.label) : seg.label;
}

export function pillSegments(segs: PillSegment[], nerd: boolean, narrow: boolean): BorderSegment[] {
  if (segs.length === 0) return [];

  const bgs = segs.map((s) => resolveColorHex(s.bg));
  const out: BorderSegment[] = [];
  if (nerd) out.push({ key: "pc-lcurve", text: PL_LCURVE, color: bgs[0] });

  segs.forEach((seg, i) => {
    out.push({
      key: `pc-body-${i}`,
      text: ` ${resolveLabel(seg, narrow)} `,
      color: resolveColorHex(seg.fg),
      backgroundColor: bgs[i],
      bold: seg.bold,
    });
    if (nerd && i < segs.length - 1) {
      out.push({
        key: `pc-flame-${i}`,
        text: PL_RFLAME,
        color: bgs[i],
        backgroundColor: bgs[i + 1],
      });
    }
  });

  if (nerd) out.push({ key: "pc-rcurve", text: PL_RCURVE, color: bgs[bgs.length - 1] });
  return out;
}

export function pillWidth(segs: PillSegment[], nerd: boolean, narrow: boolean): number {
  if (segs.length === 0) return 0;
  let w = 0;
  for (const seg of segs) w += stringWidth(` ${resolveLabel(seg, narrow)} `);
  if (nerd) w += 2 + (segs.length - 1); // L + R curves + flames between
  return w;
}
