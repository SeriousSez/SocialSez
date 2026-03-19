importScripts('./ngsw-worker.js');

const CACHE_NAME = 'venli-v1';

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then(keys =>
                Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
            )
        ])
    );
});

self.addEventListener('backgroundfetchsuccess', (event) => {
    event.waitUntil((async () => {
        const reg = event.registration;
        let succeeded = true;

        try {
            const records = await reg.matchAll();
            await Promise.all(records.map(record =>
                record.responseReady
                    .then(response => {
                        if (!response.ok) throw new Error(`HTTP ${response.status}`);
                        return response.text();
                    })
                    .catch(() => { succeeded = false; })
            ));
        } catch {
            succeeded = false;
        }

        if (succeeded) {
            await notifyClients({ type: 'REEL_UPLOAD_STATUS', id: reg.id, state: 'success', message: 'Reel uploaded successfully.' });
            await showNotification('Reel uploaded ✓', 'Your reel is now live.', reg.id);
        } else {
            await notifyClients({ type: 'REEL_UPLOAD_STATUS', id: reg.id, state: 'failed', message: 'Reel upload failed. Please try again.' });
            await showNotification('Reel upload failed', 'Something went wrong. Please try again.', reg.id);
        }
    })());
});

self.addEventListener('backgroundfetchfail', (event) => {
    const reg = event.registration;
    event.waitUntil((async () => {
        await notifyClients({ type: 'REEL_UPLOAD_STATUS', id: reg.id, state: 'failed', message: 'Reel upload failed. Please try again.' });
        await showNotification('Reel upload failed', 'Something went wrong. Please try again.', reg.id);
    })());
});

self.addEventListener('backgroundfetchabort', (event) => {
    event.waitUntil(
        notifyClients({ type: 'REEL_UPLOAD_STATUS', id: event.registration.id, state: 'failed', message: 'Reel upload was cancelled.' })
    );
});

self.addEventListener('backgroundfetchclick', (event) => {
    event.waitUntil(self.clients.openWindow('/'));
});

async function notifyClients(message) {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
        client.postMessage(message);
    }
}

async function showNotification(title, body, tag) {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        await self.registration.showNotification(title, { body, icon: '/favicon.ico', badge: '/favicon.ico', tag });
    }
}
