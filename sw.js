/* ============================================================
   《圖書館熄燈後》Service Worker — PWA 離線支援
   策略：
   - 程式檔（html/css/js）→ 網路優先、離線退回快取：push 部署後一上線就拿到新版
   - 資產（images/ bgm/ icons/ vendor/）→ 快取優先、首次取用時寫入：重載秒開、離線可玩
   - 跨網域（Firebase 等）一律不攔
   改版若要強制全部重抓，把 VERSION 加一即可。
   ============================================================ */
const VERSION = "wj-v2";
const CORE = [
  "./", "./index.html", "./teacher.html", "./style.css",
  "./game.js", "./data.js", "./audio.js", "./coop.js",
  "./vendor/gsap.min.js", "./manifest.json",
  "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;            // Firebase / 字型等外部請求不攔

  const isAsset = /\/(images|bgm|icons|vendor)\//.test(url.pathname);
  if (isAsset) {
    // 快取優先：圖與音樂大且少變動
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }
  // 程式與頁面：網路優先（部署即更新），離線退回快取
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() =>
      caches.match(req).then(hit => hit || (req.mode === "navigate" ? caches.match("./index.html") : Response.error()))
    )
  );
});
