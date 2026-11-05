cmake_minimum_required(VERSION 3.14)
set(CMAKE_WARN_DEPRECATED OFF CACHE BOOL "" FORCE)


# --- Toolchain setup (satoru正) ---
set(CMAKE_TOOLCHAIN_FILE "$ENV{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake" CACHE STRING "")
set(VCPKG_TARGET_TRIPLET "wasm32-emscripten-wasm-eh" CACHE STRING "")
set(VCPKG_OVERLAY_TRIPLETS "${CMAKE_CURRENT_SOURCE_DIR}/triplets" CACHE STRING "")
set(VCPKG_CHAINLOAD_TOOLCHAIN_FILE "$ENV{EMSDK}/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake" CACHE STRING "")

project(html_to_image_wasm)
set(CMAKE_CXX_STANDARD 20)

# --- Unified options ---
# WASM_EXPORT_NAME: JS factory name. satoru='createSatoruModule' / image-opt='createImageConverterModule'
#  -> unified default 'createHtmlToImageModule' (override with -DWASM_EXPORT_NAME=...).
option(WASM_EXPORT_NAME "EMSCRIPTEN EXPORT_NAME" OFF) # handled below (string option emulation)
if(NOT DEFINED WASM_EXPORT_NAME OR WASM_EXPORT_NAME STREQUAL "OFF")
    set(WASM_EXPORT_NAME "createHtmlToImageModule")
endif()

# AVIF backend: AOM既定（encode対応。DAV1Dに戻す場合は -DWASM_AVIF_BACKEND=DAV1D）。
# satoru=DAV1D(SYSTEM)+AVIF_ENABLE_WASM=OFF / image-opt=AOM(SYSTEM)+AVIF_ENABLE_WASM=ON
set(WASM_AVIF_BACKEND "AOM" CACHE STRING "AVIF decoder backend: AOM (default) or DAV1D (decode-only)")

# Text shaping: ON既定 (satoru=freetype/harfbuzz/skshaper有効 / image-opt=無効だった差分をsatoru側に統一)
option(WASM_ENABLE_TEXT_SHAPING "Enable freetype+harfbuzz+skshaper" ON)
# PDF: ON (satoru=SK_SUPPORT_PDF=1 / image-opt=0 だった差分をsatoru側に統一)
option(WASM_ENABLE_PDF "Enable Skia PDF document support" ON)
# SKSL: OFF既定 (image-optのみsrc/sksl+SkRuntimeBlenderを取り込んでいた分。必要時のみON)
option(WASM_ENABLE_SKSL "Enable Skia SkSL sources" OFF)
# JXL: ON既定 (libjxl FetchContentで取得。JPEG XL encode/decode用)
option(WASM_ENABLE_JXL "Enable JPEG XL" ON)

