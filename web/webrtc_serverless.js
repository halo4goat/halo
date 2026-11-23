// Serverless WebRTC transport: copy-paste signaling, star topology (host = peer 0).
// Wire format on both channels: [src u8][dst u8][payload]. The host overwrites src with the real sender
// and relays packets addressed to other peers (dst = 255 means everyone).
(() => {
  'use strict';
  const BROADCAST = 255;
  const MAX_PEERS = 16;
  const PREFIX = 'HCE1';
  const LIMIT = [1200, 16384];       // [state, reliable] max payload bytes; mirrors src/net_webrtc.h
  const QUEUE_CAP = [256, 4096];
  const MAX_BUFFERED_STATE = 1 << 20;

  const b64u = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const unb64u = (s) => {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  };
  const viaStream = async (bytes, transform) =>
    new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer());

  async function pack(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'function') {
      return `${PREFIX}z.${b64u(await viaStream(raw, new CompressionStream('deflate-raw')))}`;
    }
    return `${PREFIX}u.${b64u(raw)}`;
  }
  async function unpack(code, type) {
    const m = /^HCE1([zu])\.([A-Za-z0-9_-]+)$/.exec(String(code).replace(/\s+/g, ''));
    if (!m) throw new Error('Not a valid code. Copy the whole code, starting with HCE1.');
    let raw = unb64u(m[2]);
    if (m[1] === 'z') {
      if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot read compressed codes.');
      raw = await viaStream(raw, new DecompressionStream('deflate-raw'));
    }
    const o = JSON.parse(new TextDecoder().decode(raw));
    if (o.t !== type || typeof o.sdp !== 'string' || !Number.isInteger(o.id) || typeof o.m !== 'string') {
      throw new Error(type === 'o' ? 'This is not an invite code.' : 'This is not an answer code.');
    }
    if (o.id < 1 || o.id >= MAX_PEERS) throw new Error('Invalid player slot in code.');
    return o;
  }

  function createHaloNet(cfg) {
    const ice = (cfg && cfg.iceServers) || (window.HaloConfig && window.HaloConfig.net.iceServers) ||
      [{ urls: 'stun:stun.l.google.com:19302' }];
    const gatherMs = (window.HaloConfig && window.HaloConfig.net.gatherTimeoutMs) || 5000;
    const S = { role: null, localId: -1, matchId: null, peers: new Map(), pending: new Map(), q: [[], []],
      stats: { rx: [0, 0], tx: [0, 0], dropped: 0 }, listeners: new Set() };

    const emit = (ev) => { for (const f of S.listeners) { try { f(ev); } catch (e) { console.error(e); } } };
    const randomHex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');

    function waitIce(pc) {
      return new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve();
        const done = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', on); resolve(); };
        const on = () => { if (pc.iceGatheringState === 'complete') done(); };
        const t = setTimeout(done, gatherMs);
        pc.addEventListener('icegatheringstatechange', on);
      });
    }

    function dropPeer(peer) {
      try { peer.pc.close(); } catch { /* already closed */ }
      if (S.pending.get(peer.id) === peer) S.pending.delete(peer.id);
      if (S.peers.get(peer.id) === peer) { S.peers.delete(peer.id); emit({ type: 'peer-closed', id: peer.id }); }
    }

    function newPeer(id) {
      const pc = new RTCPeerConnection({ iceServers: ice });
      const peer = { id, pc, ch: null, open: false, timer: 0 };
      // Negotiated channels: both sides create them with the same ids, so no ondatachannel handshake is needed.
      const st = pc.createDataChannel('state', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
      const rl = pc.createDataChannel('reliable', { negotiated: true, id: 1, ordered: true });
      st.binaryType = rl.binaryType = 'arraybuffer';
      peer.ch = [st, rl];
      const check = () => {
        if (!peer.open && st.readyState === 'open' && rl.readyState === 'open') {
          peer.open = true; clearTimeout(peer.timer); emit({ type: 'peer-open', id });
        }
      };
      st.onopen = rl.onopen = check;
      st.onmessage = (e) => onMessage(peer, 0, e.data);
      rl.onmessage = (e) => onMessage(peer, 1, e.data);
      rl.onclose = () => dropPeer(peer);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') dropPeer(peer);
      };
      return peer;
    }

    function deliver(from, ch, payload) {
      const q = S.q[ch];
      if (q.length >= QUEUE_CAP[ch]) { q.shift(); S.stats.dropped++; }
      q.push({ from, channel: ch, data: payload });
      S.stats.rx[ch]++;
    }

    function rawSend(peer, ch, src, dst, payload) {
      const dc = peer.ch[ch];
      if (!peer.open || dc.readyState !== 'open' || payload.length > LIMIT[ch]) return false;
      if (ch === 0 && dc.bufferedAmount > MAX_BUFFERED_STATE) { S.stats.dropped++; return false; }
      const out = new Uint8Array(payload.length + 2);
      out[0] = src; out[1] = dst; out.set(payload, 2);
      dc.send(out);
      S.stats.tx[ch]++;
      return true;
    }

    function onMessage(peer, ch, data) {
      const u = new Uint8Array(data);
      if (u.length < 3 || u.length - 2 > LIMIT[ch]) return;
      const dst = u[1];
      const payload = u.subarray(2);
      if (S.role === 'host') {
        const src = peer.id;                       // never trust the sender's claimed id
        if (dst === 0 || dst === BROADCAST) deliver(src, ch, payload);
        if (dst === BROADCAST) {
          for (const p of S.peers.values()) if (p.id !== src) rawSend(p, ch, src, BROADCAST, payload);
        } else if (dst !== 0) {
          const target = S.peers.get(dst);
          if (target) rawSend(target, ch, src, dst, payload);
        }
      } else if (u[0] < MAX_PEERS) {
        deliver(u[0], ch, payload);
      }
    }

    function closeAll() {
      for (const p of [...S.peers.values(), ...S.pending.values()]) { try { p.pc.close(); } catch { /* ignore */ } }
      S.peers.clear(); S.pending.clear(); S.q[0].length = S.q[1].length = 0;
      S.role = null; S.localId = -1; S.matchId = null;
      S.stats = { rx: [0, 0], tx: [0, 0], dropped: 0 };
    }

    const api = {
      supported: () => typeof RTCPeerConnection === 'function',
      localId: () => S.localId,
      role: () => S.role,
      isOpen: (id) => !!(S.peers.get(id) && S.peers.get(id).open),
      peers: () => [...S.peers.values()].map((p) => ({ id: p.id, open: p.open })),
      stats: () => ({ ...S.stats, queued: [S.q[0].length, S.q[1].length] }),
      on: (f) => { S.listeners.add(f); return () => S.listeners.delete(f); },
      codec: { pack, unpack },

      hostCreate() { closeAll(); S.role = 'host'; S.localId = 0; S.matchId = randomHex(4); emit({ type: 'host-created' }); },

      async hostAddPlayer() {
        if (S.role !== 'host') throw new Error('Create a match first.');
        let slot = 1;
        while (slot < MAX_PEERS && (S.peers.has(slot) || S.pending.has(slot))) slot++;
        if (slot >= MAX_PEERS) throw new Error('All 15 player slots are in use.');
        const peer = newPeer(slot);
        S.pending.set(slot, peer);
        try {
          await peer.pc.setLocalDescription(await peer.pc.createOffer());
          await waitIce(peer.pc);
          return { slot, code: await pack({ t: 'o', m: S.matchId, id: slot, sdp: peer.pc.localDescription.sdp }) };
        } catch (e) { dropPeer(peer); throw e; }
      },

      async hostAcceptAnswer(code) {
        if (S.role !== 'host') throw new Error('Create a match first.');
        const a = await unpack(code, 'a');
        if (a.m !== S.matchId) throw new Error('This answer belongs to a different match.');
        const peer = S.pending.get(a.id);
        if (!peer) throw new Error(`Slot ${a.id} has no open invite.`);
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: a.sdp });
        S.pending.delete(a.id);
        S.peers.set(a.id, peer);
        peer.timer = setTimeout(() => { if (!peer.open) { emit({ type: 'error', message: `Player ${a.id} did not connect.` }); dropPeer(peer); } }, 30000);
        return a.id;
      },

      cancelSlot(slot) { const p = S.pending.get(slot) || S.peers.get(slot); if (p) dropPeer(p); },

      async joinWithOffer(code) {
        const o = await unpack(code, 'o');
        closeAll();
        S.role = 'client'; S.localId = o.id; S.matchId = o.m;
        const peer = newPeer(0);
        S.peers.set(0, peer);
        try {
          await peer.pc.setRemoteDescription({ type: 'offer', sdp: o.sdp });
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          await waitIce(peer.pc);
          return await pack({ t: 'a', m: o.m, id: o.id, sdp: peer.pc.localDescription.sdp });
        } catch (e) { closeAll(); throw e; }
      },

      leave() { closeAll(); emit({ type: 'left' }); },

      // peer = 0..15 or 255 (broadcast). Returns false when nothing was sent.
      send(peerId, ch, bytes) {
        if (S.localId < 0 || (ch !== 0 && ch !== 1) || !bytes || bytes.length === 0) return false;
        if (S.role === 'host') {
          if (peerId === BROADCAST) { let any = false; for (const p of S.peers.values()) any = rawSend(p, ch, 0, BROADCAST, bytes) || any; return any; }
          const p = S.peers.get(peerId);
          return !!p && rawSend(p, ch, 0, peerId, bytes);
        }
        const host = S.peers.get(0);
        return !!host && rawSend(host, ch, S.localId, peerId, bytes);   // the host relays
      },

      pop() { return S.q[1].shift() || S.q[0].shift() || null; },
    };
    return api;
  }

  window.createHaloNet = createHaloNet;
  window.HaloNet = createHaloNet();
})();
