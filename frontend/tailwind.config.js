/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Stone neutrals (from KayKit dungeon texture) ──
        stone: {
          950: "#0e0e10",
          900: "#1a1a1e",
          850: "#252428",
          800: "#2e2c30",
          700: "#484448",
          600: "#5a5a5a",
          500: "#706058",
          400: "#8a7e74",
          300: "#9a9ea4",
          200: "#d0d0d0",
          100: "#e8e0d4",
          50: "#f8f0e0",
        },
        // ── Gold primary (from KayKit dungeon texture) ──
        gold: {
          DEFAULT: "#e0a030",
          50: "#fef7e6",
          100: "#fdecc4",
          200: "#f9d580",
          300: "#f0c838",
          400: "#e0a030",
          500: "#c87838",
          600: "#b87848",
          700: "#a06030",
          800: "#7a4820",
          900: "#503010",
        },
        // ── Semantic colors (from KayKit dungeon texture accents) ──
        danger: {
          DEFAULT: "#c82030",
          light: "#f06078",
          dark: "#8a1520",
          bg: "rgba(200, 32, 48, 0.15)",
        },
        success: {
          DEFAULT: "#20b070",
          light: "#58c020",
          dark: "#14704a",
          bg: "rgba(32, 176, 112, 0.15)",
        },
        warning: {
          DEFAULT: "#f08038",
          light: "#f0c838",
          dark: "#8a4820",
          bg: "rgba(240, 128, 56, 0.15)",
        },
        info: {
          DEFAULT: "#4090e0",
          light: "#30c8d0",
          dark: "#203870",
          bg: "rgba(64, 144, 224, 0.15)",
        },
        // ── Accent colors (for game elements, future mode theming) ──
        accent: {
          purple: "#582880",
          magenta: "#a01050",
          cyan: "#30c8d0",
          teal: "#18a880",
          coral: "#f08060",
        },
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
        mono: ["var(--font-mono)"],
        sans: ["var(--font-body)"],
      },
      keyframes: {
        "dropdown-enter": {
          from: { opacity: "0", transform: "translateY(-4px) scale(0.97)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "toast-slide-in": {
          from: { opacity: "0", transform: "translateX(-100%)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "toast-slide-out": {
          from: { opacity: "1", transform: "translateX(0)" },
          to: { opacity: "0", transform: "translateX(-100%)" },
        },
      },
      animation: {
        "dropdown-enter": "dropdown-enter 150ms ease-out",
        "toast-in": "toast-slide-in 200ms ease-out both",
        "toast-out": "toast-slide-out 200ms ease-in both",
      },
    },
  },
  plugins: [
    require("@tailwindcss/typography"),
  ],
};
