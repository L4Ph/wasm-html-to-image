#ifndef HTML_TO_IMAGE_SATORU_API_H
#define HTML_TO_IMAGE_SATORU_API_H

#include <litehtml/document.h>

#include <cstdarg>
#include <cstdint>
#include <memory>
#include <unordered_map>
#include <string>
#include <vector>

#include "../bridge/bridge_types.h"
#include "core/container_skia.h"
#include "core/resource_manager.h"
#include "core/satoru_context.h"
#include "include/core/SkBitmap.h"

// P1: 共有JsLoggerの唯一所有者は satoru_api.cpp の g_js_logger。
// converter_api_set_log_level からも同一インスタンスへ集約するための
// 追加アクセサ (既存シンボルのシグネチャ変更なし・bindings登録不変)。
namespace satoru {
class JsLogger;
}
satoru::JsLogger* satoru_api_get_js_logger();

class SatoruInstance {
   public:
    SatoruContext context;
    ResourceManager resourceManager;

    // Persisted state
    std::unique_ptr<container_skia> render_container;
    std::shared_ptr<litehtml::document> doc;
    std::string last_parsed_html;
    size_t last_extra_css_size = 0;
    uint64_t last_css_version = 0;
    uint64_t last_font_version = 0;
    uint64_t last_image_version = 0;
    int last_width = -1;
    int last_height = -1;
    int last_media_type = -1;
    bool image_sizes_scanned = false;
    bool needs_relayout = false;
    std::string last_font_face_scan_html;

    // Live layout (api/live_layout.cpp): the elements of the open document by the id the page gave them (`qjsl-<id>`).
    std::unordered_map<uint32_t, std::weak_ptr<litehtml::element>> live_ids;
    int live_width = 0;
    std::unordered_map<uint32_t, std::string> live_prev; // the last boxes sent for each id (for the delta)

    // True when `doc` was built and laid out by collect_resources for exactly this
    // input and nothing has changed since (mirrors collect_resources' rebuild/relayout
    // conditions), so it can be drawn without parsing and laying out again.
    bool document_ready_for(const std::string& html, int width, int height, int mediaType) const;
    std::string cached_full_master_css;
    std::vector<uint8_t> pending_resources_buffer;
    double profile_scan_font_faces_ms = 0.0;
    double profile_create_document_ms = 0.0;
    double profile_render_layout_ms = 0.0;
    double profile_scan_image_sizes_ms = 0.0;
    double profile_font_requests_ms = 0.0;
    int profile_requested_font_count = 0;
    int profile_font_url_count = 0;
    int profile_font_requests_with_urls_count = 0;
    int profile_provider_font_request_count = 0;
    int profile_mapped_font_url_request_count = 0;
    int profile_font_character_count = 0;
    int profile_measured_font_character_count = 0;
    int profile_ext_missing_count = 0;
    int profile_hana_url_count = 0;
    int profile_rebuild_count = 0;
    int profile_rebuild_initial_count = 0;
    int profile_rebuild_html_count = 0;
    int profile_rebuild_css_count = 0;
    int profile_rebuild_font_count = 0;
    int profile_rebuild_media_count = 0;
    int profile_layout_count = 0;
    int profile_layout_size_count = 0;
    int profile_layout_relayout_count = 0;
    bool collect_profile_enabled = false;

    SatoruInstance();
    ~SatoruInstance();

    // Core Logic
    void collect_resources(const std::string &html, int width, int height, int mediaType = 0);
    const std::string &get_full_master_css() const;
    std::string get_collect_profile_json() const;
    void set_collect_profile_enabled(bool enabled) { collect_profile_enabled = enabled; }

    // Resource Management
    void add_resource(const std::string &url, ResourceType type, const std::vector<uint8_t> &data);
    void scan_css(const std::string &css);
    void load_font(const std::string &name, const std::vector<uint8_t> &data);
    void load_image(const std::string &name, const std::string &data_url, int width, int height);
    void load_image_pixels(const std::string &name, int width, int height,
                           const std::vector<uint8_t> &pixels, const std::string &data_url);
    const uint8_t *get_pending_resources_binary(int &out_size);
};

SatoruInstance *satoru_api_create_instance();
void satoru_api_destroy_instance(SatoruInstance *inst);

std::string satoru_api_html_to_svg(SatoruInstance *inst, const char *html, int width, int height,
                            const SatoruRenderOptions &options);
// Render to a bitmap using the instance state (fonts/images/css), skipping any encode.
bool satoru_api_html_to_bitmap(SatoruInstance *inst, const char *html, int width, int height,
                               const SatoruRenderOptions &options, SkBitmap &out);

const uint8_t *satoru_api_html_to_png(SatoruInstance *inst, const char *html, int width, int height,
                               const SatoruRenderOptions &options, int &out_size);
const uint8_t *satoru_api_html_to_webp(SatoruInstance *inst, const char *html, int width, int height,
                                const SatoruRenderOptions &options, int &out_size);
const uint8_t *satoru_api_html_to_pdf(SatoruInstance *inst, const char *html, int width, int height,
                               const SatoruRenderOptions &options, int &out_size);
const uint8_t *satoru_api_htmls_to_pdf(SatoruInstance *inst, const std::vector<std::string> &htmls,
                                int width, int height, const SatoruRenderOptions &options, int &out_size);
const uint8_t *satoru_api_render(SatoruInstance *inst, const std::vector<std::string> &htmls, int width,
                          int height, RenderFormat format, const SatoruRenderOptions &options,
                          int &out_size);
int satoru_api_get_last_png_size(SatoruInstance *inst);
int satoru_api_get_last_webp_size(SatoruInstance *inst);
int satoru_api_get_last_pdf_size(SatoruInstance *inst);
int satoru_api_get_last_svg_size(SatoruInstance *inst);
void satoru_api_collect_resources(SatoruInstance *inst, const std::string &html, int width, int height,
                           int mediaType = 0);
// Collect every page in one call. Requests accumulate in the instance's ResourceManager
// (deduplicated by URL), so one get_pending_resources afterwards yields the union for all
// pages. Pages are laid out one after another on the same instance; when this returns the
// instance holds the document of the LAST page.
void satoru_api_collect_resources_pages(SatoruInstance *inst, const std::vector<std::string> &htmls,
                                        int width, int height, int mediaType = 0);
std::string satoru_api_get_collect_profile(SatoruInstance *inst);
void satoru_api_set_collect_profile_enabled(SatoruInstance *inst, bool enabled);
void satoru_api_add_resource(SatoruInstance *inst, const std::string &url, int type,
                      const std::vector<uint8_t> &data);
void satoru_api_scan_css(SatoruInstance *inst, const std::string &css);
void satoru_api_load_font(SatoruInstance *inst, const std::string &name, const std::vector<uint8_t> &data);
void satoru_api_load_fallback_font(SatoruInstance *inst, const std::vector<uint8_t> &data);
void satoru_api_load_image(SatoruInstance *inst, const std::string &name, const std::string &data_url,
                    int width, int height);
void satoru_api_set_font_map(SatoruInstance *inst, const std::map<std::string, std::string> &fontMap);

void satoru_api_set_log_level(int level);

const uint8_t *satoru_api_get_pending_resources_binary(SatoruInstance *inst, int &out_size);

#endif  // HTML_TO_IMAGE_SATORU_API_H
