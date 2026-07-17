// Service worker mínimo — existe só para o navegador considerar o site
// "instalável" (adicionar à tela inicial). Não guarda nada em cache de
// propósito: os dados (agendamentos, preços) vêm sempre direto do Supabase
// em tempo real, e cachear isso mostraria informação desatualizada.
self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});
