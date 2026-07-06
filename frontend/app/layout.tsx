import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Editor de Shorts Verticales',
  description:
    'Aplicación local para unir clips, cortar silencios, transcribir, subtitular y mezclar música en shorts verticales 9:16.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
