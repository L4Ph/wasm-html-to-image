#include "font_manager.h"

// P2b: 本ファイル(約812行)の責務整理マップ (振る舞い不変)。
//   font_load    : SatoruFontManager ctor / loadFont / clear (登録・破棄)
//   font_fallback: scanFontFaces / getFontUrls / getFontUrl / hasFontFaceSource /
//                  matchFonts / getMatchedWeight / getMatchedSlant / selectFont (代替選択)
//   font_metrics : 代替書体の縦メトリクス差し替え (matchMetricFallbackFonts と
//                  MetricTypeface / MetricScalerContext。要求 family の hhea 相当に合わせる)
//   font_cache   : g_* グローバルレジストリ / createSkFont (可変フォント複製cache含む)
//   font_css     : cleanName / parseUnicodeRange / checkUnicodeRange / generateFontFaceCSS
//                (SVG <defs> へ出す @font-face 生成は generateFontFaceCSS のみ)
// 将来の物理分割時は上記単位で font_<name>.cpp へ切り出す。正常系不変・新規throwなし。
// P0/P1 log規約: 本ファイルは SATORU_LOG_* のみ使用 (printf/puts 等の直接出力禁止)。

#include <algorithm>
#include <charconv>
#include <memory>
#include <mutex>
#include <sstream>
#include <utility>

#include "core/text/unicode_service.h"
#include "include/core/SkData.h"
#include "include/core/SkFont.h"
#include "include/core/SkFontArguments.h"
#include "include/core/SkFontMetrics.h"
#include "include/core/SkFontTypes.h"
#include "include/core/SkSpan.h"
#include "utils/logging.h"
#include "utils/skia_utils.h"

// Skia は、システムフォントマネージャ用に「全 virtual を実書体へ委譲する」
// 型 (SkTypeface_proxy / SkScalerContext_proxy) を src/ports に持つ。本ビルドの
// skia_lib はこの翻訳単位をコンパイルしないため、代替書体の縦メトリクスだけを
// 差し替えるサブクラスを作れるよう、ここで取り込む (Skia 側は無改変)。
// Skia 自身のビルドは -w なので、取り込み時だけ同種の警告を抑止する。
#if defined(__clang__)
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wundef"
#endif
#include "src/ports/SkTypeface_proxy.cpp"
#if defined(__clang__)
#pragma clang diagnostic pop
#endif

// External declaration for the custom empty font manager
extern sk_sp<SkFontMgr> SkFontMgr_New_Custom_Empty();

#ifndef SkSetFourByteTag
#define SkSetFourByteTag(a, b, c, d) \
    (((uint32_t)(a) << 24) | ((uint32_t)(b) << 16) | ((uint32_t)(c) << 8) | (uint32_t)(d))
#endif

namespace {
std::string trim(std::string_view s) {
    auto start = s.find_first_not_of(" \t\r\n'\"");
    if (start == std::string::npos) return "";
    auto end = s.find_last_not_of(" \t\r\n'\"");
    return std::string(s.substr(start, end - start + 1));
}

std::string_view trim_view(std::string_view s) {
    auto start = s.find_first_not_of(" \t\r\n'\"");
    if (start == std::string_view::npos) return {};
    auto end = s.find_last_not_of(" \t\r\n'\"");
    return s.substr(start, end - start + 1);
}

// ============================================================================
// Section font_cache (global registries): インスタンス生成コスト削減用
// ============================================================================

// Global font registries to minimize instantiation overhead
std::mutex g_font_mutex;
std::map<std::string, sk_sp<SkTypeface>> g_url_to_typeface;
std::map<uint64_t, sk_sp<SkTypeface>> g_hash_to_typeface;

struct global_typeface_clone_key {
    SkTypeface* base;
    int weight;
    // Signature of the other variable font axes (font-stretch, font-variation-settings).
    std::string axes;
    bool operator<(const global_typeface_clone_key& other) const {
        if (base != other.base) return base < other.base;
        if (weight != other.weight) return weight < other.weight;
        return axes < other.axes;
    }
};
std::map<global_typeface_clone_key, sk_sp<SkTypeface>> g_variable_clone_cache;

uint64_t compute_data_hash(const uint8_t* data, size_t size) {
    if (size == 0) return 0;
    uint64_t h = size;
    size_t head = size < 256 ? size : 256;
    for (size_t i = 0; i < head; ++i) {
        h ^= data[i];
        h *= 1099511628211ULL;
    }
    size_t tail_start = size > 256 ? size - 256 : 0;
    for (size_t i = tail_start; i < size; ++i) {
        h ^= data[i];
        h *= 1099511628211ULL;
    }
    return h;
}

sk_sp<SkFontMgr> get_global_font_mgr() {
    static sk_sp<SkFontMgr> mgr = SkFontMgr_New_Custom_Empty();
    return mgr;
}

char ascii_lower(char c) { return (c >= 'A' && c <= 'Z') ? (char)(c + ('a' - 'A')) : c; }

bool starts_with_ascii_ci(std::string_view s, size_t pos, std::string_view target) {
    if (target.empty()) return true;
    if (pos + target.size() > s.size()) return false;
    for (size_t i = 0; i < target.size(); ++i) {
        if (ascii_lower(s[pos + i]) != ascii_lower(target[i])) return false;
    }
    return true;
}

size_t find_ascii_ci(std::string_view s, std::string_view target, size_t start = 0) {
    if (target.empty()) return start <= s.size() ? start : std::string_view::npos;
    if (start + target.size() > s.size()) return std::string_view::npos;
    for (size_t i = start; i <= s.size() - target.size(); ++i) {
        if (starts_with_ascii_ci(s, i, target)) return i;
    }
    return std::string_view::npos;
}

bool contains_ascii_ci(std::string_view s, std::string_view target) {
    return find_ascii_ci(s, target) != std::string_view::npos;
}

bool equals_ascii_ci(std::string_view a, std::string_view b) {
    a = trim_view(a);
    b = trim_view(b);
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); ++i) {
        if (ascii_lower(a[i]) != ascii_lower(b[i])) return false;
    }
    return true;
}

// The width of a font face as a percentage of the normal width, used to pick
// a face for a given font-stretch. The width of a face is the OS/2 width class
// (1 = ultra condensed ... 5 = normal ... 9 = ultra expanded).
float width_percent(int width) {
    static const float percent[] = {50.0f, 62.5f, 75.0f, 87.5f, 100.0f,
                                    112.5f, 125.0f, 150.0f, 200.0f};
    if (width < 1 || width > 9) return 100.0f;
    return percent[width - 1];
}

