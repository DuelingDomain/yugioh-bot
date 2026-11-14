#!/usr/bin/env bash
# Build the KWS-only sherpa-onnx WebAssembly module (no model inside, ES module for a dedicated worker).
# Runs inside the pinned emsdk image; the driver is scripts/voice/build-kws-wasm.ts:
#
#   docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e EM_CACHE=/src/data/voice-build/.emcache \
#     -v "$PWD":/src -w /src docker.io/emscripten/emsdk:4.0.9@sha256:... bash scripts/voice/build-kws-wasm.sh
#
# Source and build tree live in data/voice-build (gitignored). Output: data/voice-build/out/.
set -euo pipefail
ROOT="${DOMAIN_ROOT:-/src}"
WORK="$ROOT/data/voice-build"
PINS="$ROOT/scripts/voice/kws-pins.json"
REPO="$(python3 -c "import json;print(json.load(open('$PINS'))['sherpaOnnx']['repository'])")"
COMMIT="$(python3 -c "import json;print(json.load(open('$PINS'))['sherpaOnnx']['commit'])")"
MEM="$(python3 -c "import json;print(json.load(open('$PINS'))['initialMemory'])")"
mkdir -p "$WORK"
if [ ! -d "$WORK/sherpa-onnx/.git" ]; then
  git init -q "$WORK/sherpa-onnx"
  git -C "$WORK/sherpa-onnx" remote add origin "$REPO"
fi
git -C "$WORK/sherpa-onnx" fetch -q --depth 1 origin "$COMMIT"
git -C "$WORK/sherpa-onnx" checkout -q -f "$COMMIT"
cp "$ROOT/scripts/voice/kws/CMakeLists.txt" "$WORK/sherpa-onnx/wasm/kws/CMakeLists.txt"

cd "$WORK/sherpa-onnx"
export EMSCRIPTEN="$(dirname "$(realpath "$(which emcc)")")"
export SHERPA_ONNX_IS_USING_BUILD_WASM_SH=ON
rm -rf build-voice-kws
mkdir -p build-voice-kws
cd build-voice-kws
cmake \
  -DCMAKE_INSTALL_PREFIX=./install \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE="$EMSCRIPTEN/cmake/Modules/Platform/Emscripten.cmake" \
  -DKWS_INITIAL_MEMORY="$MEM" \
  -DSHERPA_ONNX_ENABLE_PYTHON=OFF \
  -DSHERPA_ONNX_ENABLE_TESTS=OFF \
  -DSHERPA_ONNX_ENABLE_CHECK=OFF \
  -DBUILD_SHARED_LIBS=OFF \
  -DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF \
  -DSHERPA_ONNX_ENABLE_JNI=OFF \
  -DSHERPA_ONNX_ENABLE_C_API=ON \
  -DSHERPA_ONNX_ENABLE_TTS=OFF \
  -DSHERPA_ONNX_ENABLE_WEBSOCKET=OFF \
  -DSHERPA_ONNX_ENABLE_GPU=OFF \
  -DSHERPA_ONNX_ENABLE_WASM=ON \
  -DSHERPA_ONNX_ENABLE_WASM_KWS=ON \
  -DSHERPA_ONNX_ENABLE_BINARY=OFF \
  -DSHERPA_ONNX_LINK_LIBSTDCPP_STATICALLY=OFF \
  ..
make -j"${EMCC_CORES:-4}"
make install
mkdir -p "$WORK/out"
cp install/bin/wasm/sherpa-onnx-wasm-kws-main.js install/bin/wasm/sherpa-onnx-wasm-kws-main.wasm "$WORK/out/"
cp "$WORK/sherpa-onnx/LICENSE" "$WORK/out/LICENSE.sherpa-onnx"
ls -l "$WORK/out"
