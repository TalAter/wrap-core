import { openSync } from "node:fs";
import { ReadStream } from "node:tty";
import { ANSI16, type ColorRef, type FrameStops, type TokenPair } from "../ansi/index.ts";
import type { AppFs } from "../fs/index.ts";

// ── Types ────────────────────────────────────────────────────────

export type Appearance = "dark" | "light";

export type CoreThemeTokens = {
  copy: {
    body: ColorRef;
    supporting: ColorRef;
    note: ColorRef;
    unavailable: ColorRef;
    link: ColorRef;
    pop: ColorRef;
    success: ColorRef;
  };
  dialog: {
    status: ColorRef;
    prompt: ColorRef;
  };
  input: {
    surface: ColorRef;
    text: ColorRef;
    placeholder: ColorRef;
    editorStatus: ColorRef;
  };
  actionBar: {
    label: ColorRef;
    selected: ColorRef;
    shortcut: ColorRef;
    shortcutPrimary: ColorRef;
    selectedShortcut: ColorRef;
    selectedShortcutPrimary: ColorRef;
    selectedBg: ColorRef;
    separator: ColorRef;
    success: ColorRef;
  };
  checklist: {
    row: ColorRef;
    rowChecked: ColorRef;
    rowFocused: ColorRef;
    rowFocusedBg: ColorRef;
    sectionLabel: ColorRef;
    sectionRule: ColorRef;
  };
  picker: {
    option: ColorRef;
    optionFocused: ColorRef;
    optionSelected: ColorRef;
    focusIndicator: ColorRef;
    selectedIndicator: ColorRef;
  };
  severity: {
    warning: { frame: FrameStops; pill: TokenPair };
    danger: { frame: FrameStops; pill: TokenPair };
  };
};

// ── Reference palettes ───────────────────────────────────────────

export const DARK_CORE: CoreThemeTokens = {
  copy: {
    body: [210, 210, 225],
    supporting: [170, 170, 195],
    note: { base: [115, 115, 140], ansi16: ANSI16.white },
    unavailable: [65, 65, 80],
    link: [120, 180, 255],
    pop: { base: [245, 186, 74], ansi16: ANSI16.brightYellow },
    success: { base: [120, 230, 160], ansi16: ANSI16.green },
  },
  dialog: {
    status: [210, 210, 225],
    prompt: [210, 210, 225],
  },
  input: {
    surface: [35, 35, 50],
    text: [210, 210, 225],
    placeholder: { base: [115, 115, 140], ansi16: ANSI16.white },
    editorStatus: { base: [115, 115, 140], ansi16: ANSI16.white },
  },
  actionBar: {
    label: { base: [115, 115, 140], ansi16: ANSI16.white },
    selected: [210, 210, 225],
    shortcut: [170, 170, 195],
    shortcutPrimary: { base: [245, 186, 74], ansi16: ANSI16.brightYellow },
    selectedShortcut: [210, 210, 225],
    selectedShortcutPrimary: { base: [245, 186, 74], ansi16: ANSI16.brightYellow },
    selectedBg: [55, 45, 80],
    separator: [65, 65, 80],
    success: { base: [120, 230, 160], ansi16: ANSI16.green },
  },
  checklist: {
    row: { base: [115, 115, 140], ansi16: ANSI16.white },
    rowChecked: { base: [120, 230, 160], ansi16: ANSI16.green },
    rowFocused: [210, 210, 225],
    rowFocusedBg: [26, 42, 77],
    sectionLabel: [170, 170, 195],
    sectionRule: [60, 60, 100],
  },
  picker: {
    option: [170, 170, 195],
    optionFocused: [210, 210, 225],
    optionSelected: { base: [120, 230, 160], ansi16: ANSI16.green },
    focusIndicator: [210, 210, 225],
    selectedIndicator: { base: [120, 230, 160], ansi16: ANSI16.green },
  },
  severity: {
    warning: {
      frame: [
        [255, 100, 200],
        [60, 60, 100],
      ],
      pill: { fg: [255, 200, 80], bg: [80, 50, 20] },
    },
    danger: {
      frame: [
        [255, 60, 80],
        [60, 60, 100],
      ],
      pill: { fg: [255, 100, 100], bg: [80, 25, 25] },
    },
  },
};

export const LIGHT_CORE: CoreThemeTokens = {
  copy: {
    body: [0, 0, 0],
    supporting: [45, 45, 70],
    note: [105, 105, 130],
    unavailable: [175, 175, 195],
    link: [25, 90, 190],
    pop: [255, 165, 50],
    success: [15, 125, 55],
  },
  dialog: {
    status: [0, 0, 0],
    prompt: [0, 0, 0],
  },
  input: {
    surface: [218, 232, 250],
    text: [0, 0, 0],
    placeholder: [105, 105, 130],
    editorStatus: [105, 105, 130],
  },
  actionBar: {
    label: [105, 105, 130],
    selected: [0, 0, 0],
    shortcut: [45, 45, 70],
    shortcutPrimary: [255, 165, 50],
    selectedShortcut: [0, 0, 0],
    selectedShortcutPrimary: [255, 165, 50],
    selectedBg: [220, 215, 238],
    separator: [175, 175, 195],
    success: [15, 125, 55],
  },
  checklist: {
    row: [105, 105, 130],
    rowChecked: [15, 125, 55],
    rowFocused: [0, 0, 0],
    rowFocusedBg: [210, 220, 245],
    sectionLabel: [45, 45, 70],
    sectionRule: [170, 170, 195],
  },
  picker: {
    option: [45, 45, 70],
    optionFocused: [0, 0, 0],
    optionSelected: [15, 125, 55],
    focusIndicator: [0, 0, 0],
    selectedIndicator: [15, 125, 55],
  },
  severity: {
    warning: {
      frame: [
        [175, 35, 115],
        [170, 170, 195],
      ],
      pill: { fg: [160, 95, 0], bg: [248, 232, 200] },
    },
    danger: {
      frame: [
        [190, 25, 45],
        [170, 170, 195],
      ],
      pill: { fg: [190, 25, 45], bg: [248, 218, 218] },
    },
  },
};

