#include "el_svg.h"
#include "svg_builder_config.h"

#include <algorithm>
#include <cstdio>
#include <list>
#include <memory>
#include <set>
#include <sstream>

#include "bridge/magic_tags.h"
#include "container_skia.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkFontMgr.h"
#include "include/core/SkFontStyle.h"
#include "include/core/SkTypeface.h"
#include "satoru_context.h"
#include "include/core/SkStream.h"
#include "libs/litehtml/include/litehtml/render_image.h"
#include "libs/litehtml/include/litehtml/render_item.h"
#include "modules/skresources/include/SkResources.h"
#include "modules/skshaper/include/SkShaper_factory.h"
#include "modules/skshaper/include/SkShaper_harfbuzz.h"
#include "modules/skunicode/include/SkUnicode.h"
#include "modules/svg/include/SkSVGDOM.h"
#include "svg_paint_utils.h"
#include "text_utils.h"
#include "svg_tag_utils.h"

namespace litehtml {

namespace {

// The characters of the <text> inside an svg. Layout never sees them (SkSVGDOM draws them), so without this
// the font slices that cover them (Noto Sans JP comes in unicode-range slices) are never fetched and the
// glyphs come out as boxes.
void collect_svg_text_codepoints(const std::list<std::shared_ptr<element>>& list, std::set<char32_t>& out) {
    for (auto const& e : list) {
        if (e->is_comment()) continue;
        if (e->is_text()) {
            string text;
            e->get_text(text);
            const char* p = text.c_str();
            while (*p) {
                char32_t cp = satoru::decode_utf8_char(&p);
                if (cp == 0) break;
                out.insert(cp);
            }
            continue;
        }
        if (std::string(e->get_tagName()) == "style") continue;
        collect_svg_text_codepoints(e->children(), out);
    }
}

class SatoruImageAsset : public skresources::ImageAsset {
   public:
    SatoruImageAsset(sk_sp<SkImage> image) : fImage(std::move(image)) {}
    bool isMultiFrame() override { return false; }
    skresources::ImageAsset::FrameData getFrameData(float t) override {
        return {fImage, SkSamplingOptions(), SkMatrix::I(),
                skresources::ImageAsset::SizeFit::kFill};
    }

   private:
    sk_sp<SkImage> fImage;
};

// SkSVGDOM looks fonts up through an SkFontMgr, but Satoru's own manager is an empty custom one
// (typefaces are registered in SatoruFontManager, not in Skia's family tables), so SVG <text>
// resolved no typeface and drew nothing. This manager answers family lookups from the context.
class SatoruSvgFontMgr final : public SkFontMgr {
   public:
    SatoruSvgFontMgr(SatoruContext& ctx, sk_sp<SkFontMgr> base)
        : m_ctx(ctx), m_base(std::move(base)) {}