// Creates an SkFont with the rendering settings used everywhere in the engine.
SkFont* makeSkFont(sk_sp<SkTypeface> typeface, float size) {
    SkFont* font = new SkFont(typeface, size);
    font->setSubpixel(true);
    font->setLinearMetrics(true);
    font->setEmbeddedBitmaps(true);
    font->setHinting(SkFontHinting::kNone);
    font->setEdging(SkFont::Edging::kAntiAlias);
    return font;
}

std::string_view css_property_value(std::string_view body, std::string_view property) {
    size_t prop_pos = find_ascii_ci(body, property);
    if (prop_pos == std::string_view::npos) return {};
    size_t colon_pos = body.find(':', prop_pos + property.size());
    if (colon_pos == std::string_view::npos) return {};
    size_t value_start = colon_pos + 1;
    size_t value_end = body.find(';', value_start);
    if (value_end == std::string_view::npos) value_end = body.size();
    return body.substr(value_start, value_end - value_start);
}

bool parse_int(std::string_view s, int& value) {
    s = trim_view(s);
    if (s.empty()) return false;
    const char* first = s.data();
    const char* last = s.data() + s.size();
    auto [ptr, ec] = std::from_chars(first, last, value);
    return ec == std::errc() && ptr == last;
}

bool parse_weight_range(std::string_view s, int& start, int& end) {
    s = trim_view(s);
    size_t sep = s.find_first_of(" \t\r\n");
    if (sep == std::string::npos) return false;
    std::string_view first = s.substr(0, sep);
    size_t second_start = s.find_first_not_of(" \t\r\n", sep);
    if (second_start == std::string::npos) return false;
    std::string_view second = s.substr(second_start);
    return parse_int(first, start) && parse_int(second, end);
}

// ============================================================================
// Section font_fallback (3/3): 代替書体の縦メトリクス (line-height: normal)
// ============================================================================
//
// このエンジンはシステムフォントを持たないため、`Verdana` や `Arial` のような
// デスクトップ定番 family は代替書体 (通常は sans-serif = Noto Sans JP) で描かれる。
// 代替書体の em メトリクスは要求された family と大きく異なることがあり、そのまま
// 使うと `line-height: normal` の行の高さ (ひいては表の行送り) がブラウザとずれる。
// 例: Verdana は 1.215em、Noto Sans JP は 1.448em。
//
// そこで、既知の family については代替書体の scaler context の縦メトリクスだけを
// 要求 family の hhea 相当 (ascent / descent / line gap, em 比) に差し替える。
// グリフの形・送り幅・描画は代替書体のまま (人工的な横方向の拡縮はしない)。
//
// 参考: Blink の `line-height: normal` は ascent + descent + line gap で、line gap は
// ベースラインの上下に配分される。ここでは幅・字形ではなく、その縦方向の合計だけを
// 合わせる (実装の転載はせず、コメントとして挙動のみ記す)。
struct FontMetricProfile {
    enum class Generic { Sans, Serif, Mono };
    // em 比。各フォントの hhea テーブルから採取した値。
    float ascent;
    float descent;
    float line_gap;
    Generic generic;
};

constexpr FontMetricProfile kMetricProfiles[] = {
    {1.005371f, 0.209961f, 0.000000f, FontMetricProfile::Generic::Sans},  // Verdana
    {1.000488f, 0.206543f, 0.000000f, FontMetricProfile::Generic::Sans},  // Tahoma
    {0.905273f, 0.211914f, 0.032715f, FontMetricProfile::Generic::Sans},  // Arial / Helvetica
    {0.891113f, 0.216309f, 0.042480f, FontMetricProfile::Generic::Serif}, // Times New Roman
    {0.832520f, 0.300293f, 0.000000f, FontMetricProfile::Generic::Mono},  // Courier New
    {0.916992f, 0.219238f, 0.000000f, FontMetricProfile::Generic::Serif}, // Georgia
    {0.938965f, 0.222168f, 0.000000f, FontMetricProfile::Generic::Sans},  // Trebuchet MS
    {1.079102f, 0.250977f, 0.000000f, FontMetricProfile::Generic::Sans},  // Segoe UI / system-ui
    {0.750000f, 0.250000f, 0.220703f, FontMetricProfile::Generic::Sans},  // Calibri
    {0.950195f, 0.222168f, 0.000000f, FontMetricProfile::Generic::Serif}, // Cambria
    {0.742676f, 0.257324f, 0.170898f, FontMetricProfile::Generic::Mono},  // Consolas
    {1.102051f, 0.291504f, 0.000000f, FontMetricProfile::Generic::Sans},  // Comic Sans MS
    {1.008789f, 0.210938f, 0.000000f, FontMetricProfile::Generic::Sans},  // Impact
    {1.100586f, 0.309570f, 0.000000f, FontMetricProfile::Generic::Sans},  // Arial Black
    {0.935547f, 0.211914f, 0.000000f, FontMetricProfile::Generic::Sans},  // Arial Narrow
    {0.731934f, 0.284180f, 0.333008f, FontMetricProfile::Generic::Serif}, // Palatino Linotype
    {0.923340f, 0.282227f, 0.000000f, FontMetricProfile::Generic::Serif}, // Book Antiqua
    {1.005859f, 0.220215f, 0.000000f, FontMetricProfile::Generic::Sans},  // Century Gothic
    {0.861816f, 0.263184f, 0.000000f, FontMetricProfile::Generic::Serif}, // Garamond
    {0.941895f, 0.231934f, 0.000000f, FontMetricProfile::Generic::Serif}, // Bookman Old Style
    {0.921875f, 0.209961f, 0.000000f, FontMetricProfile::Generic::Sans},  // MS Sans Serif
    {0.789062f, 0.210938f, 0.000000f, FontMetricProfile::Generic::Mono},  // Lucida Console
    {1.096680f, 0.439941f, 0.000000f, FontMetricProfile::Generic::Sans},  // Lucida Sans Unicode
    {0.916504f, 0.217285f, 0.000000f, FontMetricProfile::Generic::Sans},  // Franklin Gothic Medium
    {0.724609f, 0.275391f, 0.220703f, FontMetricProfile::Generic::Sans},  // Candara
    {0.743652f, 0.256348f, 0.207520f, FontMetricProfile::Generic::Sans},  // Corbel
    {0.750977f, 0.249023f, 0.220703f, FontMetricProfile::Generic::Serif}, // Constantia
    {0.927734f, 0.234375f, 0.000000f, FontMetricProfile::Generic::Mono},  // Cascadia Code / Mono
};

