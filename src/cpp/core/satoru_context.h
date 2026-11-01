#ifndef SATORU_CONTEXT_H
#define SATORU_CONTEXT_H

#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "core/ilogger.h"
#include "core/satoru_cache_manager.h"
#include "core/text/text_types.h"
#include "core/text/unicode_service.h"
#include "font_manager.h"
#include "include/core/SkData.h"
#include "include/core/SkFontStyle.h"
#include "modules/skshaper/include/SkShaper.h"
#include "modules/skunicode/include/SkUnicode.h"
#include "common/lru_cache.h"
#include "utils/skia_utils.h"

enum class CssChangeKind {
    Generic,
    UserScan,
    ExternalResource,
    FontResourceCss,
    FontAliasCss,
    GeneratedFontFace,
};

// litehtml ignores @font-face, and the font manager scans the font CSS text itself, so the
// (often huge: a Google Fonts CSS holds a rule per unicode-range subset) @font-face rules are
// dropped from the CSS that every document creation tokenizes and parses.
inline std::string strip_font_face_rules_uncached(const std::string& css) {
    static const char kRule[] = "@font-face";
    if (css.find(kRule) == std::string::npos) return css;
    std::string out;
    out.reserve(css.size());
    size_t i = 0;
    const size_t n = css.size();
    while (i < n) {
        if (css.compare(i, 2, "/*") == 0) {  // keep comments as they are
            size_t end = css.find("*/", i + 2);
            end = end == std::string::npos ? n : end + 2;
            out.append(css, i, end - i);
            i = end;
            continue;
        }
        if (css.compare(i, sizeof(kRule) - 1, kRule) == 0) {
            const size_t open = css.find('{', i);
            if (open == std::string::npos) break;
            int depth = 0;
            size_t j = open;
            char quote = 0;
            for (; j < n; ++j) {
                const char c = css[j];
                if (quote) {
                    if (c == '\\') {
                        ++j;
                    } else if (c == quote) {
                        quote = 0;
                    }
                } else if (c == '"' || c == '\'') {
                    quote = c;
                } else if (c == '{') {
                    ++depth;
                } else if (c == '}' && --depth == 0) {
                    break;
                }
            }
            i = j < n ? j + 1 : n;
            continue;
        }
        out.push_back(css[i++]);
    }
    return out;
}

// Every render builds a new context and is handed the same default web font stylesheet (111 KB), so the result for a large
// stylesheet is remembered by its text: the scan is a per-character loop that costs about a millisecond in wasm.
inline std::string strip_font_face_rules(const std::string& css) {
    if (css.size() < 4096) return strip_font_face_rules_uncached(css);
    static thread_local std::vector<std::pair<std::string, std::string>> memo;
    for (const auto& e : memo)
        if (e.first == css) return e.second;
    std::string out = strip_font_face_rules_uncached(css);
    if (memo.size() >= 4) memo.erase(memo.begin());
    memo.emplace_back(css, out);
    return out;
}

class SatoruContext {
    satoru::ILogger *m_logger = nullptr;
    sk_sp<SkData> m_lastPng;
    sk_sp<SkData> m_lastWebp;
    sk_sp<SkData> m_lastPdf;
    sk_sp<SkData> m_lastSvg;
    std::string m_extraCss;
    // CSS fetched for the page itself (<link rel=stylesheet>, @import). Author origin, so it
    // is kept apart from m_extraCss (user origin: the `css` option, @font-face helpers).
    std::string m_pageCss;
    std::unordered_set<std::string> m_extraCssBlocks;
    std::map<std::string, std::string> m_fontMap;
    // Interned font family names for text cache keys (see getFontFamilyId).
    std::map<std::string, uint32_t, std::less<>> m_fontFamilyIds;
    uint32_t m_fontFamilyIdCounter = 0;
    uint64_t m_cssVersion = 0;
    uint64_t m_userCssVersion = 0;
    uint64_t m_externalCssVersion = 0;
    uint64_t m_fontResourceCssVersion = 0;
    uint64_t m_fontAliasCssVersion = 0;
    uint64_t m_generatedFontFaceCssVersion = 0;
    uint64_t m_fontVersion = 0;
    bool m_svgDirty = false;  // fonts or images arrived since the SVG images were last drawn
    uint64_t m_imageVersion = 0;
    uint64_t m_fontResourceNamedLoadCount = 0;
    uint64_t m_fontResourceFallbackLoadCount = 0;
    uint64_t m_fontResourceRegisteredCount = 0;
    uint64_t m_fontResourceDuplicateLoadCount = 0;
    uint64_t m_generatedFontFaceAttemptCount = 0;
    uint64_t m_generatedFontFaceAddedCount = 0;
    uint64_t m_generatedFontFaceDuplicateCount = 0;

