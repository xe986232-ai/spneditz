/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        graphite: "#15171C",
        panel: "#1E2126",
        rec: "#E14C4C",
        paper: "#ECEAE4",
        mute: "#868C96",
      },
    },
  },
  plugins: [],
};
