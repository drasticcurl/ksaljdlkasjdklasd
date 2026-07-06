import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Paleta base de la pantalla del editor (fondo oscuro estilo estudio).
        editor: {
          bg: '#0f1115',
          panel: '#1a1d24',
          border: '#2a2f3a',
          accent: '#6366f1',
        },
      },
    },
  },
  plugins: [],
};

export default config;
