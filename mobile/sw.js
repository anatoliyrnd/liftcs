const CACHE_NAME = "lift-mobile-v1";

// Список файлов, которые нужны для запуска (App Shell)
const ASSETS_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./main.js",
  "./api.js",
  "./api-service.js",
  "./auth-store.js",
  "./config.js",
  "./sync-manager.js",
  "./offline-db.js",

  "./controllers/list-controller.js",
  "./controllers/card-controller.js",

  "./components/image-compressor.js",
  "./components/network-led.js",
  "./components/api-status.js",
  "./utils/webgl-fingerprint.js",

  "../js/vendor/idb.js",
];

// 1. Установка (кэшируем файлы)
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Кэширование файлов оболочки");
      // Кэшируем каждый файл отдельно, чтобы падение одного (404) не ломало всё
      return Promise.all(
        ASSETS_TO_CACHE.map((url) => {
          return cache.add(url).catch((err) => {
            console.warn("[SW] Не удалось закэшировать:", url, err);
          });
        }),
      );
    }),
  );
  self.skipWaiting();
});

// 2. Активация (удаляем старый кэш, если версия изменилась)
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log("[SW] Удаление старого кэша:", cache);
            return caches.delete(cache);
          }
        }),
      );
    }),
  );
  self.clients.claim();
});

// 3. Перехват запросов
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Запросы к API (test_calls.php, auth_stub.php) НЕ кэшируем, пускаем напрямую в сеть
  if (event.request.method !== "GET" || url.pathname.endsWith(".php")) {
    return;
  }

  // Для всех остальных файлов (HTML, CSS, JS): Сначала ищем в кэше, если нет — идем в сеть
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request)
        .then((response) => {
          // Если скачали успешно — обновляем кэш
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Если сети нет и файла нет в кэше, а запрос на HTML-страницу — отдаем index.html
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
        });
    }),
  );
});
