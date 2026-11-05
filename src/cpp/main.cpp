// Single-WASM entry point: satoru (HTML描画) + image-converter (変換) を1モジュールに統合。
//
// mangle衝突回避方針 (適用済み):
//  - 両リポとも extern "C" { create_instance / destroy_instance } と
//    api_create_instance / api_destroy_instance / api_set_log_level / api_load_image を定義しており、
//    そのままリンクすると多重定義/シンボル衝突になるため、C++ 側API関数名自体を
//    satoru_api_create_instance / converter_api_create_instance 等へ改名し、
//    Cエクスポートも satoru_create_instance / converter_create_instance に分離した。
//    (旧素朴名 create_instance 等のextern "C"エクスポートは作らない)
//  - JS-visibleなEmbind登録名も本ファイルの通り satoru_*/converter_* にprefix分離する。
//    set_log_level / load_image 等の衝突名は登録しない。
//
// 本ファイルは登録表 (EMSCRIPTEN_BINDINGS) + Cエクスポートのみを持つ。
// valラッパ実体は api/*_bindings.cpp に引越済み:
//  - parse/val_to_* + satoru系 → api/satoru_bindings.h/.cpp
//  - encode/svg/pdf/load系 → api/converter_bindings.h/.cpp
//  - html_to_image_val (+g_last_unified_bytes) → api/unified_bindings.h/.cpp

#include <emscripten.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "api/converter_api.h"
#include "api/converter_bindings.h"
#include "api/satoru_api.h"
#include "api/satoru_bindings.h"
#include "api/unified_bindings.h"
#include "bridge/bridge_types.h"

using namespace emscripten;

extern "C" {

// Cエクスポートもprefix分離する。素朴名 create_instance/destroy_instance は輸出禁止。
EMSCRIPTEN_KEEPALIVE
SatoruInstance* satoru_create_instance() { return satoru_api_create_instance(); }

EMSCRIPTEN_KEEPALIVE
void satoru_destroy_instance(SatoruInstance* inst) { satoru_api_destroy_instance(inst); }

EMSCRIPTEN_KEEPALIVE
ImageConverterInstance* converter_create_instance() { return converter_api_create_instance(); }

EMSCRIPTEN_KEEPALIVE
void converter_destroy_instance(ImageConverterInstance* inst) {
    converter_api_destroy_instance(inst);
}
}