struct MetricFamilyAlias {
    const char* family;  // cleanName() 後 (小文字・空白/引用符なし)
    int profile;         // kMetricProfiles の添字
};

constexpr MetricFamilyAlias kMetricFamilyAliases[] = {
    {"verdana", 0},
    {"tahoma", 1},
    {"arial", 2},
    {"helvetica", 2},
    {"helveticaneue", 2},
    // Liberation fonts are metric-compatible clones of Arial / Times New
    // Roman / Courier New by design, so they share those profiles.
    {"liberationsans", 2},
    {"timesnewroman", 3},
    {"times", 3},
    {"liberationserif", 3},
    {"couriernew", 4},
    {"courier", 4},
    {"liberationmono", 4},
    {"georgia", 5},
    {"trebuchetms", 6},
    {"segoeui", 7},
    {"system-ui", 7},
    {"-apple-system", 7},
    {"blinkmacsystemfont", 7},
    {"calibri", 8},
    {"cambria", 9},
    {"consolas", 10},
    {"comicsansms", 11},
    {"impact", 12},
    {"arialblack", 13},
    {"arialnarrow", 14},
    {"palatinolinotype", 15},
    {"bookantiqua", 16},
    {"centurygothic", 17},
    {"garamond", 18},
    {"bookmanoldstyle", 19},
    {"mssansserif", 20},
    {"microsoftsansserif", 20},
    {"lucidaconsole", 21},
    {"lucidasansunicode", 22},
    {"frankingothicmedium", 23},
    {"franklingothicmedium", 23},
    {"candara", 24},
    {"corbel", 25},
    {"constantia", 26},
    {"cascadiacode", 27},
    {"cascadiamono", 27},
    // Generic families resolve to a concrete font on every platform (Arial/Helvetica
    // for sans, Times for serif, Courier for mono on the desktop platforms these
    // profiles model); without an entry they kept the substitute font's own metrics
    // (Noto Sans JP is 1.448em), which inflates every line-height: normal line.
    {"sans-serif", 2},
    {"ui-sans-serif", 2},
    {"serif", 3},
    {"ui-serif", 3},
    {"monospace", 4},
    {"ui-monospace", 4},
};

int find_metric_profile(const std::string& clean_family) {
    for (const auto& alias : kMetricFamilyAliases) {
        if (clean_family == alias.family) return alias.profile;
    }
    return -1;
}

bool is_generic_metric_family(const std::string& clean_family) {
    return clean_family == "sans-serif" || clean_family == "ui-sans-serif" ||
           clean_family == "serif" || clean_family == "ui-serif" ||
           clean_family == "monospace" || clean_family == "ui-monospace";
}

// 実書体の scaler context を包み、縦メトリクスだけを差し替える。
class MetricScalerContext final : public SkScalerContext_proxy {
   public:
    MetricScalerContext(std::unique_ptr<SkScalerContext> real, SkTypeface_proxy& typeface,
                        const SkScalerContextEffects& effects, const SkDescriptor* desc,
                        const FontMetricProfile& profile)
        : SkScalerContext_proxy(std::move(real), typeface, effects, desc), m_profile(profile) {}

   protected:
    void generateFontMetrics(SkFontMetrics* fm) override {
        // 代替書体の実メトリクスを取得してから、縦方向だけ置き換える。
        // 下線位置・x-height・送り幅などは代替書体の値を使う。
        SkScalerContext_proxy::generateFontMetrics(fm);
        const SkScalar size = fRec.fTextSize;
        if (!(size > 0)) return;
        fm->fAscent = -m_profile.ascent * size;
        fm->fDescent = m_profile.descent * size;
        fm->fLeading = m_profile.line_gap * size;
        // fTop/fBottom はグリフの実測範囲。代替書体の広い方 (インク) を残す。
        fm->fTop = std::min(fm->fTop, fm->fAscent);
        fm->fBottom = std::max(fm->fBottom, fm->fDescent);
    }

   private:
    FontMetricProfile m_profile;
};

// 実書体へ全 virtual を委譲しつつ、上記 scaler context を返す typeface。
class MetricTypeface final : public SkTypeface_proxy {
   public:
    MetricTypeface(sk_sp<SkTypeface> base, const FontMetricProfile& profile)
        : SkTypeface_proxy(base, base->fontStyle(), base->isFixedPitch()),
          m_base(std::move(base)),
          m_profile(profile) {}

   protected:
    std::unique_ptr<SkScalerContext> onCreateScalerContext(
        const SkScalerContextEffects& effects, const SkDescriptor* desc) const override {
        std::unique_ptr<SkScalerContext> real = m_base->createScalerContext(effects, desc);
        if (!real) return SkTypeface_proxy::onCreateScalerContext(effects, desc);
        return std::make_unique<MetricScalerContext>(
            std::move(real), *const_cast<MetricTypeface*>(this), effects, desc, m_profile);
    }

    sk_sp<SkTypeface> onMakeClone(const SkFontArguments& args) const override {
        sk_sp<SkTypeface> clone = m_base->makeClone(args);
        if (!clone) return nullptr;
        return sk_ref_sp<SkTypeface>(new MetricTypeface(std::move(clone), m_profile));
    }

   private:
    sk_sp<SkTypeface> m_base;
    FontMetricProfile m_profile;
};

// 同じ実書体 + 同じプロファイルには同じラッパーを返す (uniqueID を安定させる。
// Skia の strike / typeface キャッシュは uniqueID で引かれる)。
std::map<std::pair<SkTypefaceID, int>, sk_sp<SkTypeface>> g_metric_typeface_cache;

sk_sp<SkTypeface> metric_adjusted_typeface(const sk_sp<SkTypeface>& base, int profile_index) {
    if (!base) return nullptr;
    const std::pair<SkTypefaceID, int> key(base->uniqueID(), profile_index);
    {
        std::lock_guard<std::mutex> lock(g_font_mutex);
        auto it = g_metric_typeface_cache.find(key);
        if (it != g_metric_typeface_cache.end()) return it->second;
    }
    sk_sp<SkTypeface> wrapped =
        sk_ref_sp<SkTypeface>(new MetricTypeface(base, kMetricProfiles[profile_index]));
    {
        std::lock_guard<std::mutex> lock(g_font_mutex);
        auto inserted = g_metric_typeface_cache.emplace(key, wrapped);
        // 競合した場合は先に入ったラッパーを返す (uniqueID を 1 つに保つ)。
        if (inserted.second) return wrapped;
        return inserted.first->second;
    }
}
}  // namespace

