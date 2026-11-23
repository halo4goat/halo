#include "net_webrtc.h"

#include <emscripten.h>

#include <cstdint>

EM_JS(int, halo_js_net_supported, (), {
  return (typeof HaloNet !== 'undefined' && HaloNet.supported()) ? 1 : 0;
});
EM_JS(int, halo_js_net_local_id, (), { return HaloNet.localId(); });
EM_JS(int, halo_js_net_peer_open, (int id), { return HaloNet.isOpen(id) ? 1 : 0; });
EM_JS(int, halo_js_net_send, (int peer, int channel, const void* ptr, int len), {
  return HaloNet.send(peer, channel, HEAPU8.subarray(ptr, ptr + len)) ? 1 : 0;
});
// Returns packet size, -1 when the queue is empty, -2 when the packet did not fit (it is dropped).
EM_JS(int, halo_js_net_recv, (void* ptr, int cap, int* meta), {
  const p = HaloNet.pop();
  if (!p) return -1;
  if (p.data.length > cap) return -2;
  HEAPU8.set(p.data, ptr);
  HEAP32[meta >> 2] = p.from;
  HEAP32[(meta >> 2) + 1] = p.channel;
  return p.data.length;
});

namespace halo::net {

bool supported() { return halo_js_net_supported() != 0; }
int localId() { return supported() ? halo_js_net_local_id() : -1; }

bool peerOpen(int peerId) { return supported() && halo_js_net_peer_open(peerId) != 0; }

bool send(int peerId, Channel channel, const void* data, std::size_t size) {
  const std::size_t limit = channel == Channel::State ? kMaxStatePacket : kMaxReliablePacket;
  if (!data || size == 0 || size > limit || !supported()) return false;
  return halo_js_net_send(peerId, static_cast<int>(channel), data, static_cast<int>(size)) != 0;
}

RecvResult receive(void* buffer, std::size_t capacity) {
  if (!buffer || capacity == 0 || capacity > 0x7fffffff || !supported()) {
    return {RecvStatus::Empty, -1, Channel::State, 0};
  }
  std::int32_t meta[2] = {-1, 0};
  const int rc = halo_js_net_recv(buffer, static_cast<int>(capacity), meta);
  if (rc == -1) return {RecvStatus::Empty, -1, Channel::State, 0};
  if (rc < 0) return {RecvStatus::BufferTooSmall, meta[0], Channel::State, 0};
  return {RecvStatus::Packet, meta[0], static_cast<Channel>(meta[1]), static_cast<std::size_t>(rc)};
}

}  // namespace halo::net
