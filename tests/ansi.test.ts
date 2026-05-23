import { afterEach, describe, expect, test } from "bun:test";
import {
  __resetColorLevelCache,
  ANSI16,
  bold,
  type Color,
  type ColorRef,
  colorHex,
  colorLevel,
  dim,
  ERASE_LINE,
  type FrameStops,
  fg,
  gradient,
  gradientCells,
  HIDE_CURSOR,
  interpolate,
  isTTY,
  quantizeColor,
  resolveColor,
  resolveColorHex,
  SHOW_CURSOR,
  stripAnsi,
  supportsColor,
} from "../src/ansi/index.ts";

// ── Color math ────────────────────────────────────────────────────

describe("colorHex", () => {
  test("converts RGB to lowercase hex string", () => {
    expect(colorHex([0, 0, 0])).toBe("#000000");
    expect(colorHex([255, 255, 255])).toBe("#ffffff");
    expect(colorHex([255, 0, 128])).toBe("#ff0080");
  });

  test("pads single-digit components", () => {
    expect(colorHex([1, 2, 3])).toBe("#010203");
  });
});

describe("quantizeColor", () => {
  test("level 3 (truecolor) passes through unchanged", () => {
    const c: Color = [123, 45, 67];
    expect(quantizeColor(c, 3)).toEqual(c);
  });

  test("level 0 passes through unchanged", () => {
    const c: Color = [123, 45, 67];
    expect(quantizeColor(c, 0)).toEqual(c);
  });

  test("level 2 snaps to xterm 256-color palette", () => {
    const result = quantizeColor([100, 100, 100], 2);
    // Grayscale ramp: nearest gray for 100 is computed from the 24-step ramp
    expect(result[0]).toBe(result[1]);
    expect(result[1]).toBe(result[2]);
  });

  test("level 1 snaps to ANSI 16-color palette", () => {
    const result = quantizeColor([255, 0, 0], 1);
    // Should map to red or brightRed
    expect(result).toEqual(ANSI16.red);
  });

  test("pure white quantizes to brightWhite at level 1", () => {
    expect(quantizeColor([255, 255, 255], 1)).toEqual(ANSI16.brightWhite);
  });
});

// ── ColorRef resolution ───────────────────────────────────────────

describe("resolveColor", () => {
  test("plain Color tuple returns as-is at any level", () => {
    const c: Color = [100, 200, 50];
    expect(resolveColor(c, 3)).toEqual(c);
    expect(resolveColor(c, 1)).toEqual(c);
    expect(resolveColor(c, 0)).toEqual(c);
  });

  test("ColorRef object returns base at truecolor level", () => {
    const ref: ColorRef = { base: [100, 200, 50], ansi16: [0, 170, 0] };
    expect(resolveColor(ref, 3)).toEqual([100, 200, 50]);
  });

  test("ColorRef object returns ansi16 override at level 1", () => {
    const ref: ColorRef = { base: [100, 200, 50], ansi16: [0, 170, 0] };
    expect(resolveColor(ref, 1)).toEqual([0, 170, 0]);
  });

  test("ColorRef object returns ansi256 override at level 2", () => {
    const ref: ColorRef = { base: [100, 200, 50], ansi256: [95, 215, 95] };
    expect(resolveColor(ref, 2)).toEqual([95, 215, 95]);
  });

  test("falls back to base when no override for level", () => {
    const ref: ColorRef = { base: [100, 200, 50] };
    expect(resolveColor(ref, 1)).toEqual([100, 200, 50]);
    expect(resolveColor(ref, 2)).toEqual([100, 200, 50]);
  });
});

