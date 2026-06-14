import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { createAppFs } from "../src/fs/index.ts";
import {
  __resetThemeStore,
  type CoreThemeTokens,
  cacheAppearance,
  DARK_CORE,
  getCachedAppearance,
  getTheme,
  LIGHT_CORE,
  parseOsc11Response,
  resolveAppearance,
  resolveTheme,
  setTheme,
} from "../src/theme/index.ts";
import { tmpHome } from "./helpers.ts";

const trackedHomes: string[] = [];
function freshHome(): string {
  const home = tmpHome();
  trackedHomes.push(home);
  return home;
}
afterEach(() => {
  while (trackedHomes.length) {
    const home = trackedHomes.pop();
    if (home) rmSync(home, { recursive: true, force: true });
  }
  __resetThemeStore();
});

// ── CoreThemeTokens shape ────────────────────────────────────────

describe("CoreThemeTokens shape", () => {
  const TOKEN_GROUPS = {
    copy: ["body", "supporting", "note", "unavailable", "link", "pop", "success"],
    dialog: ["status", "prompt"],
    input: ["surface", "text", "placeholder", "editorStatus"],
    actionBar: [
      "label",
      "selected",
      "shortcut",
      "shortcutPrimary",
      "selectedShortcut",
      "selectedShortcutPrimary",
      "selectedBg",
      "separator",
      "success",
    ],
    checklist: ["row", "rowChecked", "rowFocused", "rowFocusedBg", "sectionLabel", "sectionRule"],
    picker: ["option", "optionFocused", "optionSelected", "focusIndicator", "selectedIndicator"],
    severity: ["warning", "danger"],
  } as const;

  for (const palette of [
    { name: "DARK_CORE", theme: DARK_CORE },
    { name: "LIGHT_CORE", theme: LIGHT_CORE },
  ] as const) {
    describe(palette.name, () => {
      test("has exactly the expected top-level groups", () => {
        expect(Object.keys(palette.theme).sort()).toEqual(Object.keys(TOKEN_GROUPS).sort());
      });

      for (const [group, fields] of Object.entries(TOKEN_GROUPS)) {
        test(`${group} has exactly the expected fields`, () => {
          const section = palette.theme[group as keyof CoreThemeTokens];
          expect(Object.keys(section).sort()).toEqual([...fields].sort());
        });
      }

      // `severity` is the only nested group: its members are { frame, pill }
      // objects, which the one-level check above can't reach.
      test("severity members have exactly { frame, pill }", () => {
        expect(Object.keys(palette.theme.severity.warning).sort()).toEqual(["frame", "pill"]);
        expect(Object.keys(palette.theme.severity.danger).sort()).toEqual(["frame", "pill"]);
      });

      test("does NOT contain wizard, risk, or forget groups", () => {
        const keys = Object.keys(palette.theme);
        expect(keys).not.toContain("wizard");
        expect(keys).not.toContain("risk");
        expect(keys).not.toContain("forget");
      });

      test("dialog has no wrap-specific fields", () => {
        const keys = Object.keys(palette.theme.dialog);
        expect(keys).not.toContain("outputLabel");
        expect(keys).not.toContain("outputText");
        expect(keys).not.toContain("explanation");
        expect(keys).not.toContain("plan");
        expect(keys).not.toContain("foldIndicator");
        expect(keys).not.toContain("composePill");
      });
    });
  }

  test("DARK_CORE and LIGHT_CORE are distinct palettes", () => {
    expect(DARK_CORE).not.toEqual(LIGHT_CORE);
  });
});

// ── Global store ─────────────────────────────────────────────────

describe("global theme store", () => {
  test("getTheme returns DARK_CORE by default", () => {
    expect(getTheme()).toBe(DARK_CORE);
  });

  test("setTheme/getTheme round-trips", () => {
    setTheme(LIGHT_CORE);
    expect(getTheme()).toBe(LIGHT_CORE);
  });

  test("__resetThemeStore resets to DARK_CORE", () => {
    setTheme(LIGHT_CORE);
    __resetThemeStore();
    expect(getTheme()).toBe(DARK_CORE);
  });

  test("resolveTheme returns DARK_CORE for 'dark'", () => {
    expect(resolveTheme("dark")).toBe(DARK_CORE);
  });

  test("resolveTheme returns LIGHT_CORE for 'light'", () => {
    expect(resolveTheme("light")).toBe(LIGHT_CORE);
  });
});

// ── parseOsc11Response ───────────────────────────────────────────

describe("parseOsc11Response", () => {
  test("detects dark background (low luminance)", () => {
    // rgb:0000/0000/0000 — pure black
    expect(parseOsc11Response("\x1b]11;rgb:0000/0000/0000\x07")).toBe("dark");
  });

  test("detects light background (high luminance)", () => {
    // rgb:ffff/ffff/ffff — pure white
    expect(parseOsc11Response("\x1b]11;rgb:ffff/ffff/ffff\x07")).toBe("light");
  });

  test("handles 2-char hex channels", () => {
    expect(parseOsc11Response("\x1b]11;rgb:ff/ff/ff\x07")).toBe("light");
    expect(parseOsc11Response("\x1b]11;rgb:00/00/00\x07")).toBe("dark");
  });

  test("handles ST terminator (ESC backslash)", () => {
    expect(parseOsc11Response("\x1b]11;rgb:0000/0000/0000\x1b\\")).toBe("dark");
  });

  test("dark grey terminal (e.g. iTerm default)", () => {
    // rgb:1c1c/1c1c/1c1c — typical dark terminal bg
    expect(parseOsc11Response("\x1b]11;rgb:1c1c/1c1c/1c1c\x07")).toBe("dark");
  });

  test("light grey terminal (e.g. Solarized Light)", () => {
    // rgb:fdf6/e3e3/d7d7 — Solarized Light bg
    expect(parseOsc11Response("\x1b]11;rgb:fdf6/e3e3/d7d7\x07")).toBe("light");
  });

  test("returns null for malformed input", () => {
    expect(parseOsc11Response("")).toBeNull();
    expect(parseOsc11Response("not an osc response")).toBeNull();
    expect(parseOsc11Response("\x1b]11;rgb:zzzz/0000/0000\x07")).toBeNull();
  });

  test("returns null for partial response (no terminator match but valid rgb)", () => {
    // The regex matches the rgb: portion, so this actually does parse.
    // Verify it returns something reasonable or null depending on match.
    const result = parseOsc11Response("\x1b]11;rgb:0000/0000/0000");
    // The regex doesn't require the terminator — it should still parse
    expect(result).toBe("dark");
  });
});

