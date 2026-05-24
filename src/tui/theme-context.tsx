import { defaultTheme, extendTheme, ThemeProvider as InkUIThemeProvider } from "@inkjs/ui";
import { createContext, type ReactNode, useContext } from "react";
import { resolveColorHex } from "../ansi/index.ts";
import type { CoreThemeTokens } from "../theme/index.ts";

type TuiContext = {
  theme: CoreThemeTokens;
  nerdFonts: boolean;
};

const TuiCtx = createContext<TuiContext | null>(null);

function buildInkUITheme(t: CoreThemeTokens) {
  const focused = resolveColorHex(t.picker.optionFocused);
  const idle = resolveColorHex(t.picker.option);
  const selected = resolveColorHex(t.picker.optionSelected);
  const focusIndicator = resolveColorHex(t.picker.focusIndicator);
  const selectedIndicator = resolveColorHex(t.picker.selectedIndicator);
  return extendTheme(defaultTheme, {
    components: {
      Select: {
        styles: {
          focusIndicator: () => ({ color: focusIndicator }),
          selectedIndicator: () => ({ color: selectedIndicator }),
          label: ({ isFocused, isSelected }: { isFocused: boolean; isSelected: boolean }) => ({
            color: isFocused ? focused : isSelected ? selected : idle,
          }),
        },
      },
    },
  });
}

export function ThemeProvider({
  theme,
  nerdFonts,
  children,
}: {
  theme: CoreThemeTokens;
  nerdFonts: boolean;
  children: ReactNode;
}) {
  return (
    <TuiCtx.Provider value={{ theme, nerdFonts }}>
      <InkUIThemeProvider theme={buildInkUITheme(theme)}>{children}</InkUIThemeProvider>
    </TuiCtx.Provider>
  );
}

export function useTheme(): CoreThemeTokens {
  const ctx = useContext(TuiCtx);
  if (!ctx) throw new Error("useTheme() must be inside <ThemeProvider>");
  return ctx.theme;
}

export function useNerdFonts(): boolean {
  const ctx = useContext(TuiCtx);
  if (!ctx) throw new Error("useNerdFonts() must be inside <ThemeProvider>");
  return ctx.nerdFonts;
}