   protected:
    int onCountFamilies() const override { return 0; }
    void onGetFamilyName(int, SkString*) const override {}
    sk_sp<SkFontStyleSet> onCreateStyleSet(int) const override {
        return SkFontStyleSet::CreateEmpty();
    }
    sk_sp<SkFontStyleSet> onMatchFamily(const char[]) const override {
        return SkFontStyleSet::CreateEmpty();
    }
    sk_sp<SkTypeface> onMatchFamilyStyle(const char family[], const SkFontStyle& style) const override {
        return lookup(family, style);
    }
    sk_sp<SkTypeface> onMatchFamilyStyleCharacter(const char family[], const SkFontStyle& style,
                                                  const char*[], int, SkUnichar c) const override {
        // The requested family, then sans-serif: every face of each (the default fonts come in
        // unicode-range slices, so the first face covers only part of the Latin letters or of the
        // kanji), then any loaded typeface that covers the character.
        for (const char* name : {family, "sans-serif"}) {
            if (!name || !*name) continue;
            bool fake_bold = false;
            for (auto& tf : m_ctx.get_typefaces(name, style.weight(), style.slant(), fake_bold))
                if (tf && tf->unicharToGlyph(c) != 0) return weighted(tf, style.weight());
        }
        if (auto any = m_ctx.fontManager.findTypefaceForCodepoint(c)) return weighted(any, style.weight());
        return lookup(family, style);
    }
    sk_sp<SkTypeface> onMakeFromData(sk_sp<SkData> d, int i) const override {
        return m_base ? m_base->makeFromData(std::move(d), i) : nullptr;
    }
    sk_sp<SkTypeface> onMakeFromStreamIndex(std::unique_ptr<SkStreamAsset> s, int i) const override {
        return m_base ? m_base->makeFromStream(std::move(s), i) : nullptr;
    }
    sk_sp<SkTypeface> onMakeFromStreamArgs(std::unique_ptr<SkStreamAsset> s,
                                           const SkFontArguments& a) const override {
        return m_base ? m_base->makeFromStream(std::move(s), a) : nullptr;
    }
    sk_sp<SkTypeface> onMakeFromFile(const char path[], int i) const override {
        return m_base ? m_base->makeFromFile(path, i) : nullptr;
    }
    sk_sp<SkTypeface> onLegacyMakeTypeface(const char family[], SkFontStyle style) const override {
        return lookup(family, style);
    }

   private:
    sk_sp<SkTypeface> lookup(const char* family, const SkFontStyle& style) const {
        SkFontStyle::Slant slant = style.slant();
        bool fake_bold = false;
        std::string name = family ? family : "";
        if (!name.empty()) {
            auto tfs = m_ctx.get_typefaces(name, style.weight(), slant, fake_bold);
            if (!tfs.empty() && tfs.front()) return weighted(tfs.front(), style.weight());
        }
        auto tfs = m_ctx.get_typefaces("sans-serif", style.weight(), slant, fake_bold);
        if (!tfs.empty() && tfs.front()) return weighted(tfs.front(), style.weight());
        return m_ctx.fontManager.getDefaultTypeface();
    }

    // The default fonts are variable: the face for a weight is a clone with that wght (what the HTML text
    // path does through createSkFont); SkSVGDOM would otherwise draw every weight at the default one.
    sk_sp<SkTypeface> weighted(sk_sp<SkTypeface> tf, int weight) const {
        if (!tf) return tf;
        std::unique_ptr<SkFont> font(m_ctx.fontManager.createSkFont(tf, 12.0f, weight));
        return font ? font->refTypeface() : tf;
    }

    SatoruContext& m_ctx;
    sk_sp<SkFontMgr> m_base;
};

// SkSVGDOM shapes text with Skia's primitive shaper unless it is given another one, and that shaper takes
// the font of the FIRST font run for the whole string: a character that font lacks (the second kanji of a
// word, when the default CJK font comes in unicode-range slices) is drawn as a box. HarfBuzz walks every
// run, so the fallback manager above is consulted for each character.
class SatoruSvgShaperFactory final : public SkShapers::Factory {
   public:
    explicit SatoruSvgShaperFactory(sk_sp<SkUnicode> unicode) : m_unicode(std::move(unicode)) {}

    std::unique_ptr<SkShaper> makeShaper(sk_sp<SkFontMgr> fallback) override {
        return SkShapers::HB::ShapeDontWrapOrReorder(m_unicode, std::move(fallback));
    }
    // One direction and one script per string: HarfBuzz guesses the segment properties itself.
    // The run ends at the end of the text: HarfBuzz walks the runs, and an end of 0 never advances.
    std::unique_ptr<SkShaper::BiDiRunIterator> makeBidiRunIterator(const char*, size_t utf8Bytes, uint8_t level) override {
        return std::make_unique<SkShaper::TrivialBiDiRunIterator>(level, utf8Bytes);
    }
    std::unique_ptr<SkShaper::ScriptRunIterator> makeScriptRunIterator(const char*, size_t utf8Bytes, SkFourByteTag script) override {
        return std::make_unique<SkShaper::TrivialScriptRunIterator>(script, utf8Bytes);
    }
    SkUnicode* getUnicode() override { return m_unicode.get(); }