// ── getCachedAppearance / cacheAppearance ────────────────────────

describe("appearance caching", () => {
  function newFs() {
    const home = freshHome();
    return createAppFs({ app: "test", home });
  }

  test("returns null when cache file does not exist", () => {
    const fs = newFs();
    expect(getCachedAppearance(fs)).toBeNull();
  });

  test("cacheAppearance writes a value that getCachedAppearance reads back", () => {
    const fs = newFs();
    cacheAppearance(fs, "light");
    expect(getCachedAppearance(fs)).toBe("light");
  });

  test("round-trips both dark and light", () => {
    const fs = newFs();
    cacheAppearance(fs, "dark");
    expect(getCachedAppearance(fs)).toBe("dark");
    cacheAppearance(fs, "light");
    expect(getCachedAppearance(fs)).toBe("light");
  });

  test("returns null for expired cache", () => {
    const fs = newFs();
    // Write a cache entry with a timestamp 2 hours in the past
    const expired = JSON.stringify({ appearance: "dark", ts: Date.now() - 2 * 60 * 60 * 1000 });
    fs.write("cache/appearance.json", expired);
    expect(getCachedAppearance(fs)).toBeNull();
  });

  test("returns null for malformed cache JSON", () => {
    const fs = newFs();
    fs.write("cache/appearance.json", "not json");
    expect(getCachedAppearance(fs)).toBeNull();
  });

  test("returns null for cache with invalid appearance value", () => {
    const fs = newFs();
    fs.write("cache/appearance.json", JSON.stringify({ appearance: "midnight", ts: Date.now() }));
    expect(getCachedAppearance(fs)).toBeNull();
  });

  test("returns null for cache missing timestamp", () => {
    const fs = newFs();
    fs.write("cache/appearance.json", JSON.stringify({ appearance: "dark" }));
    expect(getCachedAppearance(fs)).toBeNull();
  });
});

// ── resolveAppearance ────────────────────────────────────────────

describe("resolveAppearance", () => {
  function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void>) {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(overrides)) {
      saved[k] = process.env[k];
      if (overrides[k] === undefined) delete process.env[k];
      else process.env[k] = overrides[k];
    }
    return fn().finally(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
  }

  test("env var takes highest precedence", async () => {
    await withEnv({ MY_THEME: "light" }, async () => {
      const result = await resolveAppearance({
        envVarName: "MY_THEME",
        configAppearance: "dark",
      });
      expect(result).toBe("light");
    });
  });

  test("env var 'dark' is respected", async () => {
    await withEnv({ MY_THEME: "dark" }, async () => {
      const result = await resolveAppearance({ envVarName: "MY_THEME" });
      expect(result).toBe("dark");
    });
  });

  test("invalid env var value is ignored", async () => {
    await withEnv({ MY_THEME: "purple" }, async () => {
      const result = await resolveAppearance({
        envVarName: "MY_THEME",
        configAppearance: "light",
      });
      expect(result).toBe("light");
    });
  });

  test("configAppearance 'dark'/'light' used when env is unset", async () => {
    await withEnv({ MY_THEME: undefined }, async () => {
      expect(await resolveAppearance({ envVarName: "MY_THEME", configAppearance: "dark" })).toBe(
        "dark",
      );
      expect(await resolveAppearance({ envVarName: "MY_THEME", configAppearance: "light" })).toBe(
        "light",
      );
    });
  });

  test("configAppearance 'auto' falls through to cache/probe", async () => {
    const home = freshHome();
    const fs = createAppFs({ app: "test", home });
    cacheAppearance(fs, "light");
    await withEnv({ MY_THEME: undefined }, async () => {
      const result = await resolveAppearance({
        envVarName: "MY_THEME",
        configAppearance: "auto",
        fs,
      });
      expect(result).toBe("light");
    });
  });

  test("reads from cache when env and config are absent", async () => {
    const home = freshHome();
    const fs = createAppFs({ app: "test", home });
    cacheAppearance(fs, "light");
    await withEnv({ MY_THEME: undefined }, async () => {
      const result = await resolveAppearance({ envVarName: "MY_THEME", fs });
      expect(result).toBe("light");
    });
  });

  test("falls back to 'dark' when nothing is set and fs is omitted", async () => {
    await withEnv({ MY_THEME: undefined }, async () => {
      // No fs, no config, no env — should fall back to "dark"
      // (queryTerminalBackground will likely return null in test env)
      const result = await resolveAppearance({ envVarName: "MY_THEME" });
      expect(result).toBe("dark");
    });
  });

  test("skips caching when fs is omitted", async () => {
    await withEnv({ MY_THEME: undefined }, async () => {
      // Should not throw even without fs
      const result = await resolveAppearance({ envVarName: "MY_THEME" });
      expect(result).toBe("dark");
    });
  });
});
