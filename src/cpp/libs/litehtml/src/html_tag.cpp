#include <algorithm>

#include "html.h"
#include "html_tag.h"
#include "el_text.h"
#include "document.h"
#include "html_microsyntaxes.h"
#include "iterators.h"
#include "stylesheet.h"
#include "table.h"
#include "num_cvt.h"
#include "line_box.h"
#include "render_item.h"
#include "internal.h"
#include "document_container.h"

namespace litehtml
{

static char32_t decode_utf8(const char **ptr) {
    const char *p = *ptr;
    unsigned char c = (unsigned char)*p++;
    if (c < 0x80) {
        *ptr = p;
        return c;
    }
    char32_t res;
    int len;
    if (c < 0xE0) {
        res = c & 0x1F;
        len = 1;
    } else if (c < 0xF0) {
        res = c & 0x0F;
        len = 2;
    } else {
        res = c & 0x07;
        len = 3;
    }
    while (len--) {
        res = (res << 6) | ((unsigned char)*p++ & 0x3F);
    }
    *ptr = p;
    return res;
}

// CSS Selectors-4 §3.4: the ::first-letter pseudo-element covers the first
// typographic letter unit plus any preceding punctuation (Unicode categories
// Ps, Pe, Pi, Pf, Po) and any following punctuation (Pe, Pf, Po). Chromium
// matches this: "「あ」" -> "「あ」", "あ。。" -> "あ。。", "。あ" -> "。あ",
// while "あ「" -> "あ" (Ps/Pi are not following punctuation).
// The Ps/Pi/Pf/Pe tables are complete for the blocks in use; the Po table is a
// practical subset (ASCII punctuation, General Punctuation, CJK punctuation).
static bool is_first_letter_ps(char32_t ch) {
    switch (ch) {
    // Parentheses / brackets (Ps)
    case 0x0028: case 0x005B: case 0x007B:
    case 0x0F3A: case 0x0F3C: case 0x169B:
    case 0x201A: case 0x201E:
    case 0x2045: case 0x207D: case 0x208D:
    case 0x2308: case 0x230A: case 0x2329:
    case 0x2768: case 0x276A: case 0x276C: case 0x276E:
    case 0x2770: case 0x2772: case 0x2774:
    case 0x27C5: case 0x27E6: case 0x27E8: case 0x27EA: case 0x27EC: case 0x27EE:
    case 0x2983: case 0x2985: case 0x2987: case 0x2989: case 0x298B:
    case 0x298D: case 0x298F: case 0x2991: case 0x2993: case 0x2995: case 0x2997:
    case 0x29D8: case 0x29DA: case 0x29FC:
    case 0x2E22: case 0x2E24: case 0x2E26: case 0x2E28: case 0x2E42:
    case 0x2E55: case 0x2E57: case 0x2E59: case 0x2E5B:
    case 0x3008: case 0x300A: case 0x300C: case 0x300E:
    case 0x3010: case 0x3014: case 0x3016: case 0x3018: case 0x301A: case 0x301D:
    case 0xFD3E: case 0xFE17:
    case 0xFE35: case 0xFE37: case 0xFE39: case 0xFE3B: case 0xFE3D:
    case 0xFE3F: case 0xFE41: case 0xFE43: case 0xFE47:
    case 0xFE59: case 0xFE5B: case 0xFE5D:
    case 0xFF08: case 0xFF3B: case 0xFF5B: case 0xFF5F: case 0xFF62:
        return true;
    default:
        return false;
    }
}

static bool is_first_letter_pe(char32_t ch) {
    switch (ch) {
    case 0x0029: case 0x005D: case 0x007D:
    case 0x0F3B: case 0x0F3D: case 0x169C:
    case 0x2046: case 0x207E: case 0x208E:
    case 0x2309: case 0x230B: case 0x232A:
    case 0x2769: case 0x276B: case 0x276D: case 0x276F:
    case 0x2771: case 0x2773: case 0x2775:
    case 0x27C6: case 0x27E7: case 0x27E9: case 0x27EB: case 0x27ED: case 0x27EF:
    case 0x2984: case 0x2986: case 0x2988: case 0x298A: case 0x298C:
    case 0x298E: case 0x2990: case 0x2992: case 0x2994: case 0x2996: case 0x2998:
    case 0x29D9: case 0x29DB: case 0x29FD:
    case 0x2E23: case 0x2E25: case 0x2E27: case 0x2E29:
    case 0x2E56: case 0x2E58: case 0x2E5A: case 0x2E5C:
    case 0x3009: case 0x300B: case 0x300D: case 0x300F:
    case 0x3011: case 0x3015: case 0x3017: case 0x3019: case 0x301B:
    case 0x301E: case 0x301F:
    case 0xFD3F: case 0xFE18:
    case 0xFE36: case 0xFE38: case 0xFE3A: case 0xFE3C: case 0xFE3E:
    case 0xFE40: case 0xFE42: case 0xFE44: case 0xFE48:
    case 0xFE5A: case 0xFE5C: case 0xFE5E:
    case 0xFF09: case 0xFF3D: case 0xFF5D: case 0xFF60: case 0xFF63:
        return true;
    default:
        return false;
    }
}

static bool is_first_letter_pi(char32_t ch) {
    switch (ch) {
    case 0x00AB: case 0x2018: case 0x201B: case 0x201C: case 0x201F:
    case 0x2039: case 0x2E02: case 0x2E04: case 0x2E09: case 0x2E0C:
    case 0x2E1C: case 0x2E20:
        return true;
    default:
        return false;
    }
}

static bool is_first_letter_pf(char32_t ch) {
    switch (ch) {
    case 0x00BB: case 0x2019: case 0x201D: case 0x203A:
    case 0x2E03: case 0x2E05: case 0x2E0A: case 0x2E0D:
    case 0x2E1D: case 0x2E21:
        return true;
    default:
        return false;
    }
}

static bool is_first_letter_po(char32_t ch) {
    if (ch >= 0x2020 && ch <= 0x2027) return true;  // † ‡ • ‣ ․ ‥ … ‧
    if (ch >= 0x2030 && ch <= 0x2038) return true;  // per mille, primes, ‸
    if (ch >= 0x2047 && ch <= 0x2051) return true;  // ⁇ ⁈ ... ⁑
    if (ch >= 0xFE10 && ch <= 0xFE19) return true;  // vertical forms
    if (ch >= 0xFE50 && ch <= 0xFE57) return true;  // small forms (， 、)
    if (ch >= 0xFE5F && ch <= 0xFE61) return true;  // ﹟ ﹠ ﹡
    switch (ch) {
    // ASCII punctuation (Po); the ASCII quotation marks are Po too
    case 0x0021: case 0x0022: case 0x0023: case 0x0025: case 0x0026: case 0x0027:
    case 0x002A: case 0x002C: case 0x002E: case 0x002F:
    case 0x003A: case 0x003B: case 0x003F: case 0x0040: case 0x005C:
    // Latin-1
    case 0x00A1: case 0x00A7: case 0x00B6: case 0x00B7: case 0x00BF:
    case 0x037E: case 0x0387:
    // General Punctuation
    case 0x2016: case 0x2017:
    case 0x203B: case 0x203C: case 0x203D: case 0x203E:
    case 0x2041: case 0x2042: case 0x2043:
    case 0x2053: case 0x2054: case 0x2057: case 0x205C: case 0x205E:
    // CJK Symbols and Punctuation (、。〃〽・)
    case 0x3001: case 0x3002: case 0x3003: case 0x301D: case 0x303D: case 0x30FB:
    // Halfwidth / fullwidth CJK forms
    case 0xFF01: case 0xFF02: case 0xFF03: case 0xFF05: case 0xFF06: case 0xFF07:
    case 0xFF0A: case 0xFF0C: case 0xFF0E: case 0xFF0F:
    case 0xFF1A: case 0xFF1B: case 0xFF1F: case 0xFF20:
    case 0xFF3C: case 0xFF61: case 0xFF64: case 0xFF65:
        return true;
    default:
        return false;
    }
}

static bool is_first_letter_preceding_punct(char32_t ch) {
    return is_first_letter_ps(ch) || is_first_letter_pe(ch) || is_first_letter_pi(ch) ||
           is_first_letter_pf(ch) || is_first_letter_po(ch);
}

static bool is_first_letter_following_punct(char32_t ch) {
    return is_first_letter_pe(ch) || is_first_letter_pf(ch) || is_first_letter_po(ch);
}

litehtml::html_tag::html_tag(const std::shared_ptr<document>& doc) : element(doc)
{
        m_tag = empty_id;
        m_id = empty_id;
}

litehtml::html_tag::html_tag(const element::ptr& parent, const string& style) : element(parent->get_document()),
        m_tag(empty_id),
        m_id(empty_id)
{
        litehtml::style st;
        st.add(style);
        add_style(st);
        this->parent(parent);
        compute_styles();
}

bool litehtml::html_tag::appendChild(const element::ptr &el)
{
        if(el)
        {
                el->parent(shared_from_this());
                m_children.push_back(el);
                return true;
        }
        return false;
}

bool litehtml::html_tag::removeChild(const element::ptr &el)
{
        if(el && el->parent() == shared_from_this())
        {
                el->parent(nullptr);
                m_children.erase(std::remove(m_children.begin(), m_children.end(), el), m_children.end());
                return true;
        }
        return false;
}

void litehtml::html_tag::clearRecursive()
{
        for(auto& el : m_children)
        {
                el->clearRecursive();
                el->parent(nullptr);
        }
        m_children.clear();
}

string_id html_tag::id() const
{
        return m_id;
}

string_id html_tag::tag() const
{
        return m_tag;
}

const char* html_tag::get_tagName() const
{
        return _s(m_tag).c_str();
}

void html_tag::set_tagName( const char* tag )
{
        m_tag = _id(lowcase(tag));
}

void html_tag::set_attr( const char* _name, const char* _val )
{
        if (_name && _val)
        {
                // attribute names in attribute selector are matched ASCII case-insensitively regardless of document mode
                string name = lowcase(_name);
                // m_attrs has all attribute values, including class and id, in their original case  
                // because in attribute selector values are matched case-sensitively even in quirks mode
                m_attrs[name] = _val;

                if (name == "class")
                {
                        string val = _val;
                        // class names in class selector (.xxx) are matched ASCII case-insensitively in quirks mode
                        if (get_document()->mode() == quirks_mode) lcase(val);
                        m_str_classes = split_string(val, whitespace, "", "");
                        m_classes.clear();
                        for (auto cls : m_str_classes) m_classes.push_back(_id(cls));
                }
                else if (name == "id")
                {
                        string val = _val;
                        // ids in id selector (#xxx) are matched ASCII case-insensitively in quirks mode
                        if (get_document()->mode() == quirks_mode) lcase(val);
                        m_id = _id(val);
                }
        }
}

void html_tag::remove_attr( const char* _name )
{
        if (!_name) return;
        string name = lowcase(_name);
        m_attrs.erase(name);
        if (name == "class")
        {
                m_str_classes.clear();
                m_classes.clear();
        }
        else if (name == "id")
        {
                m_id = empty_id;
        }
}

const char* html_tag::get_attr( const char* name, const char* def ) const
{
        auto attr = m_attrs.find(name);
        if(attr != m_attrs.end())
        {
                return attr->second.c_str();
        }
        return def;
}

litehtml::elements_list litehtml::html_tag::select_all(const string& selector )
{
        css_selector sel;
        sel.parse(selector, get_document()->mode());

        return select_all(sel);
}

litehtml::elements_list litehtml::html_tag::select_all(const css_selector& selector )
{
        litehtml::elements_list res;
        select_all(selector, res);
        return res;
}

void litehtml::html_tag::select_all(const css_selector& selector, elements_list& res)
{
        if(select(selector))
        {
                res.push_back(shared_from_this());
        }

        for(auto& el : m_children)
        {
                el->select_all(selector, res);
        }
}


litehtml::element::ptr litehtml::html_tag::select_one( const string& selector )
{
        css_selector sel;
        sel.parse(selector, get_document()->mode());

        return select_one(sel);
}

litehtml::element::ptr litehtml::html_tag::select_one( const css_selector& selector )
{
        if(select(selector))
        {
                return shared_from_this();
        }

        for(auto& el : m_children)
        {
                element::ptr res = el->select_one(selector);
                if(res)
                {
                        return res;
                }
        }
        return nullptr;
}

void litehtml::html_tag::apply_stylesheet( const litehtml::css& stylesheet )
{
	// Rules of equal layer and specificity must apply in source order whichever bucket (id, class,
	// tag, universal) they come from, so collect the candidates first and sort them.
	std::vector<const css_selector::ptr*> candidates;
	auto apply_selectors = [&](const css_selector::vector* selectors)
	{
		if (!selectors) return;
		for(const auto& sel : *selectors) candidates.push_back(&sel);
	};
	auto apply_candidates = [&]()
	{
		std::stable_sort(candidates.begin(), candidates.end(),
			[](const css_selector::ptr* a, const css_selector::ptr* b) { return **a < **b; });
		for(const css_selector::ptr* sel_ptr : candidates)
		{
			const auto& sel = *sel_ptr;
			int apply = select(*sel, false);

			if(apply != select_no_match)
			{
				used_selector::ptr us = std::make_unique<used_selector>(sel, false);

				if(sel->is_media_valid() && sel->is_container_valid(this))
				{
					auto apply_before_after = [&]()
						{
							const auto& content_property = sel->m_style->get_property(_content_);
							bool content_none = content_property.is<string>() && content_property.get<string>() == "none";
							bool create = !content_none && (sel->m_right.m_attrs.size() > 1 || sel->m_right.m_tag != star_id);

							element::ptr el;
							if(apply & select_match_with_after)
							{
								el = get_element_after(*sel->m_style, create);
							} else if(apply & select_match_with_before)
							{
								el = get_element_before(*sel->m_style, create);
							} else
							{
								return;
							}
							if(el)
							{
								if(!content_none)
								{
									el->add_style(*sel->m_style, sel->m_specificity);        
								} else
								{
									el->parent()->removeChild(el);       
								}
							} else
							{
								if(!content_none)
								{
									add_style(*sel->m_style, sel->m_specificity);
								}
							}
							us->m_used = true;
						};
						// `input::placeholder`: the style goes to the span that wraps the placeholder text
						auto apply_placeholder = [&]()
							{
								for(const auto& child : m_children)
								{
									if(child->get_attr("data-satoru-placeholder"))
									{
										child->add_style(*sel->m_style, sel->m_specificity);
										us->m_used = true;
									}
								}
							};


					if(apply & select_match_pseudo_class)
					{
						if(select(*sel, true))
						{
							bool handled = false;
							if((apply & (select_match_with_after | select_match_with_before)))
							{
								apply_before_after();
								handled = true;
							}
							if((apply & select_match_with_first_letter))
							{
								m_first_letter_style.combine(*sel->m_style, sel->m_specificity);
								m_has_first_letter_style = true;
								us->m_used = true;
								handled = true;
							}
							if((apply & select_match_with_placeholder))
							{
								apply_placeholder();
								handled = true;
							}
							if(!handled)
							{
								add_style(*sel->m_style, sel->m_specificity);
								us->m_used = true;
							}
						}
					} else if((apply & (select_match_with_after | select_match_with_before | select_match_with_first_letter | select_match_with_placeholder)))
					{
						if((apply & select_match_with_placeholder))
						{
							apply_placeholder();
						}
						if((apply & (select_match_with_after | select_match_with_before)))
						{
							apply_before_after();
						}
						if((apply & select_match_with_first_letter))
						{
							m_first_letter_style.combine(*sel->m_style, sel->m_specificity);
							m_has_first_letter_style = true;
							us->m_used = true;
						}
					} else
					{
						add_style(*sel->m_style, sel->m_specificity);
						us->m_used = true;
					}
				}
				m_used_styles.push_back(std::move(us));
			}
		}
	};

	if (m_id != empty_id)
	{
		apply_selectors(stylesheet.id_selectors(m_id));
	}

	for(const auto& cls : m_classes)
	{
		apply_selectors(stylesheet.class_selectors(cls));
	}

	if (m_tag != empty_id)
	{
		apply_selectors(stylesheet.tag_selectors(m_tag));
	}

	apply_selectors(&stylesheet.universal_selectors());
	apply_candidates();

	for(auto& el : m_children)
	{
		if(el->css().get_display() != display_inline_text)
		{
			el->apply_stylesheet(stylesheet);
		}
	}

	if(m_has_first_letter_style)
	{
		apply_first_letter();
	}
}

void litehtml::html_tag::get_content_size( size& sz, pixel_t max_width )
{
        sz.height       = 0;
        if((*m_cssp).get_display() == display_block)
        {
                sz.width        = max_width;
        } else
        {
                sz.width        = 0;
        }
}

void litehtml::html_tag::draw(uint_ptr hdc, pixel_t x, pixel_t y, const position *clip, const std::shared_ptr<render_item> &ri)
{
        position pos = ri->pos();
        pos.x   += x;
        pos.y   += y;

        document_container* container = get_document()->container();

        draw_background(hdc, x, y, clip, ri);
        draw_borders(hdc, x, y, clip, ri);

        if((*m_cssp).get_display() == display_list_item &&
                ((*m_cssp).get_list_style_type() != list_style_type_none || (*m_cssp).get_list_style_image() != ""))
        {
                if((*m_cssp).get_overflow() > overflow_visible)
                {
                        position border_box = pos;
                        border_box += ri->get_paddings();
                        border_box += ri->get_borders();

                        border_radiuses bdr_radius = (*m_cssp).get_borders().radius.calc_percents(border_box.width, border_box.height);

                        bdr_radius -= ri->get_borders();
                        bdr_radius -= ri->get_paddings();

                        get_document()->container()->set_clip(pos, bdr_radius);
                }

                draw_list_marker(hdc, pos, ri);

                if((*m_cssp).get_overflow() > overflow_visible)
                {
                        get_document()->container()->del_clip();
                }
        }
}

bool html_tag::get_custom_property(string_id name, css_token_vector& result) const
{
        const property_value& value = m_style.get_property(name);

        if (value.is<css_token_vector>())
        {
                result = value.get<css_token_vector>();
                if (result.size() == 1 && result[0].type == IDENT)
                {
                        string id = lowcase(result[0].ident());
                        if (id == "initial")
                        {
                                const custom_property_definition* def = get_document()->get_custom_property_def(name);
                                if (def && !def->initial_value.empty())
                                {
                                        result = def->initial_value;
                                        return true;
                                }
                                return false;
                        }
                        if (id == "unset")
                        {
                                const custom_property_definition* def = get_document()->get_custom_property_def(name);
                                if (def && !def->inherits)
                                {
                                        if (!def->initial_value.empty())
                                        {
                                                result = def->initial_value;
                                                return true;
                                        }
                                        return false;
                                }
                        }
                        else
                        {
                                return true;
                        }
                }
                else
                {
                        return true;
                }
        }

        const custom_property_definition* def = get_document()->get_custom_property_def(name);
        if (def && !def->inherits)
        {
                if (!def->initial_value.empty())
                {
                        result = def->initial_value;
                        return true;
                }
                return false;
        }

        if (auto _parent = parent_tag())
        {
                if (_parent->get_custom_property(name, result))
                        return true;
        }

        if (def && !def->initial_value.empty())
        {
                result = def->initial_value;
                return true;
        }

        return false;
}

int g_cs_depth = 0;
std::shared_ptr<litehtml::css_properties> litehtml::html_tag::text_css()
{
    if (!m_text_css)
    {
        m_text_css = std::make_shared<css_properties>();
        build_text_css(*m_text_css, shared_from_this());
    }
    return m_text_css;
}

void litehtml::html_tag::compute_styles(bool recursive)
{
    g_cs_depth++;
    m_text_css.reset();
      fflush(stdout);

    const char* style = get_attr("style");
    document::ptr doc = get_document();

    if (style)
    {
              fflush(stdout);
        m_style.add(style, "", doc->container(), css::unlayered_id, selector_specificity(1, 0, 0, 0));
    }

      fflush(stdout);
    m_style.subst_vars(this);

      fflush(stdout);
    (*m_cssp).compute(this, doc);

    if (recursive)
    {
              fflush(stdout);
        for (const auto& el : m_children)
        {
            el->compute_styles();
        }
    }
      fflush(stdout);
    g_cs_depth--;
}

namespace
{
// Small kana and the prolonged sound mark: `line-break: strict` does not allow a line to start with them.
bool lb_strict_no_start(unsigned int cp)
{
	switch (cp)
	{
	case 0x3041: case 0x3043: case 0x3045: case 0x3047: case 0x3049: case 0x3063: case 0x3083:
	case 0x3085: case 0x3087: case 0x308E: case 0x3095: case 0x3096:
	case 0x30A1: case 0x30A3: case 0x30A5: case 0x30A7: case 0x30A9: case 0x30C3: case 0x30E3:
	case 0x30E5: case 0x30E7: case 0x30EE: case 0x30F5: case 0x30F6: case 0x30FC:
		return true;
	default:
		return cp >= 0x31F0 && cp <= 0x31FF;
	}
}

// Characters `line-break: loose` additionally lets a line start with (iteration marks, hyphens, ...).
bool lb_loose_may_start(unsigned int cp)
{
	switch (cp)
	{
	case 0x3005: case 0x303B: case 0x309D: case 0x309E: case 0x30FD: case 0x30FE:
	case 0x2010: case 0x2013: case 0x301C: case 0x30A0: case 0x30FB:
		return true;
	default:
		return false;
	}
}

unsigned int first_codepoint(const litehtml::string& text)
{
	const char* p = text.c_str();
	return *p ? litehtml::decode_utf8(&p) : 0;
}

// Heuristic English hyphenation points: indexes (in bytes) before which a word may break.
std::vector<size_t> english_hyphenation_points(const litehtml::string& w)
{
	std::vector<size_t> points;
	const size_t n = w.size();
	if (n < 6) return points;
	for (unsigned char c : w) if (!std::isalpha(c)) return points;
	auto vowel = [&](size_t i) { char c = (char)std::tolower((unsigned char)w[i]); return c == 'a' || c == 'e' || c == 'i' || c == 'o' || c == 'u' || c == 'y'; };
	auto digraph = [&](size_t i) {  // do not split th, ch, sh, ph, gh, wh, ck at (i-1, i)
		char a = (char)std::tolower((unsigned char)w[i - 1]), b = (char)std::tolower((unsigned char)w[i]);
		return (b == 'h' && (a == 't' || a == 'c' || a == 's' || a == 'p' || a == 'g' || a == 'w')) || (a == 'c' && b == 'k');
	};
	for (size_t i = 2; i + 2 < n; i++)
	{
		bool brk = false;
		if (vowel(i - 1) && !vowel(i) && vowel(i + 1)) brk = true;                          // V|CV
		else if (!vowel(i - 1) && !vowel(i) && vowel(i - 2) && vowel(i + 1) && !digraph(i)) brk = true;  // VC|CV
		if (brk && (points.empty() || i - points.back() >= 2)) points.push_back(i);
	}
	return points;
}
}  // namespace

void litehtml::html_tag::apply_word_break()
{
	// line-break (CJK strictness) and hyphens: auto rewrite the word tokens of this element.
	{
		const line_break lb = (*m_cssp).get_line_break();
		const bool auto_hyphens = (*m_cssp).get_hyphens() == hyphens_auto;
		bool english = false;
		if (auto_hyphens)
		{
			for (element::ptr e = shared_from_this(); e; e = e->parent())
			{
				const char* lang = e->get_attr("lang");
				if (lang) { english = lowcase(string(lang)).compare(0, 2, "en") == 0; break; }
			}
		}
		if (lb == line_break_loose || lb == line_break_strict || (auto_hyphens && english))
		{
			for (auto it = m_children.begin(); it != m_children.end(); )
			{
				auto text_el = std::dynamic_pointer_cast<el_text>(*it);
				if (!text_el || text_el->is_white_space() || text_el->is_break() || text_el->is_space())
				{
					++it;
					continue;
				}
				string text;
				text_el->get_text(text);
				if (lb == line_break_strict && !text.empty() && lb_strict_no_start(first_codepoint(text)) &&
					it != m_children.begin())
				{
					// merge into the previous word: no break before a small kana / long vowel mark
					auto prev = std::prev(it);
					auto prev_text = std::dynamic_pointer_cast<el_text>(*prev);
					if (prev_text && !prev_text->is_space() && !prev_text->is_break())
					{
						string merged;
						prev_text->get_text(merged);
						merged += text;
						prev_text->set_text(merged.c_str());
						it = m_children.erase(it);
						continue;
					}
				}
				std::vector<string> pieces;
				if (lb == line_break_loose)
				{
					const char* p = text.c_str();
					string cur;
					while (*p)
					{
						const char* next = p;
						unsigned int cp = decode_utf8(&next);
						if (!cur.empty() && lb_loose_may_start(cp))
						{
							pieces.push_back(cur);
							cur.clear();
						}
						cur.append(p, next - p);
						p = next;
					}
					if (!cur.empty()) pieces.push_back(cur);
				}
				else if (auto_hyphens && english)
				{
					std::vector<size_t> points = english_hyphenation_points(text);
					size_t start = 0;
					for (size_t pt : points)
					{
						pieces.push_back(text.substr(start, pt - start) + "\xC2\xAD");
						start = pt;
					}
					pieces.push_back(text.substr(start));
				}
				if (pieces.size() > 1)
				{
					it = m_children.erase(it);
					for (const auto& piece : pieces)
					{
						auto new_el = std::make_shared<el_text>(piece.c_str(), get_document());
						new_el->parent(shared_from_this());
						new_el->compute_styles(false);
						m_children.insert(it, new_el);
					}
				}
				else
				{
					++it;
				}
			}
		}
	}

	word_break wb = (*m_cssp).get_word_break();
	overflow_wrap ow = (*m_cssp).get_overflow_wrap();
	// `overflow-wrap: anywhere` and `word-break: break-all` (and line-break: anywhere)
	// allow a break between any two characters. `break-word` only does so when a word
	// does not fit a line by itself, so those runs keep their word grouping and the
	// line box moves the whole word to the next line while it still fits one.
	const bool break_anywhere = wb == word_break_break_all || ow == overflow_wrap_anywhere ||
	                            (*m_cssp).get_line_break() == line_break_anywhere;
	const bool keep_whole_word = !break_anywhere &&
	                             (wb == word_break_break_word || ow == overflow_wrap_break_word);
	if(wb == word_break_break_all || wb == word_break_break_word || ow == overflow_wrap_break_word || ow == overflow_wrap_anywhere ||
	   (*m_cssp).get_line_break() == line_break_anywhere)
	{
		for (auto it = m_children.begin(); it != m_children.end(); )
		{
			if((*it)->is_text() && !(*it)->is_white_space() && !(*it)->is_break())
			{
				string text;
				(*it)->get_text(text);
				const char* p = text.c_str();
				const char* start_p = p;
				
				// Count characters to see if we need to split
				int count = 0;
				const char* p_test = p;
				while(*p_test) { decode_utf8(&p_test); count++; }
				
				if(count > 1)
				{
					auto original_el = *it;
					it = m_children.erase(it);
					
					p = text.c_str();
					std::vector<std::shared_ptr<el_text>> chars;
					while(*p)
					{
						const char* next_p = p;
						decode_utf8(&next_p);
						
						string char_str(p, next_p - p);
						auto new_el = std::make_shared<el_text>(char_str.c_str(), get_document());
						new_el->parent(shared_from_this());
						new_el->compute_styles(false);

						chars.push_back(new_el);
						p = next_p;
					}
					if(keep_whole_word)
					{
						for(const auto& ch : chars)
						{
							ch->set_word_break_member();
						}
						chars.front()->set_word_break_start(chars);
					}
					for(const auto& ch : chars)
					{
						m_children.insert(it, ch);
					}
					// it now points to the element after the inserted ones
				}
				else
				{
					++it;
				}
			}
			else
			{
				(*it)->apply_word_break();
				++it;
			}
		}
	}
	else
	{
		for (auto& el : m_children)
		{
			el->apply_word_break();
		}
	}
}

bool litehtml::html_tag::is_white_space() const
{
        return false;
}

int     html_tag::select(const css_selector::vector& selector_list, bool apply_pseudo)
{
        for (auto sel : selector_list)
        {
                if (int result = select(*sel, apply_pseudo))
                        return result;
        }
        return select_no_match;
}

int litehtml::html_tag::select(const string& selector)
{
        css_selector sel;
        sel.parse(selector, get_document()->mode());
        return select(sel, true);
}

int litehtml::html_tag::select(const css_selector& selector, bool apply_pseudo)
{
        // ::part(name): the compound's type selector and the selectors written
        // before ::part describe the shadow HOST; the part name (and any
        // selectors after it) describe this element. Flattening keeps the part
        // element under its host (data-satoru-scope / data-satoru-slotted name
        // the scope whose host carries data-satoru-host), so rebuild the
        // selector without ::part and match it against the host -- the
        // combinators to the left then resolve in the host's own context.
        int part_idx = -1;
        for (int i = 0; i < (int)selector.m_right.m_attrs.size(); i++)
        {
                if (selector.m_right.m_attrs[i].type == select_pseudo_element &&
                    selector.m_right.m_attrs[i].name == _id("part"))
                {
                        part_idx = i;
                        break;
                }
        }
        if (part_idx >= 0)
        {
                const string& part_name = selector.m_right.m_attrs[part_idx].value;
                const char* part_attr = get_attr("part");
                if (!part_attr || part_name.empty() ||
                    !contains(split_string(string(part_attr)), part_name))
                {
                        return select_no_match;
                }
                int self_flags = 0;
                if (part_idx + 1 < (int)selector.m_right.m_attrs.size())
                {
                        css_element_selector self_sel;
                        self_sel.m_tag = star_id;
                        self_sel.m_attrs.assign(selector.m_right.m_attrs.begin() + part_idx + 1,
                                                selector.m_right.m_attrs.end());
                        int self_res = select(self_sel, apply_pseudo);
                        if (self_res == select_no_match)
                        {
                                return select_no_match;
                        }
                        self_flags = self_res & ~select_match;
                }
                css_selector host_selector;
                host_selector.m_right.m_prefix = selector.m_right.m_prefix;
                host_selector.m_right.m_tag = selector.m_right.m_tag;
                host_selector.m_right.m_attrs.assign(selector.m_right.m_attrs.begin(),
                                                     selector.m_right.m_attrs.begin() + part_idx);
                host_selector.m_left = selector.m_left;
                host_selector.m_combinator = selector.m_combinator;
                for (const char* scope_name : {"data-satoru-scope", "data-satoru-slotted"})
                {
                        const char* scope = get_attr(scope_name);
                        if (!scope) continue;
                        for (element::ptr anc = parent(); anc; anc = anc->parent())
                        {
                                const char* host_id = anc->get_attr("data-satoru-host");
                                if (host_id && string(host_id) == scope)
                                {
                                        int host_res = anc->select(host_selector, apply_pseudo);
                                        if (host_res != select_no_match)
                                        {
                                                return select_match |
                                                       (host_res & select_match_pseudo_class) | self_flags;
                                        }
                                }
                        }
                }
                return select_no_match;
        }

        int right_res = select(selector.m_right, apply_pseudo);
        if(right_res == select_no_match)
        {
                return select_no_match;
        }
        element::ptr el_parent = parent();
        if(selector.m_left)
        {
                if (!el_parent)
                {
                        return select_no_match;
                }
                switch(selector.m_combinator)
                {
                case combinator_descendant:
                        {
                                bool is_pseudo = false;
                                element::ptr res = find_ancestor(*selector.m_left, apply_pseudo, &is_pseudo);
                                if(!res)
                                {
                                        return select_no_match;
                                } else
                                {
                                        if(is_pseudo)
                                        {
                                                right_res |= select_match_pseudo_class;
                                        }
                                }
                        }
                        break;
                case combinator_child:
                        {
                                int res = el_parent->select(*selector.m_left, apply_pseudo);
                                if(res == select_no_match)
                                {
                                        return select_no_match;
                                } else
                                {
                                        if(right_res != select_match_pseudo_class)
                                        {
                                                right_res |= res;
                                        }
                                }
                        }
                        break;
                case combinator_adjacent_sibling:
                        {
                                bool is_pseudo = false;
                                element::ptr res = el_parent->find_adjacent_sibling(shared_from_this(), *selector.m_left, apply_pseudo, &is_pseudo);
                                if(!res)
                                {
                                        return select_no_match;
                                } else
                                {
                                        if(is_pseudo)
                                        {
                                                right_res |= select_match_pseudo_class;
                                        }
                                }
                        }
                        break;
                case combinator_general_sibling:
                        {
                                bool is_pseudo = false;
                                element::ptr res =  el_parent->find_sibling(shared_from_this(), *selector.m_left, apply_pseudo, &is_pseudo);
                                if(!res)
                                {
                                        return select_no_match;
                                } else
                                {
                                        if(is_pseudo)
                                        {
                                                right_res |= select_match_pseudo_class;
                                        }
                                }
                        }
                        break;
                default:
                        right_res = select_no_match;
                }
        }
        return right_res;
}

int litehtml::html_tag::select(const css_element_selector& selector, bool apply_pseudo)
{
        if(selector.m_tag != star_id && selector.m_tag != m_tag)
        {
                return select_no_match;
        }

        int res = select_match;

        for(const auto& attr : selector.m_attrs)
        {
                switch(attr.type)
                {
                case select_class:
                        if (!(attr.name in m_classes))
                        {
                                return select_no_match;
                        }
                        break;
                case select_id:
                        if (attr.name != m_id)
                        {
                                return select_no_match;
                        }
                        break;
                case select_pseudo_element:
                        if(attr.name == _after_)
                        {
                                if(selector.m_attrs.size() == 1 && selector.m_tag == star_id && m_tag != __tag_after_)
                                {
                                        return select_no_match;
                                }
                                res |= select_match_with_after;
                        } else if(attr.name == _before_)
                        {
                                if(selector.m_attrs.size() == 1 && selector.m_tag == star_id && m_tag != __tag_before_)
                                {
                                        return select_no_match;
                                }
                                res |= select_match_with_before;
                        } else if(attr.name == _first_letter_)
                        {
                                res |= select_match_with_first_letter;
                        } else if(m_tag == _id("input") &&
                                  (attr.name == _id("placeholder") || attr.name == _id("-webkit-input-placeholder") ||
                                   attr.name == _id("-moz-placeholder")))
                        {
                                res |= select_match_with_placeholder;
                        } else
                        {
                                return select_no_match;
                        }
                        break;
                case select_pseudo_class:
                        if(apply_pseudo)
                        {
                                if (select_pseudoclass(attr) == select_no_match)
                                {
                                        return select_no_match;
                                }
                        } else
                        {
                                res |= select_match_pseudo_class;
                        }
                        break;
                default:
                        if (select_attribute(attr) == select_no_match)
                        {
                                return select_no_match;
                        }
                }
        }
        return res;
}

int html_tag::select_pseudoclass(const css_attribute_selector& sel)
{
        element::ptr el_parent = parent();

        switch (sel.name)
        {
        case _only_child_:
                if (!el_parent || !el_parent->is_only_child(shared_from_this(), false))
                {
                        return select_no_match;
                }
                break;
        case _only_of_type_:
                if (!el_parent || !el_parent->is_only_child(shared_from_this(), true))
                {
                        return select_no_match;
                }
                break;
        case _first_child_:
                if (!el_parent || !el_parent->is_nth_child(shared_from_this(), 0, 1, false))
                {
                        return select_no_match;
                }
                break;
        case _first_of_type_:
                if (!el_parent || !el_parent->is_nth_child(shared_from_this(), 0, 1, true))
                {
                        return select_no_match;
                }
                break;
        case _last_child_:
                if (!el_parent || !el_parent->is_nth_last_child(shared_from_this(), 0, 1, false))    
                {
                        return select_no_match;
                }
                break;
        case _last_of_type_:
                if (!el_parent || !el_parent->is_nth_last_child(shared_from_this(), 0, 1, true))     
                {
                        return select_no_match;
                }
                break;
        case _nth_child_:
        case _nth_of_type_:
        case _nth_last_child_:
        case _nth_last_of_type_:
        {
                if (!el_parent) return select_no_match;

                int num = sel.a;
                int off = sel.b;
                if (!num && !off) return select_no_match;

                switch (sel.name)
                {
                case _nth_child_:
                        if (!el_parent->is_nth_child(shared_from_this(), num, off, false, sel.selector_list))
                        {
                                return select_no_match;
                        }
                        break;
                case _nth_of_type_:
                        if (!el_parent->is_nth_child(shared_from_this(), num, off, true))
                        {
                                return select_no_match;
                        }
                        break;
                case _nth_last_child_:
                        if (!el_parent->is_nth_last_child(shared_from_this(), num, off, false, sel.selector_list))
                        {
                                return select_no_match;
                        }
                        break;
                case _nth_last_of_type_:
                        if (!el_parent->is_nth_last_child(shared_from_this(), num, off, true))       
                        {
                                return select_no_match;
                        }
                        break;
                default:
                        break;
                }

        }
        break;
        case _is_:
        case _where_:
                if (select(sel.selector_list, true) == select_no_match)
                {
                        return select_no_match;
                }
                break;
        case _has_:
                if (!select_has(sel))
                {
                        return select_no_match;
                }
                break;
        case _not_:
                if (select(sel.selector_list, true))
                {
                        return select_no_match;
                }
                break;
        case _lang_:
                if (!get_document()->match_lang(sel.value))
                {
                        return select_no_match;
                }
                break;
        default:
                if (!(sel.name in m_pseudo_classes))
                {
                        return select_no_match;
                }
                break;
        }
        return select_match;
}

bool html_tag::select_has(const css_attribute_selector& sel)
{
	set_pseudo_class(__litehtml_anchor_, true);
	bool res = false;
	for (const auto& s : sel.selector_list)
	{
		css_selector::ptr anchor_sel = s;
		while (anchor_sel->m_left && anchor_sel->m_left->m_left) anchor_sel = anchor_sel->m_left;
		int combinator = anchor_sel->m_combinator;

		if (is_any_child_match(s, combinator))
		{
			res = true;
			break;
		}
	}
	set_pseudo_class(__litehtml_anchor_, false);
	return res;
}

bool html_tag::is_any_child_match(const css_selector::ptr& sel, int combinator)
{
	if (combinator == '+' || combinator == '~')
	{
		auto p = parent();
		if (!p) return false;
		bool found = false;
		for (const auto& sib : p->children())
		{
			if (found)
			{
				if (sib->select(*sel)) return true;
				if (combinator == '+') break;
			}
			if (sib.get() == this) found = true;
		}
	}
	else if (combinator == '>')
	{
		for (const auto& child : m_children)
		{
			if (child->select(*sel)) return true;
		}
	}
	else // descendant
	{
		// recursive search
		std::function<bool(const element::ptr&)> search = [&](const element::ptr& el)
		{
			for (const auto& child : el->children())
			{
				if (child->select(*sel)) return true;
				if (search(child)) return true;
			}
			return false;
		};
		if (search(shared_from_this())) return true;
	}
	return false;
}

// https://www.w3.org/TR/selectors-4/#attribute-selectors
int html_tag::select_attribute(const css_attribute_selector& sel)
{
        const char* sz_attr_value = get_attr(_s(sel.name).c_str());

        if (!sz_attr_value) return select_no_match;

        string attr_value = sel.caseless_match ? lowcase(sz_attr_value) : sz_attr_value;

        switch (sel.matcher)
        {
        case attribute_exists:
                return select_match;

        case attribute_equals:
                if (attr_value == sel.value)
                {
                        return select_match;
                }
                break;

        case attribute_contains_string: // *=
                if (sel.value != "" && contains(attr_value, sel.value))
                {
                        return select_match;
                }
                break;

        // Attribute value is a whitespace-separated list of words, one of which is exactly sel.value
        case attribute_contains_word: // ~=
                if (sel.value != "" && contains(split_string(attr_value), sel.value))
                {
                        return select_match;
                }
                break;

        case attribute_starts_with_string: // ^=
                if (sel.value != "" && match(attr_value, 0, sel.value))
                {
                        return select_match;
                }
                break;

        // Attribute value is either equals sel.value or begins with sel.value immediately followed by "-".
        case attribute_starts_with_string_hyphen: // |=
                // Note: no special treatment for sel.value == ""
                if (attr_value == sel.value || match(attr_value, 0, sel.value + '-'))
                {
                        return select_match;
                }
                break;

        case attribute_ends_with_string: // $=
                if (sel.value != "" && match(attr_value, -(int)sel.value.size(), sel.value))
                {
                        return select_match;
                }
                break;
        }
        return select_no_match;
}

element::ptr html_tag::find_ancestor(const css_selector& selector, bool apply_pseudo, bool* is_pseudo)
{
        element::ptr el_parent = parent();
        if (!el_parent)
        {
                return nullptr;
        }
        int res = el_parent->select(selector, apply_pseudo);
        if(res != select_no_match)
        {
                if(is_pseudo)
                {
                        if(res & select_match_pseudo_class)
                        {
                                *is_pseudo = true;
                        } else
                        {
                                *is_pseudo = false;
                        }
                }
                return el_parent;
        }
        return el_parent->find_ancestor(selector, apply_pseudo, is_pseudo);
}

void litehtml::html_tag::parse_attributes()
{
	parse_presentational_hints();

	for(auto& el : m_children)
        {
                el->parse_attributes();
        }
}

void litehtml::html_tag::parse_presentational_hints()
{
	if (m_tag == _col_ || m_tag == _colgroup_)
	{
		const char* str = get_attr("width");
		if (str) map_to_dimension_property_ignoring_zero(_width_, str);
	}
	else if (m_tag == _input_ || m_tag == _textarea_)
	{
		// Control size from the size / cols / rows attributes (average glyph width approximated).
		auto px = [](float v) { return css_token{DIMENSION, v, css_number_number, "px"}; };
		auto positive = [this](const char* name, float def) {
			const char* a = get_attr(name);
			float v = a ? (float)atof(a) : 0;
			return v > 0 ? v : def;
		};
		if (m_tag == _input_)
		{
			string type = get_attr("type", "text");
			for (auto& c : type) c = (char)tolower((unsigned char)c);
			if (type == "text" || type == "search" || type == "email" || type == "url" || type == "tel" ||
				type == "number" || type == "password")
			{
				m_style.add_property(_width_, {px(positive("size", 20) * 7.6f + 17)});
			}
		}
		else
		{
			m_style.add_property(_width_, {px(positive("cols", 20) * 8.f + 19)});
			m_style.add_property(_height_, {px(positive("rows", 2) * 15.f + 6)});
		}
	}
}

void litehtml::html_tag::get_text( string& text ) const
{
        for (auto& el : m_children)
        {
                el->get_text(text);
        }
}

bool litehtml::html_tag::is_body()  const
{
        return false;
}

void litehtml::html_tag::set_data( const char* /*data*/ )
{

}

bool litehtml::html_tag::on_mouse_over()
{
        bool ret = false;

        element::ptr el = shared_from_this();
        while(el)
        {
                if(el->set_pseudo_class(_hover_, true))
                {
                        ret = true;
                }
                el = el->parent();
        }

        return ret;
}

bool litehtml::html_tag::on_mouse_leave()
{
        bool ret = false;

        element::ptr el = shared_from_this();
        while(el)
        {
                if(el->set_pseudo_class(_hover_, false))
                {
                        ret = true;
                }
                if(el->set_pseudo_class(_active_, false))
                {
                        ret = true;
                }
                el = el->parent();
        }

        return ret;
}

bool litehtml::html_tag::on_lbutton_down()
{
        bool ret = false;

        element::ptr el = shared_from_this();
        while (el)
        {
                if (el->set_pseudo_class(_active_, true))
                {
                        ret = true;
                }
                el = el->parent();
        }

        return ret;
}

bool litehtml::html_tag::on_lbutton_up(bool is_click)
{
        bool ret = false;

        element::ptr el = shared_from_this();
        while (el)
        {
                if (el->set_pseudo_class(_active_, false))
                {
                        ret = true;
                }
                el = el->parent();
        }

        if (is_click) on_click();

        return ret;
}

void litehtml::html_tag::on_click()
{
        if (!is_root())
        {
                if(!get_document()->container()->on_element_click(shared_from_this()))
                {
                        element::ptr el_parent = parent();
                        if (el_parent)
                        {
                                el_parent->on_click();
                        }
                }
        }
}

bool litehtml::html_tag::is_break() const
{
        return false;
}

// Borders and radii of one fragment of an inline box that was split over several lines. The
// first and last fragments carry the start/end edge and their corners; the other edges repeat
// on every fragment. In vertical writing the inline axis runs top to bottom, so the roles of
// the physical sides are transposed.
static litehtml::css_borders inline_fragment_borders(const litehtml::css_borders& src, bool vertical, bool first, bool last)
{
        litehtml::css_borders bdr;
        if(vertical)
        {
                if(first)
                {
                        bdr.radius.top_left_x           = src.radius.top_left_x;
                        bdr.radius.top_left_y           = src.radius.top_left_y;
                        bdr.radius.top_right_x          = src.radius.top_right_x;
                        bdr.radius.top_right_y          = src.radius.top_right_y;
                        bdr.top                         = src.top;
                }
                if(last)
                {
                        bdr.radius.bottom_left_x        = src.radius.bottom_left_x;
                        bdr.radius.bottom_left_y        = src.radius.bottom_left_y;
                        bdr.radius.bottom_right_x       = src.radius.bottom_right_x;
                        bdr.radius.bottom_right_y       = src.radius.bottom_right_y;
                        bdr.bottom                      = src.bottom;
                }
                bdr.left = src.left;
                bdr.right = src.right;
                return bdr;
        }
        if(first)
        {
                bdr.radius.bottom_left_x        = src.radius.bottom_left_x;
                bdr.radius.bottom_left_y        = src.radius.bottom_left_y;
                bdr.radius.top_left_x           = src.radius.top_left_x;
                bdr.radius.top_left_y           = src.radius.top_left_y;
                bdr.left                        = src.left;
        }
        if(last)
        {
                bdr.radius.bottom_right_x       = src.radius.bottom_right_x;
                bdr.radius.bottom_right_y       = src.radius.bottom_right_y;
                bdr.radius.top_right_x          = src.radius.top_right_x;
                bdr.radius.top_right_y          = src.radius.top_right_y;
                bdr.right                       = src.right;
        }
        bdr.top = src.top;
        bdr.bottom = src.bottom;
        return bdr;
}

// box-decoration-break: clone fragment (see document::set_fragment_band): fit the content box
// `pos` so that the decorated border box is only the visible band of the element.
static void apply_fragment_band(const litehtml::document::fragment_band* band, litehtml::position& pos,
                                const std::shared_ptr<litehtml::render_item>& ri)
{
        if (!band) return;
        litehtml::pixel_t vertical = ri->padding_top() + ri->padding_bottom() + ri->border_top() + ri->border_bottom();
        pos.y += band->top;
        pos.height = std::max<litehtml::pixel_t>(0, band->bottom - band->top - vertical);
}

void litehtml::html_tag::draw_background(uint_ptr hdc, pixel_t x, pixel_t y, const position *clip,   
                                                                                 const std::shared_ptr<render_item> &ri)
{
        if((*m_cssp).get_display() != display_inline && (*m_cssp).get_display() != display_table_row)        
        {
                position pos = ri->pos();
                pos.x   += x;
                pos.y   += y;
                apply_fragment_band(get_document()->fragment_band_of(this), pos, ri);

                position border_box = pos;
                border_box += ri->get_paddings();
                border_box += ri->get_borders();

                if(border_box.does_intersect(clip) || is_root())
                {
                        auto v_offset = ri->get_draw_vertical_offset();
                        pos.y += v_offset;
                        pos.height -= v_offset;

                        border_box.round();
                        border_radiuses radius = (*m_cssp).get_borders().radius.calc_percents(border_box.width, border_box.height);

                        if(!(*m_cssp).get_box_shadow().empty())
                        {
                                get_document()->container()->draw_box_shadow(hdc, (*m_cssp).get_box_shadow(), border_box, radius, false);
                        }

                        const background* bg = get_background();
                        if(bg)
                        {
                                int num_layers = bg->get_layers_number();
                                for(int i = num_layers - 1; i >= 0; i--)
                                {
                                        background_layer layer;

                                        if(!bg->get_layer(i, pos, this, ri, layer)) continue;        

                                        if(is_root() && (clip != nullptr))
                                        {
                                                layer.clip_box = *clip;
                                                layer.border_box = *clip;
                                        }

                                        layer.border_box.round();
                                        layer.clip_box.round();
                                        layer.origin_box.round();

                                        bg->draw_layer(hdc, i, layer, get_document()->container(), (*m_cssp).get_image_rendering());  
                                }
                        }

                                                if(!(*m_cssp).get_box_shadow().empty())
                        {
                                get_document()->container()->draw_box_shadow(hdc, (*m_cssp).get_box_shadow(), border_box, radius, true);
                        }
                }
        } else
        {
                const background* bg = get_background();

                position::vector boxes;
                ri->get_inline_boxes(boxes);

                position content_box;

                for(auto box = boxes.begin(); box != boxes.end(); box++)
                {
                        box->x  += x;
                        box->y  += y;

                        if(box->does_intersect(clip))
                        {
                                content_box = *box;
                                content_box -= ri->get_borders();
                                content_box -= ri->get_paddings();

                                css_borders bdr = inline_fragment_borders((*m_cssp).get_borders(), (*m_cssp).get_writing_mode() != writing_mode_horizontal_tb,
                                        box == boxes.begin(), box == boxes.end() - 1);

                                if(bg)
                                {
                                        int num_layers = bg->get_layers_number();
                                        for(int i = num_layers - 1; i >= 0; i--)
                                        {
                                                background_layer layer;

                                                if(!bg->get_layer(i, content_box, this, ri, layer)) continue;

                                                layer.border_radius = bdr.radius.calc_percents(box->width, box->height);

                                                layer.border_box.round();
                                                layer.clip_box.round();
                                                layer.origin_box.round();

                                                bg->draw_layer(hdc, i, layer, get_document()->container(), (*m_cssp).get_image_rendering());  
                                        }
                                }
                                if(!(*m_cssp).get_box_shadow().empty())
                                {
                                        get_document()->container()->draw_box_shadow(hdc, (*m_cssp).get_box_shadow(), *box, bdr.radius.calc_percents(box->width, box->height), true);
                                }
                        }
                }
        }
}

void litehtml::html_tag::draw_borders(uint_ptr hdc, pixel_t x, pixel_t y, const position *clip, const std::shared_ptr<render_item> &ri)
{
        if((*m_cssp).get_display() != display_inline && (*m_cssp).get_display() != display_table_row)        
        {
                position pos = ri->pos();
                pos.x   += x;
                pos.y   += y;
                apply_fragment_band(get_document()->fragment_band_of(this), pos, ri);

                position border_box = pos;
                border_box += ri->get_paddings();
                border_box += ri->get_borders();

                if(border_box.does_intersect(clip) || is_root())
                {
                        auto v_offset = ri->get_draw_vertical_offset();
                        pos.y += v_offset;
                        pos.height -= v_offset;

                        border_box.round();
                        border_radiuses radius = (*m_cssp).get_borders().radius.calc_percents(border_box.width, border_box.height);

                        borders bdr = (*m_cssp).get_borders();
                        if((*m_cssp).get_border_image().is_valid())
                        {
                            bdr.radius = radius;
                            get_document()->container()->draw_border_image(hdc, (*m_cssp).get_border_image(), bdr, border_box, is_root());
                        }
                        else if(bdr.is_visible())
                        {
                                bdr.radius = radius;
                                get_document()->container()->draw_borders(hdc, bdr, border_box, is_root());
                        }
                }
        } else
        {
                position::vector boxes;
                ri->get_inline_boxes(boxes);

                for(auto box = boxes.begin(); box != boxes.end(); box++)
                {
                        box->x  += x;
                        box->y  += y;

                        if(box->does_intersect(clip))
                        {
                                css_borders bdr = inline_fragment_borders((*m_cssp).get_borders(), (*m_cssp).get_writing_mode() != writing_mode_horizontal_tb,
                                        box == boxes.begin(), box == boxes.end() - 1);

                                if((*m_cssp).get_border_image().is_valid())
                                {
                                    borders b = bdr;
                                    b.radius = bdr.radius.calc_percents(box->width, box->height);
                                    box->round();
                                    get_document()->container()->draw_border_image(hdc, (*m_cssp).get_border_image(), b, *box, false);
                                }
                                else if(bdr.is_visible())
                                {
                                        borders b = bdr;
                                        b.radius = bdr.radius.calc_percents(box->width, box->height);
                                        box->round();
                                        get_document()->container()->draw_borders(hdc, b, *box, false);
                                }
                        }
                }
        }
}

bool litehtml::html_tag::set_pseudo_class( string_id cls, bool add )
{
        bool ret = false;
        if(add)
        {
                if(std::find(m_pseudo_classes.begin(), m_pseudo_classes.end(), cls) == m_pseudo_classes.end())
                {
                        m_pseudo_classes.push_back(cls);
                        ret = true;
                }
        } else
        {
                auto pi = std::find(m_pseudo_classes.begin(), m_pseudo_classes.end(), cls);
                if(pi != m_pseudo_classes.end())
                {
                        m_pseudo_classes.erase(pi);
                        ret = true;
                }
        }
        return ret;
}

bool litehtml::html_tag::set_class( const char* pclass, bool add )
{
        string_vector classes;
        bool changed = false;

        split_string( pclass, classes, " " );

        if(add)
        {
                for( auto & _class : classes )
                {
                        if(std::find(m_str_classes.begin(), m_str_classes.end(), _class) == m_str_classes.end())
                        {
                                m_str_classes.push_back( std::move( _class ) );
                                changed = true;
                        }
                }
        } else
        {
                for( const auto & _class : classes )
                {
                        auto end = std::remove(m_str_classes.begin(), m_str_classes.end(), _class);  

                        if(end != m_str_classes.end())
                        {
                                m_str_classes.erase(end, m_str_classes.end());
                                changed = true;
                        }
                }
        }

        if( changed )
        {
                string class_string;
                join_string(class_string, m_str_classes, " ");
                set_attr("class", class_string.c_str());

                return true;
        }
        else
        {
                return false;
        }

}

bool litehtml::html_tag::is_replaced() const
{
        return false;
}

// CJK list markers (cjk-ideographic and the kana systems). Counters past the end of a kana list
// fall back to decimal, like browsers do when the alphabetic system runs out of symbols.
static litehtml::string cjk_ideographic_number(int n)
{
        static const char* digits[] = {"", "一", "二", "三", "四", "五", "六", "七", "八", "九"};
        static const char* units[] = {"", "十", "百", "千"};
        if (n <= 0 || n > 9999) return std::to_string(n);
        litehtml::string out;
        const int place_values[] = {1000, 100, 10, 1};
        const int place_units[] = {3, 2, 1, 0};
        for (int i = 0; i < 4; i++)
        {
                int d = (n / place_values[i]) % 10;
                if (d == 0) continue;
                // 十 alone stands for ten, but 二十 keeps its digit
                if (!(d == 1 && place_units[i] == 1 && out.empty())) out += digits[d];
                out += units[place_units[i]];
        }
        return out;
}

static litehtml::string kana_number(const litehtml::string& symbols_utf8, int n)
{
        // split the UTF-8 symbol list into characters
        std::vector<litehtml::string> chars;
        for (size_t i = 0; i < symbols_utf8.size();)
        {
                size_t len = 1;
                unsigned char c = (unsigned char) symbols_utf8[i];
                if (c >= 0xF0) len = 4; else if (c >= 0xE0) len = 3; else if (c >= 0xC0) len = 2;
                chars.push_back(symbols_utf8.substr(i, len));
                i += len;
        }
        if (n < 1 || n > (int) chars.size()) return std::to_string(n);
        return chars[n - 1];
}

static const char* list_marker_suffix(litehtml::list_style_type type)
{
        switch (type)
        {
        case litehtml::list_style_type_cjk_ideographic:
        case litehtml::list_style_type_hiragana:
        case litehtml::list_style_type_hiragana_iroha:
        case litehtml::list_style_type_katakana:
        case litehtml::list_style_type_katakana_iroha:
                return "、";
        default:
                return ".";
        }
}

void litehtml::html_tag::draw_list_marker( uint_ptr hdc, const position& pos, const std::shared_ptr<render_item> &ri )
{
        list_marker lm;

        size img_size;
        if (css().get_list_style_image() != "")
        {
                lm.image   = css().get_list_style_image();
                lm.baseurl = css().get_list_style_image_baseurl().c_str();
                get_document()->container()->get_image_size(lm.image.c_str(), lm.baseurl, img_size); 
        } else
        {
                lm.baseurl = nullptr;
        }

        pixel_t ln_height       = css().line_height().computed_value;
        pixel_t sz_font         = css().get_font_size();
        lm.pos.x                = pos.x;
        lm.pos.width    = sz_font / 3;
        lm.color        = css().get_color();
        lm.marker_type  = css().get_list_style_type();
        lm.font         = css().get_font();

        // In vertical writing the marker sits at the inline-start (top) of each column.
        const writing_mode wmode = css().get_writing_mode();
        const bool vertical = wmode != writing_mode_horizontal_tb;
        const bool block_from_right = wmode == writing_mode_vertical_rl || wmode == writing_mode_sideways_rl;
        const pixel_t column_edge_x = block_from_right ? pos.x + pos.width - ln_height : pos.x;

        if (css().get_list_style_type() >= list_style_type_armenian)
        {
                auto li_baseline = pos.y + ri->get_first_baseline() - ri->content_offset_top();      
                lm.pos.y = li_baseline - css().get_font_metrics().ascent;
                lm.pos.height = css().get_font_metrics().height;

                lm.index = atoi(get_attr("list_index", "0"));
        }
        else
        {
                lm.pos.height = sz_font / 3;
                lm.pos.y = pos.y + ln_height / 2 - lm.pos.height / 2;
                lm.index = -1;
                if (vertical)
                {
                        lm.pos.x = column_edge_x + ln_height / 2 - lm.pos.width / 2;
                        lm.pos.y = pos.y;
                }
        }

        if(img_size.width != 0 && img_size.height != 0)
        {
                if(lm.pos.y + img_size.height > pos.y + pos.height)
                {
                        lm.pos.y = pos.y + pos.height - img_size.height;
                }
                if(img_size.width > lm.pos.width)
                {
                        lm.pos.x -= img_size.width - lm.pos.width;
                }

                lm.pos.width    = img_size.width;
                lm.pos.height   = img_size.height;
        }

        if ((*m_cssp).get_list_style_position() == list_style_position_outside)
        {
                if ((*m_cssp).get_list_style_type() >= list_style_type_armenian)
                {
                        if(lm.font)
                        {
                                auto tw_space = get_document()->container()->text_width(" ", lm.font, get_direction());
                                lm.pos.x = pos.x - tw_space * 2;
                                lm.pos.width = tw_space;
                        } else
                        {
                                lm.pos.width = 0;
                        }
                }
                else if (vertical)
                {
                        lm.pos.y -= sz_font;
                }
                else
                {
                        lm.pos.x -= sz_font;
                }
        }

        if ((*m_cssp).get_list_style_type() >= list_style_type_armenian)
        {
                auto marker_text = get_list_marker_text(lm.index);
                if (marker_text.empty())
                {
                        get_document()->container()->draw_list_marker(hdc, lm);
                }
                else
                {
                        if(lm.font && vertical)
                        {
                                marker_text += list_marker_suffix((*m_cssp).get_list_style_type());
                                auto tw = get_document()->container()->text_width(marker_text.c_str(), lm.font, get_direction(), wmode);
                                auto tw_space = get_document()->container()->text_width(" ", lm.font, get_direction(), wmode);
                                position text_pos;
                                text_pos.x = column_edge_x;
                                text_pos.width = ln_height;
                                text_pos.height = tw;
                                text_pos.y = (*m_cssp).get_list_style_position() == list_style_position_outside ? pos.y - tw - tw_space : pos.y;
                                get_document()->container()->draw_text(hdc, marker_text.c_str(), lm.font, lm.color, text_pos, litehtml::text_overflow_clip, get_direction(), wmode);
                        }
                        else if(lm.font)
                        {
                                marker_text += list_marker_suffix((*m_cssp).get_list_style_type());
                                auto tw = get_document()->container()->text_width(marker_text.c_str(), lm.font, get_direction());
                                auto text_pos = lm.pos;
                                text_pos.move_to(text_pos.right() - tw, text_pos.y);
                                text_pos.width = tw;
                                text_pos.round();
                                get_document()->container()->draw_text(hdc, marker_text.c_str(), lm.font, lm.color, text_pos, litehtml::text_overflow_clip, get_direction());
                        }
                }
        }
        else
        {
                get_document()->container()->draw_list_marker(hdc, lm);
        }
}

void litehtml::html_tag::measure_list_marker(int index)
{
        if ((*m_cssp).get_list_style_type() < list_style_type_armenian || !(*m_cssp).get_font())
        {
                return;
        }
        auto marker_text = get_list_marker_text(index);
        if (marker_text.empty())
        {
                return;
        }
        marker_text += list_marker_suffix((*m_cssp).get_list_style_type());
        get_document()->container()->text_width(marker_text.c_str(), (*m_cssp).get_font(), get_direction(), (*m_cssp).get_writing_mode());
}

litehtml::string litehtml::html_tag::get_list_marker_text(int index)
{
        switch ((*m_cssp).get_list_style_type())
        {
        case litehtml::list_style_type_decimal:
                return std::to_string(index);
        case litehtml::list_style_type_decimal_leading_zero:
                {
                        auto txt = std::to_string(index);
                        if (txt.length() == 1)
                        {
                                txt = "0" + txt;
                        }
                        return txt;
                }
        case litehtml::list_style_type_lower_latin:
        case litehtml::list_style_type_lower_alpha:
                return num_cvt::to_latin_lower(index);
        case litehtml::list_style_type_lower_greek:
                return num_cvt::to_greek_lower(index);
        case litehtml::list_style_type_upper_alpha:
        case litehtml::list_style_type_upper_latin:
                return num_cvt::to_latin_upper(index);
        case litehtml::list_style_type_lower_roman:
                return num_cvt::to_roman_lower(index);
        case litehtml::list_style_type_upper_roman:
                return num_cvt::to_roman_upper(index);
        case litehtml::list_style_type_cjk_ideographic:
                return cjk_ideographic_number(index);
        case litehtml::list_style_type_hiragana:
                return kana_number("あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわゐゑをん", index);
        case litehtml::list_style_type_hiragana_iroha:
                return kana_number("いろはにほへとちりぬるをわかよたれそつねならむうゐのおくやまけふこえてあさきゆめみしゑひもせす", index);
        case litehtml::list_style_type_katakana:
                return kana_number("アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヰヱヲン", index);
        case litehtml::list_style_type_katakana_iroha:
                return kana_number("イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセス", index);
        default:
                return "";
//      case litehtml::list_style_type_armenian:
//      case litehtml::list_style_type_georgian:
//      case litehtml::list_style_type_hebrew:
//      case litehtml::list_style_type_hiragana:
//      case litehtml::list_style_type_hiragana_iroha:
//      case litehtml::list_style_type_katakana:
//      case litehtml::list_style_type_katakana_iroha:
//  case litehtml::list_style_type_none:
//  case litehtml::list_style_type_circle:
//  case litehtml::list_style_type_disc:
//  case litehtml::list_style_type_square:
//  case litehtml::list_style_type_cjk_ideographic:
//      break;
        }
}

bool html_tag::is_nth_child(const element::ptr& el, int num, int off, bool of_type, const css_selector::vector& selector_list) const
{
        int idx = 1;
        for(const auto& child : m_children)
        {
                if(child->css().get_display() != display_inline_text)
                {
                        if( (!of_type && selector_list.empty()) ||
                                (of_type && child->tag() == el->tag()) || child->select(selector_list) )
                        {
                                if(el == child)
                                {
                                        if(num != 0)
                                        {
                                                if((idx - off) * num >= 0 && (idx - off) % num == 0) 
                                                {
                                                        return true;
                                                }

                                        } else if(idx == off)
                                        {
                                                return true;
                                        }
                                        return false;
                                }
                                idx++;
                        }
                        if(el == child) break;
                }
        }
        return false;
}

bool html_tag::is_nth_last_child(const element::ptr& el, int num, int off, bool of_type, const css_selector::vector& selector_list) const
{
        int idx = 1;
        for(auto child = m_children.rbegin(); child != m_children.rend(); child++)
        {
                if((*child)->css().get_display() != display_inline_text)
                {
                        if( (!of_type && selector_list.empty()) ||
                                (of_type && (*child)->tag() == el->tag()) || (*child)->select(selector_list) )
                        {
                                if(el == (*child))
                                {
                                        if(num != 0)
                                        {
                                                if((idx - off) * num >= 0 && (idx - off) % num == 0) 
                                                {
                                                        return true;
                                                }

                                        } else if(idx == off)
                                        {
                                                return true;
                                        }
                                        return false;
                                }
                                idx++;
                        }
                        if(el == (*child)) break;
                }
        }
        return false;
}

litehtml::element::ptr litehtml::html_tag::find_adjacent_sibling( const element::ptr& el, const css_selector& selector, bool apply_pseudo /*= true*/, bool* is_pseudo /*= 0*/ )
{
        element::ptr ret;
        for(auto& e : m_children)
        {
                if(e->css().get_display() != display_inline_text)
                {
                        if(e == el)
                        {
                                if(ret)
                                {
                                        int res = ret->select(selector, apply_pseudo);
                                        if(res != select_no_match)
                                        {
                                                if(is_pseudo)
                                                {
                                                        if(res & select_match_pseudo_class)
                                                        {
                                                                *is_pseudo = true;
                                                        } else
                                                        {
                                                                *is_pseudo = false;
                                                        }
                                                }
                                                return ret;
                                        }
                                }
                                return nullptr;
                        } else
                        {
                                ret = e;
                        }
                }
        }
        return nullptr;
}

litehtml::element::ptr litehtml::html_tag::find_sibling(const element::ptr& el, const css_selector& selector, bool apply_pseudo /*= true*/, bool* is_pseudo /*= 0*/)
{
        element::ptr ret = nullptr;
        for(auto& e : m_children)
        {
                if(e->css().get_display() != display_inline_text)
                {
                        if(e == el)
                        {
                                return ret;
                        } else if(!ret)
                        {
                                int res = e->select(selector, apply_pseudo);
                                if(res != select_no_match)
                                {
                                        if(is_pseudo)
                                        {
                                                if(res & select_match_pseudo_class)
                                                        *is_pseudo = true;
                                                else
                                                        *is_pseudo = false;
                                        }
                                        ret = e;
                                }
                        }
                }
        }
        return nullptr;
}

bool litehtml::html_tag::is_only_child(const element::ptr& el, bool of_type) const
{
        int child_count = 0;
        for(const auto& child : m_children)
        {
                if(child->css().get_display() != display_inline_text)
                {
                        if( !of_type || (of_type && el->tag() == child->tag()) )
                        {
                                child_count++;
                        }
                        if(child_count > 1) break;
                }
        }
        if(child_count > 1)
        {
                return false;
        }
        return true;
}

litehtml::element::ptr litehtml::html_tag::get_element_before(const style& style, bool create)       
{
        if(!m_children.empty())
        {
                if( m_children.front()->tag() == __tag_before_ )
                {
                        return m_children.front();
                }
        }
        if(create)
        {
                return add_pseudo_before(style);
        }
        return nullptr;
}

litehtml::element::ptr litehtml::html_tag::get_element_after(const style& style, bool create)        
{
        if(!m_children.empty())
        {
                if( m_children.back()->tag() == __tag_after_ )
                {
                        return m_children.back();
                }
        }
        if(create)
        {
                return add_pseudo_after(style);
        }
        return nullptr;
}

void litehtml::html_tag::apply_first_letter()
{
        if(!m_has_first_letter_style) return;
        if(m_first_letter_applied)
        {
                if(m_first_letter_wrapper)
                {
                        m_first_letter_wrapper->reset_style();
                        m_first_letter_wrapper->add_style(m_first_letter_style);
                        m_first_letter_wrapper->compute_styles();
                }
                return;
        }

        // Depth-first search for the first non-empty text node inside `container`,
        // skipping any ::after subtree. Returns target text node via out params.
        element::ptr found_target;
        element::ptr found_parent;
        std::function<bool(const element::ptr&)> dfs;
        dfs = [&](const element::ptr& node) -> bool
        {
                auto tag_ptr = std::dynamic_pointer_cast<html_tag>(node);
                if(!tag_ptr) return false;
                for(auto& child : tag_ptr->children())
                {
                        if(!child) continue;
                        if(child->tag() == __tag_after_) continue; // ::after対象外
                        if(child->tag() == __tag_before_ && node.get() != this)
                        {
                                // nested ::before pseudo (should not happen); skip its tag itself but
                                // still allow searching inside the top-level ::before via explicit pass
                                continue;
                        }
                        if(child->is_text())
                        {
                                if(child->is_white_space()) continue;
                                string t;
                                child->get_text(t);
                                if(t.empty()) continue;
                                found_target = child;
                                found_parent = node;
                                return true;
                        }
                        if(child->is_break()) continue;
                        // Descend into element children (inline wrappers, before pseudo, etc.)
                        // Skip replaced / images etc. by only descending into html_tag containers.
                        if(std::dynamic_pointer_cast<html_tag>(child))
                        {
                                if(dfs(child)) return true;
                        }
                }
                return false;
        };

        // 1) ::before子を先に探索 (before空はskip → 通常子へ)
        if(!m_children.empty() && m_children.front()->tag() == __tag_before_)
        {
                element::ptr before_el = m_children.front();
                // Search inside ::before (its own children, never its ::after)
                if(dfs(before_el))
                {
                        // found inside before
                } else
                {
                        found_target = nullptr;
                }
        }
        // 2) 通常子の探索 (::before自体と::afterは除外)
        if(!found_target)
        {
                for(auto& child : m_children)
                {
                        if(!child) continue;
                        if(child->tag() == __tag_before_) continue;
                        if(child->tag() == __tag_after_) continue; // ::after対象外
                        if(child->is_text())
                        {
                                if(child->is_white_space()) continue;
                                string t;
                                child->get_text(t);
                                if(t.empty()) continue;
                                found_target = child;
                                found_parent = shared_from_this();
                                break;
                        }
                        if(child->is_break()) continue;
                        if(std::dynamic_pointer_cast<html_tag>(child))
                        {
                                // Temporarily reuse dfs for this subtree
                                found_target = nullptr;
                                if(dfs(child))
                                {
                                        // dfs set found_target/found_parent
                                        break;
                                }
                        }
                }
        }

        if(!found_target || !found_parent) return;

        // 二重分割ガード: 既にwrapper内が対象なら何もしない
        {
                element::ptr p = found_parent;
                while(p)
                {
                        if(p == m_first_letter_wrapper) return;
                        p = p->parent();
                }
                if(found_target == m_first_letter_wrapper) return;
        }

        string txt;
        found_target->get_text(txt);
        if(txt.empty()) return;
        const char* s = txt.c_str();
        const char* p = s;
        char32_t first_ch = decode_utf8(&p);
        // CSS Selectors-4: the leading punctuation preceding the first letter unit
        // (Ps/Pe/Pi/Pf/Po) is part of ::first-letter, and so is the punctuation
        // following it (Pe/Pf/Po). E.g. "【前】" -> wrapper "【前】", rest "",
        // "あ。。" -> wrapper "あ。。", "あ「" -> wrapper "あ" (Ps is not trailing).
        if(is_first_letter_preceding_punct(first_ch))
        {
                while(*p)
                {
                        const char* q = p;
                        if(!is_first_letter_preceding_punct(decode_utf8(&q))) break;
                        p = q;
                }
                if(*p)
                {
                        decode_utf8(&p); // include the first following character
                }
        }
        while(*p)
        {
                const char* q = p;
                if(!is_first_letter_following_punct(decode_utf8(&q))) break;
                p = q;
        }
        size_t first_len = (size_t)(p - s);
        if(first_len == 0 || first_len > txt.size()) return;
        // If the text node holds a single codepoint, first_len == txt.size(): still wrap.
        string first_str(s, first_len);
        string rest_str(p);
        if(first_str.empty()) return;

        auto parent_tag = std::dynamic_pointer_cast<html_tag>(found_parent);
        if(!parent_tag) return;
        auto& vec = parent_tag->children();
        auto it = std::find(vec.begin(), vec.end(), found_target);
        if(it == vec.end()) return;

        auto wrapper = std::make_shared<html_tag>(get_document());
        wrapper->set_tagName("span");
        wrapper->parent(found_parent);

        auto first_el = std::make_shared<el_text>(first_str.c_str(), get_document());
        wrapper->appendChild(first_el);

        wrapper->add_style(m_first_letter_style);
        wrapper->compute_styles();

        it = vec.erase(it);
        vec.insert(it, wrapper);
        if(!rest_str.empty())
        {
                auto rest_el = std::make_shared<el_text>(rest_str.c_str(), get_document());
                rest_el->parent(found_parent);
                rest_el->compute_styles(false);
                vec.insert(it, rest_el);
        }

        m_first_letter_applied = true;
        m_first_letter_wrapper = wrapper;
}


static int s_refresh_depth = 0;

void litehtml::html_tag::handle_counter_properties(const style& style)
{
        // Counters are rebuilt in document order once a refresh is over (rebuild_counters()); the
        // refresh itself visits children before parents, which would apply increments before resets.
        if (s_refresh_depth > 0) return;
        // Only the declarations this rule contributes: handling the cascaded m_style on every
        // add_style() applied counter-increment once per matching rule (line numbers counted 8x).
        const auto& reset_property = style.get_property(_counter_reset_);
        if (reset_property.is<string_vector>()) {
                auto reset_function = [&](const string_id&name_id, const int value) {
                        reset_counter(name_id, value);
                };
                parse_counter_tokens(reset_property.get<string_vector>(), 0, reset_function);
        }

        const auto& inc_property = style.get_property(_counter_increment_);
        if (inc_property.is<string_vector>()) {
                auto inc_function = [&](const string_id&name_id, const int value) {
                        increment_counter(name_id, value);
                };
                parse_counter_tokens(inc_property.get<string_vector>(), 1, inc_function);
        }
}


void litehtml::html_tag::add_style(const style& style, selector_specificity specificity)
{
        m_style.combine(style, specificity);
        handle_counter_properties(style);
}

void litehtml::html_tag::reset_style()
{
	m_style.clear();
}

const litehtml::property_value& litehtml::html_tag::get_property_value(string_id name) const
{
	return m_style.get_property(name);
}

void litehtml::html_tag::refresh_styles()
{
        s_refresh_depth++;
        refresh_styles_impl();
        s_refresh_depth--;
        if (s_refresh_depth == 0) rebuild_counters();
}

void litehtml::html_tag::rebuild_counters()
{
        m_counter_values.clear();
        handle_counter_properties(m_style);
        for (auto& el : m_children)
        {
                el->rebuild_counters();
        }
}

void litehtml::html_tag::refresh_styles_impl()
{
        for (auto& el : m_children)
        {
                if(el->css().get_display() != display_inline_text)
                {
                        el->refresh_styles();
                }
        }

        m_style.clear();

        m_first_letter_style.clear();
        m_has_first_letter_style = false;

        parse_presentational_hints();

        for (auto& usel : m_used_styles)
        {
                usel->m_used = false;

                if(usel->m_selector->is_media_valid() && usel->m_selector->is_container_valid(this))
                {
                        int apply = select(*usel->m_selector, false);

                        if(apply != select_no_match)
                        {
                                const auto& content_property = usel->m_selector->m_style->get_property(_content_);
                                bool content_none = content_property.is<string>() && content_property.get<string>() == "none";

                                if(apply & select_match_pseudo_class)
                                {
                                        if(select(*usel->m_selector, true))
                                        {
                                                bool handled = false;
                                                if(apply & select_match_with_after)
                                                {
                                                        element::ptr el = get_element_after(*usel->m_selector->m_style, !content_none);
                                                        if(el)
                                                        {
                                                                if (content_none)
                                                                {
                                                                        removeChild(el);
                                                                }
                                                                else
                                                                {
                                                                        el->reset_style();
                                                                        el->add_style(*usel->m_selector->m_style, usel->m_selector->m_specificity);
                                                                }
                                                        }
                                                        handled = true;
                                                } else if(apply & select_match_with_before)
                                                {
                                                        element::ptr el = get_element_before(*usel->m_selector->m_style, !content_none);
                                                        if(el)
                                                        {
                                                                if (content_none)
                                                                {
                                                                        removeChild(el);
                                                                }
                                                                else
                                                                {
                                                                        el->reset_style();
                                                                        el->add_style(*usel->m_selector->m_style, usel->m_selector->m_specificity);
                                                                }
                                                        }
                                                        handled = true;
                                                }
                                                if(apply & select_match_with_first_letter)
                                                {
                                                        m_first_letter_style.combine(*usel->m_selector->m_style, usel->m_selector->m_specificity);
                                                        m_has_first_letter_style = true;
                                                        usel->m_used = true;
                                                        handled = true;
                                                }
                                                if(apply & select_match_with_placeholder) handled = true;
                                                if(!handled)
                                                {
                                                        add_style(*usel->m_selector->m_style, usel->m_selector->m_specificity);
                                                        usel->m_used = true;
                                                }
                                        }
                                } else 
                                {
                                        bool handled = false;
                                        if(apply & select_match_with_after)
                                        {
                                                element::ptr el = get_element_after(*usel->m_selector->m_style, !content_none);
                                                if(el)
                                                {
                                                        if (content_none)
                                                        {
                                                                removeChild(el);
                                                        }
                                                        else
                                                        {
                                                                el->add_style(*usel->m_selector->m_style, usel->m_selector->m_specificity);
                                                        }
                                                }
                                                handled = true;
                                        } else if(apply & select_match_with_before)
                                        {
                                                element::ptr el = get_element_before(*usel->m_selector->m_style, !content_none);
                                                if(el)
                                                {
                                                        if (content_none)
                                                        {
                                                                removeChild(el);
                                                        }
                                                        else
                                                        {
                                                                el->add_style(*usel->m_selector->m_style, usel->m_selector->m_specificity);
                                                        }
                                                }
                                                handled = true;
                                        }
                                        if(apply & select_match_with_first_letter)
                                        {
                                                m_first_letter_style.combine(*usel->m_selector->m_style, usel->m_selector->m_specificity);
                                                m_has_first_letter_style = true;
                                                usel->m_used = true;
                                                handled = true;
                                        }
                                        if(apply & select_match_with_placeholder) handled = true;
                                        if(!handled)
                                        {
                                                add_style(*usel->m_selector->m_style, usel->m_selector->m_specificity);
                                                usel->m_used = true;
                                        }
                                }
                        }
                }
        }

        const char* style = get_attr("style");
        if (style)
        {
                m_style.add(style, "", get_document()->container(), css::unlayered_id, selector_specificity(1, 0, 0, 0));
        }

        if(m_has_first_letter_style)
        {
                if(m_first_letter_applied && m_first_letter_wrapper)
                {
                        m_first_letter_wrapper->reset_style();
                        m_first_letter_wrapper->add_style(m_first_letter_style);
                        m_first_letter_wrapper->compute_styles();
                } else
                {
                        apply_first_letter();
                }
        }
}

const litehtml::background* litehtml::html_tag::get_background(bool own_only)
{
        if(own_only)
        {
                // return own background with check for empty one
                if((*m_cssp).get_bg().is_empty())
                {
                        return nullptr;
                }
                return &(*m_cssp).get_bg();
        }

        if((*m_cssp).get_bg().is_empty())
        {
                // if this is root element (<html>) try to get background from body
                if (is_root())
                {
                        for (const auto& el : m_children)
                        {
                                if( el->is_body() )
                                {
                                        // return own body background
                                        return el->get_background(true);
                                }
                        }
                }
                return nullptr;
        }

        if(is_body())
        {
                element::ptr el_parent = parent();
                if (el_parent)
                {
                        if (!el_parent->get_background(true))
                        {
                                // parent of body will draw background for body
                                return nullptr;
                        }
                }
        }

        return &(*m_cssp).get_bg();
}

string html_tag::dump_get_name()
{
        if(m_tag == empty_id)
        {
                return "anon [html_tag]";
        }
        return _s(m_tag) + " [html_tag]";
}

// https://html.spec.whatwg.org/multipage/rendering.html#maps-to-the-pixel-length-property
void html_tag::map_to_pixel_length_property(string_id prop_name, string attr_value, selector_specificity specificity)
{
        int n;
        if (html_parse_non_negative_integer(attr_value, n))
        {
                css_token tok(DIMENSION, (float)n, css_number_integer, "px");
                m_style.add_property(prop_name, {tok}, "", false, nullptr, 0, specificity);
        }
}

// https://html.spec.whatwg.org/multipage/rendering.html#tables-2:attr-table-border
void html_tag::map_to_pixel_length_property_with_default_value(string_id prop_name, string attr_value, int default_value)
{
        int n = default_value;
        html_parse_non_negative_integer(attr_value, n);
        css_token tok(DIMENSION, (float)n, css_number_integer, "px");
        m_style.add_property(prop_name, {tok});
}

// https://html.spec.whatwg.org/multipage/rendering.html#maps-to-the-dimension-property
void html_tag::map_to_dimension_property(string_id prop_name, string attr_value)
{
        float x = 0;
        html_dimension_type type = html_length;
        if (!html_parse_dimension_value(attr_value, x, type))
                return;

        css_token tok;
        if (type == html_length)
                tok = {DIMENSION,  x, css_number_number, "px"};
        else
                tok = {PERCENTAGE, x, css_number_number};

        m_style.add_property(prop_name, {tok});
}

// https://html.spec.whatwg.org/multipage/rendering.html#maps-to-the-dimension-property-(ignoring-zero)
void html_tag::map_to_dimension_property_ignoring_zero(string_id prop_name, string attr_value)       
{
        float x = 0;
        html_dimension_type type = html_length;
        if (!html_parse_nonzero_dimension_value(attr_value, x, type))
                return;

        css_token tok;
        if (type == html_length)
                tok = {DIMENSION,  x, css_number_number, "px"};
        else
                tok = {PERCENTAGE, x, css_number_number};

        m_style.add_property(prop_name, {tok});
}

} // namespace litehtml
