// <pre class="mermaid"> / <div class="mermaid">: the element's text is a Mermaid diagram that the engine draws
// itself (src/cpp/mermaid), as a replaced element in the same way an inline <svg> is.

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <list>
#include <set>
#include <string>
#include <unordered_map>

#include "container_skia.h"
#include "el_svg.h"
#include "include/core/SkFont.h"
#include "include/core/SkFontStyle.h"
#include "include/core/SkTypeface.h"
#include "utils/logging.h"
#include "libs/litehtml/include/litehtml/render_image.h"
#include "libs/litehtml/include/litehtml/render_item.h"
#include "mermaid/mermaid.h"
#include "mermaid/mermaid_internal.h"
#include "satoru_context.h"
#include "text_utils.h"

namespace litehtml {

namespace {

void collect_plain_text(const std::list<std::shared_ptr<element>>& list, std::string& out) {
    for (auto const& e : list) {
        if (e->is_comment()) continue;
        if (e->is_text()) {
            string t;
            e->get_text(t);
            out += t;
            continue;
        }
        collect_plain_text(e->children(), out);
    }
}

// What one diagram's measuring has already worked out. The same labels are measured over and over (every wrap, every size
// pass of the layout), and each character costs a face lookup and a font; the fonts do not change while one diagram is drawn.
struct MeasureCache {
    std::unordered_map<std::string, double> strings;                    // whole text at one size, weight and family
    std::unordered_map<unsigned long long, double> glyphs;              // one character at one size, weight and family
};

// Text width from the fonts the engine has loaded; a character no face covers counts as an estimate.
double measure_with_fonts(SatoruContext* ctx, MeasureCache& cache, const std::string& text, double size, int weight, bool mono) {
    char head[48];
    std::snprintf(head, sizeof head, "%d|%d|%.3f|", mono ? 1 : 0, weight, size);
    std::string key = head + text;
    if (auto it = cache.strings.find(key); it != cache.strings.end()) return it->second;
    bool fake_bold = false;
    std::vector<sk_sp<SkTypeface>> faces;
    bool have_faces = false;
    double w = 0;
    const char* p = text.c_str();
    while (*p) {
        const char* start = p;
        char32_t cp = satoru::decode_utf8_char(&p);
        if (cp == 0) break;
        // character (21 bits), weight (10), family (1), size in eighths (up to 12 bits): no two of them share a bit
        unsigned long long gk = (unsigned long long)cp | ((unsigned long long)(weight & 0x3FF) << 21) | ((mono ? 1ull : 0ull) << 31) |
                                ((unsigned long long)(size * 8.0 + 0.5) & 0xFFFFFull) << 32;
        if (auto it = cache.glyphs.find(gk); it != cache.glyphs.end()) {
            w += it->second;
            continue;
        }
        if (!have_faces) {
            faces = ctx->get_typefaces(mono ? "monospace" : "sans-serif", weight, SkFontStyle::kUpright_Slant, fake_bold);
            have_faces = true;
        }
        sk_sp<SkTypeface> face;
        for (auto& f : faces)
            if (f && f->unicharToGlyph((SkUnichar)cp) != 0) {
                face = f;
                break;
            }
        if (!face) face = ctx->fontManager.findTypefaceForCodepoint((SkUnichar)cp);
        double cw;
        if (!face) {
            cw = size * (cp < 0x80 ? 0.55 : 1.0);
        } else {
            SkFont font(face, (SkScalar)size);
            cw = font.measureText(start, (size_t)(p - start), SkTextEncoding::kUTF8);
        }
        cache.glyphs[gk] = cw;
        w += cw;
    }
    cache.strings[key] = w;
    return w;
}

}  // namespace

el_mermaid::el_mermaid(const std::shared_ptr<document>& doc) : html_tag(doc) {}
el_mermaid::~el_mermaid() {}

// Draws the diagram once: the colours come from the page (`color`, and the --mermaid-bg / -accent / ...
// custom properties on the element or an ancestor), the text widths from the loaded fonts.
void el_mermaid::ensure_svg() {
    if (m_ready) return;
    m_ready = true;
    std::string source;
    collect_plain_text(m_children, source);

    mermaid::Options opt;
    auto* skia = dynamic_cast<container_skia*>(get_document()->container());
    auto prop = [&](const char* name) -> std::string {
        css_token_vector toks;
        if (!get_custom_property(_id(name), toks)) return "";
        return svgutil::trim(get_repr(toks, 0, -1, true));
    };
    opt.fg = color_to_string(css().get_color());
    // a named theme first, then every colour the page sets itself on top of it
    if (auto t = prop("--mermaid-theme"); !t.empty()) mermaid::apply_theme(t, opt);
    auto over = [&](const char* name, std::string& dst) {
        if (auto v = prop(name); !v.empty()) dst = v;
    };
    over("--mermaid-fg", opt.fg);
    over("--mermaid-bg", opt.bg);
    over("--mermaid-accent", opt.accent);
    over("--mermaid-line", opt.line);
    over("--mermaid-muted", opt.muted);
    over("--mermaid-surface", opt.surface);
    over("--mermaid-border", opt.border);
    over("--mermaid-arrow", opt.arrow);
    over("--mermaid-group-fill", opt.group_fill);
    over("--mermaid-group-header", opt.group_header);
    over("--mermaid-label-fill", opt.label_fill);
    // arrow heads follow the line (official themes) or the accent unless the page names them
    if (prop("--mermaid-arrow").empty()) {
        if (!prop("--mermaid-line").empty() && !opt.arrow.empty()) opt.arrow = opt.line;
        else if (!prop("--mermaid-accent").empty()) opt.arrow.clear();
    }
    opt.allow_directives = prop("--mermaid-directives") == "on";
    // a limit given as 0 lifts it; anything that is not a number keeps the default
    auto limit = [&](const char* name, size_t& dst) {
        std::string v = prop(name);
        if (!v.empty() && v.find_first_not_of("0123456789") == std::string::npos) dst = (size_t)std::strtoull(v.c_str(), nullptr, 10);
    };
    limit("--mermaid-max-bytes", opt.max_source_bytes);
    limit("--mermaid-max-lines", opt.max_lines);
    if (auto m = prop("--mermaid-mode"); m == "compat") opt.mode = mermaid::Options::Mode::Compat;
    else if (m == "recover") opt.mode = mermaid::Options::Mode::Recover;
    if (skia) {
        SatoruContext* ctx = &skia->get_context();
        auto cache = std::make_shared<MeasureCache>();
        opt.measure = [ctx, cache](const std::string& text, double size, int weight, bool mono) {
            return measure_with_fonts(ctx, *cache, text, size, weight, mono);
        };
    }

    std::string svg, err;
    std::vector<std::string> repaired;
    if (mermaid::render(source, opt, svg, err, &repaired)) {
        // what the input repair changed (Compat / Recover), for the page's diagnostics
        for (const std::string& note : repaired) SATORU_LOG_WARN("[MERMAID_RECOVERED] %s", note.c_str());
    } else {
        // a diagram that does not parse is shown as a one-line error instead of vanishing
        SATORU_LOG_WARN("[MERMAID_ERROR] %s", err.c_str());
        std::string msg = "Mermaid: " + err;
        double w = mermaid::estimate_text_width(msg, 12, 400, false) + 24, h = 36;
        svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 " + mermaid::num(w) + " " + mermaid::num(h) + "\" width=\"" +
              mermaid::num(w) + "\" height=\"" + mermaid::num(h) + "\"><rect x=\"0.5\" y=\"0.5\" width=\"" + mermaid::num(w - 1) +
              "\" height=\"" + mermaid::num(h - 1) + "\" fill=\"none\" stroke=\"#cf222e\"/><text x=\"12\" y=\"22\" font-size=\"12\" " +
              "font-family=\"sans-serif\" fill=\"#cf222e\">" + mermaid::esc(msg) + "</text></svg>";
        source += msg;
    }
    float vw = 0, vh = 0;
    if (const char* vb = strstr(svg.c_str(), "viewBox=\"")) sscanf(vb + 9, "%*f %*f %f %f", &vw, &vh);
    m_w = vw > 0 ? vw : 100;
    m_h = vh > 0 ? vh : 100;
    size_t gt = svg.find('>');
    size_t close = svg.rfind("</svg>");
    if (gt != std::string::npos && close != std::string::npos && close > gt) m_inner = svg.substr(gt + 1, close - gt - 1);

    // the labels' characters decide which font slices are fetched
    if (skia) {
        std::set<char32_t> codepoints;
        const char* p = source.c_str();
        while (*p) {
            char32_t cp = satoru::decode_utf8_char(&p);
            if (cp == 0) break;
            codepoints.insert(cp);
        }
        skia->add_used_codepoints(codepoints);
    }
}

void el_mermaid::get_content_size(size& sz, pixel_t max_width) {
    ensure_svg();
    sz.width = (pixel_t)m_w;
    sz.height = (pixel_t)m_h;
    if (max_width > 0 && sz.width > max_width) {
        sz.height = sz.height * max_width / sz.width;
        sz.width = max_width;
    }
}

std::shared_ptr<render_item> el_mermaid::create_render_item(const std::shared_ptr<render_item>& parent_ri) {
    ensure_svg();
    auto ret = std::make_shared<render_item_image>(shared_from_this());
    ret->parent(parent_ri);
    return ret;
}

void el_mermaid::draw(uint_ptr, pixel_t x, pixel_t y, const position*, const std::shared_ptr<render_item>& ri) {
    container_skia* container = dynamic_cast<container_skia*>(get_document()->container());
    if (!container || !container->get_canvas()) return;
    ensure_svg();
    position pos = ri->pos();
    pos.x += x;
    pos.y += y;
    // when tagging (SVG output) the XML carries absolute coordinates
    char head[320];
    snprintf(head, sizeof(head),
             "<svg x=\"%d\" y=\"%d\" width=\"%d\" height=\"%d\" viewBox=\"0 0 %g %g\" xmlns=\"http://www.w3.org/2000/svg\" "
             "xmlns:xlink=\"http://www.w3.org/1999/xlink\">",
             container->is_tagging() ? (int)pos.x : 0, container->is_tagging() ? (int)pos.y : 0, (int)pos.width, (int)pos.height, m_w,
             m_h);
    draw_svg_xml(container, std::string(head) + m_inner + "</svg>", pos);
}

}  // namespace litehtml