// ============================================================================
// Section font_load: 登録・破棄 (将来 font_load.cpp)
// ============================================================================

SatoruFontManager::SatoruFontManager() { m_fontMgr = get_global_font_mgr(); }

bool SatoruFontManager::loadFont(const char* name, const uint8_t* data, int size, const char* url) {
    if (!name || !*name) return false;
    if (!m_fontMgr) m_fontMgr = get_global_font_mgr();

    sk_sp<SkTypeface> typeface;
    uint64_t data_hash = 0;

    // Check global caches first
    {
        std::lock_guard<std::mutex> lock(g_font_mutex);
        if (url && *url) {
            auto it = g_url_to_typeface.find(url);
            if (it != g_url_to_typeface.end()) {
                typeface = it->second;
            }
        }
        if (!typeface && data && size > 0) {
            data_hash = compute_data_hash(data, size);
            auto it = g_hash_to_typeface.find(data_hash);
            if (it != g_hash_to_typeface.end()) {
                typeface = it->second;
            }
        }
    }

    if (!typeface && data && size > 0) {
        auto data_ptr = SkData::MakeWithCopy(data, size);
        typeface = m_fontMgr->makeFromData(std::move(data_ptr));

        if (typeface) {
            std::lock_guard<std::mutex> lock(g_font_mutex);
            if (url && *url) {
                g_url_to_typeface[url] = typeface;
            }
            if (data_hash == 0) data_hash = compute_data_hash(data, size);
            g_hash_to_typeface[data_hash] = typeface;
        }
    }

    if (typeface) {
        bool changed = false;
        std::stringstream ss(name);
        std::string item;
        while (std::getline(ss, item, ',')) {
            std::string cleaned = cleanName(trim(item));
            if (cleaned.empty()) continue;

            // Determine intended style from m_fontFaces if url matches
            SkFontStyle intended_style = typeface->fontStyle();
            if (url && *url) {
                for (const auto& entry : m_fontFaces) {
                    if (entry.first.family == cleaned) {
                        for (const auto& src_ptr : entry.second) {
                            const font_face_source& src = *src_ptr;
                            if (src.url == url) {
                                // Keep the width of the file itself, it is needed to
                                // pick a face for a given font-stretch.
                                intended_style =
                                    SkFontStyle(entry.first.weight, typeface->fontStyle().width(),
                                                entry.first.slant);
                                break;
                            }
                        }
                    }
                }
            }

            bool duplicate = false;
            for (const auto& existing : m_typefaceCache[cleaned]) {
                if (existing.typeface->uniqueID() == typeface->uniqueID() &&
                    existing.intended_style == intended_style) {
                    duplicate = true;
                    break;
                }
            }

            if (!duplicate) {
                m_typefaceCache[cleaned].push_back({typeface, intended_style});
                changed = true;
                if (!m_defaultTypeface) m_defaultTypeface = typeface;

                // If it's an emoji font, also register it under "notocoloremoji"
                if (cleaned.find("emoji") != std::string::npos) {
                    m_typefaceCache["notocoloremoji"].push_back({typeface, intended_style});
                }
            }
        }
        return changed;
    } else {
        SATORU_LOG_ERROR("[Satoru] FAILED to create typeface for '%s'", name);
    }
    return false;
}

void SatoruFontManager::clear() {
    m_typefaceCache.clear();
    m_fontFaces.clear();
    m_fallbackTypefaces.clear();
    m_defaultTypeface = nullptr;
}

// ============================================================================
// Section font_fallback (1/2): @font-face 走査・URL解決 (将来 font_fallback.cpp)
// ============================================================================

