# Halo CE in the browser: GitHub Pages port scaffold

A fully static web host for a WebAssembly build of a Halo: Combat Evolved engine: bring-your-own game files, serverless WebRTC multiplayer, single-threaded Emscripten output that needs no special server headers.

**Status: this repository is the web platform layer plus a test harness. It does not contain a Halo engine and does not run the game yet.** See "What is missing".

## What is here

| Path | Purpose |
|---|---|
| `docs/index.html` | Launcher UI (files, lobby, performance, launch). This is the folder GitHub Pages serves. |
| `web/asset_loader.js` | Stages the user's `.map` files in IndexedDB as 4 MiB chunks; bounded LRU (default 128 MiB, hard cap 512 MiB) for reads. |
| `web/webrtc_serverless.js` | Copy-paste WebRTC signaling and transport (`window.HaloNet`). |
| `web/shader_cache.js` | IndexedDB cache for translated shader source (see caveat below). |
| `web/config.js` | Every tunable and every unverified value, in one place. |
| `src/net_webrtc.{h,cpp}` | C++ socket-style API over `HaloNet`: `send`, `receive`, `peerOpen`, `localId`. |
| `src/asset_io.{h,cpp}` | C++ synchronous reads from the staged maps (`read`, `prefetch`, optional `readBlocking`). |
| `src/main.cpp` | Harness: WebGL 2 context via SDL2, reads the first bytes of each staged map, logs received packets. |
| `CMakeLists.txt`, `build.sh` | Emscripten build; output goes straight into `docs/`. |
| `.github/workflows/deploy.yml` | Builds and deploys `docs/` to GitHub Pages. |
| `tests/codec_test.js` | Checks the invite/answer code format. |

Link flags follow your brief: `-sUSE_PTHREADS=0`, `-sINITIAL_MEMORY=536870912`, `-sMAXIMUM_MEMORY=1610612736`, `-sALLOW_MEMORY_GROWTH=1`, WebGL 2 only, `-O3` (or `-Oz` with `HALO_SIZE_OPT=1`), `-g0`. `build.sh` fails if `halo.wasm` is 50 MiB or larger. All page links are relative (`./`), so a project site at `https://<user>.github.io/<repo>/` works.

## Compile

1. Install the Emscripten SDK and activate it (`source emsdk_env.sh`). CI pins 3.1.64.
2. Run `./build.sh`. It copies `web/*.js` and `web/style.css` into `docs/`, configures with `emcmake`, builds, and writes `docs/halo.js` and `docs/halo.wasm`.
3. Test locally: `python3 -m http.server -d docs 8080`, then open `http://localhost:8080`.

Useful variants: `WEB_ONLY=1 ./build.sh` (no compiler needed), `HALO_ASYNCIFY=1 ./build.sh`, `HALO_ENGINE_DIR=path HALO_ENGINE_TARGET=name ./build.sh`.

## Publish on GitHub Pages

1. Create a repository and push this folder to `main`.
2. In the repository: Settings, Pages, Source: **GitHub Actions**.
3. The `Deploy to GitHub Pages` workflow runs on each push. Your site appears at `https://<user>.github.io/<repo>/`.
4. If an engine tree is added later, set repository variables `HALO_ENGINE_DIR` and `HALO_ENGINE_TARGET` (Settings, Secrets and variables, Actions, Variables).

## Connect two players

1. Both open the site. Each adds their own game files (step 1).
2. Host: **Create match**, then **Add player**. Copy the invite code and send it to the player.
3. Player: paste the invite code under **Join a match**, press **Create answer code**, copy the result and send it back.
4. Host: paste the answer code into that player's slot and press **Connect**. Repeat from step 2 for each additional player (up to 15).
5. The status line shows connected peers. **Test connection on this device** runs a host and a joiner inside one tab and sends a packet on each channel.

Peers are connected as a star around the host (host = peer 0). Joiner-to-joiner packets are relayed by the host. Two channels exist per peer: channel 0 is unordered with no retransmits (state snapshots), channel 1 is ordered and reliable (lobby, chat, match events).

## Things that behave differently from what the brief assumed

- **STUN address.** The brief says `stun:google.com`. The public Google server is `stun:stun.l.google.com:19302`; that is what `web/config.js` uses.
- **NAT.** Without a TURN relay, two players who are both behind symmetric NAT or strict corporate networks may fail to connect. That cannot be fixed without a server; add a TURN entry to `HaloConfig.net.iceServers` if you have one.
- **Synchronous reads.** An engine expects blocking file reads, but IndexedDB is asynchronous. In the default build a read of a chunk that is not resident returns `NotResident` (and starts the load), so the engine's file layer must retry or prefetch. `HALO_ASYNCIFY=ON` makes `readBlocking()` wait instead, at a cost in wasm size and speed.
- **Shader cache.** WebGL 2 has no program-binary API, so the cache stores translated GLSL ES source. It saves translation time only; it cannot skip the driver's compile on Intel UHD.
- **Map cache memory.** The LRU lives in JS memory outside the wasm heap, in addition to the 512 MiB initial wasm memory. The 128 MiB default is my choice for 4 GB devices.

## What is missing

1. **The engine.** No source for a Halo CE engine is included, and none was named, so `HALO_ENGINE_DIR` / `HALO_ENGINE_TARGET` are unset. Once chosen, an adapter must provide `int halo_engine_run(int argc, char** argv)` (declared in `src/main.cpp`) and route the engine's file reads to `halo::assets` and its UDP socket calls to `halo::net`. The call sites cannot be named until the engine is known.
2. **Direct3D 8/9 to WebGL 2 translation.** This depends on the engine's renderer and is not written.
3. **Map header layout.** `web/config.js` checks a header layout written from general knowledge, marked UNVERIFIED. A mismatch only shows a warning. The raw field at the version offset is displayed in the file list so you can confirm it against a real map.
4. **Required file list.** Only the names from your brief are required (`bitmaps.map`, `sounds.map`, `ui.map`, plus one scenario map). The engine may need more.
5. **Not run here.** Nothing was built with `emcc` or run in a browser. What was checked: `node --check` on all JS, `node tests/codec_test.js`, and `g++ -fsyntax-only` of `net_webrtc.cpp` and `asset_io.cpp` against a stub `emscripten.h`. `main.cpp`, the CMake flags, the workflow, and all WebRTC, IndexedDB and UI behavior are untested.
