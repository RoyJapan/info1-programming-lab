// 公開のたびに CACHE_NAME と ?v= を上げる。?v= は index.html と app.js の import とそろえる（テストで確認）。
const CACHE_NAME = "info1-programming-lab-v6";
const APP_FILES = [
  "./",
  "./index.html",
  "./styles.css?v=6",
  "./app.js?v=6",
  "./runtime.js?v=6",
  "./lessons.js?v=6",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES.map((url) => new Request(url, { cache: "reload" })))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("info1-programming-lab-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    // GitHub Pages は10分キャッシュさせるため、毎回サーバーに更新を確認する（変更がなければ304で軽い）。
    fetch(event.request, { cache: "no-cache" }).then((response) => {
      // respondWith に渡した後では本文を読めないため、先に複製しておく。
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