void SatoruFontManager::scanFontFaces(const std::string& css) {
    std::string_view css_sv = css;
    if (!contains_ascii_ci(css_sv, "@font-face")) return;

    // What a big stylesheet (the default web font's, over 100 KB of @font-face blocks) scanned to, kept by its text: every
    // render of a page starts a new instance and is handed the same stylesheet again.
    using ScannedFace = std::pair<font_request, std::shared_ptr<const font_face_source>>;
    struct ScanMemo {
        size_t hash = 0;
        size_t size = 0;
        std::vector<ScannedFace> faces;
    };
    constexpr size_t kMemoMinSize = 4096;
    constexpr size_t kMemoSlots = 4;
    static thread_local std::vector<ScanMemo> memo;

    auto add_face = [this](const font_request& req, const std::shared_ptr<const font_face_source>& src) {
        auto& sources = m_fontFaces[req];
        for (const auto& existing_src : sources)
            if (existing_src->url == src->url) return;
        sources.push_back(src);
    };
    const bool memoise = css.size() >= kMemoMinSize;
    const size_t css_hash = memoise ? std::hash<std::string_view>{}(css_sv) : 0;
    if (memoise)
        for (const ScanMemo& m : memo)
            if (m.hash == css_hash && m.size == css.size()) {
                for (const ScannedFace& f : m.faces) add_face(f.first, f.second);
                return;
            }
    std::vector<ScannedFace> scanned;

    size_t pos = 0;

    while (true) {
        size_t start_pos = find_ascii_ci(css_sv, "@font-face", pos);
        if (start_pos == std::string_view::npos) break;

        size_t block_start = css_sv.find('{', start_pos);
        if (block_start == std::string_view::npos) break;

        size_t block_end = block_start;
        int depth = 1;
        for (size_t i = block_start + 1; i < css_sv.size(); ++i) {
            if (css_sv[i] == '{')
                depth++;
            else if (css_sv[i] == '}') {
                depth--;
                if (depth == 0) {
                    block_end = i;
                    break;
                }
            }
        }
        if (depth != 0) break;

        std::string_view body_sv = css_sv.substr(block_start + 1, block_end - block_start - 1);
        pos = block_end + 1;

        std::string family = "";
        std::vector<int> weights;
        SkFontStyle::Slant slant = SkFontStyle::kUpright_Slant;

        if (std::string_view family_value = css_property_value(body_sv, "font-family");
            !family_value.empty()) {
            family = cleanName(family_value);
        }

        if (std::string_view weight_value = css_property_value(body_sv, "font-weight");
            !weight_value.empty()) {
            std::string_view w = trim_view(weight_value);
            if (equals_ascii_ci(w, "bold"))
                weights.push_back(700);
            else if (equals_ascii_ci(w, "normal"))
                weights.push_back(400);
            else {
                int start = 0;
                int end = 0;
                if (parse_weight_range(w, start, end)) {
                    for (int v = 100; v <= 900; v += 100) {
                        if (v >= start && v <= end) weights.push_back(v);
                    }
                } else {
                    int parsed = 0;
                    if (parse_int(w, parsed)) weights.push_back(parsed);
                }
            }
        }

        if (weights.empty()) weights.push_back(400);

        if (std::string_view style_value = css_property_value(body_sv, "font-style");
            !style_value.empty()) {
            std::string_view s = trim_view(style_value);
            if (equals_ascii_ci(s, "italic") || equals_ascii_ci(s, "oblique"))
                slant = SkFontStyle::kItalic_Slant;
        }

        if (!family.empty()) {
            std::string_view best_url;
            int best_score = -1;

            size_t url_search_pos = 0;
            while (true) {
                size_t url_idx = find_ascii_ci(body_sv, "url(", url_search_pos);
                if (url_idx == std::string_view::npos) break;

                size_t url_content_start = url_idx + 4;
                size_t url_content_end = body_sv.find(')', url_content_start);
                if (url_content_end == std::string_view::npos) break;

                std::string_view url = trim_view(
                    body_sv.substr(url_content_start, url_content_end - url_content_start));
                url_search_pos = url_content_end + 1;

                int score = 0;
                if (contains_ascii_ci(url, "woff2"))
                    score = 5;
                else if (contains_ascii_ci(url, "woff"))
                    score = 4;
                else if (contains_ascii_ci(url, "ttf") || contains_ascii_ci(url, "truetype"))
                    score = 3;
                else if (contains_ascii_ci(url, "otf") || contains_ascii_ci(url, "opentype"))
                    score = 2;
                else if (contains_ascii_ci(url, "ttc"))
                    score = 1;
                else if (contains_ascii_ci(url, ".eot"))
                    score = -1;

                if (score > best_score) {
                    best_score = score;
                    best_url = std::move(url);
                }
            }

            if (!best_url.empty() && best_score >= 0) {
                auto src = std::make_shared<font_face_source>();
                src->url = std::string(best_url);

                if (std::string_view range_value = css_property_value(body_sv, "unicode-range");
                    !range_value.empty()) {
                    src->unicode_range = trim(range_value);
                    parseUnicodeRange(src->unicode_range, src->ranges);
                }

                for (int w : weights) {
                    font_request req;
                    req.family = family;
                    req.weight = w;
                    req.slant = slant;

                    add_face(req, src);
                    if (memoise) scanned.emplace_back(req, src);
                }
            }
        }
    }
    if (memoise) {
        if (memo.size() >= kMemoSlots) memo.erase(memo.begin());
        memo.push_back(ScanMemo{css_hash, css.size(), std::move(scanned)});
    }
}

std::vector<std::string> SatoruFontManager::getFontUrls(
    const std::string& family, int weight, SkFontStyle::Slant slant,
    const std::set<char32_t>* usedCodepoints) const {
    std::vector<std::string> urls;
    urls.reserve(4);
    std::stringstream ss(family);
    std::string item;

    while (std::getline(ss, item, ',')) {
        std::string cleanedFamily = cleanName(trim(item).c_str());
        if (cleanedFamily.empty()) continue;

        font_request req;
        req.family = cleanedFamily;
        req.weight = weight;
        req.slant = slant;

        auto it = m_fontFaces.find(req);
        if (it != m_fontFaces.end()) {
            for (const auto& src_ptr : it->second) {
                const font_face_source& src = *src_ptr;
                if (std::find(urls.begin(), urls.end(), src.url) != urls.end()) continue;

                bool needed = true;
                if (usedCodepoints && !src.unicode_range.empty()) {
                    needed = false;
                    for (const auto& range : src.ranges) {
                        auto cp = usedCodepoints->lower_bound((char32_t)range.first);
                        if (cp != usedCodepoints->end() && *cp <= range.second) {
                            needed = true;
                            break;
                        }
                    }
                }
                if (needed) {
                    urls.push_back(src.url);
                }
            }
        }

        // If no exact weight match, look for same family and slant but different weight
        // (This helps finding the best available weight if requested weight is missing)
        for (const auto& entry : m_fontFaces) {
            if (entry.first.family == cleanedFamily && entry.first.slant == slant) {
                if (entry.first.weight == weight) continue;  // Already checked

                for (const auto& src_ptr : entry.second) {

                    const font_face_source& src = *src_ptr;
                    if (std::find(urls.begin(), urls.end(), src.url) == urls.end()) {
                        bool needed = true;
                        if (usedCodepoints && !src.unicode_range.empty()) {
                            needed = false;
                            for (const auto& range : src.ranges) {
                                auto cp = usedCodepoints->lower_bound((char32_t)range.first);
                                if (cp != usedCodepoints->end() && *cp <= range.second) {
                                    needed = true;
                                    break;
                                }
                            }
                        }
                        if (needed) {
                            urls.push_back(src.url);
                        }
                    }
                }
            }
        }
    }

    return urls;
}

std::string SatoruFontManager::getFontUrl(const std::string& family, int weight,
                                          SkFontStyle::Slant slant) const {
    auto urls = getFontUrls(family, weight, slant);
    return urls.empty() ? "" : urls[0];
}

bool SatoruFontManager::hasFontFaceSource(const std::string& family, const std::string& url) const {
    std::string cleanedFamily = cleanName(family);
    for (const auto& entry : m_fontFaces) {
        if (entry.first.family != cleanedFamily) continue;
        for (const auto& src_ptr : entry.second) {
            const font_face_source& src = *src_ptr;
            if (src.url == url) return true;
        }
    }
    return false;
}

// 取得要否の索引としてのみ使う family (HanaMin.css・文字体系別 Noto Sans の css)。
// その unicode-range は取得必要性の根拠にはなっても、取得済みの根拠にはならない。
static bool is_fallback_index_family(const std::string& family) {
    std::string f;
    for (char c : family) {
        if (c == '\'' || c == '"' || c == ' ') continue;
        f.push_back((char)std::tolower((unsigned char)c));
    }
    if (f == "hanamin" || f.compare(0, 10, "satoru-fb-") == 0) return true;
    static const char* const kNames[] = {"notosanskr", "notosanshebrew", "notosansarabic",
                                         "notosansthai", "notosansdevanagari", "notosans"};
    for (const char* n : kNames) {
        if (f == n) return true;
    }
    return false;
}

