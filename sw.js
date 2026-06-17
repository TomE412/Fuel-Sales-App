const CACHE='fuel-v7';
const CORE=['./','index.html','ops-dashboard.html','manifest.json','dash-manifest.json','icon-192.png','icon-512.png','apple-touch-icon.png'];

self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).catch(()=>{}));
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',e=>{
  const url=e.request.url;
  // External services always go to network (never cache the live data calls)
  if(url.includes('script.google.com')||url.includes('googleapis')||url.includes('jsdelivr')||url.includes('cdnjs'))return;

  // NETWORK-FIRST for HTML so app updates always appear when online
  if(e.request.mode==='navigate'||e.request.destination==='document'||url.endsWith('.html')||url.endsWith('/')){
    e.respondWith(
      fetch(e.request).then(r=>{
        if(r&&r.status===200){const cl=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cl));}
        return r;
      }).catch(()=>caches.match(e.request).then(c=>c||caches.match('index.html')))
    );
    return;
  }

  // CACHE-FIRST for static assets (icons, manifest)
  e.respondWith(
    caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{
      if(r&&r.status===200&&e.request.method==='GET'){const cl=r.clone();caches.open(CACHE).then(ca=>ca.put(e.request,cl));}
      return r;
    }))
  );
});