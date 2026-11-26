/**
 * Service Worker for FocusRead PWA
 * Provides offline support and caching
 */

const CACHE_NAME = 'focusread-v1';

const STATIC_ASSETS = [
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
    './js/settings.js',
    './js/search.js',
    './manifest.json'
];

const EXTERNAL_ASSETS = [
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return Promise.all([
                cache.addAll(STATIC_ASSETS),
                ...EXTERNAL_ASSETS.map(url => 
                    cache.add(url).catch(err => console.log('Failed to cache:', url, err))
                )
            ]);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    
    if (event.request.url.includes('fonts.googleapis.com') || 
        event.request.url.includes('fonts.gstatic.com') ||
        event.request.url.includes('fonts.cdnfonts.com')) {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((response) => {
                    if (response) return response;
                    
                    return fetch(event.request).then((fetchResponse) => {
                        cache.put(event.request, fetchResponse.clone());
                        return fetchResponse;
                    });
                });
            })
        );
        return;
    }
    
    event.respondWith(
        caches.match(event.request).then((response) => {
            if (response) {
                return response;
            }
            
            return fetch(event.request).then((fetchResponse) => {
                if (!fetchResponse || fetchResponse.status !== 200 || fetchResponse.type !== 'basic') {
                    return fetchResponse;
                }
                
                const responseToCache = fetchResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
                
                return fetchResponse;
            }).catch(() => {
                if (event.request.destination === 'document') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});
