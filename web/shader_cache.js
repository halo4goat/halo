// IndexedDB cache for TRANSLATED shader source (GLSL ES 3.00 text). WebGL 2 has no program-binary API, so this
// saves translation time, not driver compile time. The engine-side D3D-to-GLSL translator that would call it
// does not exist in this repo yet.
(() => {
  'use strict';
  const DB = 'halo-ce-shaders';
  let dbp = null;
  const open = () => (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('src');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('src', mode);
      const req = fn(t.objectStore('src'));
      t.oncomplete = () => res(req && req.result);
      t.onerror = t.onabort = () => rej(t.error);
    });
  };
  const keyOf = (id) => `${window.HaloConfig.buildId}:${id}`;
  window.HaloShaderCache = {
    get: (id) => run('readonly', (s) => s.get(keyOf(id))).catch(() => undefined),
    put: (id, value) => run('readwrite', (s) => s.put(value, keyOf(id))).catch(() => undefined),
    clear: () => run('readwrite', (s) => s.clear()),
  };
})();
