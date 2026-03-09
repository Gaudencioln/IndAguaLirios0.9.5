'use strict';
const CACHE_NAME='agua-lirios-cache-v0.9.5';
const ASSETS=['./','./index.html','./styles.css','./app.js','./manifest.json','./sw.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS))); self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE_NAME?caches.delete(k):null)))); self.clients.claim();});
self.addEventListener('fetch',e=>{
  const req=e.request;
  e.respondWith(caches.match(req).then(cached=>{
    if(cached) return cached;
    return fetch(req).then(res=>{
      if(req.method==='GET' && new URL(req.url).origin===self.location.origin){
        const copy=res.clone(); caches.open(CACHE_NAME).then(c=>c.put(req,copy));
      }
      return res;
    }).catch(()=> (req.mode==='navigate'?caches.match('./index.html'):cached));
  }));
});