    std::unique_ptr<satoru::UnicodeService> m_unicodeService;
    std::unique_ptr<SkShaper> m_shaper;

   public:
    struct LayoutProfile {
        bool enabled = false;
        double container_create_font_ms = 0.0;
        double container_text_width_ms = 0.0;
        double container_split_text_ms = 0.0;
        double container_bidi_ms = 0.0;
        double text_measure_ms = 0.0;
        double text_analyze_ms = 0.0;
        double text_shape_ms = 0.0;
        double text_shape_prepared_ms = 0.0;
        int container_create_font_count = 0;
        int container_text_width_count = 0;
        int container_text_width_unique_count = 0;
        int container_text_width_duplicate_count = 0;
        int container_split_text_count = 0;
        int container_bidi_count = 0;
        int text_measure_count = 0;
        int text_analyze_count = 0;
        int text_shape_count = 0;
        int text_shape_prepared_count = 0;
        int text_measure_cacheable_count = 0;
        int text_measure_cache_hit_count = 0;
        // Miss breakdown (cacheable but not a hit), so a cache change can be aimed at the reason
        // the cache misses: a new text/font combination (cold), the same text measured at another
        // maxWidth (width), an entry that only differs by the font generation (version), or the
        // exact key having been evicted from the LRU (evicted).
        int text_measure_miss_count = 0;
        int text_measure_miss_cold_count = 0;
        int text_measure_miss_width_count = 0;
        int text_measure_miss_version_count = 0;
        int text_measure_miss_evicted_count = 0;
        int text_shape_cacheable_count = 0;
        int text_shape_cache_hit_count = 0;
        std::unordered_set<std::string> container_text_width_keys;
        // Last (maxWidth, fontVersion) seen per width/version-independent measure identity. A miss
        // can then be classified against the previous probe of the same text in the same font.
        std::unordered_map<satoru::MeasureKey, std::pair<double, uint64_t>,
                           satoru::MeasureKeyHash>
            text_measure_probe;

        void reset() {
            container_create_font_ms = 0.0;
            container_text_width_ms = 0.0;
            container_split_text_ms = 0.0;
            container_bidi_ms = 0.0;
            text_measure_ms = 0.0;
            text_analyze_ms = 0.0;
            text_shape_ms = 0.0;
            text_shape_prepared_ms = 0.0;
            container_create_font_count = 0;
            container_text_width_count = 0;
            container_text_width_unique_count = 0;
            container_text_width_duplicate_count = 0;
            container_split_text_count = 0;
            container_bidi_count = 0;
            text_measure_count = 0;
            text_analyze_count = 0;
            text_shape_count = 0;
            text_shape_prepared_count = 0;
            text_measure_cacheable_count = 0;
            text_measure_cache_hit_count = 0;
            text_measure_miss_count = 0;
            text_measure_miss_cold_count = 0;
            text_measure_miss_width_count = 0;
            text_measure_miss_version_count = 0;
            text_measure_miss_evicted_count = 0;
            text_shape_cacheable_count = 0;
            text_shape_cache_hit_count = 0;
            container_text_width_keys.clear();
            text_measure_probe.clear();
        }
    };

