(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const CFG = window.HaloConfig;
  const fmt = (b) => (b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(2)} GB` : b >= 2 ** 20 ? `${(b / 2 ** 20).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
  const log = (m) => { const el = $('#log'); el.hidden = false; el.textContent += `${m}\n`; el.scrollTop = el.scrollHeight; };
  const copy = async (text, btn) => {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
    }
    const old = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = old; }, 1500);
  };
  const el = (tag, props, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

  // ---- 1. files ----
  async function renderMaps() {
    await HaloAssets.refresh();
    const list = HaloAssets.list();
    const ul = $('#maps'); ul.replaceChildren();
    for (const m of list) {
      const note = m.headerOk ? 'header matches the assumed layout'
        : `header differs from the assumed layout (unverified assumption; field at offset ${CFG.maps.header.versionOffset}: ${m.headerField ?? 'n/a'})`;
      const rm = el('button', { type: 'button', textContent: 'Remove' });
      rm.addEventListener('click', async () => { await HaloAssets.remove(m.name); renderMaps(); });
      ul.append(el('li', {}, el('span', {}, el('strong', { textContent: m.name }), el('br'),
        el('span', { className: m.headerOk ? 'note' : 'note warn', textContent: note })), el('span', { textContent: fmt(m.size) }), rm));
    }
    const names = new Set(list.map((m) => m.name));
    const missing = CFG.maps.required.filter((n) => !names.has(n));
    const hasScenario = list.some((m) => !CFG.maps.required.includes(m.name));
    const ok = missing.length === 0 && hasScenario;
    const msg = ok ? 'All required files are present.'
      : `Still needed: ${[...missing, ...(hasScenario ? [] : ['at least one scenario map, for example bloodgulch.map'])].join(', ')}.`;
    $('#mapStatus').textContent = msg; $('#mapStatus').className = ok ? 'note good' : 'note';
    $('#launch').disabled = !ok;
    $('#launchHint').textContent = ok ? 'Ready to launch.' : 'Add your game files to enable Launch.';
    const s = await HaloAssets.storageInfo().catch(() => null);
    $('#storage').textContent = s && s.quota ? `Browser storage: ${fmt(s.usage)} used of ${fmt(s.quota)} available${s.persisted ? ' (kept)' : ''}.` : '';
  }
  async function ingestAll(files) {
    if (!files.length) { $('#mapStatus').textContent = 'No .map files found in that selection.'; return; }
    const prog = $('#prog'); prog.hidden = false;
    for (const f of files) {
      try {
        await HaloAssets.ingest(f, (d, t) => { prog.max = t; prog.value = d; $('#progLabel').textContent = `${f.name}: ${fmt(d)} of ${fmt(t)}`; });
      } catch (e) { $('#progLabel').textContent = `${f.name} could not be stored: ${e.message}. Free up space and try again.`; prog.hidden = true; await renderMaps(); return; }
    }
    prog.hidden = true; $('#progLabel').textContent = ''; await renderMaps();
  }
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', async (e) => { ingestAll(await HaloAssets.filesFromDrop(e.dataTransfer)); });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fileInput').click(); } });
  $('#pickDir').addEventListener('click', () => $('#dirInput').click());
  $('#pickFiles').addEventListener('click', () => $('#fileInput').click());
  for (const id of ['#dirInput', '#fileInput']) {
    $(id).addEventListener('change', (e) => { ingestAll([...e.target.files].filter((f) => f.name.toLowerCase().endsWith('.map'))); e.target.value = ''; });
  }

  // ---- 2. multiplayer ----
  const net = window.HaloNet;
  const refreshNet = () => {
    if (!net.supported()) { $('#netStatus').textContent = 'This browser does not support WebRTC.'; return; }
    const open = net.peers().filter((p) => p.open).map((p) => p.id);
    $('#netStatus').textContent = net.role() ? `${net.role() === 'host' ? 'Hosting' : 'Joined'} as player ${net.localId()}. Connected peers: ${open.length ? open.join(', ') : 'none yet'}.` : 'Not in a match.';
  };
  net.on((ev) => { if (ev.type === 'error') log(ev.message); refreshNet(); });
  $('#hostCreate').addEventListener('click', () => { $('#slots').replaceChildren(); net.hostCreate(); $('#hostAdd').disabled = false; });
  $('#hostAdd').addEventListener('click', async () => {
    const btn = $('#hostAdd'); btn.disabled = true;
    try {
      const { slot, code } = await net.hostAddPlayer();
      const offer = el('textarea', { readOnly: true, value: code, id: `offer${slot}` });
      const answer = el('textarea', { id: `answer${slot}`, spellcheck: false });
      const cp = el('button', { type: 'button', textContent: 'Copy invite code' });
      const go = el('button', { type: 'button', textContent: 'Connect' });
      const err = el('span', { className: 'note warn' });
      cp.addEventListener('click', () => copy(code, cp));
      go.addEventListener('click', async () => { err.textContent = ''; try { await net.hostAcceptAnswer(answer.value); go.disabled = true; } catch (e) { err.textContent = e.message; } });
      $('#slots').append(el('div', { className: 'slot' }, el('strong', { textContent: `Player ${slot}` }),
        el('div', { className: 'row' }, cp), offer,
        el('label', { className: 'note', htmlFor: `answer${slot}`, textContent: 'Paste their answer code' }), answer, el('div', { className: 'row' }, go, err)));
    } catch (e) { log(`Could not create invite: ${e.message}`); }
    btn.disabled = false;
  });
  $('#joinGo').addEventListener('click', async () => {
    const btn = $('#joinGo'); btn.disabled = true;
    try { $('#joinAnswer').value = await net.joinWithOffer($('#joinOffer').value); $('#joinOut').hidden = false; }
    catch (e) { $('#joinOut').hidden = true; log(`Could not join: ${e.message}`); $('#netStatus').textContent = e.message; }
    btn.disabled = false; refreshNet();
  });
  $('#joinCopy').addEventListener('click', () => copy($('#joinAnswer').value, $('#joinCopy')));
  $('#loopback').addEventListener('click', async () => {
    const out = $('#loopResult'); out.textContent = 'Testing...';
    const a = createHaloNet(), b = createHaloNet();
    const until = (f, ms) => new Promise((res, rej) => { const t0 = Date.now(); const id = setInterval(() => { if (f()) { clearInterval(id); res(); } else if (Date.now() - t0 > ms) { clearInterval(id); rej(new Error('timed out')); } }, 50); });
    try {
      a.hostCreate();
      const { code } = await a.hostAddPlayer();
      await a.hostAcceptAnswer(await b.joinWithOffer(code));
      await until(() => a.isOpen(1) && b.isOpen(0), 10000);
      b.send(0, 0, new Uint8Array([1, 2, 3])); b.send(0, 1, new Uint8Array([4, 5]));
      a.send(1, 1, new Uint8Array([9]));
      await until(() => a.stats().queued[0] === 1 && a.stats().queued[1] === 1 && b.stats().queued[1] === 1, 5000);
      out.textContent = 'Both channels carried packets between two peers on this device.'; out.className = 'note good';
    } catch (e) { out.textContent = `Failed: ${e.message}. Check that WebRTC is not blocked.`; out.className = 'note warn'; }
    a.leave(); b.leave();
  });

  // ---- 3. performance + capabilities ----
  const settings = () => ({ preset: 'chromebook', renderHeight: +$('#renderHeight').value, dynamicShadows: $('#shadows').checked,
    specularBloom: $('#bloom').checked, texture: CFG.defaults.texture, cacheMiB: +$('#cacheMiB').value });
  $('#renderHeight').value = CFG.defaults.renderHeight; $('#cacheMiB').value = CFG.defaults.cacheMiB;
  $('#shadows').checked = CFG.defaults.dynamicShadows; $('#bloom').checked = CFG.defaults.specularBloom;
  (() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) { $('#caps').textContent = 'WebGL 2 is not available in this browser; the game cannot run.'; $('#caps').className = 'note warn'; return; }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const s3 = !!gl.getExtension('WEBGL_compressed_texture_s3tc');
    $('#caps').textContent = `WebGL 2 available. Compressed textures (S3TC): ${s3 ? 'yes' : 'no'}. Largest texture: ${gl.getParameter(gl.MAX_TEXTURE_SIZE)} px.${dbg ? ` Graphics: ${gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)}.` : ''}`;
  })();

  // ---- launch ----
  $('#launch').addEventListener('click', async () => {
    const s = settings();
    window.HaloSettings = Object.freeze(s);
    await HaloAssets.refresh();
    HaloAssets.setLimit(s.cacheMiB * 1024 * 1024);
    const canvas = $('#canvas');
    $('#stage').hidden = false; $('#fs').hidden = false; $('#launch').disabled = true;
    canvas.addEventListener('click', () => { if (canvas.requestPointerLock) canvas.requestPointerLock(); });
    $('#fs').addEventListener('click', () => canvas.requestFullscreen && canvas.requestFullscreen());
    window.Module = { canvas, print: log, printErr: log,
      arguments: [...HaloAssets.list().map((m) => m.name), `--hce-render-height=${s.renderHeight}`],
      onAbort: (w) => log(`Aborted: ${w}`) };
    const sc = el('script', { src: './halo.js' });
    sc.onerror = () => { log('halo.js was not found next to this page. Build the wasm first (see README).'); $('#launch').disabled = false; };
    document.body.append(sc);
  });

  renderMaps().catch((e) => { $('#mapStatus').textContent = `Browser storage is unavailable: ${e.message}`; });
  refreshNet();
})();