describe("resolveColorHex", () => {
  test("returns quantized hex for plain Color", () => {
    const hex = resolveColorHex([255, 0, 0]);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("uses ansi16 override when color level is 1", () => {
    // Force level 1 via env
    const saved = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = "1";
    __resetColorLevelCache();
    try {
      const ref: ColorRef = { base: [120, 230, 160], ansi16: ANSI16.green };
      const hex = resolveColorHex(ref);
      // Should produce the hex for ANSI16.green quantized to level 1
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      // resolveColor at level 1 picks ansi16 override, then quantizeColor snaps it
      const expectedColor = quantizeColor([...ANSI16.green] as Color, 1);
      expect(hex).toBe(colorHex(expectedColor));
    } finally {
      if (saved === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = saved;
      __resetColorLevelCache();
    }
  });
});

// ── colorLevel detection ──────────────────────────────────────────

describe("colorLevel", () => {
  afterEach(() => {
    __resetColorLevelCache();
  });

  function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
    const saved: Record<string, string | undefined> = {};
    // Clear known env vars that affect detection
    const keys = [
      "NO_COLOR",
      "FORCE_COLOR",
      "COLORTERM",
      "TERM",
      "TERM_PROGRAM",
      "KITTY_WINDOW_ID",
      "WT_SESSION",
      "ALACRITTY_LOG",
      "ALACRITTY_SOCKET",
      "KONSOLE_VERSION",
      "WEZTERM_EXECUTABLE",
      "VTE_VERSION",
      ...Object.keys(overrides),
    ];
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined) process.env[k] = v;
    }
    __resetColorLevelCache();
    try {
      fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      __resetColorLevelCache();
    }
  }

  test("NO_COLOR forces level 0", () => {
    withEnv({ NO_COLOR: "", FORCE_COLOR: undefined }, () => {
      expect(colorLevel()).toBe(0);
    });
  });

  test("FORCE_COLOR=3 forces truecolor", () => {
    withEnv({ FORCE_COLOR: "3" }, () => {
      expect(colorLevel()).toBe(3);
    });
  });

  test("FORCE_COLOR=2 forces 256-color", () => {
    withEnv({ FORCE_COLOR: "2" }, () => {
      expect(colorLevel()).toBe(2);
    });
  });

  test("FORCE_COLOR=1 forces 16-color", () => {
    withEnv({ FORCE_COLOR: "1" }, () => {
      expect(colorLevel()).toBe(1);
    });
  });

  test("FORCE_COLOR=0 forces no color", () => {
    withEnv({ FORCE_COLOR: "0" }, () => {
      expect(colorLevel()).toBe(0);
    });
  });

  test("FORCE_COLOR with no value defaults to 1", () => {
    withEnv({ FORCE_COLOR: "" }, () => {
      expect(colorLevel()).toBe(1);
    });
  });

  test("FORCE_COLOR takes precedence over COLORTERM", () => {
    withEnv({ FORCE_COLOR: "1", COLORTERM: "truecolor" }, () => {
      expect(colorLevel()).toBe(1);
    });
  });

  // TTY-gated detection: computeColorLevel returns 0 for non-TTY before
  // reaching COLORTERM/TERM/env-var heuristics, so these only run in a TTY.
  const ttyOnly = test.skipIf(!process.stdout.isTTY);

  ttyOnly("COLORTERM=truecolor returns 3", () => {
    withEnv({ COLORTERM: "truecolor" }, () => {
      expect(colorLevel()).toBe(3);
    });
  });

  test("TERM=dumb returns 0", () => {
    withEnv({ TERM: "dumb" }, () => {
      expect(colorLevel()).toBe(0);
    });
  });

  ttyOnly("TERM=xterm-256color returns 2", () => {
    withEnv({ TERM: "xterm-256color" }, () => {
      expect(colorLevel()).toBe(2);
    });
  });

  ttyOnly("KITTY_WINDOW_ID triggers truecolor", () => {
    withEnv({ KITTY_WINDOW_ID: "1" }, () => {
      expect(colorLevel()).toBe(3);
    });
  });

  ttyOnly("TERM_PROGRAM=iTerm.app returns 3", () => {
    withEnv({ TERM_PROGRAM: "iTerm.app" }, () => {
      expect(colorLevel()).toBe(3);
    });
  });

  test("result is cached", () => {
    withEnv({ FORCE_COLOR: "3" }, () => {
      expect(colorLevel()).toBe(3);
      // Mutate env — should still return cached value
      process.env.FORCE_COLOR = "0";
      expect(colorLevel()).toBe(3);
    });
  });

  test("__resetColorLevelCache clears the cache", () => {
    withEnv({ FORCE_COLOR: "3" }, () => {
      expect(colorLevel()).toBe(3);
      process.env.FORCE_COLOR = "0";
      __resetColorLevelCache();
      expect(colorLevel()).toBe(0);
    });
  });
});

// ── isTTY / supportsColor ─────────────────────────────────────────

describe("isTTY", () => {
  test("returns a boolean", () => {
    expect(typeof isTTY()).toBe("boolean");
  });
});

