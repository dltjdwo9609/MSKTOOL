/* 규범 대조 평가 프로그램 — 서비스 워커 (앱 셸 오프라인 캐시)

   · 같은 출처(정적 파일)만 다룹니다. 구글 Apps Script(script.google.com)처럼 외부로 나가는
     API 요청은 가로채지도, 캐시하지도 않습니다. 회원 기록 동기화는 언제나 네트워크로 나갑니다.
   · index.html 은 네트워크 우선(network-first) → 새로 올린 버전이 바로 반영됩니다.
     오프라인이면 마지막으로 받은 index.html 로 앱을 엽니다.
   · 아이콘·manifest 같은 정적 파일은 stale-while-revalidate → 빠르게 보여 주고 뒤에서 갱신합니다.
   · VERSION 은 build.py 가 index.html 내용 해시로 바꿔 넣습니다. 내용이 바뀌면 새 캐시를 만들고
     예전 캐시(pne-shell-*)는 activate 에서 지웁니다.
*/
const VERSION = 'f781f05b12';
const CACHE = 'pne-shell-' + VERSION;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k !== CACHE && k.indexOf('pne-shell-') === 0) return caches.delete(k);
          return null;
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* 네트워크 우선 — 앱 화면(HTML) */
function networkFirst(req) {
  return fetch(req).then(function (res) {
    if (!res || !res.ok) return res;
    return caches.open(CACHE).then(function (cache) {
      return cache.put('./index.html', res.clone());
    }).then(function () { return res; });
  }).catch(function () {
    return caches.open(CACHE).then(function (cache) {
      return cache.match('./index.html').then(function (hit) {
        return hit || cache.match('./');
      });
    }).then(function (hit) {
      if (hit) return hit;
      return new Response('지금은 오프라인이라 앱을 열 수 없어요. 연결된 뒤 다시 열어 주세요.',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    });
  });
}

self.addEventListener('fetch', function (ev) {
  const req = ev.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  /* 외부 출처(구글 시트 API·CDN 등)는 절대 가로채지 않는다 */
  if (url.origin !== self.location.origin) return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (req.mode === 'navigate') {
    ev.respondWith(networkFirst(req));
    return;
  }

  /* 정적 파일 — 캐시 먼저 보여 주고, 네트워크 결과로 캐시를 갱신 */
  const net = fetch(req).then(function (res) {
    if (!res || !res.ok) return res;
    return caches.open(CACHE).then(function (cache) {
      return cache.put(req, res.clone());
    }).then(function () { return res; });
  }).catch(function () { return null; });

  ev.waitUntil(net.then(function () {}, function () {}));
  ev.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return net.then(function (res) {
        return res || new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});
