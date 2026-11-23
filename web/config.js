// Single place for build-dependent and tunable values. Nothing here comes from a Halo engine source or a dump.
window.HaloConfig = Object.freeze({
  buildId: 'harness-1',            // bump to invalidate the shader cache
  maps: {
    chunkBytes: 4 * 1024 * 1024,
    residentBytesDefault: 128 * 1024 * 1024,   // LRU budget outside the wasm heap
    residentBytesHardCap: 512 * 1024 * 1024,   // never exceeded, per the brief
    // Names taken from your brief. The complete set the engine needs is unknown; at least one more .map
    // (a scenario such as bloodgulch.map) is also required before Launch unlocks.
    required: ['bitmaps.map', 'sounds.map', 'ui.map'],
    // UNVERIFIED: written from general knowledge of the retail map header, not from your files or an engine.
    // Confirm against a real map. Mismatches only warn (mode 'warn'); they never block staging.
    header: {
      mode: 'warn',
      bytes: 2048,
      headOffset: 0, headMagic: 0x68656164,     // read as little-endian u32
      versionOffset: 4,                          // shown raw in the UI so you can confirm it
      footOffset: 2044, footMagic: 0x666f6f74,
    },
  },
  net: {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    gatherTimeoutMs: 5000,
  },
  defaults: { renderHeight: 720, dynamicShadows: false, specularBloom: false, texture: 's3tc', cacheMiB: 128 },
});
