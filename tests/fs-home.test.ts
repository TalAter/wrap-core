import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createAppHome } from "../src/fs/index.ts";
import { tmpHome } from "./helpers.ts";

/**
 * Track every tmpHome we hand out so each test cleans up after itself
 * without each test having to manage its own afterEach.
 */
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
});

describe("createAppHome — root resolution", () => {
  // Parameterized over three names: pins the uppercase + `-` → `_` env-var
  // derivation rule and the default-dir-name rule.
  for (const app of ["wrap", "sweep", "my-tool"] as const) {
    const envKey = app.toUpperCase().replace(/-/g, "_") + "_HOME";

    describe(`app: "${app}"`, () => {
      test(`uses $${envKey} when set`, () => {
        const home = freshHome();
        const fs = createAppHome({ app, env: { [envKey]: home } });
        expect(fs.root).toBe(home);
      });

      test(`falls back to ~/.${app} when env unset, undefined, or empty`, () => {
        const expected = join(homedir(), `.${app}`);
        expect(createAppHome({ app, env: {} }).root).toBe(expected);
        expect(createAppHome({ app, env: { [envKey]: undefined } }).root).toBe(expected);
        expect(createAppHome({ app, env: { [envKey]: "" } }).root).toBe(expected);
      });

      test(`opts.home overrides env`, () => {
        const home = freshHome();
        const fs = createAppHome({
          app,
          home,
          env: { [envKey]: "/should/be/ignored" },
        });
        expect(fs.root).toBe(home);
      });
    });
  }

  test("root is captured at construction (not lazy)", () => {
    const home = freshHome();
    const env = { WRAP_HOME: home };
    const fs = createAppHome({ app: "wrap", env });
    env.WRAP_HOME = "/changed/after/construction";
    expect(fs.root).toBe(home);
  });
});

describe("createAppHome — validation", () => {
  test("throws on app names not matching /^[a-z][a-z0-9-]*$/", () => {
    for (const bad of ["", "Wrap", "1wrap", "-wrap", "wrap_tool", "wrap.tool", "wrap/x"]) {
      expect(() => createAppHome({ app: bad })).toThrow(`createAppHome: invalid app name ${bad}`);
    }
  });

  test("validates app even when opts.home is supplied", () => {
    expect(() => createAppHome({ app: "Bad", home: "/tmp/whatever" })).toThrow(
      "createAppHome: invalid app name Bad",
    );
  });

  test("accepts lowercase letters, digits, and hyphens", () => {
    for (const good of ["wrap", "sweep", "my-tool", "x", "a1", "a-b-c-9"]) {
      expect(() => createAppHome({ app: good, env: {} })).not.toThrow();
    }
  });

  test("throws when opts.home is a non-absolute path", () => {
    expect(() => createAppHome({ app: "wrap", home: "relative/path" })).toThrow();
    expect(() => createAppHome({ app: "wrap", home: "./rel" })).toThrow();
  });

  test("treats empty-string opts.home as unset (falls through to env/default)", () => {
    const home = freshHome();
    expect(isAbsolute(home)).toBe(true);
    const fs = createAppHome({ app: "wrap", home: "", env: { WRAP_HOME: home } });
    expect(fs.root).toBe(home);
  });
});

describe("AppHome — IO", () => {
  function newFs() {
    const home = freshHome();
    return { home, fs: createAppHome({ app: "wrap", home }) };
  }

  test("resolve joins root with relative path", () => {
    const { home, fs } = newFs();
    expect(fs.resolve("a/b.txt")).toBe(join(home, "a/b.txt"));
  });

  test("read returns null for missing file", () => {
    const { fs } = newFs();
    expect(fs.read("nope.txt")).toBeNull();
  });

  test("read returns empty string for an existing empty file", () => {
    const { fs } = newFs();
    fs.write("empty.txt", "");
    expect(fs.read("empty.txt")).toBe("");
  });

  test("read rethrows non-ENOENT errors (EISDIR)", () => {
    const { home, fs } = newFs();
    mkdirSync(join(home, "actually-a-dir"));
    expect(() => fs.read("actually-a-dir")).toThrow(/EISDIR/);
  });

  test("write + read round-trip", () => {
    const { home, fs } = newFs();
    fs.write("greeting.txt", "hello");
    expect(fs.read("greeting.txt")).toBe("hello");
    expect(readFileSync(join(home, "greeting.txt"), "utf-8")).toBe("hello");
  });

  test("write creates nested parent directories", () => {
    const { home, fs } = newFs();
    fs.write("cache/models.dev.json", '{"ok":1}');
    expect(existsSync(join(home, "cache"))).toBe(true);
    expect(fs.read("cache/models.dev.json")).toBe('{"ok":1}');
  });

  test("write overwrites existing content", () => {
    const { fs } = newFs();
    fs.write("greeting.txt", "first");
    fs.write("greeting.txt", "second");
    expect(fs.read("greeting.txt")).toBe("second");
  });

  test("append creates file then appends", () => {
    const { fs } = newFs();
    fs.append("logs/app.log", "line1\n");
    fs.append("logs/app.log", "line2\n");
    expect(fs.read("logs/app.log")).toBe("line1\nline2\n");
  });

  test("append creates parent directories", () => {
    const { home, fs } = newFs();
    fs.append("deeply/nested/dir/file.log", "x\n");
    expect(existsSync(join(home, "deeply/nested/dir"))).toBe(true);
  });

  test("exists returns true for existing files", () => {
    const { fs } = newFs();
    fs.write("x.txt", "y");
    expect(fs.exists("x.txt")).toBe(true);
  });

  test("exists returns true for existing directories", () => {
    const { home, fs } = newFs();
    mkdirSync(join(home, "subdir"));
    expect(fs.exists("subdir")).toBe(true);
  });

  test("exists returns false for missing paths", () => {
    const { fs } = newFs();
    expect(fs.exists("never")).toBe(false);
  });

  test("root is not created on disk at construction", () => {
    // Construct with a home dir whose parent exists but the dir itself doesn't.
    const parent = freshHome();
    const home = join(parent, "not-yet");
    const fs = createAppHome({ app: "wrap", home });
    expect(fs.root).toBe(home);
    expect(existsSync(home)).toBe(false);
    // First write transitively mkdir -p's it.
    fs.write("hello.txt", "hi");
    expect(existsSync(home)).toBe(true);
    expect(fs.read("hello.txt")).toBe("hi");
  });
});
