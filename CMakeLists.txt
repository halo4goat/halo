cmake_minimum_required(VERSION 3.20)
project(halo_ce_web LANGUAGES C CXX)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "Configure through Emscripten: emcmake cmake -S . -B build")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(HALO_ENGINE_DIR "" CACHE PATH "Engine source tree containing a CMakeLists.txt (unset = harness only)")
set(HALO_ENGINE_TARGET "" CACHE STRING "Library target exported by that tree (unknown until an engine is chosen)")
option(HALO_ASYNCIFY "Let asset reads wait on IndexedDB via ASYNCIFY (larger, slower wasm)" OFF)
option(HALO_SIZE_OPT "Optimize for size (-Oz) instead of speed (-O3)" OFF)

set(HALO_OPT $<IF:$<BOOL:${HALO_SIZE_OPT}>,-Oz,-O3>)

add_executable(halo src/main.cpp src/net_webrtc.cpp src/asset_io.cpp)
target_include_directories(halo PRIVATE src)
target_compile_options(halo PRIVATE ${HALO_OPT} -sUSE_SDL=2)

# Single-threaded on purpose: no SharedArrayBuffer, so no COOP/COEP headers are needed on GitHub Pages.
# Memory values are the ones from the brief: 512 MiB initial, 1536 MiB max, growth on.
# STACK_SIZE (5 MiB) is my default, not from the brief or an engine; raise it if the engine needs more.
target_link_options(halo PRIVATE
  ${HALO_OPT} -g0
  -sUSE_SDL=2 -sUSE_PTHREADS=0
  -sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2
  -sINITIAL_MEMORY=536870912 -sMAXIMUM_MEMORY=1610612736 -sALLOW_MEMORY_GROWTH=1
  -sSTACK_SIZE=5242880 -sENVIRONMENT=web -sASSERTIONS=0
  "-sEXPORTED_RUNTIME_METHODS=['UTF8ToString','HEAPU8','HEAP32']")

set_target_properties(halo PROPERTIES SUFFIX ".js" RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/docs")

if(HALO_ASYNCIFY)
  target_compile_definitions(halo PRIVATE HALO_USE_ASYNCIFY=1)
  target_link_options(halo PRIVATE -sASYNCIFY)
endif()

if(HALO_ENGINE_DIR)
  if(NOT HALO_ENGINE_TARGET)
    message(FATAL_ERROR "HALO_ENGINE_DIR is set but HALO_ENGINE_TARGET is empty")
  endif()
  add_subdirectory(${HALO_ENGINE_DIR} engine EXCLUDE_FROM_ALL)
  target_link_libraries(halo PRIVATE ${HALO_ENGINE_TARGET})
  target_compile_definitions(halo PRIVATE HALO_ENGINE_LINKED=1)
endif()
