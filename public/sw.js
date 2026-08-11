const CACHE_NAME = "albayati-shell-v1";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icons/favicon-32.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }

  if (url.pathname.startsWith("/icons/") || url.pathname.startsWith("/fonts/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return response;
    })));
  }
});

self.addEventListener("push", (event) => {
  const fallback = { title: "نظام البياتي", body: "لديك تحديث جديد يحتاج المتابعة.", url: "/" };
  let payload = fallback;
  try {
    payload = { ...fallback, ...(event.data ? event.data.json() : {}) };
  } catch {
    payload = { ...fallback, body: event.data ? event.data.text() : fallback.body };
  }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/favicon-32.png",
    tag: payload.tag || "albayati-update",
    data: { url: payload.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const openClient = clients.find((client) => client.url.startsWith(self.location.origin));
    if (openClient) {
      openClient.navigate(targetUrl);
      return openClient.focus();
    }
    return self.clients.openWindow(targetUrl);
  }));
});