// 単一EMSCRIPTEN_BINDINGS。旧2モジュール名 (satoru / image_converter) は廃止。
EMSCRIPTEN_BINDINGS(html_to_image) {
    class_<SatoruInstance>("SatoruInstance");
    class_<ImageConverterInstance>("ImageConverterInstance");

    // NOTE: 各メンバ関数の実体は api/*.cpp + core/* に接続済み。
    // JS名は衝突回避のため satoru_* / converter_* にprefix分離する:
    //   satoru_create_instance / satoru_destroy_instance / satoru_set_log_level /
    //   satoru_render / satoru_load_image / ... および
    //   converter_create_instance / converter_destroy_instance / converter_set_log_level /
    //   converter_load_image / converter_encode / converter_crop / converter_resize / ...
    // 素朴名 create_instance / destroy_instance / set_log_level / load_image での登録は禁止。
    function("satoru_create_instance", &satoru_create_instance, allow_raw_pointers());
    function("satoru_destroy_instance", &satoru_destroy_instance, allow_raw_pointers());
    function("satoru_set_log_level", &satoru_api_set_log_level);
    function("satoru_render", &satoru_render_val, allow_raw_pointers());
    // satoru resource系のうち実体ありのみ登録。
    // 除外: load_image_pixels(C APIなし)。
    // 削除済み (WASM到達不能のため実体ごと除去): init_document/
    // layout_document/render_from_state/merge_pdfs/
    // get_pending_resources(JSON)/get_font_diagnostics。
    // collect_resources/add_resource/load_font/load_fallback_font/
    // get_pending_resources は実体ありのため登録
    // (外部フォント/画像の解決に必須)。
    function("satoru_collect_resources", &satoru_collect_resources_val, allow_raw_pointers());
    function("satoru_layout_json", &satoru_layout_json_val, allow_raw_pointers());
    function("satoru_live_open", &satoru_live_open_val, allow_raw_pointers());
    function("satoru_live_apply", &satoru_live_apply_val, allow_raw_pointers());
    function("satoru_live_sync", &satoru_live_sync_val, allow_raw_pointers());
    function("satoru_live_boxes", &satoru_live_boxes_val, allow_raw_pointers());
    function("satoru_live_probe", &satoru_live_probe_val, allow_raw_pointers());
    function("satoru_layout_style_json", &satoru_layout_style_json_val, allow_raw_pointers());
    function("satoru_get_pending_resources", &satoru_get_pending_resources_val,
             allow_raw_pointers());
    function("satoru_add_resource", &satoru_add_resource_val, allow_raw_pointers());
    function("satoru_load_font", &satoru_load_font_val, allow_raw_pointers());
    function("satoru_load_fallback_font", &satoru_load_fallback_font_val, allow_raw_pointers());
    function("satoru_scan_css", &satoru_api_scan_css, allow_raw_pointers());
    function("satoru_load_image", &satoru_api_load_image, allow_raw_pointers());
    function("satoru_set_font_map", &satoru_set_font_map_val, allow_raw_pointers());
    function("satoru_get_last_png_size", &satoru_api_get_last_png_size, allow_raw_pointers());
    function("satoru_get_last_webp_size", &satoru_api_get_last_webp_size, allow_raw_pointers());
    function("satoru_get_last_pdf_size", &satoru_api_get_last_pdf_size, allow_raw_pointers());
    function("satoru_get_last_svg_size", &satoru_api_get_last_svg_size, allow_raw_pointers());
    function("satoru_get_collect_profile", &satoru_api_get_collect_profile, allow_raw_pointers());
    function("satoru_set_collect_profile_enabled", &satoru_api_set_collect_profile_enabled,
             allow_raw_pointers());
    function("converter_create_instance", &converter_create_instance, allow_raw_pointers());
    function("converter_destroy_instance", &converter_destroy_instance, allow_raw_pointers());
    function("converter_set_log_level", &converter_api_set_log_level);
    function("converter_load_image", &converter_load_image_val, allow_raw_pointers());
    function("converter_encode", &converter_encode_val, allow_raw_pointers());
    function("converter_encode_svg", &converter_encode_svg_val, allow_raw_pointers());
    function("converter_encode_pdf", &converter_encode_pdf_val, allow_raw_pointers());
    function("converter_encode_pdf_cmyk", &converter_encode_pdf_cmyk_val, allow_raw_pointers());
    function("converter_set_dpi", &converter_set_dpi_val, allow_raw_pointers());
    function("converter_crop", &converter_api_crop, allow_raw_pointers());
    // converter_resize の fit は必須引数として渡す (C++側既定値fit=0=Contain)。
    function("converter_resize", &converter_api_resize, allow_raw_pointers());
    function("converter_get_original_width", &converter_api_get_original_width,
             allow_raw_pointers());
    function("converter_get_original_height", &converter_api_get_original_height,
             allow_raw_pointers());
    function("converter_is_original_animation", &converter_api_is_original_animation,
             allow_raw_pointers());
    function("converter_get_original_format", &converter_api_get_original_format,
             allow_raw_pointers());
    function("converter_get_width", &converter_api_get_width, allow_raw_pointers());
    function("converter_get_height", &converter_api_get_height, allow_raw_pointers());
    function("converter_is_animation", &converter_api_is_animation, allow_raw_pointers());
    function("converter_get_format", &converter_api_get_format, allow_raw_pointers());
    function("html_to_image", &html_to_image_val);
    function("satoru_render_to_converter", &satoru_render_to_converter_val,
             allow_raw_pointers());
    // Animated (opacity / transform / color) HTML -> additive converter
    // frames. Positional:
    // (satoruInst, converterInst, htmls, width, height, options, durationMs, fps).
    function("satoru_render_animation_to_converter", &satoru_render_animation_to_converter_val,
             allow_raw_pointers());
}
