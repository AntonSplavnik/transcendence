/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        wood: {
          900: "#1c1917", // Very dark wood (Main Background)
          800: "#292524", // Dark wood (Panels/Cards)
          700: "#44403c", // Borders
          300: "#d6d3d1", // Secondary Text
          100: "#f5f5f4", // Primary Text
        },
        primary: {
          DEFAULT: "#d97706", // Amber 600 (Varnish/Gold)
          hover: "#b45309",   // Amber 700
          text: "#fffbeb",    // Amber 50
        }
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
      },
      backgroundImage: {
        'wood-pattern': "url('https://www.transparenttextures.com/patterns/wood-pattern.png')", // Optional subtle texture
      }
    },
  },
  plugins: [
    require("@tailwindcss/typography"),
  ],
};
