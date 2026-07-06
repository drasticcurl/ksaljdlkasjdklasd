/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // La Interfaz corre en localhost:3000 y consume el backend en localhost:8000.
  // La URL base del backend se inyecta en tiempo de build/ejecución vía la
  // variable pública NEXT_PUBLIC_API_BASE_URL (ver lib/api.ts).
  env: {
    NEXT_PUBLIC_API_BASE_URL:
      process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000',
  },
};

module.exports = nextConfig;