    SatoruFontManager fontManager;
    std::map<std::string, image_info> imageCache;
    // Characters of the <text> inside SVG images (<img>, CSS background): SkSVGDOM draws them, layout never
    // sees them, so the font slices covering them are requested from here.
    std::set<char32_t> svgImageCodepoints;
    // Font families the <text> of SVG images names (requested like the families of HTML text), and the
    // external images they reference, which the resource manager takes over to fetch.
    std::set<std::string> svgImageFamilies;
    bool svgImageBold = false;
    std::vector<std::string> svgImageUrls;
    satoru::SatoruCacheManager cacheManager;
    LayoutProfile layoutProfile;
    bool needsRelayout = false;

    SatoruContext() {}
    SatoruContext(satoru::ILogger *logger) : m_logger(logger) {}

    void init();

    void setLogger(satoru::ILogger *logger) { m_logger = logger; }
    satoru::ILogger *getLogger() const { return m_logger; }

    satoru::UnicodeService &getUnicodeService();
    SkShaper *getShaper();

    bool addCss(const std::string &css, CssChangeKind kind = CssChangeKind::Generic) {
        if (css.empty()) return false;
        if (!m_extraCssBlocks.insert(css).second) return false;
        std::string &bucket =
            (kind == CssChangeKind::ExternalResource) ? m_pageCss : m_extraCss;
        bucket += strip_font_face_rules(css) + "\n";
        m_cssVersion++;
        switch (kind) {
            case CssChangeKind::UserScan:
                m_userCssVersion++;
                break;
            case CssChangeKind::ExternalResource:
                m_externalCssVersion++;
                break;
            case CssChangeKind::FontResourceCss:
                m_fontResourceCssVersion++;
                break;
            case CssChangeKind::FontAliasCss:
                m_fontAliasCssVersion++;
                break;
            case CssChangeKind::GeneratedFontFace:
                m_generatedFontFaceCssVersion++;
                break;
            case CssChangeKind::Generic:
                break;
        }
        return true;
    }
    const std::string &getExtraCss() const { return m_extraCss; }
    const std::string &getPageCss() const { return m_pageCss; }
    uint64_t getCssVersion() const { return m_cssVersion; }
    uint64_t getUserCssVersion() const { return m_userCssVersion; }
    uint64_t getExternalCssVersion() const { return m_externalCssVersion; }
    uint64_t getFontResourceCssVersion() const { return m_fontResourceCssVersion; }
    uint64_t getFontAliasCssVersion() const { return m_fontAliasCssVersion; }
    uint64_t getGeneratedFontFaceCssVersion() const { return m_generatedFontFaceCssVersion; }
    uint64_t getFontVersion() const { return m_fontVersion; }
    // Text cache keys refer to the resolved family by a small interned id instead
    // of copying the family string into every key (Blink NGShapeCache-style).
    // Ids are never reused, so a font change only has to bump m_fontVersion (which
    // every text cache key carries) to make all pre-change entries unreachable.
    uint32_t getFontFamilyId(std::string_view family) {
        auto it = m_fontFamilyIds.find(family);
        if (it != m_fontFamilyIds.end()) return it->second;
        const uint32_t id = ++m_fontFamilyIdCounter;
        m_fontFamilyIds.emplace(family, id);
        return id;
    }
    uint64_t getImageVersion() const { return m_imageVersion; }
    uint64_t getFontResourceNamedLoadCount() const { return m_fontResourceNamedLoadCount; }
    uint64_t getFontResourceFallbackLoadCount() const { return m_fontResourceFallbackLoadCount; }
    uint64_t getFontResourceRegisteredCount() const { return m_fontResourceRegisteredCount; }
    uint64_t getFontResourceDuplicateLoadCount() const { return m_fontResourceDuplicateLoadCount; }
    uint64_t getGeneratedFontFaceAttemptCount() const { return m_generatedFontFaceAttemptCount; }
    uint64_t getGeneratedFontFaceAddedCount() const { return m_generatedFontFaceAddedCount; }
    uint64_t getGeneratedFontFaceDuplicateCount() const {
        return m_generatedFontFaceDuplicateCount;
    }
    void noteFontResourceNamedLoad() { m_fontResourceNamedLoadCount++; }
    void noteFontResourceFallbackLoad() { m_fontResourceFallbackLoadCount++; }
    void noteFontResourceRegistered(bool registered) {
        if (registered)
            m_fontResourceRegisteredCount++;
        else
            m_fontResourceDuplicateLoadCount++;
    }
    void noteGeneratedFontFace(bool added) {
        m_generatedFontFaceAttemptCount++;
        if (added)
            m_generatedFontFaceAddedCount++;
        else
            m_generatedFontFaceDuplicateCount++;
    }
    void markFontChanged() { m_fontVersion++; }
    void clearCss() {
        if (m_extraCss.empty() && m_pageCss.empty() && m_extraCssBlocks.empty()) return;
        m_extraCss.clear();
        m_pageCss.clear();
        m_extraCssBlocks.clear();
        m_cssVersion++;
    }

