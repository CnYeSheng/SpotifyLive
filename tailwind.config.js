/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx,vue}",
  ],
  theme: {
    extend: {
      colors: {
        spotify: {
          black: '#191414',
          green: '#1DB954',
          darkgray: '#282828',
          lightgray: '#B3B3B3',
        },
      },
      fontFamily: {
        sans: ['Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
