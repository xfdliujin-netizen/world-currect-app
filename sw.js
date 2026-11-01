/* 刘诣辰的专属错字本 —— 离线缓存 Service Worker
   策略：页面走「先网络、断网用缓存」；脚本/字数据/图标走「缓存优先」。
   改动 App 后只需把 VER 数字加一，旧缓存会自动清理。

   ⚠️ 手写识别模型（PP-OCRv5，约 16MB）和 onnxruntime 运行时单独放在 MODEL_CACHE 里，
      不随 VER 变化删除 —— 否则每次 App 更新都要重新下载 16MB。
      只有模型 URL 换版本（如 @0.1.4 → @0.2.0）时，才把 MODEL_VER 加一让它重下。 */
const VER = 'czb-v6';
const MODEL_CACHE = 'czb-model-v1';   // 跨 App 版本保留
const KEEP_CACHES = [VER, MODEL_CACHE];

const SHELL = [
  './',
  './index.html',
  './vendor/hanzi-writer.min.js',
  './icon-192.png',
  './apple-touch-icon.png',
  './icon-512.png'
];

/* 内置 18 个字的笔画数据预先缓存，断网也能看笔顺 */
const CHARS = '拔拨候具侯虐贯琴炙初隆暇冕赢即既戴带'.split('');
const DATA = CHARS.map(function (c) {
  return 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/' + encodeURIComponent(c) + '.json';
});

const CDN_HOSTS = ['cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'unpkg.com'];

self.addEventListener('install', function (e) {
  e.waitUntil((async function () {
    const cache = await caches.open(VER);
    await Promise.all(SHELL.map(function (u) {
      return cache.add(new Request(u, { cache: 'reload' })).catch(function () {});
    }));
    /* 字数据逐个加，个别失败不影响整体 */
    await Promise.all(DATA.map(function (u) {
      return fetch(u, { mode: 'cors' })
        .then(function (r) { if (r && r.ok) return cache.put(u, r); })
        .catch(function () {});
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(keys.map(function (k) {
      return KEEP_CACHES.indexOf(k) >= 0 ? null : caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* 页面：先网络（保证更新及时），断网回退缓存 */
  if (req.mode === 'navigate') {
    e.respondWith((async function () {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(VER);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (err) {
        const cache = await caches.open(VER);
        return (await cache.match(req)) || (await cache.match('./index.html')) || (await cache.match('./'));
      }
    })());
    return;
  }

  /* 手写识别模型 + onnxruntime 运行时：单独缓存，缓存优先，跨 App 版本永久保留 */
  if (/PP-OCRv5_rec_mobile|onnxruntime-web/.test(url.href)) {
    e.respondWith((async function () {
      const cache = await caches.open(MODEL_CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch (err) {
        return hit || Response.error();
      }
    })());
    return;
  }

  /* 同源静态文件 + CDN 脚本/字数据：缓存优先，命中就不再走网络 */
  const sameOrigin = url.origin === location.origin;
  if (sameOrigin || CDN_HOSTS.indexOf(url.hostname) >= 0) {
    e.respondWith((async function () {
      const cache = await caches.open(VER);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch (err) {
        return hit || Response.error();
      }
    })());
  }
});
