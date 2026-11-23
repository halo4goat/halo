// Harness entry point. It proves the web plumbing end to end (WebGL 2 context, staged-map reads, WebRTC packets).
// It is NOT a Halo engine: no engine source is linked unless the build is configured with HALO_ENGINE_DIR.
#include <GLES3/gl3.h>
#include <SDL2/SDL.h>
#include <emscripten.h>

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "asset_io.h"
#include "net_webrtc.h"

#ifdef HALO_ENGINE_LINKED
// Supplied by the engine adapter once an engine is chosen. Its signature is not known yet.
int halo_engine_run(int argc, char** argv);
#endif

namespace {

struct Probe {
  std::string name;
  bool done = false;
};

struct App {
  SDL_Window* window = nullptr;
  SDL_GLContext gl = nullptr;
  std::vector<Probe> probes;
} app;

void probeMaps() {
  for (Probe& p : app.probes) {
    if (p.done) continue;
    unsigned char head[4] = {};
    const auto r = halo::assets::read(p.name.c_str(), 0, head, sizeof head);
    if (r.status == halo::assets::ReadStatus::NotResident) continue;
    p.done = true;
    if (r.status == halo::assets::ReadStatus::Error) {
      std::printf("[assets] %s: not staged or unreadable\n", p.name.c_str());
    } else {
      std::printf("[assets] %s: size=%lld, first %zu bytes: %02x %02x %02x %02x\n", p.name.c_str(),
                  static_cast<long long>(halo::assets::size(p.name.c_str())), r.bytes, head[0], head[1], head[2],
                  head[3]);
    }
  }
}

void pollNet() {
  std::uint8_t buf[2048];
  for (int i = 0; i < 64; ++i) {
    const auto r = halo::net::receive(buf, sizeof buf);
    if (r.status == halo::net::RecvStatus::Empty) return;
    if (r.status == halo::net::RecvStatus::BufferTooSmall) {
      std::printf("[net] dropped oversize packet from peer %d\n", r.from);
      continue;
    }
    std::printf("[net] peer %d channel %d: %zu bytes\n", r.from, static_cast<int>(r.channel), r.size);
  }
}

void frame() {
  SDL_Event e;
  while (SDL_PollEvent(&e)) {
    if (e.type == SDL_QUIT) emscripten_cancel_main_loop();
  }
  probeMaps();
  pollNet();
  glClearColor(0.07f, 0.11f, 0.09f, 1.0f);
  glClear(GL_COLOR_BUFFER_BIT);
  SDL_GL_SwapWindow(app.window);
}

}  // namespace

int main(int argc, char** argv) {
  int height = 720;  // Chromebook Performance preset; the launcher passes --hce-render-height=N
  for (int i = 1; i < argc; ++i) {
    if (std::strncmp(argv[i], "--hce-render-height=", 20) == 0) {
      const int v = std::atoi(argv[i] + 20);
      if (v >= 240 && v <= 2160) height = v;
    } else if (argv[i][0] != '-') {
      app.probes.push_back({argv[i], false});
    }
  }

  if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_AUDIO | SDL_INIT_GAMECONTROLLER) != 0) {
    std::printf("SDL_Init failed: %s\n", SDL_GetError());
    return 1;
  }
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES);
  app.window = SDL_CreateWindow("Halo CE", SDL_WINDOWPOS_UNDEFINED, SDL_WINDOWPOS_UNDEFINED, height * 16 / 9, height,
                                SDL_WINDOW_OPENGL);
  if (!app.window) {
    std::printf("SDL_CreateWindow failed: %s\n", SDL_GetError());
    return 1;
  }
  app.gl = SDL_GL_CreateContext(app.window);
  if (!app.gl) {
    std::printf("WebGL 2 context creation failed: %s\n", SDL_GetError());
    return 1;
  }
  std::printf("[gl] %s | %s\n", reinterpret_cast<const char*>(glGetString(GL_VERSION)),
              reinterpret_cast<const char*>(glGetString(GL_RENDERER)));
  std::printf("[assets] available=%d  [net] supported=%d localId=%d\n", halo::assets::available() ? 1 : 0,
              halo::net::supported() ? 1 : 0, halo::net::localId());

#ifdef HALO_ENGINE_LINKED
  return halo_engine_run(argc, argv);
#else
  std::printf("[harness] no engine linked; see README, section \"What is missing\"\n");
  emscripten_set_main_loop(frame, 0, 1);
  return 0;
#endif
}
