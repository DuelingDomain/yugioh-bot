# Replaces wasm/kws/CMakeLists.txt of the pinned sherpa-onnx checkout (see ../build-kws-wasm.sh).
# Differences from upstream:
#  - no --preload-file: the model is self-hosted and written into the module file system at run time
#  - INITIAL_MEMORY 64MB (upstream 512MB), growth stays on
#  - SherpaOnnxCreateKeywordStreamWithKeywords is exported (card names that arrive after the spotter exists)
#  - an ES module for a dedicated worker (MODULARIZE + EXPORT_ES6, ENVIRONMENT=worker), FS exported
if(NOT $ENV{SHERPA_ONNX_IS_USING_BUILD_WASM_SH})
    message(FATAL_ERROR "Please use scripts/voice/build-kws-wasm.sh to build for wasm KWS")
endif()

set(exported_functions
  SherpaOnnxCreateKeywordSpotter
  SherpaOnnxCreateKeywordStream
  SherpaOnnxCreateKeywordStreamWithKeywords
  SherpaOnnxDecodeKeywordStream
  SherpaOnnxDestroyKeywordResult
  SherpaOnnxDestroyKeywordSpotter
  SherpaOnnxDestroyOnlineStream
  SherpaOnnxGetKeywordResult
  SherpaOnnxIsKeywordStreamReady
  SherpaOnnxOnlineStreamAcceptWaveform
  SherpaOnnxOnlineStreamInputFinished
  SherpaOnnxResetKeywordStream
)
set(mangled_exported_functions)
foreach(x IN LISTS exported_functions)
    list(APPEND mangled_exported_functions "_${x}")
endforeach()

list(JOIN mangled_exported_functions "," all_exported_functions)

include_directories(${CMAKE_SOURCE_DIR})
set(MY_FLAGS "-s FORCE_FILESYSTEM=1 -s INITIAL_MEMORY=${KWS_INITIAL_MEMORY} -s ALLOW_MEMORY_GROWTH=1")
string(APPEND MY_FLAGS " -sSTACK_SIZE=5242880 ")
string(APPEND MY_FLAGS " -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createSherpaKws -sENVIRONMENT=worker ")
string(APPEND MY_FLAGS " -sEXPORTED_FUNCTIONS=[_CopyHeap,_malloc,_free,${all_exported_functions}] ")
string(APPEND MY_FLAGS " -sEXPORTED_RUNTIME_METHODS=['ccall','stringToUTF8','setValue','getValue','lengthBytesUTF8','UTF8ToString','HEAPU8','HEAP32','HEAPF32','FS'] ")

message(STATUS "MY_FLAGS: ${MY_FLAGS}")

set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${MY_FLAGS}")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${MY_FLAGS}")
set(CMAKE_EXECUTABLE_LINKER_FLAGS "${CMAKE_EXECUTABLE_LINKER_FLAGS} ${MY_FLAGS}")

add_executable(sherpa-onnx-wasm-kws-main sherpa-onnx-wasm-main-kws.cc)
target_link_libraries(sherpa-onnx-wasm-kws-main sherpa-onnx-c-api)
install(TARGETS sherpa-onnx-wasm-kws-main DESTINATION bin/wasm)

install(
        FILES
        "$<TARGET_FILE_DIR:sherpa-onnx-wasm-kws-main>/sherpa-onnx-wasm-kws-main.js"
        "$<TARGET_FILE_DIR:sherpa-onnx-wasm-kws-main>/sherpa-onnx-wasm-kws-main.wasm"
        DESTINATION
        bin/wasm
)
