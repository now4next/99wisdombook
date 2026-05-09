// Service Worker - 99 Wisdom Book Web Push
const CACHE_NAME = 'wisdom-sw-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// 푸시 수신
self.addEventListener('push', event => {
  let data = {
    title: '📚 오늘의 Daily Wisdom',
    body: '오늘의 한 문장이 도착했습니다.',
    url: '/?autoopen=1',
  };
  try { data = { ...data, ...event.data.json() }; } catch (_) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/og-image.png',
      badge: '/og-image.png',
      tag: 'wisdom-daily',
      renotify: true,
      requireInteraction: false,
      data: { url: data.url },
    })
  );
});

// 알림 클릭
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
