#include "html.h"
#include "el_text.h"
#include "render_item.h"
#include "document_container.h"

namespace litehtml
{
	// What a text node looks like before it has a parent to take its style from.
	static css_properties* default_text_css()
	{
		static css_properties* d = []() { auto* c = new css_properties(); c->set_display(display_inline_text); return c; }();
		return d;
	}

	// The style of the text inside `parent`: the font and the rest are the parent's, the box is an inline run. It is the same for
	// every text node of that parent, so they share one (a style is about 2.3 KB, and a page has about as many text nodes as elements).
	void build_text_css(css_properties& out, const element::ptr& parent)
	{
		if (parent)
		{
			out.line_height_w() = parent->css().line_height();
			out.set_font(parent->css().get_font());
			out.set_font_metrics(parent->css().get_font_metrics());
			out.set_white_space(parent->css().get_white_space());
			out.set_unicode_bidi(parent->css().get_unicode_bidi());
			out.set_direction(parent->css().get_direction());
			out.set_text_transform(parent->css().get_text_transform());
		}
		out.set_display(display_inline_text);
		out.set_float(float_none);

		element::ptr p = parent;
		while (p && p->css().get_display() == display_inline)
		{
			if (p->css().get_position() == element_position_relative)
			{
				out.set_offsets(p->css().get_offsets());
				out.set_position(element_position_relative);
				break;
			}
			p = p->parent();
		}
		if (p)
		{
			out.set_position(element_position_static);
		}
	}
}

litehtml::el_text::el_text(const char* text, const document::ptr& doc) : element(doc, default_text_css())
{
	if(text)
	{
		m_text = text;
	}
	m_use_transformed	= false;
	m_draw_spaces		= true;
}

void litehtml::el_text::get_content_size( size& sz, pixel_t /*max_width*/ )
{
	sz = m_size;
}

void litehtml::el_text::get_text( string& text ) const
{
	text += m_text;
}

void litehtml::el_text::set_text( const char* text )
{
	if(text)
	{
		m_text = text;
	} else
	{
		m_text = "";
	}
	compute_styles(false);
}

void litehtml::el_text::compute_styles(bool /*recursive*/)
{
	element::ptr el_parent = parent();
	std::shared_ptr<css_properties> shared = el_parent ? el_parent->text_css() : nullptr;
	if (!shared)
	{
		shared = std::make_shared<css_properties>();
		build_text_css(*shared, el_parent);
	}
	m_text_css = shared;
	m_cssp = shared.get();

	if(m_cssp->get_text_transform() != text_transform_none)
	{
		m_transformed_text	= m_text;
		m_use_transformed = true;
		get_document()->container()->transform_text(m_transformed_text, m_cssp->get_text_transform());
	} else
	{
		m_use_transformed = false;
	}

	if(is_white_space())
	{
		m_transformed_text = " ";
		m_use_transformed = true;
	} else
	{
		if(m_text == "\t")
		{
			m_transformed_text = "    ";
			m_use_transformed = true;
		}
		if(m_text == "\n" || m_text == "\r")
		{
			m_transformed_text = "";
			m_use_transformed = true;
		}
	}

	// Soft hyphens are invisible unless the word ends a line (see set_hyphen_visible).
	m_ends_shy = false;
	m_hyphen_visible = false;
	if (m_text.find("\xC2\xAD") != string::npos)
	{
		string stripped;
		for (size_t i = 0; i < m_text.size(); i++)
		{
			if ((unsigned char)m_text[i] == 0xC2 && i + 1 < m_text.size() && (unsigned char)m_text[i + 1] == 0xAD)
			{
				i++;
				continue;
			}
			stripped += m_text[i];
		}
		m_ends_shy = m_text.size() >= 2 && (unsigned char)m_text[m_text.size() - 2] == 0xC2 &&
					 (unsigned char)m_text[m_text.size() - 1] == 0xAD;
		m_shy_stripped = stripped;
		m_transformed_text = stripped;
		m_use_transformed = true;
	}

	font_metrics fm;
	uint_ptr font = 0;
	if (el_parent)
	{
		font = el_parent->css().get_font();
		fm = el_parent->css().get_font_metrics();
	}
	if(is_break() || !font)
	{
		m_size.height	= 0;
		m_size.width	= 0;
	} else
	{
        if (el_parent->css().get_writing_mode() == writing_mode_horizontal_tb)
        {
		    m_size.width	= get_document()->container()->text_width(m_use_transformed ? m_transformed_text.c_str() : m_text.c_str(), font, el_parent->get_direction(), el_parent->css().get_writing_mode());
		    // The text box is the font ascent plus descent. The font's line gap is leading, not
		    // part of the box: Blink keeps the box as a `FontHeight` (ascent/descent) and hands the
		    // gap out around the baseline (`FontHeight::LineHeight()` is ascent + descent;
		    // `blink::CalculateLeadingSpace` in core/layout/inline/line_utils.cc splits
		    // line-height - LineHeight()). Read at chromium/src@faa920470c39 (line 35-44) and
		    // platform/fonts/font_height.h (line 30).
		    m_size.height	= fm.ascent + fm.descent;
        }
        else
        {
		    m_size.width	= fm.ascent + fm.descent;
		    m_size.height	= get_document()->container()->text_width(m_use_transformed ? m_transformed_text.c_str() : m_text.c_str(), font, el_parent->get_direction(), el_parent->css().get_writing_mode());
        }
	}
	m_draw_spaces = fm.draw_spaces;
}