std::set<char32_t> SatoruFontManager::uncoveredCodepoints(
    const std::set<char32_t>& codepoints) const {
    std::set<char32_t> out;
    for (char32_t cp : codepoints) {
        if (cp < 0x80) continue;  // ASCII は常に解決可能とみなす (走査コスト回避)
        bool covered = false;
        for (const auto& [name, typefaces] : m_typefaceCache) {
            for (const auto& c : typefaces) {
                if (c.typeface && c.typeface->unicharToGlyph((SkUnichar)cp) != 0) {
                    covered = true;
                    break;
                }
            }
            if (covered) break;
        }
        if (!covered) {
            for (const auto& [req, srcs] : m_fontFaces) {
                // HanaMin.css は未取得ブロックの索引であり、その unicode-range は
                // 取得必要性の根拠にはなっても、取得済みの根拠にはならない
                // (通常経路の取得対象はレイアウト要求 family のみ)。除外する。
                if (is_fallback_index_family(req.family)) continue;
                auto cached = m_typefaceCache.find(req.family);
                bool familyLoaded = cached != m_typefaceCache.end() && !cached->second.empty();
                for (const auto& src_ptr : srcs) {
                    const font_face_source& src = *src_ptr;
                    if (src.ranges.empty()) {
                        // unicode-range 指定の無い @font-face は全域請求。
                        // family 未読み込みの間は通常経路の取得を待つ。
                        if (!familyLoaded) {
                            covered = true;
                            break;
                        }
                    } else if (checkUnicodeRange(cp, src.ranges)) {
                        covered = true;
                        break;
                    }
                }
                if (covered) break;
            }
        }
        if (!covered) out.insert(cp);
    }
    return out;
}

// ============================================================================
// Section font_fallback (2/2): 最適マッチ選択 (将来 font_fallback.cpp)
// ============================================================================

std::vector<sk_sp<SkTypeface>> SatoruFontManager::matchFonts(const std::string& family, int weight,
                                                             SkFontStyle::Slant slant, int stretch) {
    std::string cleanFamily = cleanName(family);
    auto it = m_typefaceCache.find(cleanFamily);
    if (it != m_typefaceCache.end()) {
        const auto& cached = it->second;
        if (cached.empty()) return {};

        // Find the best match for weight and slant using intended_style
        cached_typeface bestMatch = {nullptr, SkFontStyle()};
        int minDiff = 10000;

        for (const auto& c : cached) {
            SkFontStyle style = c.intended_style;
            int diff = std::abs(style.weight() - weight);
            if (style.slant() != slant) diff += 1000;
            // font-stretch picks a face by its width. The width is only taken into
            // account when a stretch other than normal is requested, so the default
            // selection is not affected.
            if (stretch != 100) {
                diff += (int)(std::abs(width_percent(style.width()) - (float)stretch) * 4);
            }

            if (diff < minDiff) {
                minDiff = diff;
                bestMatch = c;
            }
        }

        if (bestMatch.typeface) {
            // Also include other typefaces that might have different glyph sets (subsets)
            // but have the same weight/slant. This is important for Google Fonts subsets.
            std::vector<sk_sp<SkTypeface>> matches;
            SkFontStyle bestStyle = bestMatch.intended_style;

            for (const auto& c : cached) {
                if (c.intended_style == bestStyle) {
                    matches.push_back(c.typeface);
                }
            }
            return matches;
        }
    }

    return {};
}

bool SatoruFontManager::isGenericMetricFamily(const std::string& family) const {
    return is_generic_metric_family(cleanName(family));
}

std::string SatoruFontManager::metricProfileGenericFamily(const std::string& family) const {
    const int profile_index = find_metric_profile(cleanName(family));
    if (profile_index < 0) return "";
    switch (kMetricProfiles[profile_index].generic) {
        case FontMetricProfile::Generic::Serif:
            return "serif";
        case FontMetricProfile::Generic::Mono:
            return "monospace";
        case FontMetricProfile::Generic::Sans:
            return "";
    }
    return "";
}

std::vector<sk_sp<SkTypeface>> SatoruFontManager::matchMetricFallbackFonts(
    const std::string& family, int weight, SkFontStyle::Slant slant, int stretch) {
    const std::string clean_family = cleanName(family);
    const int profile_index = find_metric_profile(clean_family);
    if (profile_index < 0) return {};

    // ページの @font-face が同名 family を持つ場合は、まだ読み込み中でも
    // 本来の書体を優先する (代替メトリクスで先に確定させない)。
    // font_request は family が第一キーなので、family の先頭だけ見ればよい。
    // 汎用 family は対象外: @font-face の family 名に汎用名は使えず、登録されている
    // のはエンジン自身が汎用名で読み込んだ代替書体だけである。
    if (!is_generic_metric_family(clean_family)) {
        font_request probe;
        probe.family = clean_family;
        probe.weight = -1;
        probe.slant = SkFontStyle::kUpright_Slant;
        auto face_it = m_fontFaces.lower_bound(probe);
        if (face_it != m_fontFaces.end() && face_it->first.family == clean_family) return {};
    }

    // 既に実体が読み込まれている family は通常の matchFonts が返している。ただし
    // 汎用 family 自身の実体は代替書体であり、その縦メトリクス (Noto Sans JP では
    // 1.448em) が line-height: normal にそのまま漏れるため、汎用 family はここで
    // 止めず、登録済みの実体を代替として差し替え対象にする。
    if (m_typefaceCache.find(clean_family) != m_typefaceCache.end() &&
        !is_generic_metric_family(clean_family))
        return {};

    const FontMetricProfile& profile = kMetricProfiles[profile_index];
    const bool sans = profile.generic == FontMetricProfile::Generic::Sans;
    const char* generic = sans ? "sans-serif"
                               : profile.generic == FontMetricProfile::Generic::Serif ? "serif"
                                                                                      : "monospace";
    std::vector<sk_sp<SkTypeface>> substitutes = matchFonts(generic, weight, slant, stretch);
    if (substitutes.empty() && !sans) {
        // serif/monospace が未取得のページでも、sans-serif の代替書体に
        // その family の縦メトリクスだけを載せて使う。
        substitutes = matchFonts("sans-serif", weight, slant, stretch);
    }
    if (substitutes.empty()) return {};

    std::vector<sk_sp<SkTypeface>> out;
    out.reserve(substitutes.size());
    for (const auto& tf : substitutes) {
        out.push_back(metric_adjusted_typeface(tf, profile_index));
    }
    return out;
}

