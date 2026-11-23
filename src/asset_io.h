#pragma once
#include <cstddef>
#include <cstdint>

// Synchronous reads from the user's staged .map files. Data lives in IndexedDB; window.HaloAssets keeps a
// bounded LRU of 4 MiB chunks outside the wasm heap. A read that touches a chunk that is not resident
// returns NotResident, has already scheduled the load, and should be retried on a later frame.
// With -DHALO_ASYNCIFY=ON, readBlocking() instead suspends until the chunks are loaded.
namespace halo::assets {

enum class ReadStatus { Ok, NotResident, Error };
struct ReadResult {
  ReadStatus status;
  std::size_t bytes;  // bytes copied; may be shorter than requested at end of file
};

bool available();
std::int64_t size(const char* mapName);  // -1 when the map is not staged
ReadResult read(const char* mapName, std::uint64_t offset, void* dst, std::size_t len);
void prefetch(const char* mapName, std::uint64_t offset, std::size_t len);
#ifdef HALO_USE_ASYNCIFY
ReadResult readBlocking(const char* mapName, std::uint64_t offset, void* dst, std::size_t len);
#endif

}  // namespace halo::assets