// ── Global theme store ───────────────────────────────────────────

let activeTheme: CoreThemeTokens = DARK_CORE;

export function setTheme(theme: CoreThemeTokens): void {
  activeTheme = theme;
}

export function getTheme(): CoreThemeTokens {
  return activeTheme;
}

export function resolveTheme(appearance: Appearance): CoreThemeTokens {
  return appearance === "light" ? LIGHT_CORE : DARK_CORE;
}

export function __resetThemeStore(): void {
  activeTheme = DARK_CORE;
}

// ── Appearance detection ─────────────────────────────────────────

const CACHE_PATH = "cache/appearance.json";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export function parseOsc11Response(raw: string): Appearance | null {
  const match = raw.match(/\]11;rgb:([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})\/([0-9a-fA-F]{2,4})/);
  if (!match) return null;

  const r = Number.parseInt((match[1] as string).slice(0, 2), 16) / 255;
  const g = Number.parseInt((match[2] as string).slice(0, 2), 16) / 255;
  const b = Number.parseInt((match[3] as string).slice(0, 2), 16) / 255;

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;

  // WCAG relative luminance
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? "light" : "dark";
}

// The cache is a pure optimization — an unreadable or unwritable home dir
// must degrade to probing, never break appearance resolution (or whatever
// command needed a theme, e.g. --help).
export function getCachedAppearance(fs: AppFs): Appearance | null {
  try {
    const raw = fs.read(CACHE_PATH);
    if (raw === null) return null;
    const data = JSON.parse(raw) as { appearance?: string; ts?: number };
    if (data.appearance !== "dark" && data.appearance !== "light") return null;
    if (typeof data.ts !== "number") return null;
    if (data.ts + CACHE_TTL_MS < Date.now()) return null;
    return data.appearance;
  } catch {
    return null;
  }
}

export function cacheAppearance(fs: AppFs, appearance: Appearance): void {
  try {
    fs.write(CACHE_PATH, JSON.stringify({ appearance, ts: Date.now() }));
  } catch {
    // best-effort
  }
}

// DA1 (Primary Device Attributes) reply: CSI ? <params> c. Every terminal
// answers DA1, and replies arrive in request order — so a DA1 reply means
// the terminal has already said everything it will say about OSC 11.
export function hasDa1Response(buf: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching an ANSI escape sequence
  return /\x1b\[\?[\d;]*c/.test(buf);
}

type ProbeStream = {
  on(event: "data", cb: (chunk: Buffer) => void): unknown;
  on(event: "error", cb: () => void): unknown;
  setRawMode(mode: boolean): unknown;
  destroy(): void;
};

// A complete OSC 11 reply without the DA1 sentinel yet (mux filtering DA1,
// or a terminal that answers OSC but not DA1): wait this long for the
// trailing DA1 so it gets consumed too, then resolve with what we have.
const OSC_GRACE_MS = 100;

// Sends OSC 11 + DA1 together and reads until the DA1 sentinel arrives, so
// the wait is bounded by the terminal's real round-trip time (SSH included)
// and both replies are consumed instead of leaking into the shell. The
// timeout is a backstop for terminals that never answer DA1; it resolves
// from whatever buffered, not null, in case only the OSC reply made it.
export function readProbeReply(
  stream: ProbeStream,
  write: (s: string) => void,
  timeoutMs: number,
): Promise<Appearance | null> {
  return new Promise<Appearance | null>((resolve) => {
    let settled = false;
    let buf = "";
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      try {
        stream.setRawMode(false);
      } catch {
        // ignore
      }
      stream.destroy();
    };

    const settle = () => {
      cleanup();
      resolve(parseOsc11Response(buf));
    };

    const timer = setTimeout(settle, timeoutMs);

    stream.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      if (hasDa1Response(buf)) {
        settle();
      } else if (graceTimer === undefined && (buf.includes("\x07") || buf.includes("\x1b\\"))) {
        graceTimer = setTimeout(settle, OSC_GRACE_MS);
      }
    });

    stream.on("error", () => {
      cleanup();
      resolve(null);
    });

    try {
      stream.setRawMode(true);
      write("\x1b]11;?\x07\x1b[c");
    } catch {
      cleanup();
      resolve(null);
    }
  });
}

export async function queryTerminalBackground(timeoutMs = 2000): Promise<Appearance | null> {
  if (!process.stderr.isTTY) return null;

  let fd: number;
  try {
    fd = openSync("/dev/tty", "r");
  } catch {
    return null;
  }

  return readProbeReply(new ReadStream(fd), (s) => process.stderr.write(s), timeoutMs);
}

export async function resolveAppearance(opts: {
  envVarName: string;
  configAppearance?: "auto" | "dark" | "light";
  fs?: AppFs;
}): Promise<Appearance> {
  const envTheme = process.env[opts.envVarName];
  if (envTheme === "dark" || envTheme === "light") return envTheme;

  if (opts.configAppearance === "dark" || opts.configAppearance === "light") {
    return opts.configAppearance;
  }

  if (opts.fs) {
    const cached = getCachedAppearance(opts.fs);
    if (cached) return cached;
  }

  const detected = await queryTerminalBackground().catch(() => null);
  if (detected) {
    if (opts.fs) cacheAppearance(opts.fs, detected);
    return detected;
  }
  return "dark";
}