int SatoruFontManager::getMatchedWeight(sk_sp<SkTypeface> typeface, const std::string& family) {
    std::string cleanFamily = cleanName(family);
    auto it = m_typefaceCache.find(cleanFamily);
    if (it != m_typefaceCache.end()) {
        for (const auto& c : it->second) {
            if (c.typeface->uniqueID() == typeface->uniqueID()) {
                return c.intended_style.weight();
            }
        }
    }
    return typeface->fontStyle().weight();
}

int SatoruFontManager::getMatchedSlant(sk_sp<SkTypeface> typeface, const std::string& family) {
    std::string cleanFamily = cleanName(family);
    auto it = m_typefaceCache.find(cleanFamily);
    if (it != m_typefaceCache.end()) {
        for (const auto& c : it->second) {
            if (c.typeface->uniqueID() == typeface->uniqueID()) {
                return c.intended_style.slant();
            }
        }
    }
    return typeface->fontStyle().slant();
}

// ============================================================================
// Section font_cache: SkFont 生成・可変フォント複製cache (将来 font_cache.cpp)
// ============================================================================

SkFont* SatoruFontManager::createSkFont(sk_sp<SkTypeface> typeface, float size, int weight,
                                         int stretch,
                                         const std::vector<litehtml::font_variation_setting>& variations) {
    if (!typeface) return nullptr;

    int count = typeface->getVariationDesignPosition(
        SkSpan<SkFontArguments::VariationPosition::Coordinate>());
    if (count > 0) {
        // Clones are shared by every request that resolves to the same axes.
        std::string axes = std::to_string(stretch);
        for (const auto& v : variations) {
            axes += "," + std::to_string(v.tag) + "=" + std::to_string(v.value);
        }

        // Check global cache first for variable font clones
        sk_sp<SkTypeface> varTypeface = nullptr;
        {
            std::lock_guard<std::mutex> lock(g_font_mutex);
            global_typeface_clone_key key = {typeface.get(), weight, axes};
            auto it = g_variable_clone_cache.find(key);
            if (it != g_variable_clone_cache.end()) {
                varTypeface = it->second;
            }
        }

        if (varTypeface) {
            return makeSkFont(varTypeface, size);
        }

        std::vector<SkFontArguments::VariationPosition::Coordinate> coords(count);
        typeface->getVariationDesignPosition(SkSpan(coords));

        bool modified = false;
        // font-weight drives the wght axis.
        for (auto& coord : coords) {
            if (coord.axis == SkSetFourByteTag('w', 'g', 'h', 't')) {
                coord.value = (float)weight;
                modified = true;
                break;
            }
        }
        // font-stretch drives the wdth axis.
        if (stretch != 100) {
            for (auto& coord : coords) {
                if (coord.axis == SkSetFourByteTag('w', 'd', 't', 'h')) {
                    coord.value = (float)stretch;
                    modified = true;
                    break;
                }
            }
        }
        // font-variation-settings has the highest priority and may set any axis,
        // including wght and wdth.
        for (const auto& v : variations) {
            for (auto& coord : coords) {
                if (coord.axis == v.tag) {
                    coord.value = v.value;
                    modified = true;
                    break;
                }
            }
        }

        if (modified) {
            SkFontArguments args;
            SkFontArguments::VariationPosition pos = {coords.data(), (int)coords.size()};
            args.setVariationDesignPosition(pos);
            varTypeface = typeface->makeClone(args);
            if (varTypeface) {
                {
                    std::lock_guard<std::mutex> lock(g_font_mutex);
                    global_typeface_clone_key key = {typeface.get(), weight, axes};
                    g_variable_clone_cache[key] = varTypeface;
                }
                return makeSkFont(varTypeface, size);
            }
        }
    }

    return makeSkFont(typeface, size);
}

// ============================================================================
// Section font_css: 名前正規化・unicode-range・@font-face CSS出力 (将来 font_cache.cpp)
// ============================================================================

std::string SatoruFontManager::cleanName(std::string_view name) const {
    std::string res;
    res.reserve(name.length());
    for (char c : name) {
        if (c == '\'' || c == '\"') continue;
        if (c == ' ' || c == '\t' || c == '\r' || c == '\n') continue;
        res += (char)tolower(c);
    }
    return res;
}

void SatoruFontManager::parseUnicodeRange(
    const std::string& rangeStr, std::vector<std::pair<uint32_t, uint32_t>>& outRanges) const {
    if (rangeStr.empty()) return;

    std::stringstream ss(rangeStr);
    std::string segment;
    while (std::getline(ss, segment, ',')) {
        segment = trim(segment);
        if (segment.empty()) continue;

        size_t uPos = segment.find("U+");
        if (uPos == std::string::npos) uPos = segment.find("u+");
        if (uPos != std::string::npos) {
            segment = segment.substr(uPos + 2);
        }

        size_t dashPos = segment.find('-');
        uint32_t start = 0, end = 0;

        try {
            if (segment.find('?') != std::string::npos) {
                std::string minStr = segment;
                std::string maxStr = segment;
                std::replace(minStr.begin(), minStr.end(), '?', '0');
                std::replace(maxStr.begin(), maxStr.end(), '?', 'F');
                start = std::stoul(minStr, nullptr, 16);
                end = std::stoul(maxStr, nullptr, 16);
            } else if (dashPos != std::string::npos) {
                std::string startStr = segment.substr(0, dashPos);
                std::string endStr = segment.substr(dashPos + 1);
                start = std::stoul(startStr, nullptr, 16);
                end = std::stoul(endStr, nullptr, 16);
            } else {
                start = std::stoul(segment, nullptr, 16);
                end = start;
            }
            outRanges.push_back({start, end});
        } catch (const std::exception& e) {
            // P0: 黙殺せず js_logger 経由で可視化。振る舞いは不変 (当該 segment を skip して継続)。
            // "[CODE] ..." 形式は TS diagnostics.ts の DiagnosticMessage {code,message} に集約される想定。
            SATORU_LOG_WARN("[FONT_UNICODE_RANGE_PARSE_FAILED] skip segment '%s': %s",
                            segment.c_str(), e.what());
        } catch (...) {
            SATORU_LOG_WARN("[FONT_UNICODE_RANGE_PARSE_FAILED] skip segment '%s': unknown error",
                            segment.c_str());
        }
    }
}