describe("supportsColor", () => {
  afterEach(() => __resetColorLevelCache());

  test("returns false when NO_COLOR is set", () => {
    const saved = process.env.NO_COLOR;
    const savedForce = process.env.FORCE_COLOR;
    process.env.NO_COLOR = "";
    delete process.env.FORCE_COLOR;
    try {
      expect(supportsColor()).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = saved;
      if (savedForce === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = savedForce;
    }
  });

  test("returns true when FORCE_COLOR is set (non-zero)", () => {
    const saved = process.env.FORCE_COLOR;
    const savedNo = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    try {
      expect(supportsColor()).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = saved;
      if (savedNo === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = savedNo;
    }
  });

  test("FORCE_COLOR=0 returns false", () => {
    const saved = process.env.FORCE_COLOR;
    const savedNo = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "0";
    try {
      expect(supportsColor()).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = saved;
      if (savedNo === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = savedNo;
    }
  });
});

// ── ANSI helpers ──────────────────────────────────────────────────

describe("bold", () => {
  test("wraps text with bold escape codes", () => {
    expect(bold("hi")).toBe("\x1b[1mhi\x1b[0m");
  });
});

describe("dim", () => {
  test("wraps text with dim escape codes", () => {
    expect(dim("hi")).toBe("\x1b[2mhi\x1b[0m");
  });
});

describe("fg", () => {
  test("wraps text with truecolor foreground codes", () => {
    const result = fg("hi", 255, 0, 128);
    expect(result).toBe("\x1b[38;2;255;0;128mhi\x1b[0m");
  });
});

describe("stripAnsi", () => {
  test("removes ANSI escape sequences", () => {
    expect(stripAnsi(bold("hello"))).toBe("hello");
    expect(stripAnsi(fg("world", 255, 0, 0))).toBe("world");
    expect(stripAnsi("plain")).toBe("plain");
  });

  test("handles multiple escapes", () => {
    const mixed = `${bold("a")} ${dim("b")} c`;
    expect(stripAnsi(mixed)).toBe("a b c");
  });
});

describe("cursor/erase constants", () => {
  test("SHOW_CURSOR is the expected escape", () => {
    expect(SHOW_CURSOR).toBe("\x1b[?25h");
  });

  test("HIDE_CURSOR is the expected escape", () => {
    expect(HIDE_CURSOR).toBe("\x1b[?25l");
  });

  test("ERASE_LINE is the expected escape", () => {
    expect(ERASE_LINE).toBe("\x1b[2K");
  });
});

// ── Gradient ──────────────────────────────────────────────────────

describe("interpolate", () => {
  test("t=0 returns first stop", () => {
    const a: Color = [255, 0, 0];
    const b: Color = [0, 0, 255];
    const result = interpolate([a, b], 0);
    expect(result).toEqual(a);
  });

  test("t=1 returns last stop", () => {
    const a: Color = [255, 0, 0];
    const b: Color = [0, 0, 255];
    const result = interpolate([a, b], 1);
    expect(result).toEqual(b);
  });

  test("t=0.5 returns a blended color (not just average of RGB)", () => {
    const a: Color = [255, 0, 0];
    const b: Color = [0, 0, 255];
    const mid = interpolate([a, b], 0.5);
    // OKLAB blend won't be [128,0,128] — just verify it's in range
    for (const ch of mid) {
      expect(ch).toBeGreaterThanOrEqual(0);
      expect(ch).toBeLessThanOrEqual(255);
    }
    // And it shouldn't be identical to either endpoint
    expect(mid).not.toEqual(a);
    expect(mid).not.toEqual(b);
  });
});

describe("gradientCells", () => {
  test("returns array of same length as input text", () => {
    const cells = gradientCells("hello", [
      [255, 0, 0],
      [0, 0, 255],
    ]);
    expect(cells).toHaveLength(5);
  });

  test("empty string returns empty array", () => {
    expect(gradientCells("", [[255, 0, 0]])).toEqual([]);
  });

  test("spaces produce plain space cells", () => {
    const cells = gradientCells("a b", [
      [255, 0, 0],
      [0, 0, 255],
    ]);
    expect(cells[1]).toBe(" ");
  });

  test("level 0 produces raw characters", () => {
    const cells = gradientCells(
      "ab",
      [
        [255, 0, 0],
        [0, 0, 255],
      ],
      undefined,
      4,
      0,
    );
    expect(cells[0]).toBe("a");
    expect(cells[1]).toBe("b");
  });
});

describe("gradient", () => {
  test("returns string with ANSI reset at end", () => {
    const result = gradient("abc", [
      [255, 0, 0],
      [0, 0, 255],
    ]);
    expect(result.endsWith("\x1b[0m")).toBe(true);
  });

  test("level 0 returns plain text (no reset)", () => {
    const result = gradient("abc", [[255, 0, 0]], undefined, 4, 0);
    expect(result).toBe("abc");
  });
});

// ── Type exports ──────────────────────────────────────────────────

describe("type exports", () => {
  test("ANSI16 has the expected palette slots", () => {
    expect(ANSI16.black).toEqual([0, 0, 0]);
    expect(ANSI16.brightWhite).toEqual([255, 255, 255]);
    expect(Object.keys(ANSI16)).toHaveLength(16);
  });

  test("FrameStops is a two-element Color tuple (structural check)", () => {
    const stops: FrameStops = [
      [255, 0, 0],
      [0, 0, 255],
    ];
    expect(stops).toHaveLength(2);
  });
});
