#include "satoru_bindings.h"
#include "layout_json.h"

#include <map>

using namespace emscripten;

// ---- Shared helper (image-opt版 val_to_vector を採用: Uint8Array + ArrayBuffer 両対応) ----
std::vector<uint8_t> val_to_vector(val data) {
    unsigned len = 0;
    if (data["length"].isUndefined()) {
        if (!data["byteLength"].isUndefined()) {
            len = data["byteLength"].as<unsigned>();
        }
    } else {
        len = data["length"].as<unsigned>();
    }
    std::vector<uint8_t> vec(len);
    if (len > 0) {
        val memoryView = val(typed_memory_view(len, vec.data()));
        if (data["length"].isUndefined()) {
            val uint8View = val::global("Uint8Array").new_(data);
            memoryView.call<void>("set", uint8View);
        } else {
            memoryView.call<void>("set", data);
        }
    }
    return vec;
}

// satoru版 parse_options を SatoruRenderOptions 向けに移設 (フィールド1:1)。
void parse_satoru_options(SatoruRenderOptions& options, val options_val) {
    if (options_val.isUndefined() || options_val.isNull()) return;
    if (options_val.hasOwnProperty("svgTextToPaths")) {
        options.svgTextToPaths = options_val["svgTextToPaths"].as<bool>();
    }
    if (options_val.hasOwnProperty("outputWidth")) {
        options.outputWidth = options_val["outputWidth"].as<int>();
    }
    if (options_val.hasOwnProperty("outputHeight")) {
        options.outputHeight = options_val["outputHeight"].as<int>();
    }
    if (options_val.hasOwnProperty("fitType")) {
        options.fitType = options_val["fitType"].as<int>();
    }
    if (options_val.hasOwnProperty("cropX")) {
        options.cropX = options_val["cropX"].as<int>();
    }
    if (options_val.hasOwnProperty("cropY")) {
        options.cropY = options_val["cropY"].as<int>();
    }
    if (options_val.hasOwnProperty("cropWidth")) {
        options.cropWidth = options_val["cropWidth"].as<int>();
    }
    if (options_val.hasOwnProperty("cropHeight")) {
        options.cropHeight = options_val["cropHeight"].as<int>();
    }
    if (options_val.hasOwnProperty("backgroundColor")) {
        options.backgroundColor = options_val["backgroundColor"].as<uint32_t>();
    }
    if (options_val.hasOwnProperty("fitPositionX")) {
        options.fitPositionX = options_val["fitPositionX"].as<float>();
    }
    if (options_val.hasOwnProperty("fitPositionY")) {
        options.fitPositionY = options_val["fitPositionY"].as<float>();
    }
    if (options_val.hasOwnProperty("mediaType")) {
        options.mediaType = options_val["mediaType"].as<int>();
    }
    if (options_val.hasOwnProperty("scale")) {
        options.scale = options_val["scale"].as<float>();
    }
    if (options_val.hasOwnProperty("colorSpace")) {
        options.colorSpace = options_val["colorSpace"].as<int>();
    }
    if (options_val.hasOwnProperty("pdfTitle")) {
        options.pdfTitle = options_val["pdfTitle"].as<std::string>();
    }
    if (options_val.hasOwnProperty("pdfOutline")) {
        options.pdfOutline = options_val["pdfOutline"].as<bool>();
    }
    if (options_val.hasOwnProperty("pdfAuthor")) {
        options.pdfAuthor = options_val["pdfAuthor"].as<std::string>();
    }
    if (options_val.hasOwnProperty("pdfSubject")) {
        options.pdfSubject = options_val["pdfSubject"].as<std::string>();
    }
    if (options_val.hasOwnProperty("pdfKeywords")) {
        options.pdfKeywords = options_val["pdfKeywords"].as<std::string>();
    }
    if (options_val.hasOwnProperty("pdfCreator")) {
        options.pdfCreator = options_val["pdfCreator"].as<std::string>();
    }
    if (options_val.hasOwnProperty("pdfProducer")) {
        options.pdfProducer = options_val["pdfProducer"].as<std::string>();
    }
    if (options_val.hasOwnProperty("pdfMarginTop")) {
        options.pdfMarginTop = options_val["pdfMarginTop"].as<int>();
    }
    if (options_val.hasOwnProperty("pdfMarginRight")) {
        options.pdfMarginRight = options_val["pdfMarginRight"].as<int>();
    }
    if (options_val.hasOwnProperty("pdfMarginBottom")) {
        options.pdfMarginBottom = options_val["pdfMarginBottom"].as<int>();
    }
    if (options_val.hasOwnProperty("pdfMarginLeft")) {
        options.pdfMarginLeft = options_val["pdfMarginLeft"].as<int>();
    }
    if (options_val.hasOwnProperty("pdfHeader")) {
        options.pdfHeader = options_val["pdfHeader"].as<std::string>();
    }
    if (options_val.hasOwnProperty("pdfSkipRunning")) {
        options.pdfSkipRunning = options_val["pdfSkipRunning"].as<int>();
    }
    if (options_val.hasOwnProperty("pdfFooter")) {
        options.pdfFooter = options_val["pdfFooter"].as<std::string>();
    }
}