bool SatoruFontManager::checkUnicodeRange(
    char32_t codepoint, const std::vector<std::pair<uint32_t, uint32_t>>& ranges) const {
    for (const auto& range : ranges) {
        if (codepoint >= range.first && codepoint <= range.second) return true;
    }
    return false;
}

std::string SatoruFontManager::generateFontFaceCSS() const {
    std::stringstream ss;
    std::set<std::string> seen_urls;

    for (const auto& entry : m_fontFaces) {
        const auto& req = entry.first;
        for (const auto& src_ptr : entry.second) {
            const font_face_source& src = *src_ptr;
            std::string key =
                req.family + std::to_string(req.weight) + std::to_string((int)req.slant) + src.url;
            if (seen_urls.count(key)) continue;
            seen_urls.insert(key);

            ss << "@font-face {\n"
               << "  font-family: '" << req.family << "';\n"
               << "  font-weight: " << req.weight << ";\n"
               << "  font-style: "
               << (req.slant == SkFontStyle::kUpright_Slant ? "normal" : "italic") << ";\n"
               << "  src: url('" << src.url << "');\n";
            if (!src.unicode_range.empty()) {
                ss << "  unicode-range: " << src.unicode_range << ";\n";
            }
            ss << "}\n";
        }
    }
    return ss.str();
}

sk_sp<SkTypeface> SatoruFontManager::findTypefaceForCodepoint(SkUnichar u) const {
    for (auto const& [name, typefaces] : m_typefaceCache) {
        for (auto const& tc : typefaces) {
            if (tc.typeface && tc.typeface->unicharToGlyph(u) != 0) return tc.typeface;
        }
    }
    for (auto const& tf : m_fallbackTypefaces) {
        if (tf && tf->unicharToGlyph(u) != 0) return tf;
    }
    return nullptr;
}

SkFont SatoruFontManager::selectFont(char32_t u, font_info* fi, SkFont* lastSelectedFont,
                                     const satoru::UnicodeService& unicode) {
    return selectFont(u, fi, lastSelectedFont, unicode, unicode.isEmoji(u), unicode.isMark(u));
}

SkFont SatoruFontManager::selectFont(char32_t u, font_info* fi, SkFont* lastSelectedFont,
                                     const satoru::UnicodeService& /*unicode*/, bool is_emoji,
                                     bool is_mark) {
    SkFont* selected_font = nullptr;

    if (!is_mark) {
        auto cached = fi->selected_font_cache.find(u);
        if (cached != fi->selected_font_cache.end()) {
            return cached->second;
        }
    }

    if (is_emoji) {
        // Pass 0: Exact match for notocoloremoji
        auto it = m_typefaceCache.find("notocoloremoji");
        if (it != m_typefaceCache.end()) {
            for (auto const& tc : it->second) {
                if (tc.typeface->unicharToGlyph(u) != 0) {
                    static std::map<SkTypefaceID, std::unique_ptr<SkFont>> s_color_cache;
                    SkTypefaceID id = tc.typeface->uniqueID();
                    if (s_color_cache.find(id) == s_color_cache.end()) {
                        s_color_cache[id] = std::unique_ptr<SkFont>(
                            createSkFont(tc.typeface, fi->fonts[0]->getSize(), 400));
                    }
                    selected_font = s_color_cache[id].get();
                    goto emoji_found;
                }
            }
        }

        // PASS 1: Mandatory Color Font Search (name contains "color")
        if (!selected_font) {
            for (auto const& [name, typefaces] : m_typefaceCache) {
                std::string lowerName = name;
                std::transform(lowerName.begin(), lowerName.end(), lowerName.begin(), ::tolower);
                if (lowerName.find("color") != std::string::npos) {
                    for (auto const& tc : typefaces) {
                        if (tc.typeface->unicharToGlyph(u) != 0) {
                            static std::map<SkTypefaceID, std::unique_ptr<SkFont>> s_color_cache;
                            SkTypefaceID id = tc.typeface->uniqueID();
                            if (s_color_cache.find(id) == s_color_cache.end()) {
                                s_color_cache[id] = std::unique_ptr<SkFont>(
                                    createSkFont(tc.typeface, fi->fonts[0]->getSize(), 400));
                            }
                            selected_font = s_color_cache[id].get();
                            break;
                        }
                    }
                }
                if (selected_font) break;
            }
        }

        // PASS 2: General Emoji Font Search
        if (!selected_font) {
            for (auto const& [name, typefaces] : m_typefaceCache) {
                std::string lowerName = name;
                std::transform(lowerName.begin(), lowerName.end(), lowerName.begin(), ::tolower);
                if (lowerName.find("emoji") != std::string::npos) {
                    for (auto const& tc : typefaces) {
                        if (tc.typeface->unicharToGlyph(u) != 0) {
                            static std::map<SkTypefaceID, std::unique_ptr<SkFont>> s_emoji_cache;
                            SkTypefaceID id = tc.typeface->uniqueID();
                            if (s_emoji_cache.find(id) == s_emoji_cache.end()) {
                                s_emoji_cache[id] = std::unique_ptr<SkFont>(
                                    createSkFont(tc.typeface, fi->fonts[0]->getSize(), 400));
                            }
                            selected_font = s_emoji_cache[id].get();
                            break;
                        }
                    }
                }
                if (selected_font) break;
            }
        }
    }
emoji_found:

    // 2. Check if the previous font is usable (MRU optimization)
    if (!selected_font && lastSelectedFont) {
        SkGlyphID glyph = lastSelectedFont->getTypeface()->unicharToGlyph(u);
        if (glyph != 0 || is_mark) {
            selected_font = lastSelectedFont;
        }
    }

    // 3. If still no font selected, search through all fonts
    if (!selected_font) {
        for (auto f : fi->fonts) {
            if (f->getTypeface()->unicharToGlyph(u) != 0) {
                selected_font = f;
                break;
            }
        }
        if (!selected_font) selected_font = fi->fonts[0];
    }

    SkFont font = *selected_font;
    font.setSize(fi->fonts[0]->getSize());
    if (fi->fake_bold) font.setEmbolden(true);
    if (fi->fake_italic) font.setSkewX(-0.25f);

    if (is_emoji) {
        font.setEmbeddedBitmaps(true);
        font.setHinting(SkFontHinting::kNone);
        font.setEdging(SkFont::Edging::kAntiAlias);
    }

    if (!is_mark) {
        fi->selected_font_cache.emplace(u, font);
    }

    return font;
}
