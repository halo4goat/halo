#pragma once
#include <cstddef>

// C++ side of the serverless WebRTC socket shim. The transport itself lives in web/webrtc_serverless.js
// (window.HaloNet). Peer ids: host = 0, joiners = 1..15, kBroadcast = every other peer.
// Topology is a star: joiners only hold a connection to the host, and the host relays joiner-to-joiner traffic.
namespace halo::net {

enum class Channel : int { State = 0, Reliable = 1 };  // State: unordered, no retransmit. Reliable: ordered.
enum class RecvStatus { Packet, Empty, BufferTooSmall };

inline constexpr int kBroadcast = 255;
inline constexpr int kMaxPeers = 16;
// My defaults, not taken from the engine's real packet sizes: unreliable messages stay near one MTU.
inline constexpr std::size_t kMaxStatePacket = 1200;
inline constexpr std::size_t kMaxReliablePacket = 16384;

struct RecvResult {
  RecvStatus status;
  int from;
  Channel channel;
  std::size_t size;
};

bool supported();                // RTCPeerConnection and window.HaloNet are present
int localId();                   // -1 when not in a match
bool peerOpen(int peerId);       // both data channels open
bool send(int peerId, Channel channel, const void* data, std::size_t size);
RecvResult receive(void* buffer, std::size_t capacity);  // reliable packets are drained before state packets

}  // namespace halo::net
