import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'sidecarmaster',
    short_name: 'sidecarmaster',
    description: 'Master and provisioning service for the management sidecars',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#3730A3',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
