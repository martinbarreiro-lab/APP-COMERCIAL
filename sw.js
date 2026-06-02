// Service Worker mínimo — La Cabaña PWA
// Permite que la app sea instalable. No cachea de forma agresiva
// para que los cambios en Vercel se vean siempre.

self.addEventListener('install', (e) => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (e) => {
  // Estrategia "network first": siempre intenta traer la versión nueva.
  // Si no hay red, no rompe (deja pasar el error normal del navegador).
  return
})