   private:
    sk_sp<SkUnicode> m_unicode;
};

class SatoruResourceProvider : public skresources::ResourceProvider {
   public:
    SatoruResourceProvider(const std::map<std::string, image_info>& imageCache)
        : m_imageCache(imageCache) {}

    sk_sp<skresources::ImageAsset> loadImageAsset(const char path[], const char name[],
                                                  const char id[]) const override {
        std::string full_path;
        if (path && path[0]) {
            full_path = path;
            if (name && name[0]) {
                full_path += "/";
                full_path += name;
            }
        } else if (name && name[0]) {
            full_path = name;
        }

        if (full_path.empty()) return nullptr;

        auto it = m_imageCache.find(full_path);
        if (it != m_imageCache.end() && it->second.skImage) {
            return sk_make_sp<SatoruImageAsset>(it->second.skImage);
        }

        return nullptr;
    }

   private:
    const std::map<std::string, image_info>& m_imageCache;
};

}  // namespace

el_svg::el_svg(const std::shared_ptr<document>& doc) : html_tag(doc) {
    (*m_cssp).set_display(display_inline_block);
}
el_svg::~el_svg() {}

void el_svg::parse_attributes() {
    html_tag::parse_attributes();
}

// Presentational hints are re-applied whenever styles are recomputed; mapping width/height in
// parse_attributes() lost them on the first refresh, so an SVG with an explicit height got an
// aspect-ratio height instead.
void el_svg::parse_presentational_hints() {
    const char* str_w = get_attr("width");
    const char* str_h = get_attr("height");
    // SVG width/height are CSS lengths, so "1.33em" keeps its unit; the HTML dimension mapping
    // would read it as 1.33px. Plain numbers and percentages still take the HTML path.
    auto map_length = [this](string_id prop, const char* value) {
        char* end = nullptr;
        double v = strtod(value, &end);
        while (*end == ' ') end++;
        size_t n = strlen(end);
        while (n && end[n - 1] == ' ') n--;
        if (end == value || n == 0 || (n == 1 && *end == '%') || (n == 2 && !strncmp(end, "px", 2))) {
            map_to_dimension_property(prop, value);
        } else {
            m_style.add_property(prop, {css_token{DIMENSION, (float)v, css_number_number, string(end, n)}});
        }
    };
    if (str_w) map_length(_width_, str_w);
    if (str_h) map_length(_height_, str_h);
    html_tag::parse_presentational_hints();
}

bool el_svg::is_ratio_only_replaced() const {
    // No intrinsic width or height (absent, or a percentage), but a usable viewBox for the ratio.
    auto has_size = [&](const char* name) {
        const char* v = get_attr(name);
        return v && !strchr(v, '%') && atof(v) > 0;
    };
    if (has_size("width") || has_size("height")) return false;
    const char* vb = get_attr("viewbox");
    float vx, vy, vw, vh;
    return vb && (sscanf(vb, "%f %f %f %f", &vx, &vy, &vw, &vh) == 4 ||
                  sscanf(vb, "%f,%f,%f,%f", &vx, &vy, &vw, &vh) == 4) &&
           vw > 0 && vh > 0;
}

void el_svg::get_content_size(size& sz, pixel_t max_width) {
    // Only absolute lengths are an intrinsic size; "100%" is not 100px.
    auto absolute_px = [](const css_length& len) -> pixel_t {
        if (len.is_predefined() || len.is_calc() || len.units() == css_units_percentage) return 0;
        return (pixel_t)len.val();
    };
    sz.width = absolute_px(css().get_width());
    sz.height = absolute_px(css().get_height());

    // A percentage attribute ("100%") is not a pixel size: atof() would read it as 100px.
    auto attr_px = [&](const char* name) -> pixel_t {
        const char* v = get_attr(name);
        if (!v || strchr(v, '%')) return 0;
        return (pixel_t)atof(v);
    };
    if (sz.width == 0) sz.width = attr_px("width");
    if (sz.height == 0) sz.height = attr_px("height");

    if (sz.width == 0 || sz.height == 0) {
        const char* str_vb = get_attr("viewbox");
        if (str_vb) {
            float vx, vy, vw, vh;
            // Try space-separated first
            if (sscanf(str_vb, "%f %f %f %f", &vx, &vy, &vw, &vh) == 4 ||
                sscanf(str_vb, "%f,%f,%f,%f", &vx, &vy, &vw, &vh) == 4) {
                if (vw > 0 && vh > 0) {
                    if (sz.width == 0 && sz.height == 0) {
                        sz.width = vw;
                        sz.height = vh;
                    } else if (sz.width == 0) {
                        sz.width = sz.height * vw / vh;
                    } else if (sz.height == 0) {
                        sz.height = sz.width * vh / vw;
                    }
                }
            }
        }
    }

    if (sz.width == 0) sz.width = 100;
    if (sz.height == 0) sz.height = 100;
}

std::shared_ptr<render_item> el_svg::create_render_item(
    const std::shared_ptr<render_item>& parent_ri) {
    if (auto* skia = dynamic_cast<container_skia*>(get_document()->container())) {
        std::set<char32_t> codepoints;
        collect_svg_text_codepoints(m_children, codepoints);
        if (!codepoints.empty()) skia->add_used_codepoints(codepoints);
    }
    auto ret = std::make_shared<render_item_image>(shared_from_this());
    ret->parent(parent_ri);
    return ret;
}

namespace {

std::string trim_copy(const std::string& v) {
    size_t b = v.find_first_not_of(" \t\r\n");
    if (b == std::string::npos) return "";
    size_t e = v.find_last_not_of(" \t\r\n");
    return v.substr(b, e - b + 1);
}

// The text of a custom property's tokens. The stylesheet drops whitespace tokens, so a value whose parts
// need a separator (`color-mix(in srgb, #000 50%, #fff)`) is written back with spaces; anything else keeps
// the compact form that plain colours (`rgb(1,2,3)`) need.
std::string custom_property_text(const css_token_vector& toks) {
    std::string compact = get_repr(toks);
    return compact.find("color-mix(") != std::string::npos ? get_repr(toks, 0, -1, true) : compact;
}

// Resolve var() and light-dark() in a fill/stroke value the way the cascade would. Returns false
// when the value is invalid at computed-value time (an undefined variable without a fallback), in
// which case the declaration is dropped. light-dark() picks its light branch.
bool resolve_paint(const element* el, const std::string& in, std::string& out, int depth = 0) {
    if (depth > 16) return false;
    out.clear();
    size_t i = 0;
    while (i < in.size()) {
        size_t v = in.find("var(", i);
        size_t l = in.find("light-dark(", i);
        bool is_var = v != std::string::npos && (l == std::string::npos || v < l);
        size_t start = is_var ? v : l;
        if (start == std::string::npos) {
            out.append(in, i, std::string::npos);
            break;
        }
        out.append(in, i, start - i);
        size_t p = start + (is_var ? 4 : 11);
        int paren = 1;
        size_t comma = std::string::npos;
        while (p < in.size() && paren > 0) {
            char c = in[p];
            if (c == '(') paren++;
            else if (c == ')') paren--;
            else if (c == ',' && paren == 1 && comma == std::string::npos) comma = p;
            if (paren > 0) p++;
        }
        if (paren != 0) return false;
        size_t arg_start = start + (is_var ? 4 : 11);
        std::string first = trim_copy(in.substr(arg_start, (comma == std::string::npos ? p : comma) - arg_start));
        std::string second = comma == std::string::npos ? "" : trim_copy(in.substr(comma + 1, p - comma - 1));
        std::string piece;
        if (is_var) {
            bool ok = false;
            css_token_vector toks;
            if (first.rfind("--", 0) == 0 && el->get_custom_property(_id(first), toks)) {
                ok = resolve_paint(el, custom_property_text(toks), piece, depth + 1);
            }
            if (!ok) {
                if (comma == std::string::npos) return false;
                if (!resolve_paint(el, second, piece, depth + 1)) return false;
            }
        } else {
            if (!resolve_paint(el, first, piece, depth + 1)) return false;
        }
        out += piece;
        i = p + 1;
    }
    out = trim_copy(out);
    return !out.empty();
}

// The fill/stroke the stylesheets give an element, resolved, or empty when it has none.
std::string css_paint(const element* el, string_id property) {
    const property_value& pv = el->get_property_value(property);
    if (!pv.is<string>()) return "";
    std::string resolved, out;
    if (!resolve_paint(el, pv.get<string>(), resolved)) return "";
    return svgutil::eval_color_functions(resolved, out) ? out : "";
}

std::string svg_escape_attr(const std::string& v) {
    std::string out;
    for (char c : v) {
        if (c == '&') out += "&amp;";
        else if (c == '"') out += "&quot;";
        else if (c == '<') out += "&lt;";
        else out += c;
    }
    return out;
}

// An attribute value with var(), light-dark() and color-mix() evaluated, since SkSVGDOM reads none of
// them (SVG generators such as beautiful-mermaid put `fill="var(--_node-fill)"` on every shape).
// Returns false when the value is invalid at computed-value time: the attribute is then dropped.
bool resolve_attr(const element* el, const std::string& value, std::string& out) {
    auto has = [&](const char* f) { return value.find(f) != std::string::npos; };
    if (!has("var(") && !has("light-dark(") && !has("color-mix(")) {
        out = value;
        return true;
    }
    std::string resolved;
    if (!resolve_paint(el, value, resolved)) return false;
    return svgutil::eval_color_functions(resolved, out);
}

// The font-family the stylesheets give a text element (`text { font-family: ... }`), or empty.
std::string css_font_family(const element* el) {
    const property_value& pv = el->get_property_value(_font_family_);
    return pv.is<string>() ? pv.get<string>() : "";
}

}  // namespace

class html_tag_accessor : public html_tag {
   public:
    static const string_map& get_attrs(const html_tag* tag) {
        return ((const html_tag_accessor*)tag)->m_attrs;
    }
    static const elements_list& get_children(const html_tag* tag) {
        return ((const html_tag_accessor*)tag)->m_children;
    }
};

void el_svg::write_element(std::ostream& os, const element::ptr& el) const {
    if (el->is_text()) {
        string text;
        el->get_text(text);
        // the parser has decoded entities; XML needs them back, or "<<x>>" ends the whole document
        for (char c : text) {
            if (c == '&') os << "&amp;";
            else if (c == '<') os << "&lt;";
            else if (c == '>') os << "&gt;";
            else os << c;
        }
        return;
    }
    if (el->is_comment()) return;

    std::string tag_name = map_tag(el->get_tagName());
    os << "<" << tag_name;

    bool is_image_or_use = (tag_name == "image" || tag_name == "use");

    auto tag_ptr = std::dynamic_pointer_cast<html_tag>(el);
    if (tag_ptr) {
        const auto& attrs = html_tag_accessor::get_attrs(tag_ptr.get());
        bool stroke_width_is_zero = false;
        for (auto const& attr : attrs) {
            if (attr.first == "stroke-width" && (attr.second == "0" || attr.second == "0px")) {
                stroke_width_is_zero = true;
                break;
            }
        }

        // Stylesheet fill/stroke win over the presentation attributes of the same name.
        const std::string css_fill = css_paint(el.get(), _fill_);
        const std::string css_stroke = css_paint(el.get(), _stroke_);

        bool stroke_attr_written = false;
        for (auto const& attr : attrs) {
            std::string attr_name = map_attr(attr.first);
            std::string attr_val = attr.second;
            if ((attr_name == "fill" && !css_fill.empty()) ||
                (attr_name == "stroke" && !css_stroke.empty()))
                continue;
            // Remove newlines and tabs from attribute values (common in base64 data URLs)
            attr_val.erase(std::remove(attr_val.begin(), attr_val.end(), '\n'), attr_val.end());
            attr_val.erase(std::remove(attr_val.begin(), attr_val.end(), '\r'), attr_val.end());
            attr_val.erase(std::remove(attr_val.begin(), attr_val.end(), '\t'), attr_val.end());
            if (!resolve_attr(el.get(), attr_val, attr_val)) continue;

            if (attr_name == "stroke") {
                if (stroke_width_is_zero) {
                    os << " stroke=\"none\"";
                } else {
                    os << " stroke=\"" << attr_val << "\"";
                }
                stroke_attr_written = true;
            } else if (is_image_or_use && (attr_name == "href" || attr_name == "xlink:href")) {
                os << " xlink:href=\"" << attr_val << "\"";
            } else if (attr_name != "xmlns" && attr_name != "xmlns:xlink") {
                os << " " << attr_name << "=\"" << attr_val << "\"";
            }
        }
        if (!css_fill.empty()) os << " fill=\"" << css_fill << "\"";
        if (!css_stroke.empty()) {
            os << " stroke=\"" << (stroke_width_is_zero ? "none" : css_stroke) << "\"";
            stroke_attr_written = true;
        }
        if (stroke_width_is_zero && !stroke_attr_written) {
            os << " stroke=\"none\"";
        }
        if ((tag_name == "text" || tag_name == "tspan") && !el->get_attr("font-family")) {
            std::string family = css_font_family(el.get());
            if (!family.empty()) os << " font-family=\"" << svg_escape_attr(family) << "\"";
        }
    }

    auto children = el->children();
    if (children.empty()) {
        os << "/>";
    } else {
        os << ">";
        for (auto const& child : children) {
            write_element(os, child);
        }
        os << "</" << tag_name << ">";
    }
    write_markers(os, el, tag_name);
}

// SkSVGDOM draws no <marker>, so marker-start / marker-end of a line, polyline or polygon are drawn
// here: the marker's content is copied into a group placed on the first / last vertex.
const element* el_svg::find_marker(const element_list_t& list, const std::string& id) const {
    for (auto const& e : list) {
        if (e->is_text() || e->is_comment()) continue;
        if (std::string(e->get_tagName()) == "marker") {
            const char* mid = e->get_attr("id");
            if (mid && id == mid) return e.get();
        }
        if (auto found = find_marker(e->children(), id)) return found;
    }
    return nullptr;
}

void el_svg::write_markers(std::ostream& os, const element::ptr& el, const std::string& tag_name) const {
    if (tag_name != "line" && tag_name != "polyline" && tag_name != "polygon") return;
    const char* start_ref = el->get_attr("marker-start");
    const char* end_ref = el->get_attr("marker-end");
    if (!start_ref && !end_ref) return;

    std::vector<svgutil::Point> pts;
    auto num = [&](const char* name) {
        const char* v = el->get_attr(name);
        return v ? std::strtod(v, nullptr) : 0.0;
    };
    if (tag_name == "line") {
        pts = {{num("x1"), num("y1")}, {num("x2"), num("y2")}};
    } else if (const char* points = el->get_attr("points")) {
        pts = svgutil::parse_points(points);
    }
    if (pts.size() < 2) return;
    const char* sw = el->get_attr("stroke-width");
    double stroke_width = sw ? std::strtod(sw, nullptr) : 1.0;
    if (!(stroke_width > 0)) stroke_width = 1.0;

    auto place = [&](const char* ref, bool at_end) {
        if (!ref) return;
        std::string r = svgutil::trim(ref);
        if (r.rfind("url(#", 0) != 0) return;
        size_t close = r.find(')');
        if (close == std::string::npos) return;
        std::string id = svgutil::trim(r.substr(5, close - 5));
        if (id.size() >= 2 && (id.back() == '"' || id.back() == '\'')) id = id.substr(0, id.size() - 1);
        const element* marker = find_marker(m_children, id);
        if (!marker) return;

        auto attr = [&](const char* name, double def) {
            const char* v = marker->get_attr(name);
            return v ? std::strtod(v, nullptr) : def;
        };
        svgutil::MarkerDef def;
        def.refX = attr("refx", 0);
        def.refY = attr("refy", 0);
        def.markerWidth = attr("markerwidth", 3);
        def.markerHeight = attr("markerheight", 3);
        if (const char* vb = marker->get_attr("viewbox")) {
            auto nums = svgutil::parse_points(vb);  // x y w h as two pairs
            if (nums.size() == 2) {
                def.has_viewBox = true;
                def.vbX = nums[0].x;
                def.vbY = nums[0].y;
                def.vbW = nums[1].x;
                def.vbH = nums[1].y;
            }
        }
        const char* units = marker->get_attr("markerunits");
        def.stroke_units = !(units && std::string(units) == "userSpaceOnUse");

        double angle = 0;
        const char* orient = marker->get_attr("orient");
        std::string o = orient ? svgutil::trim(orient) : "";
        if (o == "auto" || o == "auto-start-reverse") {
            angle = svgutil::segment_angle(pts, at_end);
            if (!at_end && o == "auto-start-reverse") angle += 180;
        } else if (!o.empty()) {
            angle = std::strtod(o.c_str(), nullptr);
        }
        os << "<g transform=\"" << svgutil::marker_transform(def, at_end ? pts.back() : pts.front(), angle, stroke_width)
           << "\">";
        for (auto const& child : marker->children()) write_element(os, child);
        os << "</g>";
    };
    place(start_ref, false);
    place(end_ref, true);
}

std::string el_svg::reconstruct_xml(int x, int y, int width, int height) const {
    std::stringstream ss;
    ss << "<svg x=\"" << x << "\" y=\"" << y << "\" width=\"" << width << "\" height=\"" << height
       << "\" xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"";

    for (auto const& attr : m_attrs) {
        std::string attr_name = map_attr(attr.first);
        if (attr_name == "viewBox") {
            ss << " " << attr_name << "=\"" << attr.second << "\"";
        }
    }

    bool stroke_width_is_zero = false;
    for (auto const& attr : m_attrs) {
        if (attr.first == "stroke-width" && (attr.second == "0" || attr.second == "0px")) {
            stroke_width_is_zero = true;
            break;
        }
    }

    const std::string css_fill = css_paint(this, _fill_);
    const std::string css_stroke = css_paint(this, _stroke_);

    bool stroke_attr_written = false;
    for (auto const& attr : m_attrs) {
        std::string attr_name = map_attr(attr.first);
        std::string attr_val = attr.second;
        if ((attr_name == "fill" && !css_fill.empty()) ||
            (attr_name == "stroke" && !css_stroke.empty()))
            continue;
        // Remove newlines and tabs
        attr_val.erase(std::remove(attr_val.begin(), attr_val.end(), '\n'), attr_val.end());
        attr_val.erase(std::remove(attr_val.begin(), attr_val.end(), '\r'), attr_val.end());
        attr_val.erase(std::remove(attr_val.begin(), attr_val.end(), '\t'), attr_val.end());
        if (!resolve_attr(this, attr_val, attr_val)) continue;

        if (attr_name == "xmlns" || attr_name == "xmlns:xlink" || attr_name == "x" ||
            attr_name == "y" || attr_name == "width" || attr_name == "height" ||
            attr_name == "viewBox")
            continue;
        if (attr_name == "stroke") {
            if (stroke_width_is_zero) {
                ss << " stroke=\"none\"";
            } else {
                ss << " stroke=\"" << attr_val << "\"";
            }
            stroke_attr_written = true;
        } else if (attr_name == "href" || attr_name == "xlink:href") {
            ss << " xlink:href=\"" << attr_val << "\"";
        } else {
            ss << " " << attr_name << "=\"" << attr_val << "\"";
        }
    }
    if (!css_fill.empty()) ss << " fill=\"" << css_fill << "\"";
    if (!css_stroke.empty()) {
        ss << " stroke=\"" << (stroke_width_is_zero ? "none" : css_stroke) << "\"";
        stroke_attr_written = true;
    }
    if (stroke_width_is_zero && !stroke_attr_written) {
        ss << " stroke=\"none\"";
    }

    ss << ">";
    for (auto const& child : m_children) {
        write_element(ss, child);
    }
    ss << "</svg>";
    return ss.str();
}

void configure_svg_builder(SkSVGDOM::Builder& builder, SatoruContext& context) {
    auto resource_provider = sk_make_sp<SatoruResourceProvider>(context.imageCache);
    builder.setResourceProvider(skresources::DataURIResourceProviderProxy::Make(
        resource_provider, skresources::ImageDecodeStrategy::kPreDecode));
    builder.setTextShapingFactory(
        sk_make_sp<SatoruSvgShaperFactory>(context.getUnicodeService().getSkUnicodeSp()));
    builder.setFontManager(sk_make_sp<SatoruSvgFontMgr>(context, context.fontManager.getFontMgr()));
}

// Draw finished SVG XML (absolute position when tagging) at pos; shared with el_mermaid.
void draw_svg_xml(container_skia* container, const std::string& xml, const position& pos) {
    SkCanvas* canvas = container->get_canvas();
    if (!canvas) return;
    if (container->is_tagging()) {
        int index = container->add_inline_svg(xml, pos);
        SkPaint p;
        p.setColor(satoru::make_magic_color(satoru::MagicTagExtended::InlineSvg, index));
        canvas->drawRect(
            SkRect::MakeXYWH((float)pos.x, (float)pos.y, (float)pos.width, (float)pos.height), p);
    } else {
        SkMemoryStream stream(xml.c_str(), xml.size());
        auto resource_provider =
            sk_make_sp<SatoruResourceProvider>(container->get_context().imageCache);
        auto proxy_rp = skresources::DataURIResourceProviderProxy::Make(
            resource_provider, skresources::ImageDecodeStrategy::kPreDecode);

        SkSVGDOM::Builder builder;
        builder.setResourceProvider(proxy_rp);
        // Without a font manager SkSVGText draws nothing at all.
        configure_svg_builder(builder, container->get_context());
        auto svg_dom = builder.make(stream);

        if (svg_dom) {
            canvas->save();
            canvas->translate((float)pos.x, (float)pos.y);

            SkSize container_size = SkSize::Make((float)pos.width, (float)pos.height);
            svg_dom->setContainerSize(container_size);
            svg_dom->render(canvas);

            canvas->restore();
        }
    }
}

void el_svg::draw(uint_ptr hdc, pixel_t x, pixel_t y, const position* clip,
                  const std::shared_ptr<render_item>& ri) {
    container_skia* container = dynamic_cast<container_skia*>(get_document()->container());
    if (!container) return;

    SkCanvas* canvas = container->get_canvas();
    if (!canvas) return;

    position pos = ri->pos();
    pos.x += x;
    pos.y += y;

    // For tagging (SVG output), we need absolute coordinates in the reconstructed XML
    // because svg_renderer will replace a magic-colored rect with this XML string.
    std::string xml =
        reconstruct_xml(container->is_tagging() ? (int)pos.x : 0,
                        container->is_tagging() ? (int)pos.y : 0, (int)pos.width, (int)pos.height);

    xml = replace_css_vars(xml);

    // Replace "currentColor" with actual computed color
    litehtml::web_color color = css().get_color();
    xml = replace_current_color(xml, color);

    draw_svg_xml(container, xml, pos);
}

}  // namespace litehtml