void litehtml::el_text::apply_word_break()
{
}

void litehtml::el_text::set_word_break_start(const std::vector<std::shared_ptr<el_text>>& chars)
{
	m_word_break_part = true;
	m_word_break_start = true;
	m_word_break_chars = chars;
}

litehtml::pixel_t litehtml::el_text::word_break_width() const
{
	pixel_t width = 0;
	for (const auto& txt : m_word_break_chars)
	{
		if (txt) width += txt->m_size.width;
	}
	return width;
}

litehtml::pixel_t litehtml::el_text::set_hyphen_visible(bool visible)
{
	element::ptr el_parent = parent();
	if (!el_parent || visible == m_hyphen_visible) return 0;
	if (visible && (!m_ends_shy || el_parent->css().get_hyphens() == hyphens_none)) return 0;
	uint_ptr font = el_parent->css().get_font();
	if (!font) return 0;

	string hyphen = el_parent->css().get_hyphenate_character();
	if (hyphen.empty()) hyphen = "-";  // auto: U+002D (U+2010 is missing from many fonts)
	const string shown = visible ? m_shy_stripped + hyphen : m_shy_stripped;
	const pixel_t old_width = m_size.width;
	m_transformed_text = shown;
	m_use_transformed = true;
	if (el_parent->css().get_writing_mode() == writing_mode_horizontal_tb)
	{
		m_size.width = get_document()->container()->text_width(shown.c_str(), font, el_parent->get_direction(), el_parent->css().get_writing_mode());
	}
	else
	{
		m_size.height = get_document()->container()->text_width(shown.c_str(), font, el_parent->get_direction(), el_parent->css().get_writing_mode());
	}
	m_hyphen_visible = visible;
	return el_parent->css().get_writing_mode() == writing_mode_horizontal_tb ? m_size.width - old_width : 0;
}

void litehtml::el_text::draw(uint_ptr hdc, pixel_t x, pixel_t y, const position *clip, const std::shared_ptr<render_item> &ri)
{
	if(ri->skip()) return;

	if(is_white_space() && !m_draw_spaces)
	{
		return;
	}

	position pos = ri->pos();
	pos.x	+= x;
	pos.y	+= y;
	pos.round();

	if(pos.does_intersect(clip))
	{
		element::ptr el_parent = parent();
		if (el_parent)
		{
			document::ptr doc = get_document();

			uint_ptr font = el_parent->css().get_font();
			if(font)
			{
				web_color color = el_parent->css().get_color();
				if (el_parent->css().has_text_fill_color())
				{
					color = el_parent->css().get_text_fill_color();
				}
				// A run flagged by the line box (text-overflow or -webkit-line-clamp) always gets the ellipsis.
				text_overflow overflow = ri->force_ellipsis() ? text_overflow_ellipsis : text_overflow_clip;
				doc->container()->draw_text(hdc, m_use_transformed ? m_transformed_text.c_str() : m_text.c_str(), font,
											color, pos, overflow, el_parent->css().get_direction(), el_parent->css().get_writing_mode());
			}
		}
	}
}

litehtml::string litehtml::el_text::dump_get_name()
{
	return "text: \"" + get_escaped_string(m_text) + "\"";
}

std::vector<std::tuple<litehtml::string, litehtml::string>> litehtml::el_text::dump_get_attrs()
{
	return {};
}
