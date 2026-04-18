const CACHE = 'examenes-v2';
const FILES = ['./index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    await checkAndNotify();
  })());
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('./'));
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SCHEDULE_CHECK') {
    saveToIDB(e.data.examenes, e.data.config).then(() => checkAndNotify());
  }
});

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('examenes-sw', 1);
    req.onupgradeneeded = ev => ev.target.result.createObjectStore('data', { keyPath: 'id' });
    req.onsuccess = ev => resolve(ev.target.result);
    req.onerror = reject;
  });
}

function idbGet(store, key) {
  return new Promise(r => { const req = store.get(key); req.onsuccess = () => r(req.result); req.onerror = () => r(null); });
}

async function saveToIDB(examenes, config) {
  const db = await openDB();
  const tx = db.transaction('data', 'readwrite');
  const st = tx.objectStore('data');
  st.put({ id: 'examenes', value: examenes });
  st.put({ id: 'config', value: config });
}

async function checkAndNotify() {
  try {
    const db = await openDB();
    const tx = db.transaction('data', 'readonly');
    const st = tx.objectStore('data');
    const exRec = await idbGet(st, 'examenes');
    const cfgRec = await idbGet(st, 'config');
    if (!exRec || !cfgRec) return;

    const examenes = exRec.value || [];
    const config = cfgRec.value || {};
    const ahora = new Date();
    const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    const hoyStr = ahora.toISOString().split('T')[0];

    const tx2 = db.transaction('data', 'readonly');
    const st2 = tx2.objectStore('data');
    const yaNotifHoy = await idbGet(st2, 'notif-' + hoyStr);
    if (yaNotifHoy) return;

    const notifs = [];
    examenes.forEach(ex => {
      const dias = Math.round((new Date(ex.fecha + 'T00:00:00') - hoy) / 86400000);
      if (dias === 0) {
        notifs.push({ title: '📚 ¡Examen HOY!', body: ex.materia + (ex.hora ? ' · ' + ex.hora : ''), tag: 'hoy-' + ex.materia });
      } else if (dias === 1) {
        notifs.push({ title: '⚠️ Examen mañana', body: ex.materia, tag: 'man-' + ex.materia });
      } else if (dias > 1 && dias <= (config.dias || 7)) {
        notifs.push({ title: `📅 Examen en ${dias} días`, body: ex.materia, tag: 'prox-' + ex.materia });
      }
    });

    for (const n of notifs) {
      await self.registration.showNotification(n.title, {
        body: n.body, tag: n.tag,
        icon: './icon-192.png', badge: './icon-192.png',
        vibrate: [300, 100, 300, 100, 300],
        data: { url: './' }
      });
    }

    if (notifs.length > 0) {
      const tx3 = db.transaction('data', 'readwrite');
      tx3.objectStore('data').put({ id: 'notif-' + hoyStr, value: true });
    }
  } catch(e) { console.log('SW check error', e); }
}