std::vector<std::string> val_to_html_vector(val htmls) {
    std::vector<std::string> html_vector;
    if (htmls.isArray()) {
        auto l = htmls["length"].as<unsigned>();
        for (unsigned i = 0; i < l; ++i) {
            html_vector.push_back(htmls[i].as<std::string>());
        }
    } else {
        html_vector.push_back(htmls.as<std::string>());
    }
    return html_vector;
}

// satoru版 render_val の改名移設。satoru_api_render (実在) に接続。
val satoru_render_val(SatoruInstance* inst, val htmls, int width, int height, int format,
                      val options_val) {
    if (!inst) return val::null();
    std::vector<std::string> html_vector = val_to_html_vector(htmls);
    SatoruRenderOptions options;
    parse_satoru_options(options, options_val);
    int size = 0;
    const uint8_t* data = satoru_api_render(inst, html_vector, width, height,
                                            (RenderFormat)format, options, size);
    if (!data || size == 0) return val::null();
    return val(typed_memory_view(size, data));
}

// satoru_set_font_map: C APIは const std::map<std::string,std::string>& 受けのためJS直結不可。
// JSオブジェクト {family: url} 受けのvalラッパ経由で登録する。
// Debug: every element's border box as JSON (see api/layout_json.h). `htmls` is one page.
std::string satoru_layout_json_val(SatoruInstance* inst, val htmls, int width, int height,
                                   int mediaType, bool includeInline) {
    std::vector<std::string> pages = val_to_html_vector(htmls);
    if (!inst || pages.empty()) return "[]";
    return satoru_api_layout_json(inst, pages[0], width, height, mediaType, includeInline);
}

// Same walk with the computed (used) style of every element: `"s":{display,position,color,...}` (see api/layout_json.cpp).
std::string satoru_layout_style_json_val(SatoruInstance* inst, val htmls, int width, int height,
                                         int mediaType, bool includeInline) {
    std::vector<std::string> pages = val_to_html_vector(htmls);
    if (!inst || pages.empty()) return "[]";
    return satoru_api_layout_json(inst, pages[0], width, height, mediaType, includeInline, true);
}

// P0 probe: restyle + relayout the document the last layout call left behind; see document::live_probe.
std::string satoru_live_probe_val(SatoruInstance* inst, int width, int mode) {
    if (!inst || !inst->doc) return "{}";
    auto t = inst->doc->live_probe((litehtml::pixel_t)normalize_viewport_width(width), mode);
    char buf[200];
    snprintf(buf, sizeof(buf), "{\"clear\":%.2f,\"apply\":%.2f,\"compute\":%.2f,\"tree\":%.2f,\"layout\":%.2f}", t.clear, t.apply, t.compute, t.tree, t.layout);
    return buf;
}

// Live layout: open a document, apply attribute ops to it ("ok" or "rebuild"), read the boxes of the document held now.
void satoru_live_open_val(SatoruInstance* inst, std::string html, int width, int mediaType) {
    satoru_api_live_open(inst, html, width, mediaType);
}
std::string satoru_live_apply_val(SatoruInstance* inst, std::string ops, int width) {
    return satoru_api_live_apply(inst, ops, normalize_viewport_width(width)) ? "ok" : "rebuild";
}
std::string satoru_live_sync_val(SatoruInstance* inst, bool delta) {
    return satoru_api_live_boxes(inst, delta);
}
std::string satoru_live_boxes_val(SatoruInstance* inst) {
    return satoru_api_layout_json_current(inst, true, true);
}

void satoru_set_font_map_val(SatoruInstance* inst, val fontMap) {
    if (!inst || fontMap.isUndefined() || fontMap.isNull()) return;
    std::map<std::string, std::string> m;
    val keys = val::global("Object").call<val>("keys", fontMap);
    unsigned n = keys["length"].as<unsigned>();
    for (unsigned i = 0; i < n; ++i) {
        std::string k = keys[i].as<std::string>();
        m[k] = fontMap[k].as<std::string>();
    }
    satoru_api_set_font_map(inst, m);
}

// satoru resource discovery/injection (upstream idiom).
// Bodies (collect/add/pending/load_font) are fully ported in api/satoru_api.cpp;
// only the Embind registrations were missing, so externally referenced fonts
// and images could never be resolved (data: URLs resolve inline in request()).
void satoru_collect_resources_val(SatoruInstance* inst, val htmls, int width, int height,
                                  int mediaType) {
    if (!inst) return;
    // One call covers all pages: JS no longer loops page by page across the wasm boundary.
    satoru_api_collect_resources_pages(inst, val_to_html_vector(htmls), width, height, mediaType);
}
val satoru_get_pending_resources_val(SatoruInstance* inst) {
    if (!inst) return val::null();
    int size = 0;
    const uint8_t* data = satoru_api_get_pending_resources_binary(inst, size);
    if (!data || size == 0) return val::null();
    return val(typed_memory_view(size, data));
}
void satoru_add_resource_val(SatoruInstance* inst, std::string url, int type, val data) {
    if (!inst) return;
    auto vec = val_to_vector(data);
    satoru_api_add_resource(inst, url, type, vec);
}
void satoru_load_font_val(SatoruInstance* inst, std::string name, val data) {
    if (!inst) return;
    auto vec = val_to_vector(data);
    satoru_api_load_font(inst, name, vec);
}
void satoru_load_fallback_font_val(SatoruInstance* inst, val data) {
    if (!inst) return;
    auto vec = val_to_vector(data);
    satoru_api_load_fallback_font(inst, vec);
}
