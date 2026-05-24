import { type Color, colorHex, colorLevel, interpolate, quantizeColor } from "../ansi/index.ts";

export function interpolateGradient(
  index: number,
  total: number,
  stops: readonly Color[],
  fallbackColor?: string,
): string {
  const level = colorLevel();
  if (level < 3 && fallbackColor) return fallbackColor;
  const t = total > 1 ? index / (total - 1) : 0;
  const c = interpolate(stops, t);
  return colorHex(quantizeColor(c, level));
}

export function gradientRow(
  totalWidth: number,
  stops: readonly Color[],
  fallbackColor?: string,
): string[] {
  const level = colorLevel();
  if (level < 3 && fallbackColor) return new Array(totalWidth).fill(fallbackColor);
  const out = new Array<string>(totalWidth);
  const denom = totalWidth > 1 ? totalWidth - 1 : 1;
  for (let i = 0; i < totalWidth; i++) {
    const c = interpolate(stops, i / denom);
    out[i] = colorHex(quantizeColor(c, level));
  }
  return out;
}
