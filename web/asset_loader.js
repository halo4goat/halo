// Bring-your-own-files loader. Staged .map files live in IndexedDB as 4 MiB chunks (one record each), written
// one chunk at a time so ingest never holds more than one chunk in JS memory. Reads go through a bounded LRU
// that is capped at 512 MiB no matter what the caller asks for. Nothing is uploaded anywhere.
(() => {
  'use strict';
  const C = window.HaloConfig.maps;
  const H = C.header;
  const MiB = 1024 * 1024;
  const DB_NAME = 'halo-ce-maps';

  let dbp = null;
  const openDb = () => (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('meta', { keyPath: 'name' });
      r.result.createObjectStore('chunks');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (stores, mode, fn) => {
    const db = await openDb();
    return new Promise((res, rej) => {
      const t = db.transaction(stores, mode);
      const out = fn(t);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = t.onabort = () => rej(t.error);
    });
  };

  const metaCache = new Map();
  const cache = new Map();        // "name#index" -> Uint8Array, Map order = LRU order
  const loading = new Map();
  let resident = 0;
  let limit = C.residentBytesDefault;
  const keyOf = (name, i) => `${name}#${i}`;

  function evict(keep) {
    for (const [k, v] of cache) {
      if (resident <= limit) break;
      if (keep && keep.has(k)) continue;
      cache.delete(k);
      resident -= v.byteLength;
    }
  }
  function load(name, i) {
    const k = keyOf(name, i);
    if (cache.has(k)) return Promise.resolve();
    if (loading.has(k)) return loading.get(k);
    const p = tx('chunks', 'readonly', (t) => t.objectStore('chunks').get(k)).then((buf) => {
      if (!buf) throw new Error(`Chunk ${k} is missing from storage`);
      cache.set(k, new Uint8Array(buf));
      resident += buf.byteLength;
      evict(new Set([k]));
    }).finally(() => loading.delete(k));
    loading.set(k, p);
    return p;
  }

  function span(name, offset, len) {
    const m = metaCache.get(name);
    const first = Math.floor(offset / m.chunkBytes);
    const last = Math.floor((offset + len - 1) / m.chunkBytes);
    return { m, first, last };
  }
  function clampLen(m, offset, len) { return Math.max(0, Math.min(len, m.size - offset)); }

  function inspectHeader(buf, fileSize) {
    if (fileSize < H.bytes || buf.byteLength < H.bytes) return { ok: false, version: null };
    const dv = new DataView(buf);
    const ok = dv.getUint32(H.headOffset, true) === H.headMagic && dv.getUint32(H.footOffset, true) === H.footMagic;
    return { ok, version: dv.getUint32(H.versionOffset, true) };
  }

  const api = {
    ready: false,

    async refresh() {
      const all = await tx('meta', 'readonly', (t) => t.objectStore('meta').getAll());
      metaCache.clear();
      for (const m of all) metaCache.set(m.name, m);
      api.ready = true;
      return all;
    },
    list: () => [...metaCache.values()].sort((a, b) => a.name.localeCompare(b.name)),
    sizeOf: (name) => (metaCache.has(name) ? metaCache.get(name).size : -1),

    setLimit(bytes) {
      limit = Math.min(Math.max(bytes, 16 * MiB), C.residentBytesHardCap);
      evict();
    },
    stats: () => ({ residentBytes: resident, limitBytes: limit, chunks: cache.size }),

    async ingest(file, onProgress) {
      const name = file.name.toLowerCase();
      const header = inspectHeader(await file.slice(0, H.bytes).arrayBuffer(), file.size);
      await api.remove(name);
      const n = Math.ceil(file.size / C.chunkBytes);
      try {
        for (let i = 0; i < n; i++) {
          const end = Math.min(file.size, (i + 1) * C.chunkBytes);
          const buf = await file.slice(i * C.chunkBytes, end).arrayBuffer();
          await tx('chunks', 'readwrite', (t) => t.objectStore('chunks').put(buf, keyOf(name, i)));
          if (onProgress) onProgress(end, file.size);
        }
        // Meta goes in last, so an interrupted ingest is never listed as a usable map.
        const meta = { name, size: file.size, chunkBytes: C.chunkBytes, chunks: n, headerOk: header.ok,
          headerField: header.version, added: Date.now() };
        await tx('meta', 'readwrite', (t) => t.objectStore('meta').put(meta));
        metaCache.set(name, meta);
        return meta;
      } catch (e) {
        await api.remove(name).catch(() => undefined);
        throw e;
      }
    },

    async remove(name) {
      await tx(['meta', 'chunks'], 'readwrite', (t) => {
        t.objectStore('meta').delete(name);
        t.objectStore('chunks').delete(IDBKeyRange.bound(`${name}#`, `${name}#\uffff`));
      });
      metaCache.delete(name);
      for (const [k, v] of cache) if (k.startsWith(`${name}#`)) { cache.delete(k); resident -= v.byteLength; }
    },

    // Make every chunk covering [offset, offset+len) resident. A single range may use at most half the budget.
    async ensure(name, offset, len) {
      if (!metaCache.has(name)) throw new Error(`Map ${name} is not staged`);
      const n = clampLen(metaCache.get(name), offset, len);
      if (n === 0) return;
      if (n > limit / 2) throw new Error('Read is larger than half the resident budget');
      const { first, last } = span(name, offset, n);
      for (let i = first; i <= last; i++) await load(name, i);
    },
    prefetch(name, offset, len) {
      if (!metaCache.has(name)) return;
      const n = clampLen(metaCache.get(name), offset, len);
      if (n === 0 || n > limit / 2) return;
      const { first, last } = span(name, offset, n);
      for (let i = first; i <= last; i++) load(name, i).catch(() => undefined);
    },

    // Synchronous read. Returns bytes copied, -1 when a needed chunk is not resident (its load is started),
    // -2 on error. A short count means end of file.
    readInto(name, offset, dest) {
      const m = metaCache.get(name);
      if (!m || !(offset >= 0)) return -2;
      const n = clampLen(m, offset, dest.length);
      if (n === 0) return 0;
      const { first, last } = span(name, offset, n);
      const parts = [];
      let missing = false;
      for (let i = first; i <= last; i++) {
        const c = cache.get(keyOf(name, i));
        if (c) parts.push(c); else { missing = true; load(name, i).catch(() => undefined); }
      }
      if (missing) return -1;
      let pos = offset, written = 0;
      for (let i = first; i <= last; i++) {
        const c = parts[i - first];
        const k = keyOf(name, i);
        const s = pos - i * m.chunkBytes;
        const take = Math.min(n - written, c.length - s);
        dest.set(c.subarray(s, s + take), written);
        written += take; pos += take;
        cache.delete(k); cache.set(k, c);          // refresh LRU position
      }
      return written;
    },
    // For the ASYNCIFY build. destFactory is called after the awaits because the wasm heap may have grown.
    async readIntoAsync(name, offset, destFactory, len) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await api.ensure(name, offset, len); } catch { return -2; }
        const rc = api.readInto(name, offset, destFactory());
        if (rc !== -1) return rc;
      }
      return -1;
    },

    async storageInfo() {
      const out = { usage: null, quota: null, persisted: false };
      if (navigator.storage && navigator.storage.estimate) Object.assign(out, await navigator.storage.estimate());
      if (navigator.storage && navigator.storage.persist) out.persisted = await navigator.storage.persist();
      return out;
    },

    // Files from a drop (folders are walked recursively) or from an <input>. Only *.map files are returned.
    async filesFromDrop(dt) {
      const isMap = (f) => f.name.toLowerCase().endsWith('.map');
      const entries = [...dt.items].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
      if (!entries.length) return [...dt.files].filter(isMap);
      const out = [];
      const walk = async (e) => {
        if (e.isFile) {
          await new Promise((r) => e.file((f) => { if (isMap(f)) out.push(f); r(); }, () => r()));
        } else if (e.isDirectory) {
          const rd = e.createReader();
          for (;;) {
            const batch = await new Promise((res, rej) => rd.readEntries(res, rej));
            if (!batch.length) break;
            for (const c of batch) await walk(c);
          }
        }
      };
      for (const e of entries) await walk(e);
      return out;
    },
  };
  window.HaloAssets = api;
})();
