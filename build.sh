#!/usr/bin/env bash
# Usage: ./build.sh                      build wasm harness + copy web files into docs/
#        WEB_ONLY=1 ./build.sh           only copy web files (no emcc needed)
#        HALO_ENGINE_DIR=... HALO_ENGINE_TARGET=... ./build.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p docs
cp web/*.js web/*.css docs/

if [[ "${WEB_ONLY:-0}" != "1" ]]; then
  command -v emcmake >/dev/null || { echo "emcmake not found. Run: source /path/to/emsdk/emsdk_env.sh" >&2; exit 1; }
  args=(-DCMAKE_BUILD_TYPE="${BUILD_TYPE:-Release}")
  [[ -n "${HALO_ENGINE_DIR:-}" ]]    && args+=(-DHALO_ENGINE_DIR="$HALO_ENGINE_DIR")
  [[ -n "${HALO_ENGINE_TARGET:-}" ]] && args+=(-DHALO_ENGINE_TARGET="$HALO_ENGINE_TARGET")
  [[ "${HALO_ASYNCIFY:-0}" == "1" ]] && args+=(-DHALO_ASYNCIFY=ON)
  [[ "${HALO_SIZE_OPT:-0}" == "1" ]] && args+=(-DHALO_SIZE_OPT=ON)
  emcmake cmake -S . -B build "${args[@]}"
  cmake --build build -j"$(nproc)"
  bytes=$(wc -c < docs/halo.wasm)
  echo "halo.wasm: $bytes bytes"
  (( bytes < 50*1024*1024 )) || { echo "halo.wasm is 50 MiB or larger" >&2; exit 1; }
fi
touch docs/.nojekyll
echo "Done. Serve locally: python3 -m http.server -d docs 8080"
