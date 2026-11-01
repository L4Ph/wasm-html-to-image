#ifndef SATORU_FONT_MANAGER_H
#define SATORU_FONT_MANAGER_H

#include <map>
#include <memory>
#include <set>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#include "bridge/bridge_types.h"
#include "core/ifont_manager.h"
#include "core/text/unicode_service.h"
#include "include/core/SkFont.h"
#include "include/core/SkFontMgr.h"
#include "include/core/SkFontStyle.h"
#include "include/core/SkTypeface.h"
#include "libs/litehtml/include/litehtml.h"

class SatoruFontManager : public satoru::IFontManager {
   public:
    SatoruFontManager();
    ~SatoruFontManager() override = default;

    // ── IFontManager implementation ────────────────────────────────────
    bool loadFont(const char* name, const uint8_t* data, int size,
                  const char* url = nullptr) override;
    void clear() override;

    void scanFontFaces(const std::string& css) override;
    std::vector<std::string> getFontUrls(
        const std::string& family, int weight, SkFontStyle::Slant slant,
        const std::set<char32_t>* usedCodepoints = nullptr) const override;
    std::string getFontUrl(const std::string& family, int weight,
                           SkFontStyle::Slant slant) const override;
    bool hasFontFaceSource(const std::string& family, const std::string& url) const override;
    // usedCodepoints のうち、読み込み済み書体のいずれにもグリフが無く、
    // どの @font-face の unicode-range も該当しないものを返す (CJK 外字検出用)。
    // unicode-range の無い @font-face は、当該 family が未読み込みの間のみ
    // 請求中とみなす (読み込み後にグリフが無ければ未対応として返す)。
    std::set<char32_t> uncoveredCodepoints(
        const std::set<char32_t>& codepoints) const override;

    std::vector<sk_sp<SkTypeface>> matchFonts(const std::string& family, int weight,
                                              SkFontStyle::Slant slant, int stretch = 100) override;
    int getMatchedWeight(sk_sp<SkTypeface> typeface, const std::string& family) override;
    int getMatchedSlant(sk_sp<SkTypeface> typeface, const std::string& family) override;

    SkFont* createSkFont(sk_sp<SkTypeface> typeface, float size, int weight, int stretch = 100,
                          const std::vector<litehtml::font_variation_setting>& variations = {}) override;

    void addFallbackTypeface(sk_sp<SkTypeface> tf) override { m_fallbackTypefaces.push_back(tf); }
    const std::vector<sk_sp<SkTypeface>>& getFallbackTypefaces() const override {
        return m_fallbackTypefaces;
    }

    sk_sp<SkTypeface> getDefaultTypeface() const override { return m_defaultTypeface; }

    SkFont selectFont(char32_t u, font_info* fi, SkFont* lastSelectedFont,
                      const satoru::UnicodeService& unicode) override;
    SkFont selectFont(char32_t u, font_info* fi, SkFont* lastSelectedFont,
                      const satoru::UnicodeService& unicode, bool isEmoji, bool isMark) override;

    std::string generateFontFaceCSS() const override;

    // ── Non-virtual extensions (SatoruFontManager-specific) ───────────
    sk_sp<SkFontMgr> getFontMgr() const { return m_fontMgr; }
    // Any loaded typeface (all families, then the fallbacks) that has a glyph for @p u, or null.
    sk_sp<SkTypeface> findTypefaceForCodepoint(SkUnichar u) const;

    // 未読み込みのデスクトップ定番 family (Verdana / Arial / ...) に対して、代替書体の
    // 縦メトリクス (line-height: normal の高さ) だけを要求 family の hhea 相当へ
    // 差し替えた typeface を返す。family が読み込み済み・@font-face 定義済み・未知の
    // 場合は空 (呼び出し側は従来どおり generic fallback へ進む)。
    std::vector<sk_sp<SkTypeface>> matchMetricFallbackFonts(const std::string& family, int weight,
                                                            SkFontStyle::Slant slant, int stretch = 100);

    // 汎用 family (sans-serif / serif / monospace と ui- 接頭辞つき) か。汎用 family の
    // 実体は代替書体そのものなので、登録済みでも縦メトリクスはプロファイルに合わせる。
    bool isGenericMetricFamily(const std::string& family) const;

    // 名前付き family がメトリクスプロファイル経由で描かれる際の代替実体となる
    // 汎用 family ("serif" / "monospace")。Sans プロファイルとプロファイルの無い
    // family では "" (sans の実体は常時要求されるため追加要求は不要)。
    std::string metricProfileGenericFamily(const std::string& family) const;

   private:
    sk_sp<SkFontMgr> m_fontMgr;

    struct cached_typeface {
        sk_sp<SkTypeface> typeface;
        SkFontStyle intended_style;
    };
    std::map<std::string, std::vector<cached_typeface>> m_typefaceCache;

    struct font_face_source {
        std::string url;
        std::string unicode_range;
        std::vector<std::pair<uint32_t, uint32_t>> ranges;
    };
    // Shared, so that replaying a remembered scan (scanFontFaces) copies pointers, not the strings of every face.
    std::map<font_request, std::vector<std::shared_ptr<const font_face_source>>> m_fontFaces;

    sk_sp<SkTypeface> m_defaultTypeface;
    std::vector<sk_sp<SkTypeface>> m_fallbackTypefaces;

    std::string cleanName(std::string_view name) const;
    void parseUnicodeRange(const std::string& rangeStr,
                           std::vector<std::pair<uint32_t, uint32_t>>& outRanges) const;
    bool checkUnicodeRange(char32_t codepoint,
                           const std::vector<std::pair<uint32_t, uint32_t>>& ranges) const;
};

#endif  // SATORU_FONT_MANAGER_H
