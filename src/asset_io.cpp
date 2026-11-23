#include "asset_io.h"

#include <emscripten.h>

EM_JS(int, halo_js_assets_available, (), {
  return (typeof HaloAssets !== 'undefined' && HaloAssets.ready) ? 1 : 0;
});
EM_JS(double, halo_js_assets_size, (const char* name), { return HaloAssets.sizeOf(UTF8ToString(name)); });
EM_JS(int, halo_js_assets_read, (const char* name, double offset, void* dst, int len), {
  return HaloAssets.readInto(UTF8ToString(name), offset, HEAPU8.subarray(dst, dst + len));
});
EM_JS(void, halo_js_assets_prefetch, (const char* name, double offset, int len), {
  HaloAssets.prefetch(UTF8ToString(name), offset, len);
});
#ifdef HALO_USE_ASYNCIFY
EM_ASYNC_JS(int, halo_js_assets_read_blocking, (const char* name, double offset, void* dst, int len), {
  const n = UTF8ToString(name);
  // The wasm heap may grow while awaiting, so the view is created only after the chunks are resident.
  return await HaloAssets.readIntoAsync(n, offset, () => HEAPU8.subarray(dst, dst + len), len);
});
#endif

namespace halo::assets {
namespace {
ReadResult toResult(int rc) {
  if (rc == -1) return {ReadStatus::NotResident, 0};
  if (rc < 0) return {ReadStatus::Error, 0};
  return {ReadStatus::Ok, static_cast<std::size_t>(rc)};
}
bool lenOk(std::size_t len) { return len <= 0x7fffffffu; }
}  // namespace

bool available() { return halo_js_assets_available() != 0; }

std::int64_t size(const char* mapName) {
  if (!mapName || !available()) return -1;
  const double s = halo_js_assets_size(mapName);
  return s < 0 ? -1 : static_cast<std::int64_t>(s);
}

ReadResult read(const char* mapName, std::uint64_t offset, void* dst, std::size_t len) {
  if (!mapName || !dst || !lenOk(len) || !available()) return {ReadStatus::Error, 0};
  return toResult(halo_js_assets_read(mapName, static_cast<double>(offset), dst, static_cast<int>(len)));
}

void prefetch(const char* mapName, std::uint64_t offset, std::size_t len) {
  if (!mapName || !lenOk(len) || !available()) return;
  halo_js_assets_prefetch(mapName, static_cast<double>(offset), static_cast<int>(len));
}

#ifdef HALO_USE_ASYNCIFY
ReadResult readBlocking(const char* mapName, std::uint64_t offset, void* dst, std::size_t len) {
  if (!mapName || !dst || !lenOk(len) || !available()) return {ReadStatus::Error, 0};
  return toResult(halo_js_assets_read_blocking(mapName, static_cast<double>(offset), dst, static_cast<int>(len)));
}
#endif

}  // namespace halo::assets
