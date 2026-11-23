// Run: node tests/codec_test.js   (Node 18+). Checks the invite/answer code format only; no WebRTC here.
globalThis.window = globalThis;
require('../web/config.js');
require('../web/webrtc_serverless.js');
const assert = require('node:assert');
(async () => {
  const { pack, unpack } = window.HaloNet.codec;
  const sdp = 'v=0\r\n' + Array.from({ length: 40 }, (_, i) => `a=candidate:${i} 1 udp 2113937151 192.168.1.${i} 5${i}000 typ host`).join('\r\n');
  const code = await pack({ t: 'o', m: 'ab12cd34', id: 3, sdp });
  assert.match(code, /^HCE1z\.[A-Za-z0-9_-]+$/);
  assert.ok(code.length < Buffer.byteLength(sdp) * 1.34, 'compressed code should beat plain base64');
  const wrapped = code.replace(/(.{60})/g, '$1\n  ');           // chat apps wrap lines
  const back = await unpack(wrapped, 'o');
  assert.deepStrictEqual(back, { t: 'o', m: 'ab12cd34', id: 3, sdp });
  await assert.rejects(unpack(code, 'a'), /not an answer/);
  await assert.rejects(unpack('hello', 'o'), /Not a valid code/);
  await assert.rejects(unpack(await pack({ t: 'o', m: 'x', id: 99, sdp: 's' }), 'o'), /Invalid player slot/);
  console.log('codec ok, code length', code.length, 'vs sdp bytes', sdp.length);
})().catch((e) => { console.error(e); process.exit(1); });
