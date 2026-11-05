#include "el_image.h"
#include "render_image.h"
#include "document_container.h"

#include <cstdlib>

litehtml::el_image::el_image(const document::ptr& doc) : html_tag(doc)
{
	(*m_cssp).set_display(display_inline_block);
}

void litehtml::el_image::get_content_size( size& sz, pixel_t /*max_width*/ )
{
	get_document()->container()->get_image_size(m_src.c_str(), nullptr, sz);
}

bool litehtml::el_image::is_replaced() const
{
	return true;
}

bool litehtml::el_image::is_ratio_only_replaced() const
{
	// An <img> whose source is an SVG with a viewBox but no intrinsic size:
	// only the ratio is intrinsic, exactly like an inline <svg> (el_svg).
	return get_document()->container()->get_image_ratio_only(m_src.c_str(), nullptr);
}

bool litehtml::el_image::is_no_ratio_replaced() const
{
	// An <img> whose source is an SVG with neither absolute dimensions nor
	// a viewBox: no intrinsic size and no intrinsic ratio; each axis falls
	// back to its own default object size (300 / 150) instead of a
	// transferred size.
	return get_document()->container()->get_image_no_ratio(m_src.c_str(), nullptr);
}

namespace {

// One srcset candidate: its URL plus the width (w) or density (x)
// descriptor it carries; a candidate with neither is a plain 1x.
struct srcset_candidate {
	std::string url;
	float width = 0;   // w descriptor, 0 when absent
	float density = 0; // x descriptor, 0 when absent
};

// Splits a srcset attribute the way the HTML parser does: a URL runs to
// the next ASCII whitespace (so data: URLs keep their commas), then
// descriptor tokens run to the next comma.
std::vector<srcset_candidate> parse_srcset(const char* srcset)
{
	std::vector<srcset_candidate> out;
	const char* p = srcset;
	auto is_space = [](char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f'; };
	while (*p)
	{
		while (*p && (is_space(*p) || *p == ',')) p++;
		if (!*p) break;
		const char* url_begin = p;
		while (*p && !is_space(*p)) p++;
		srcset_candidate cand;
		cand.url.assign(url_begin, p);
		while (*p && is_space(*p)) p++;
		const char* desc_begin = p;
		while (*p && *p != ',') p++;
		std::string desc(desc_begin, p);
		if (*p == ',') p++;
		// descriptor tokens are space-separated ("400w", "2x", ...)
		size_t i = 0;
		while (i < desc.size())
		{
			while (i < desc.size() && is_space(desc[i])) i++;
			size_t j = i;
			while (j < desc.size() && !is_space(desc[j])) j++;
			if (j > i)
			{
				std::string tok = desc.substr(i, j - i);
				char last = tok.back();
				if (last == 'w' || last == 'x')
				{
					float v = (float)atof(tok.c_str());
					if (v > 0)
					{
						if (last == 'w') cand.width = v;
						else cand.density = v;
					}
				}
			}
			i = j;
		}
		if (!cand.url.empty()) out.push_back(std::move(cand));
	}
	return out;
}

// Evaluates one sizes length token (px / vw / % of the viewport, em/rem
// at the initial 16px, or a bare number as px). false when unparsable.
bool sizes_length(const std::string& tok, float viewport_width, float& out)
{
	if (tok.empty()) return false;
	char* end = nullptr;
	double v = strtod(tok.c_str(), &end);
	if (end == tok.c_str()) return false;
	std::string unit(end);
	if (unit.empty() || unit == "px") out = (float)v;
	else if (unit == "vw" || unit == "%") out = (float)(v * viewport_width / 100.0);
	else if (unit == "em" || unit == "rem") out = (float)(v * 16.0);
	else return false;
	return true;
}

// The source size from a sizes attribute: the first entry whose media
// condition matches wins; a bare length is the default. Only the common
// (max-width: Npx) / (min-width: Npx) conditions are understood; an
// entry with any other condition is skipped. Default is 100vw.
float sizes_slot(const char* sizes, float viewport_width)
{
	if (!sizes || !*sizes) return viewport_width;
	std::string s(sizes);
	size_t pos = 0;
	while (pos < s.size())
	{
		// split at top-level commas
		size_t depth = 0, end = pos;
		while (end < s.size())
		{
			if (s[end] == '(') depth++;
			else if (s[end] == ')') depth--;
			else if (s[end] == ',' && depth == 0) break;
			end++;
		}
		std::string entry = s.substr(pos, end - pos);
		pos = end + 1;
		// trim
		size_t b = entry.find_first_not_of(" \t\n\r");
		size_t e = entry.find_last_not_of(" \t\n\r");
		if (b == std::string::npos) continue;
		entry = entry.substr(b, e - b + 1);
		bool matches = true;
		std::string length = entry;
		if (!entry.empty() && entry[0] == '(')
		{
			size_t close = entry.rfind(')');
			if (close == std::string::npos) continue;
			std::string cond = entry.substr(1, close - 1);
			length = entry.substr(close + 1);
			size_t lb = length.find_first_not_of(" \t\n\r");
			if (lb == std::string::npos) continue;
			length = length.substr(lb);
			float cond_val = 0;
			size_t colon = cond.find(':');
			if (colon == std::string::npos || !sizes_length(cond.substr(colon + 1), viewport_width, cond_val))
				continue;
			std::string name = cond.substr(0, colon);
			size_t nb = name.find_first_not_of(" \t\n\r");
			size_t ne = name.find_last_not_of(" \t\n\r");
			name = (nb == std::string::npos) ? "" : name.substr(nb, ne - nb + 1);
			if (name == "max-width") matches = viewport_width <= cond_val;
			else if (name == "min-width") matches = viewport_width >= cond_val;
			else continue;
		}
		if (matches)
		{
			float v = 0;
			if (sizes_length(length, viewport_width, v)) return v;
		}
	}
	return viewport_width;
}

// Picks the srcset candidate a browser would load at device pixel
// ratio 1 (the engine lays out and rasterizes at scale 1; the output
// scale is applied afterwards): with x descriptors, the smallest
// density >= 1 (else the largest); with w descriptors, the smallest
// width covering the sizes slot (else the largest). "" when the
// srcset carries nothing selectable, so the caller keeps src.
std::string select_srcset(const char* srcset, const char* sizes, float viewport_width)
{
	auto cands = parse_srcset(srcset);
	if (cands.empty()) return "";
	bool has_w = false;
	for (const auto& c : cands) has_w = has_w || c.width > 0;
	if (has_w)
	{
		float slot = sizes_slot(sizes, viewport_width);
		const srcset_candidate* best = nullptr;
		const srcset_candidate* largest = nullptr;
		for (const auto& c : cands)
		{
			if (c.width <= 0) continue;
			if (!largest || c.width > largest->width) largest = &c;
			if (c.width >= slot && (!best || c.width < best->width)) best = &c;
		}
		const srcset_candidate* pick = best ? best : largest;
		return pick ? pick->url : "";
	}
	const srcset_candidate* best = nullptr;
	const srcset_candidate* largest = nullptr;
	float largest_d = 0;
	for (const auto& c : cands)
	{
		float d = c.density > 0 ? c.density : 1.0f;
		if (!largest || d > largest_d) { largest = &c; largest_d = d; }
		if (d >= 1.0f && (!best || d < (best->density > 0 ? best->density : 1.0f))) best = &c;
	}
	const srcset_candidate* pick = best ? best : largest;
	return pick ? pick->url : "";
}

} // namespace

void litehtml::el_image::parse_attributes()
{
	m_src = get_attr("src", "");
	// Without srcset support the engine always loaded src -- for the
	// common pattern where src is the 2x file (or a placeholder) and
	// srcset carries the 1x the layout actually needs, that fetched
	// the wrong resource (and missed entirely against offline stores
	// that only hold the candidate a browser would request).
	if (const char* srcset = get_attr("srcset"))
	{
		if (*srcset)
		{
			litehtml::position vp;
			get_document()->container()->get_viewport(vp);
			std::string sel = select_srcset(srcset, get_attr("sizes"), (float)vp.width);
			if (!sel.empty()) m_src = sel;
		}
	}
	html_tag::parse_attributes();
}

void litehtml::el_image::parse_presentational_hints()
{
	// https://html.spec.whatwg.org/multipage/rendering.html#attributes-for-embedded-content-and-images:the-img-element-5
	const char* str = get_attr("width");
	if (str)
	{
		map_to_dimension_property(_width_, str);
	}

	str = get_attr("height");
	if (str)
	{
		map_to_dimension_property(_height_, str);
	}
}

void litehtml::el_image::draw(uint_ptr hdc, pixel_t x, pixel_t y, const position *clip, const std::shared_ptr<render_item> &ri)
{
	html_tag::draw(hdc, x, y, clip, ri);
	position pos = ri->pos();
	pos.x += x;
	pos.y += y;
	pos.round();

	// draw image as background
	if(pos.does_intersect(clip))
	{
		if (pos.width > 0 && pos.height > 0)
		{
			position border_box = pos;
			border_box += ri->get_paddings();
			border_box += ri->get_borders();

			border_radiuses bdr_radius = css().get_borders().radius.calc_percents(border_box.width, border_box.height);

			// 画像領域（content-box）に合わせたクリップを計算
			border_radiuses content_radius = bdr_radius;
			content_radius.top_left_x = std::max(0.0f, bdr_radius.top_left_x - (float)ri->get_paddings().left);
			content_radius.top_left_y = std::max(0.0f, bdr_radius.top_left_y - (float)ri->get_paddings().top);
			content_radius.top_right_x = std::max(0.0f, bdr_radius.top_right_x - (float)ri->get_paddings().right);
			content_radius.top_right_y = std::max(0.0f, bdr_radius.top_right_y - (float)ri->get_paddings().top);
			content_radius.bottom_right_x = std::max(0.0f, bdr_radius.bottom_right_x - (float)ri->get_paddings().right);
			content_radius.bottom_right_y = std::max(0.0f, bdr_radius.bottom_right_y - (float)ri->get_paddings().bottom);
			content_radius.bottom_left_x = std::max(0.0f, bdr_radius.bottom_left_x - (float)ri->get_paddings().left);
			content_radius.bottom_left_y = std::max(0.0f, bdr_radius.bottom_left_y - (float)ri->get_paddings().bottom);

			background_layer layer;
			layer.clip_box = border_box;
			layer.origin_box = pos;
			layer.border_box = border_box;
			layer.repeat = background_repeat_no_repeat;
			layer.border_radius = bdr_radius;

			litehtml::object_fit fit = css().get_object_fit();

			if (!content_radius.is_zero())
			{
				get_document()->container()->set_clip(pos, content_radius);
			}

			get_document()->container()->draw_image(hdc, layer, m_src, {}, fit, css().get_object_position(), css().get_image_rendering());

			if (!content_radius.is_zero())
			{
				get_document()->container()->del_clip();
			}
		}
	}
}

void litehtml::el_image::compute_styles(bool recursive)
{
	html_tag::compute_styles(recursive);

	if(!m_src.empty())
	{
		if(!css().get_height().is_predefined() && !css().get_width().is_predefined())
		{
			get_document()->container()->load_image(m_src.c_str(), nullptr, true);
		} else
		{
			get_document()->container()->load_image(m_src.c_str(), nullptr, false);
		}
	}
}

litehtml::string litehtml::el_image::dump_get_name()
{
	return "img src=\"" + m_src + "\"";
}

std::shared_ptr<litehtml::render_item> litehtml::el_image::create_render_item(const std::shared_ptr<render_item>& parent_ri)
{
	auto ret = std::make_shared<render_item_image>(shared_from_this());
	ret->parent(parent_ri);
	return ret;
}