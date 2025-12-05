/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx,html}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "rgb(var(--color-primary) / <alpha-value>)" },
        bg: "rgb(var(--color-bg) / <alpha-value>)",
        fg: "rgb(var(--color-foreground) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [
    // In ESM you must import plugins, but Tailwind's docs accept require in many setups.
    // If you need pure ESM import syntax, you'd `import typography from '@tailwindcss/typography'`
    // and then include typography in plugins. Many setups still allow require here.
    require("@tailwindcss/typography"),
  ],
};
