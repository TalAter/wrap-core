import { useAnimation } from "ink";
import { SPINNER_FRAMES, SPINNER_INTERVAL } from "../chrome/index.ts";

/**
 * Compose the bottom-border status string for one animation frame. The pure half
 * of {@link useSpinnerStatus}, split out so the formatting contract — frame
 * prefix, frame-list wrap-around, and the no-label / no-animation cases — is
 * testable without an Ink render. Returns `undefined` when there's nothing to
 * show, so the result drops straight into `Dialog`'s optional `bottomStatus`.
 */
export function spinnerStatus(
  label: string | undefined,
  frameIndex: number,
  noAnimation = false,
): string | undefined {
  if (!label) return undefined;
  if (noAnimation) return label;
  const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length] ?? "";
  return `${frame} ${label}`;
}

/**
 * Animated status string for a dialog's bottom border: a braille spinner frame
 * followed by `label` (e.g. `"⠊⠑ Analyzing…"`), ready to hand to `Dialog`'s
 * `bottomStatus`. Returns `undefined` while `label` is empty so the border draws
 * plain — pass `undefined` to stop the spinner.
 *
 * The spinner ticks only while a non-empty `label` is present. `noAnimation`
 * (the consumer's policy: CLI flag, CI, NO_COLOR, …) freezes it to the bare
 * label with no frame, mirroring `startChromeSpinner`'s `noAnimation` behaviour.
 */
export function useSpinnerStatus(
  label: string | undefined,
  opts?: { noAnimation?: boolean },
): string | undefined {
  const noAnimation = opts?.noAnimation ?? false;
  const { frame } = useAnimation({
    interval: SPINNER_INTERVAL,
    isActive: !noAnimation && !!label,
  });
  return spinnerStatus(label, frame, noAnimation);
}
