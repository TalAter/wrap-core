---
name: theme-extensibility
description: How consumers extend CoreThemeTokens with tool-specific tokens — intersection types + wrapper hook pattern.
---

# Theme extensibility

Core defines `CoreThemeTokens` as a `type` (not `interface`) containing token groups for core's shipped components: `copy`, `dialog`, `input`, `actionBar`, `checklist`, `picker`. Consumers add tool-specific tokens via TypeScript intersection types.

## Why `type` not `interface`

`interface` allows declaration merging — any file can `declare interface CoreThemeTokens { wizard: ... }` and widen the type globally. This breaks the boundary: core components could accidentally access tool-specific fields without a compile error. `type` prevents this; extension requires an explicit new type.

## Pattern

**1. Consumer defines an extended type:**

```ts
type WrapTheme = CoreThemeTokens & {
  wizard: { frame: FrameStops; labelPill: TokenPair; ... };
  risk: { low: { frame: FrameStops; pill: TokenPair }; ... };
  dialog: CoreThemeTokens["dialog"] & { plan: ColorRef; foldIndicator: TokenPair; ... };
};
```

Widening `dialog` uses `CoreThemeTokens["dialog"] & { ... }` to add fields to an existing group.

**2. Consumer builds extended palettes:**

```ts
const WRAP_DARK: WrapTheme = {
  ...DARK_CORE,
  wizard: { ... },
  risk: { ... },
  dialog: { ...DARK_CORE.dialog, plan: [120, 180, 255], ... },
};
```

**3. `setTheme` accepts the extended type** — structural typing. No cast needed at the set site.

**4. Consumer defines one wrapper hook:**

```ts
// wrap/src/tui/hooks.ts — defined once, imported by all wrap-specific components
export const useWrapTheme = () => useTheme() as WrapTheme;
export const getWrapTheme = () => getTheme() as WrapTheme;
```

The `as WrapTheme` cast is safe because wrap controls what it passes to `setTheme`/`ThemeProvider`. Centralizing it in one file avoids scattered casts.

**5. Core components use `useTheme()` → `CoreThemeTokens`.** They see only the base fields. Attempting to access `theme.wizard` is a compile error inside core — enforced by the type system, not convention.

## What lives where

| Concern | Location |
| --- | --- |
| `CoreThemeTokens` type, `DARK_CORE`/`LIGHT_CORE` palettes | `wrap-core/theme` |
| `useTheme(): CoreThemeTokens`, `ThemeProvider` | `wrap-core/tui` |
| `WrapTheme` type, `WRAP_DARK`/`WRAP_LIGHT` palettes | wrap's `src/core/theme.ts` |
| `useWrapTheme()` wrapper hook | wrap's `src/tui/hooks.ts` |
| Components reading `wizard`/`risk`/`forget` tokens | wrap's `src/tui/` (never in core) |