# --- Enable ccache ---
find_program(CCACHE_PROGRAM ccache)
if(CCACHE_PROGRAM)
    set(CMAKE_C_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
    set(CMAKE_CXX_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
    message(STATUS "ccache enabled")
endif()

# --- Directories ---
set(LIBS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/src/cpp/libs")
set(LITEHTML_DIR "${LIBS_DIR}/litehtml")
set(SKIA_CONFIG_DIR "${LIBS_DIR}/skia")

include(FetchContent)

# vcpkg インストール先 (codecs.cmake / fonts.cmake で共有。分割前は AVIF 節で定義)
set(VCPKG_INSTALLED_DIR "${CMAKE_BINARY_DIR}/vcpkg_installed/wasm32-emscripten-wasm-eh")

# --- P3a 分割モジュール (ビルド等価。詳細は各ファイル冒頭コメント参照) ---
# 順序固定: wasm-flags (フラグ定義) -> codecs (FetchContent/wuffs) -> fonts (依存集約) -> skia (skia_lib)
# FetchContent バージョン固定表は cmake/codecs.cmake 冒頭に集約。
include("${CMAKE_CURRENT_SOURCE_DIR}/cmake/wasm-flags.cmake")
include("${CMAKE_CURRENT_SOURCE_DIR}/cmake/codecs.cmake")
include("${CMAKE_CURRENT_SOURCE_DIR}/cmake/fonts.cmake")
include("${CMAKE_CURRENT_SOURCE_DIR}/cmake/skia.cmake")

# --- Target: litehtml (satoruのみ。image-optには無し) ---
add_library(litehtml STATIC)
file(GLOB LITEHTML_SRC "${LITEHTML_DIR}/src/*.cpp")
target_sources(litehtml PRIVATE ${LITEHTML_SRC})
target_include_directories(litehtml PUBLIC
    "${LITEHTML_DIR}/include"
    "${LITEHTML_DIR}/include/litehtml"
)
target_link_libraries(litehtml PRIVATE unofficial::gumbo::gumbo)
target_compile_options(litehtml PRIVATE ${COMMON_COMPILE_OPTIONS} -w)


# --- Target: html_to_image_core (satoru_core + image_converter_core 統合予定) ---
# Phase2で satoru_core由来 (container_skia/renderers等) と image_converter_core由来
# (image_converter_context/thumbhash等) のOBJECTをここへ集約する。現時点ではmain.cppのみ。
# NOTE(P3a/P4): P2b 物理分割は別途。P4 paint分離で container_skia_paint.cpp を1行追加済み。
# 以降のソース登録の追加削除はP2b側で行う。
add_library(html_to_image_core OBJECT)
target_sources(html_to_image_core PRIVATE
    src/cpp/main.cpp
    src/cpp/common/image_decoder.cpp
    src/cpp/common/svg_patch.cpp
    src/cpp/common/skia_encode.cpp
    src/cpp/common/skia_utils.cpp
    src/cpp/common/thumbhash.cpp
    src/cpp/common/webp_anim_encoder.cpp
    src/cpp/common/apng_encoder.cpp
    src/cpp/common/gif_encoder.cpp
    src/cpp/common/tiff_encoder.cpp
    src/cpp/common/pdf_cmyk.cpp
    src/cpp/core/satoru_context.cpp
    src/cpp/core/image_converter_context.cpp
    src/cpp/api/satoru_api.cpp
    src/cpp/api/converter_api.cpp
    src/cpp/api/unified_api.cpp
    src/cpp/api/satoru_bindings.cpp
    src/cpp/api/layout_json.cpp
    src/cpp/api/live_layout.cpp
    src/cpp/api/converter_bindings.cpp
    src/cpp/api/unified_bindings.cpp
    src/cpp/api/js_logger.cpp
    src/cpp/core/container_skia.cpp
    src/cpp/core/container_skia_helpers.cpp
    src/cpp/core/container_skia_filters.cpp
    src/cpp/core/container_skia_transforms.cpp
    src/cpp/core/container_skia_clip.cpp
    src/cpp/core/container_skia_paint.cpp
    src/cpp/core/text_utils.cpp
    src/cpp/core/text/unicode_service.cpp
    src/cpp/core/text/text_layout.cpp
    src/cpp/core/text/text_renderer.cpp
    src/cpp/core/text/text_decoration_renderer.cpp
    src/cpp/core/text/tagging_context.cpp
    src/cpp/core/text/text_geometry.cpp
    src/cpp/core/litehtml_extensions.cpp
    src/cpp/core/el_svg.cpp
    src/cpp/core/el_mermaid.cpp
    src/cpp/mermaid/mermaid.cpp
    src/cpp/mermaid/flowchart.cpp
    src/cpp/mermaid/layered.cpp
    src/cpp/mermaid/sequence.cpp
    src/cpp/mermaid/state.cpp
    src/cpp/mermaid/classdiagram.cpp
    src/cpp/mermaid/erdiagram.cpp
    src/cpp/mermaid/xychart.cpp
    src/cpp/mermaid/pie.cpp
    src/cpp/mermaid/gantt.cpp
    src/cpp/mermaid/mindmap.cpp
    src/cpp/mermaid/timeline.cpp
    src/cpp/mermaid/treeview.cpp
    src/cpp/mermaid/swimlane.cpp
    src/cpp/mermaid/usecase.cpp
    src/cpp/mermaid/eventmodeling.cpp
    src/cpp/mermaid/railroad.cpp
    src/cpp/mermaid/cynefin.cpp
    src/cpp/mermaid/wardley.cpp
    src/cpp/mermaid/ishikawa.cpp
    src/cpp/mermaid/venn.cpp
    src/cpp/mermaid/c4.cpp
    src/cpp/mermaid/architecture.cpp
    src/cpp/mermaid/info.cpp
    src/cpp/mermaid/radar.cpp
    src/cpp/mermaid/treemap.cpp
    src/cpp/mermaid/block.cpp
    src/cpp/mermaid/requirement.cpp
    src/cpp/mermaid/sankey.cpp
    src/cpp/mermaid/packet.cpp
    src/cpp/mermaid/kanban.cpp
    src/cpp/mermaid/gitgraph.cpp
    src/cpp/mermaid/quadrant.cpp
    src/cpp/mermaid/journey.cpp
    src/cpp/core/resource_manager.cpp
    src/cpp/core/font_manager.cpp
    src/cpp/renderers/svg_renderer.cpp
    src/cpp/renderers/png_renderer.cpp
    src/cpp/renderers/webp_renderer.cpp
    src/cpp/renderers/pdf_renderer.cpp
    src/cpp/utils/logging.cpp
    src/cpp/utils/pdf_merger.cpp
    src/cpp/utils/skia_luma.cpp
    src/cpp/utils/skia_stubs.cpp
    src/cpp/utils/skunicode_satoru.cpp
)
target_include_directories(html_to_image_core PRIVATE
    "src/cpp"
    "${LITEHTML_DIR}/include"
    "${LITEHTML_DIR}/include/litehtml"
    "${LITEHTML_DIR}/src"
)
target_link_libraries(html_to_image_core PUBLIC litehtml skia_lib)
target_compile_options(html_to_image_core PRIVATE ${COMMON_COMPILE_OPTIONS})
target_compile_definitions(html_to_image_core PRIVATE SK_USER_CONFIG_HEADER="SkUserConfig.h")
if(WASM_ENABLE_JXL)
    target_compile_definitions(html_to_image_core PRIVATE JXL_ENABLED)
    # lib/jxl.cmake 公開ターゲット: `jxl` 優先、なければ `jxl_enc`
    # NOTE: OBJECT ライブラリのため $<TARGET_OBJECTS:...> 形式では最終リンクに伝播しない。
    # 実行ファイル側への PRIVATE リンクが必須（下記 Executables 参照）。ここは将来の直接リンクに備え PUBLIC。
    if(TARGET jxl)
        target_link_libraries(html_to_image_core PUBLIC jxl)
    elseif(TARGET jxl_enc)
        target_link_libraries(html_to_image_core PUBLIC jxl_enc)
    endif()
endif()

# --- Executables ---
add_executable(html_to_image $<TARGET_OBJECTS:html_to_image_core>)
target_link_libraries(html_to_image PRIVATE litehtml skia_lib)
if(WASM_ENABLE_JXL)
    if(TARGET jxl)
        target_link_libraries(html_to_image PRIVATE jxl)
    elseif(TARGET jxl_enc)
        target_link_libraries(html_to_image PRIVATE jxl_enc)
    endif()
endif()
target_link_options(html_to_image PRIVATE ${COMMON_LINK_OPTIONS})
set_target_properties(html_to_image PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/packages/html-to-image/dist"
    OUTPUT_NAME "html-to-image"
    SUFFIX ".js"
)

# --- Host unit tests (P5) ---
# WASM/EMSCRIPTEN ビルドに影響させないためホスト時のみ登録。既存ターゲット・フラグ・ソースリスト不変。
# 単独実行も可: cmake -S tests/cpp -B build-host-tests (tests/cpp/CMakeLists.txt 参照)。
if(NOT DEFINED EMSCRIPTEN AND NOT CMAKE_SYSTEM_NAME STREQUAL "Emscripten")
    include(CTest)
    add_subdirectory(tests/cpp)
endif()
