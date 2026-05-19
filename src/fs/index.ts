import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

/**
 * Filesystem handle scoped to a single app's home directory (e.g. `~/.wrap`,
 * `~/.sweep`). Constructed once per process by `createAppHome`; `root` is
 * captured at construction time. All IO is sync utf-8 text.
 */
export type AppHome = {
  /** Absolute path of the app-home root. Captured at construction. */
  root: string;
  /** Join `root` with a relative path. No `..`-escape guarding — callers are trusted. */
  resolve(relPath: string): string;
  /**
   * Read a file under `root`. Returns `null` if the file does not exist; an
   * existing empty file returns `""`. Other errors (EISDIR, EACCES, …) throw.
   */
  read(relPath: string): string | null;
  /** Write a file under `root`, creating parent directories as needed. Overwrites. */
  write(relPath: string, content: string): void;
  /** Append to a file under `root`, creating parent directories as needed. */
  append(relPath: string, content: string): void;
  /** True if any path (file, dir, symlink) exists at `relPath` under `root`. */
  exists(relPath: string): boolean;
};

const APP_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * Construct an `AppHome` for the given app. App identity is explicit at the
 * API surface — core has no hardcoded knowledge of any consumer.
 *
 * Resolution precedence (at construction): `opts.home` → `opts.env[<APP>_HOME]`
 * → `~/.<app>`. `||` semantics: empty string at any level falls through to the
 * next, matching wrap's historical `getWrapHome` behavior.
 *
 * `app` must match `/^[a-z][a-z0-9-]*$/` regardless of whether `opts.home` is
 * supplied — the name is part of the API identity, not just env-key input.
 *
 * `opts.home`, when non-empty, must be absolute.
 */
export function createAppHome(opts: {
  /** App identifier, e.g. `"wrap"`, `"sweep"`. Must match `/^[a-z][a-z0-9-]*$/`. */
  app: string;
  /** Explicit absolute path override (primarily for tests). */
  home?: string;
  /** Env source. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}): AppHome {
  const { app, home, env = process.env } = opts;
  if (!APP_NAME.test(app)) {
    throw new Error(`createAppHome: invalid app name ${app}`);
  }
  if (home && !isAbsolute(home)) {
    throw new Error(`createAppHome: opts.home must be an absolute path, got ${home}`);
  }

  const envKey = `${app.toUpperCase().replace(/-/g, "_")}_HOME`;
  const root = home || env[envKey] || join(homedir(), `.${app}`);

  function resolve(relPath: string): string {
    return join(root, relPath);
  }
  function ensureParent(absPath: string): void {
    mkdirSync(dirname(absPath), { recursive: true });
  }

  return {
    root,
    resolve,
    read(relPath) {
      try {
        return readFileSync(resolve(relPath), "utf-8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    write(relPath, content) {
      const path = resolve(relPath);
      ensureParent(path);
      writeFileSync(path, content);
    },
    append(relPath, content) {
      const path = resolve(relPath);
      ensureParent(path);
      appendFileSync(path, content);
    },
    exists(relPath) {
      return existsSync(resolve(relPath));
    },
  };
}
