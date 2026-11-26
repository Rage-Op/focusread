/**
 * Service Worker for FocusRead PWA v6
 * Network-first for app files, cache fallback for offline
 */

const CACHE_NAME = 'focusread-v7';

const APP_FILES = [
    './',
    './index.html',
    './css/styles.css',
    './js/app.js',
    './js/pin.js',
    './js/pdf-handler.js',
    './js/storage.js',
    './js/bionic.js',
    './js/rsvp.js',
    './js/tts.js',
    './js/kokoro-tts.js',
    './js/kokoro-worker.js',
    './js/settings.js',
    './js/search.js',
    './js/firebase-config.js',
    './js/firebase-sync.js',
    './manifest.json'
];

const EXTERNAL_ASSETS = [
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return Promise.all([
                cache.addAll(APP_FILES),
                ...EXTERNAL_ASSETS.map(url => 
                    cache.add(url).catch(err => console.log('Cache miss:', url))
                )
            ]);
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name.startsWith('focusread-v') && name !== CACHE_NAME)
                        .map((name) => caches.delete(name))
                );
            }),
            self.clients.claim()
        ]).then(() => {
            return self.clients.matchAll({ type: 'window' }).then(clients => {
                clients.forEach(client => {
                    client.postMessage({ type: 'SW_ACTIVATED', version: CACHE_NAME });
                });
            });
        })
    );
});

function isAppFile(url) {
    const path = new URL(url).pathname;
    return path.endsWith('.html') || 
           path.endsWith('.js') || 
           path.endsWith('.css') ||
           path.endsWith('/') ||
           path === '' ||
           !path.includes('.');
}

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    
    const url = new URL(event.request.url);
    
    if (url.origin !== location.origin && 
        !url.href.includes('cdnjs.cloudflare.com') &&
        !url.href.includes('fonts.')) {
        return;
    }
    
    if (url.href.includes('fonts.googleapis.com') || 
        url.href.includes('fonts.gstatic.com') ||
        url.href.includes('fonts.cdnfonts.com')) {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((cached) => {
                    if (cached) return cached;
                    return fetch(event.request).then((response) => {
                        cache.put(event.request, response.clone());
                        return response;
                    });
                });
            })
        );
        return;
    }
    
    if (isAppFile(event.request.url)) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response && response.status === 200) {
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseToCache);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    return caches.match(event.request).then((cached) => {
                        if (cached) return cached;
                        if (event.request.destination === 'document') {
                            return caches.match('./index.html');
                        }
                        return new Response('Offline', { status: 503 });
                    });
                })
        );
        return;
    }
    
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            
            return fetch(event.request).then((response) => {
                if (!response || response.status !== 200) {
                    return response;
                }
                
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
                
                return response;
            });
        })
    );
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data?.type === 'CHECK_UPDATE') {
        self.registration.update();
    }
});
