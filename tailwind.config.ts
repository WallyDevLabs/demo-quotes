import type { Config } from "tailwindcss";

// Colours are CSS variables (see globals.css) so light and dark themes share one set of classes.
// Palette from docs/design/DESIGN.md (CraftLedger).
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: v("canvas"),
        surface: v("surface"),
        recessed: v("recessed"),
        line: v("line"),
        ink: { DEFAULT: v("ink"), muted: v("ink-muted") },
        primary: { DEFAULT: v("primary"), hover: v("primary-hover"), soft: v("primary-soft"), ink: v("primary-ink") },
        profit: { DEFAULT: v("profit"), soft: v("profit-soft"), ink: v("profit-ink") },
        caution: { DEFAULT: v("caution"), soft: v("caution-soft"), ink: v("caution-ink") },
        cost: { DEFAULT: v("cost"), soft: v("cost-soft"), ink: v("cost-ink") },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: { DEFAULT: "0.25rem", md: "0.375rem", lg: "0.5rem", xl: "0.75rem" },
      boxShadow: {
        raised: "0 4px 12px -2px rgba(15,23,42,.06), 0 2px 6px -1px rgba(15,23,42,.04)",
        dock: "0 -8px 25px -5px rgba(15,23,42,.12), 0 8px 10px -6px rgba(15,23,42,.04)",
      },
    },
  },
  plugins: [],
};

export default config;