    bool load_font(const char *name, const uint8_t *data, int size, const char *url = nullptr) {
        bool changed = fontManager.loadFont(name, data, size, url);
        if (changed) {
            m_fontVersion++;
            m_svgDirty = true;
        }
        return changed;
    }
    bool loadFont(const char *name, const uint8_t *data, int size, const char *url = nullptr) {
        bool changed = fontManager.loadFont(name, data, size, url);
        if (changed) {
            m_fontVersion++;
            m_svgDirty = true;
        }
        return changed;
    }

    /// Draw the SVG images again if fonts were loaded since they were last drawn.
    void refreshSvgImages();

    void load_image(const char *name, const char *data_url, int width, int height) {
        loadImage(name, data_url, width, height);
    }
    void loadImage(const char *name, const char *data_url, int width, int height);
    void loadImageFromData(const char *name, const uint8_t *data, size_t size,
                           const char *original_url = nullptr);
    void loadImageFromPixels(const char *name, int width, int height, const uint8_t *pixels,
                             const char *original_url = nullptr);

    void clear_images() { clearImages(); }
    void clearImages() {
        if (imageCache.empty()) return;
        imageCache.clear();
        m_imageVersion++;
        needsRelayout = true;
    }

    void clear_fonts() { clearFonts(); }
    void clearFonts() {
        fontManager.clear();
        m_fontVersion++;
    }

    void clearAll() {
        clearFonts();
        clearImages();
        clearCss();
        m_fontMap.clear();
        cacheManager.clearAll();
    }

    void setFontMap(const std::map<std::string, std::string> &fontMap) { m_fontMap = fontMap; }
    const std::map<std::string, std::string> &getFontMap() const { return m_fontMap; }

    sk_sp<SkTypeface> get_typeface(const std::string &family, int weight, SkFontStyle::Slant slant,
                                   bool &out_fake_bold, int stretch = 100);
    std::vector<sk_sp<SkTypeface>> get_typefaces(const std::string &family, int weight,
                                                 SkFontStyle::Slant slant, bool &out_fake_bold,
                                                 int stretch = 100);
    bool get_image_size(const std::string &url, int &w, int &h);
    bool get_image_ratio_only(const std::string &url);
    bool get_image_no_ratio(const std::string &url);

    void set_last_png(sk_sp<SkData> png) { m_lastPng = std::move(png); }
    const sk_sp<SkData> &get_last_png() const { return m_lastPng; }
    size_t get_last_png_size() const { return m_lastPng ? m_lastPng->size() : 0; }

    void set_last_webp(sk_sp<SkData> webp) { m_lastWebp = std::move(webp); }
    const sk_sp<SkData> &get_last_webp() const { return m_lastWebp; }
    size_t get_last_webp_size() const { return m_lastWebp ? m_lastWebp->size() : 0; }

    void set_last_pdf(sk_sp<SkData> pdf) { m_lastPdf = std::move(pdf); }
    const sk_sp<SkData> &get_last_pdf() const { return m_lastPdf; }
    size_t get_last_pdf_size() const { return m_lastPdf ? m_lastPdf->size() : 0; }

    void set_last_svg(sk_sp<SkData> svg) { m_lastSvg = std::move(svg); }
    const sk_sp<SkData> &get_last_svg() const { return m_lastSvg; }
    size_t get_last_svg_size() const { return m_lastSvg ? m_lastSvg->size() : 0; }
};

#endif
