#include <unordered_set>
#include <algorithm>
#include <chrono>
#include "html.h"
#include "document.h"
#include "stylesheet.h"
#include "html_tag.h"
#include "el_text.h"
#include <functional>
#include "el_para.h"
#include "el_space.h"
#include "el_body.h"
#include "el_image.h"
#include "el_table.h"
#include "el_td.h"
#include "el_link.h"
#include "el_title.h"
#include "el_style.h"
#include "el_script.h"
#include "el_comment.h"
#include "el_cdata.h"
#include "el_base.h"
#include "el_anchor.h"
#include "el_break.h"
#include "el_div.h"
#include "el_font.h"
#include "el_tr.h"
#include "gumbo.h"
#include "render_item.h"
#include "render_table.h"
#include "render_block.h"
#include "document_container.h"
#include "types.h"

namespace litehtml
{

document::document(document_container* container)
{
	m_container	= container;
}

document::~document()
{
	m_over_element = m_active_element = nullptr;
	if(m_container)
	{
		for(auto& font : m_fonts)
		{
			m_container->delete_font(font.second.font);
		}
	}
}

document::ptr document::createFromString(
	const estring& str,
	document_container* container,
	const string& master_styles,
	const string& user_styles,
	const string& page_styles )
{
	// Create litehtml::document
	document::ptr doc = make_shared<document>(container);

	// Parse document into GumboOutput
	GumboOutput* output = doc->parse_html(str);

	// mode must be set before doc->create_node because it is used in html_tag::set_attr
	switch (output->document->v.document.doc_type_quirks_mode)
	{
	case GUMBO_DOCTYPE_NO_QUIRKS:      doc->m_mode = no_quirks_mode;      break;
	case GUMBO_DOCTYPE_QUIRKS:         doc->m_mode = quirks_mode;         break;
	case GUMBO_DOCTYPE_LIMITED_QUIRKS: doc->m_mode = limited_quirks_mode; break;
	}

	// Create litehtml::elements.
	elements_list root_elements;
	doc->create_node(output->root, root_elements, true, true);
	if (!root_elements.empty())
	{
		doc->m_root = root_elements.back();
	}

	// Destroy GumboOutput
	gumbo_destroy_output(&kGumboDefaultOptions, output);

	if (master_styles != "")
	{
		// The master stylesheet is the same text for every document and holds no at-rule (nothing that refers to the document),
		// and parsing it took most of a small page's time to build. Parse it once and give each document a copy.
		static thread_local string parsed_text;
		static thread_local css parsed_css;
		static thread_local bool have_parsed = false;
		if (!have_parsed || parsed_text != master_styles)
		{
			css fresh;
			fresh.parse_css_stylesheet(master_styles, "", doc, nullptr, nullptr, true, 0);
			fresh.sort_selectors();
			parsed_css = fresh;
			parsed_text = master_styles;
			have_parsed = true;
		}
		doc->m_master_css = parsed_css;
		// Quirks mode (no DOCTYPE): tables do not inherit text-align, font and white-space
		// from their ancestors (WebKit/Blink quirks.css), e.g. <center><table> keeps cells
		// left-aligned.
		if (doc->m_mode == quirks_mode)
		{
			doc->m_master_css.parse_css_stylesheet(
				string("table { text-align: left; font-size: medium; line-height: normal;"
				       " font-weight: normal; font-style: normal; white-space: normal; }"),
				"", doc, nullptr, nullptr, true, 0);
			doc->m_master_css.sort_selectors();
		}
	}
	if (user_styles != "")
	{
		doc->m_user_css.parse_css_stylesheet(user_styles, "", doc, nullptr, nullptr, true, 1);
		doc->m_user_css.sort_selectors();
	}

	// Let's process created elements tree
	if (doc->m_root)
	{
		doc->container()->get_media_features(doc->m_media);
		css_length::set_viewport((float) doc->m_media.width, (float) doc->m_media.height);

		doc->m_root->set_pseudo_class(_root_, true);

		doc->m_root->apply_stylesheet(doc->m_master_css);

		doc->m_root->parse_attributes();
		for (const auto& css : doc->m_css)
		{
			media_query_list_list::ptr media;
			if (css.media != "")
			{
				auto mq_list = parse_media_query_list(css.media, doc);
				media = make_shared<media_query_list_list>();
				media->add(mq_list);
			}
			doc->m_styles.parse_css_stylesheet(css.text, css.baseurl, doc, media, nullptr);
		}
		// CSS fetched for the page (<link rel=stylesheet>, @import) is author origin.
		// Parsing it as a stylesheet of its own (instead of into m_user_css) keeps `@layer`
		// blocks from outranking it: an unlayered author declaration always beats a layered
		// one, exactly as in the browser.
		if (!page_styles.empty())
		{
			doc->m_styles.parse_css_stylesheet(page_styles, "", doc, nullptr, nullptr);
		}
		doc->m_styles.sort_selectors();


		doc->update_media_lists(doc->m_media);

		doc->m_root->apply_stylesheet(doc->m_styles);

		doc->m_root->apply_stylesheet(doc->m_user_css);

		doc->m_root->compute_styles();

		doc->m_root->apply_word_break();
		doc->m_root_render = doc->m_root->create_render_item(nullptr);

		doc->fix_tables_layout();

		if(doc->m_root_render)
		{
			doc->m_root_render = doc->m_root_render->init();
		}
	}


	return doc;
}

// https://html.spec.whatwg.org/multipage/parsing.html#change-the-encoding
encoding adjust_meta_encoding(encoding meta_encoding, encoding current_encoding)
{
	// 1.
	if (current_encoding == encoding::utf_16le || current_encoding == encoding::utf_16be)
		return current_encoding;

	// 2.
	if (meta_encoding == encoding::utf_16le || meta_encoding == encoding::utf_16be)
		return encoding::utf_8;

	// 3.
	if (meta_encoding == encoding::x_user_defined)
		return encoding::windows_1252;

	// 4,5,6.
	return meta_encoding;
}

// https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inhead:change-the-encoding
encoding get_meta_encoding(GumboNode* root)
{
	// find <head>
	GumboNode* head = nullptr;
	for (size_t i = 0; i < root->v.element.children.length; i++)
	{
		GumboNode* node = (GumboNode*)root->v.element.children.data[i];
		if (node->type == GUMBO_NODE_ELEMENT && node->v.element.tag == GUMBO_TAG_HEAD)
		{
			head = node;
			break;
		}
	}
	if (!head) return encoding::null;

	// go through <meta> tags in <head>
	for (size_t i = 0; i < head->v.element.children.length; i++)
	{
		GumboNode* node = (GumboNode*)head->v.element.children.data[i];
		if (node->type != GUMBO_NODE_ELEMENT || node->v.element.tag != GUMBO_TAG_META)
			continue;

		auto charset    = gumbo_get_attribute(&node->v.element.attributes, "charset");
		auto http_equiv = gumbo_get_attribute(&node->v.element.attributes, "http-equiv");
		auto content    = gumbo_get_attribute(&node->v.element.attributes, "content");
		// 1. If the element has a charset attribute...
		if (charset)
		{
			auto encoding = get_encoding(charset->value);
			if (encoding != encoding::null)
				return encoding;
		}
		// 2. Otherwise, if the element has an http-equiv attribute...
		else if (http_equiv && t_strcasecmp(http_equiv->value, "content-type") == 0 && content)
		{
			auto encoding = extract_encoding_from_meta_element(content->value);
			if (encoding != encoding::null)
				return encoding;
		}
	}

	return encoding::null;
}

// substitute for gumbo_parse that handles encodings
GumboOutput* document::parse_html(estring str)
{
	// https://html.spec.whatwg.org/multipage/parsing.html#the-input-byte-stream
	encoding_sniffing_algorithm(str);
	// cannot store output in local variable because gumbo keeps pointers into it,
	// which will be accessed later in gumbo_tag_from_original_text
	if (str.encoding == encoding::utf_8)
		m_text = str;
	else
		decode(str, str.encoding, m_text);

	// Gumbo does not support callbacks on node creation, so we cannot change encoding while parsing.
	// Instead, we parse entire file and then handle <meta> tags.

	// Using gumbo_parse_with_options to pass string length (m_text may contain NUL chars).
	GumboOutput* output = gumbo_parse_with_options(&kGumboDefaultOptions, m_text.data(), m_text.size());

	if (str.confidence == confidence::certain)
		return output;

	// Otherwise: confidence is tentative.

	// If valid HTML encoding is specified in <meta> tag...
	encoding meta_encoding = get_meta_encoding(output->root);
	if (meta_encoding != encoding::null)
	{
		// ...and it is different from currently used encoding...
		encoding new_encoding = adjust_meta_encoding(meta_encoding, str.encoding);
		if (new_encoding != str.encoding)
		{
			// ...reparse with the new encoding.
			gumbo_destroy_output(&kGumboDefaultOptions, output);
			m_text.clear();

			if (new_encoding == encoding::utf_8)
				m_text = str;
			else
				decode(str, new_encoding, m_text);
			output = gumbo_parse_with_options(&kGumboDefaultOptions, m_text.data(), m_text.size());
		}
	}

	return output;
}

void document::create_node(void* gnode, elements_list& elements, bool parseTextNode, bool process_root)
{
	auto* node = (GumboNode*)gnode;
	switch (node->type)
	{
	case GUMBO_NODE_ELEMENT:
	{
		if(process_root)
		{
			element::ptr ret;
			const char* tag = gumbo_normalized_tagname(node->v.element.tag);
			bool is_slot = false;
			if (!m_shadow_stack.empty() && !tag[0] && node->v.element.original_tag.data)
			{
				// gumbo has no tag constant for <slot>: it arrives as a custom element with an empty name.
				// Trim a copy, gumbo_tag_from_original_text edits the piece in place.
				GumboStringPiece piece = node->v.element.original_tag;
				gumbo_tag_from_original_text(&piece);
				is_slot = piece.length == 4 && !strncmp(piece.data, "slot", 4);
			}
			if (is_slot)
			{
				create_slot(node, elements, parseTextNode);
				break;
			}
			if (tag[0])
			{
				// A container that picks an element class by the markup (the engine draws <pre class="mermaid"> itself)
				// needs the class before the element exists; pass it for the two tags that can carry a diagram.
				string_map early_attrs;
				if (!strcmp(tag, "pre") || !strcmp(tag, "div"))
				{
					if (GumboAttribute* cls = gumbo_get_attribute(&node->v.element.attributes, "class"))
						early_attrs["class"] = cls->value;
				}
				ret = create_element(tag, node->v.element.tag, early_attrs.empty() ? nullptr : &early_attrs);
			}
			else
			{
				if (node->v.element.original_tag.data && node->v.element.original_tag.length)
				{
					string str;
					gumbo_tag_from_original_text(&node->v.element.original_tag);
					str.append(node->v.element.original_tag.data, node->v.element.original_tag.length);
					ret = create_element(str.c_str(), -1);
				}
			}
			if (!strcmp(tag, "script"))
			{
				parseTextNode = false;
			}
			if (ret)
			{
				GumboAttribute* attr;
				for (unsigned int i = 0; i < node->v.element.attributes.length; i++)
				{
					attr = (GumboAttribute*)node->v.element.attributes.data[i];
					ret->set_attr(attr->name, attr->value);
				}

				if (!m_shadow_stack.empty())
				{
					ret->set_attr("data-satoru-scope", std::to_string(m_shadow_stack.back().id).c_str());
				}

				elements_list child;
				GumboNode* shadow_root = nullptr;
				for (unsigned int i = 0; i < node->v.element.children.length && !shadow_root; i++)
				{
					auto* c = static_cast<GumboNode*>(node->v.element.children.data[i]);
					// gumbo hands <template> over as its own node type; its content hangs off v.element
					if (c->type == GUMBO_NODE_TEMPLATE &&
						(gumbo_get_attribute(&c->v.element.attributes, "shadowrootmode") ||
						 gumbo_get_attribute(&c->v.element.attributes, "shadowroot")))
					{
						shadow_root = c;
					}
				}
				if (shadow_root)
				{
					create_shadow_children(node, shadow_root, ret, parseTextNode);
				}
				else
				for (unsigned int i = 0; i < node->v.element.children.length; i++)
				{
					child.clear();
					create_node(static_cast<GumboNode*> (node->v.element.children.data[i]), child, parseTextNode, true);
					std::for_each(child.begin(), child.end(),
						[&ret](element::ptr& el)
						{
							ret->appendChild(el);
						}
					);
				}
				if (!strcmp(tag, "input"))
				{
					// <input> is a void element: give its value / placeholder a text child so it is drawn.
					string type = ret->get_attr("type", "text");
					for (auto& c : type) c = (char)tolower((unsigned char)c);
					const char* value = ret->get_attr("value");
					const char* placeholder = ret->get_attr("placeholder");
					string text;
					bool is_placeholder = false;
					if (type == "submit" || type == "button" || type == "reset")
					{
						text = value ? value : (type == "submit" ? "Submit" : (type == "reset" ? "Reset" : ""));
					}
					else if (type == "text" || type == "search" || type == "email" || type == "url" || type == "tel" ||
							 type == "number" || type == "password")
					{
						if (value && *value)
						{
							text = value;
							if (type == "password")
							{
								// one bullet (U+2022) per character
								size_t n = 0;
								for (const char* q = value; *q; q++) if (((unsigned char)*q & 0xC0) != 0x80) n++;
								text.clear();
								for (size_t k = 0; k < n; k++) text += "\xE2\x80\xA2";
							}
						}
						else if (placeholder && *placeholder)
						{
							text = placeholder;
							is_placeholder = true;
						}
					}
					if (text.empty() && type != "submit" && type != "button" && type != "reset" &&
						type != "checkbox" && type != "radio" && type != "file" && type != "hidden" &&
						type != "range" && type != "color" && type != "image")
					{
						// An empty field still has one line of content: its height is the line plus
						// padding and border (the UA rule no longer fixes it), so give it a zero width space.
						text = "â";
					}
					if (!text.empty())
					{
						auto txt = std::make_shared<el_text>(text.c_str(), shared_from_this());
						if (is_placeholder)
						{
							element::ptr span = create_element("span", -1);
							if (span)
							{
								span->set_attr("data-satoru-placeholder", "");
								span->appendChild(txt);
								ret->appendChild(span);
							}
						}
						else
						{
							ret->appendChild(txt);
						}
					}
				}
				if (!strcmp(tag, "select"))
				{
					// Show the selected (or first) option's label and size the box to the longest option.
					// The longest label is measured with the real text machinery (in em of
					// the default font, so the injected width scales with the select's own
					// font size); a per-character estimate is kept only as a fallback.
					// A select with size > 1 or multiple is a list box instead: every
					// option (and optgroup label) becomes a row of a pre-formatted text
					// child and the box is pinned to the display size -- its height is
					// rows * (ascent + descent + 2px) + border and its width is the
					// widest row plus the list box's padding and border (this platform's
					// overlay scrollbars reserve no extra width).
					string label, first_label;
					bool have_selected = false;
					float widest = 0;
					float row_ratio = 1.15f; // (ascent + descent) / font size of the measure font
					std::vector<string> rows;
					std::vector<char> row_selected;
					uint_ptr measure_font = 0;
					float measure_size = 16;
					if (m_container)
					{
						font_description descr;
						descr.family = m_container->get_default_font_name();
						measure_size = (float)m_container->get_default_font_size();
						descr.size = (pixel_t)measure_size;
						descr.weight = 400;
						font_metrics fm;
						measure_font = get_font(descr, &fm);
						// The row ratio is taken at the UA select size (13.333px):
						// the container rounds ascent/descent to whole pixels, so
						// the ratio at another size need not match the laid-out line.
						font_description rdescr = descr;
						rdescr.size = 13.333f;
						font_metrics rfm;
						if (get_font(rdescr, &rfm) && rfm.ascent + rfm.descent > 0)
						{
							row_ratio = (float)(rfm.ascent + rfm.descent) / 13.333f;
						}
					}
					auto add_row = [&](const string& t, bool selected = false) {
						float w = 0;
						if (measure_font && measure_size > 0)
						{
							w = (float)m_container->text_width(t.c_str(), measure_font, direction_ltr) / measure_size;
						}
						else
						{
							for (size_t k = 0; k < t.size(); k++)
							{
								unsigned char ch = (unsigned char)t[k];
								if ((ch & 0xC0) == 0x80) continue;
								w += ch >= 0xE0 ? 1.0f : 0.55f;
							}
						}
						widest = std::max(widest, w);
						rows.push_back(t);
						row_selected.push_back(selected ? 1 : 0);
					};
					std::function<void(GumboNode*)> scan = [&](GumboNode* n) {
						for (unsigned int i = 0; i < n->v.element.children.length; i++)
						{
							auto* c = static_cast<GumboNode*>(n->v.element.children.data[i]);
							if (c->type != GUMBO_NODE_ELEMENT) continue;
							if (c->v.element.tag == GUMBO_TAG_OPTGROUP)
							{
								auto* la = gumbo_get_attribute(&c->v.element.attributes, "label");
								if (la && la->value && *la->value) add_row(string(la->value));
								scan(c);
								continue;
							}
							if (c->v.element.tag != GUMBO_TAG_OPTION) continue;
							string t;
							for (unsigned int k = 0; k < c->v.element.children.length; k++)
							{
								auto* tn = static_cast<GumboNode*>(c->v.element.children.data[k]);
								if (tn->type == GUMBO_NODE_TEXT || tn->type == GUMBO_NODE_WHITESPACE) t += tn->v.text.text;
							}
							// Option labels are stripped and their whitespace collapsed.
							string clean;
							bool pending_space = false;
							for (size_t k = 0; k < t.size(); k++)
							{
								if (isspace((unsigned char)t[k])) { pending_space = !clean.empty(); continue; }
								if (pending_space) { clean += ' '; pending_space = false; }
								clean += t[k];
							}
							t = clean;
							add_row(t, gumbo_get_attribute(&c->v.element.attributes, "selected") != nullptr);
							if (first_label.empty()) first_label = t;
							if (!have_selected && gumbo_get_attribute(&c->v.element.attributes, "selected"))
							{
								have_selected = true;
								label = t;
							}
						}
					};
					scan(node);
					if (!have_selected) label = first_label;
					int display_rows = 1;
					auto* multiple_attr = gumbo_get_attribute(&node->v.element.attributes, "multiple");
					auto* size_attr = gumbo_get_attribute(&node->v.element.attributes, "size");
					if (size_attr && size_attr->value)
					{
						int s = atoi(size_attr->value);
						if (s > 0) display_rows = s;
					}
					if (multiple_attr && !size_attr) display_rows = 4;
					const bool listbox = multiple_attr != nullptr || display_rows > 1;
					const char* st = ret->get_attr("style");
					// Property presence in the author's inline style, matched at a
					// declaration boundary: a plain substring search for "height"
					// also matches "line-height" (and "width" matches "max-width"),
					// which used to suppress the height pin exactly when the author
					// set a line-height on the select.
					auto style_has = [](const char* s, const char* prop) -> bool {
						if (!s) return false;
						const size_t plen = strlen(prop);
						for (const char* p = s; *p; p++)
						{
							if (p != s && p[-1] != ';') continue;
							while (*p == ' ' || *p == '\t') p++;
							if (!strncmp(p, prop, plen) && p[plen] == ':') return true;
						}
						return false;
					};
					string ns = st ? string(st) + ";" : string();
					string extra;
					char buf[128];
					if (listbox)
					{
						if (!rows.empty())
						{
							// One block row per option/label: a selected row carries the
							// selection background across the full content width, the
							// way browsers paint it (the reference theme's selection
							// color, #CECECE). Rows inherit the select's pinned
							// line-height, so the geometry is the pre-text model's.
							for (size_t k = 0; k < rows.size(); k++)
							{
								auto row = create_element("div", -1);
								string rs = "display:block;white-space:pre;";
								if (k < row_selected.size() && row_selected[k]) rs += "background-color:rgb(206,206,206);";
								row->set_attr("style", rs.c_str());
								row->appendChild(std::make_shared<el_text>(rows[k].empty() ? " " : rows[k].c_str(), shared_from_this()));
								ret->appendChild(row);
							}
						}
						if (!style_has(st, "white-space")) extra += "white-space:pre;";
						if (!style_has(st, "padding")) extra += "padding:0 2px;";
						// The row line-height is pinned unconditionally: browsers ignore a
						// line-height set on the select itself for the control's geometry
						// (the rows keep the font's natural height), so an author value
						// must not win over the pin.
						{
							snprintf(buf, sizeof(buf), "line-height:%.4fem;", row_ratio + 0.15f);
							extra += buf;
						}
						if (!style_has(st, "width"))
						{
							snprintf(buf, sizeof(buf), "width:%.2fem;", widest + 0.45f);
							extra += buf;
						}
						if (!style_has(st, "height"))
						{
							snprintf(buf, sizeof(buf), "height:%.4fem;", (row_ratio + 0.15f) * display_rows + 0.15f);
							extra += buf;
						}
					}
					else
					{
						if (!label.empty()) ret->appendChild(std::make_shared<el_text>(label.c_str(), shared_from_this()));
						// Browsers size the closed control from the font alone; a line-height
						// set on the select must not inflate the label's line box.
						extra = "line-height:normal;";
						if (!style_has(st, "width"))
						{
							snprintf(buf, sizeof(buf), "width:%.2fem;", widest + 1.7f);
							extra += buf;
						}
					}
					if (!extra.empty()) ret->set_attr("style", (ns + extra).c_str());
				}
				elements.push_back(ret);
			}
		} else
		{
			for (unsigned int i = 0; i < node->v.element.children.length; i++)
			{
				create_node(static_cast<GumboNode*> (node->v.element.children.data[i]), elements, parseTextNode, true);
			}
		}
	}
	break;
	case GUMBO_NODE_TEXT:
	{
		if (!parseTextNode)
		{
			elements.push_back(std::make_shared<el_text>(node->v.text.text, shared_from_this()));
		}
		else
		{
			m_container->split_text(node->v.text.text,
				[this, &elements](const char* text) { elements.push_back(std::make_shared<el_text>(text, shared_from_this())); },
				[this, &elements](const char* text) { elements.push_back(std::make_shared<el_space>(text, shared_from_this())); });
		}
	}
	break;
	case GUMBO_NODE_CDATA:
	{
		element::ptr ret = std::make_shared<el_cdata>(shared_from_this());
		ret->set_data(node->v.text.text);
		elements.push_back(ret);
	}
	break;
	case GUMBO_NODE_COMMENT:
	{
		element::ptr ret = std::make_shared<el_comment>(shared_from_this());
		ret->set_data(node->v.text.text);
		elements.push_back(ret);
	}
	break;
	case GUMBO_NODE_WHITESPACE:
	{
		string str = node->v.text.text;
		for (size_t i = 0; i < str.length(); i++)
		{
			elements.push_back(std::make_shared<el_space>(str.substr(i, 1).c_str(), shared_from_this()));
		}
	}
	break;
	default:
		break;
	}
}

// A declarative shadow root is rendered as the host's children: the root's content replaces them, each
// <slot> is replaced by the light-DOM children assigned to it (its own children when none are), and the
// root's <style> text is scoped to the elements it produces (see shadow_css.h).
bool document::create_shadow_children(void* ghost, void* gshadow, const std::shared_ptr<element>& host, bool parseTextNode)
{
	auto* hostNode = static_cast<GumboNode*>(ghost);
	auto* shadow = static_cast<GumboNode*>(gshadow);
	const int id = ++m_shadow_counter;
	const string id_str = std::to_string(id);
	host->set_attr("data-satoru-host", id_str.c_str());

	std::vector<std::pair<string, elements_list>> lights;
	for (unsigned int i = 0; i < hostNode->v.element.children.length; i++)
	{
		auto* c = static_cast<GumboNode*>(hostNode->v.element.children.data[i]);
		if (c == shadow) continue;
		string slot_name;
		if (c->type == GUMBO_NODE_ELEMENT)
		{
			auto* a = gumbo_get_attribute(&c->v.element.attributes, "slot");
			if (a) slot_name = a->value;
		}
		elements_list made;
		create_node(c, made, parseTextNode, true);
		if (c->type == GUMBO_NODE_ELEMENT)
		{
			for (auto& e : made) e->set_attr("data-satoru-slotted", id_str.c_str());
		}
		lights.emplace_back(slot_name, std::move(made));
	}

	m_shadow_stack.push_back({ id, &lights });
	elements_list child;
	for (unsigned int i = 0; i < shadow->v.element.children.length; i++)
	{
		child.clear();
		create_node(static_cast<GumboNode*>(shadow->v.element.children.data[i]), child, parseTextNode, true);
		for (auto& el : child) host->appendChild(el);
	}
	m_shadow_stack.pop_back();
	return true;
}

void document::create_slot(void* gslot, elements_list& elements, bool parseTextNode)
{
	auto* node = static_cast<GumboNode*>(gslot);
	string name;
	if (auto* a = gumbo_get_attribute(&node->v.element.attributes, "name")) name = a->value;
	bool assigned = false;
	for (auto& l : *m_shadow_stack.back().lights)
	{
		if (l.first != name) continue;
		for (auto& e : l.second)
		{
			elements.push_back(e);
			assigned = true;
		}
		l.second.clear();
	}
	if (assigned) return;
	for (unsigned int i = 0; i < node->v.element.children.length; i++)
	{
		create_node(static_cast<GumboNode*>(node->v.element.children.data[i]), elements, parseTextNode, true);
	}
}

element::ptr document::create_element(const char* tag_name, const string_map& attributes)
{
	auto el = create_element(tag_name, -1);
	if (el)
	{
		for (const auto& attribute : attributes)
		{
			el->set_attr(attribute.first.c_str(), attribute.second.c_str());
		}
	}
	return el;
}

element::ptr document::create_element(const char* tag_name, int gumbo_tag, const string_map* attributes)
{
	element::ptr newTag;
	document::ptr this_doc = shared_from_this();
	if (m_container)
	{
		string_map empty_attrs;
		newTag = m_container->create_element(tag_name, attributes ? *attributes : empty_attrs, this_doc);
	}
	if (!newTag)
	{
		if (gumbo_tag != -1)
		{
			switch (gumbo_tag)
			{
			case GUMBO_TAG_BR:		newTag = std::make_shared<el_break>(this_doc);	break;
			case GUMBO_TAG_P:		newTag = std::make_shared<el_para>(this_doc);	break;
			case GUMBO_TAG_IMG:		newTag = std::make_shared<el_image>(this_doc);	break;
			case GUMBO_TAG_TABLE:	newTag = std::make_shared<el_table>(this_doc);	break;
			case GUMBO_TAG_TD:
			case GUMBO_TAG_TH:		newTag = std::make_shared<el_td>(this_doc);		break;
			case GUMBO_TAG_LINK:	newTag = std::make_shared<el_link>(this_doc);	break;
			case GUMBO_TAG_TITLE:	newTag = std::make_shared<el_title>(this_doc);	break;
			case GUMBO_TAG_A:		newTag = std::make_shared<el_anchor>(this_doc);	break;
			case GUMBO_TAG_TR:		newTag = std::make_shared<el_tr>(this_doc);		break;
			case GUMBO_TAG_STYLE:	newTag = std::make_shared<el_style>(this_doc);	break;
			case GUMBO_TAG_BASE:	newTag = std::make_shared<el_base>(this_doc);	break;
			case GUMBO_TAG_BODY:	newTag = std::make_shared<el_body>(this_doc);	break;
			case GUMBO_TAG_DIV:		newTag = std::make_shared<el_div>(this_doc);	break;
			case GUMBO_TAG_SCRIPT:	newTag = std::make_shared<el_script>(this_doc);	break;
			case GUMBO_TAG_FONT:	newTag = std::make_shared<el_font>(this_doc);	break;
			default:				newTag = std::make_shared<html_tag>(this_doc);	break;
			}
		}
		else
		{
			if (!strcmp(tag_name, "br"))
			{
				newTag = std::make_shared<el_break>(this_doc);
			}
			else if (!strcmp(tag_name, "p"))
			{
				newTag = std::make_shared<el_para>(this_doc);
			}
			else if (!strcmp(tag_name, "img"))
			{
				newTag = std::make_shared<el_image>(this_doc);
			}
			else if (!strcmp(tag_name, "table"))
			{
				newTag = std::make_shared<el_table>(this_doc);
			}
			else if (!strcmp(tag_name, "td") || !strcmp(tag_name, "th"))
			{
				newTag = std::make_shared<el_td>(this_doc);
			}
			else if (!strcmp(tag_name, "link"))
			{
				newTag = std::make_shared<el_link>(this_doc);
			}
			else if (!strcmp(tag_name, "title"))
			{
				newTag = std::make_shared<el_title>(this_doc);
			}
			else if (!strcmp(tag_name, "a"))
			{
				newTag = std::make_shared<el_anchor>(this_doc);
			}
			else if (!strcmp(tag_name, "tr"))
			{
				newTag = std::make_shared<el_tr>(this_doc);
			}
			else if (!strcmp(tag_name, "style"))
			{
				newTag = std::make_shared<el_style>(this_doc);
			}
			else if (!strcmp(tag_name, "base"))
			{
				newTag = std::make_shared<el_base>(this_doc);
			}
			else if (!strcmp(tag_name, "body"))
			{
				newTag = std::make_shared<el_body>(this_doc);
			}
			else if (!strcmp(tag_name, "div"))
			{
				newTag = std::make_shared<el_div>(this_doc);
			}
			else if (!strcmp(tag_name, "script"))
			{
				newTag = std::make_shared<el_script>(this_doc);
			}
			else if (!strcmp(tag_name, "font"))
			{
				newTag = std::make_shared<el_font>(this_doc);
			}
			else
			{
				newTag = std::make_shared<html_tag>(this_doc);
			}
		}
	}

	if (newTag)
	{
		newTag->set_tagName(tag_name);
	}

	return newTag;
}

uint_ptr document::add_font( const font_description& descr, font_metrics* fm )
{
	uint_ptr ret = 0;

	std::string key = descr.hash();

	if(m_fonts.find(key) == m_fonts.end())
	{
		font_item fi = {0, {}};

		fi.font = m_container->create_font(descr, this, &fi.metrics);
		m_fonts[key] = fi;
		ret = fi.font;
		if(fm)
		{
			*fm = fi.metrics;
		}
	}
	return ret;
}

uint_ptr document::get_font( const font_description& descr, font_metrics* fm )
{
	if(descr.size == 0)
	{
		return 0;
	}

	auto key = descr.hash();

	auto el = m_fonts.find(key);

	if(el != m_fonts.end())
	{
		if(fm)
		{
			*fm = el->second.metrics;
		}
		return el->second.font;
	}
	return add_font(descr, fm);
}

// A vertical writing-mode set on <body> also applies to the root element, as browsers do for
// the document's block flow, so the page anchors at the right edge in vertical-rl.
static void propagate_body_writing_mode(const element::ptr& root)
{
	if (!root || root->css().get_writing_mode() != writing_mode_horizontal_tb)
	{
		return;
	}
	for (const auto& child : root->children())
	{
		if (!strcmp(child->get_tagName(), "body") && child->css().get_writing_mode() != writing_mode_horizontal_tb)
		{
			root->css_w().set_writing_mode(child->css().get_writing_mode());
			return;
		}
	}
}

// In vertical-rl the block flow starts at the right edge, so a root that is narrower than the
// viewport sits flush right rather than at x = 0.
static void anchor_vertical_rl_root(const std::shared_ptr<render_item>& root, pixel_t viewport_width)
{
	const writing_mode mode = root->src_el()->css().get_writing_mode();
	if (mode != writing_mode_vertical_rl && mode != writing_mode_sideways_rl)
	{
		return;
	}
	pixel_t shift = viewport_width - root->width();
	if (shift > 0)
	{
		root->pos().x += shift;
	}
}

pixel_t document::render( pixel_t max_width, render_type rt )
{
	pixel_t ret = 0;
	if(m_root && m_root_render)
	{
		propagate_body_writing_mode(m_root);
		position viewport;
		m_container->get_viewport(viewport);
		containing_block_context cb_context;
		pixel_t root_place_x = 0;
        cb_context.mode = m_root_render->src_el()->css().get_writing_mode();

        if (cb_context.mode == writing_mode_horizontal_tb)
        {
		    cb_context.width = max_width;
		    cb_context.width.type = containing_block_context::cbc_value_type_absolute;
		    cb_context.height = viewport.height;
		    cb_context.height.type = containing_block_context::cbc_value_type_absolute;
	    // scrollbar-gutter: stable on the root reserves the scrollbar's width at the
	    // inline-end edge of the scrollport (both edges for stable both-edges), so
	    // the page is laid out narrower even though this renderer draws no
	    // scrollbar. Pages that ask for the reservation (e.g. MDN) are laid out by
	    // browsers at viewport-minus-gutter; without it every centered column is
	    // half a gutter off. 15px is the classic scrollbar width browsers reserve.
	    const int gutter = m_root->css().get_scrollbar_gutter();
	    if (gutter == scrollbar_gutter_stable || gutter == scrollbar_gutter_stable_both_edges)
	    {
		    const pixel_t scrollbar_width = 15;
		    cb_context.width.value -= scrollbar_width * (gutter == scrollbar_gutter_stable_both_edges ? 2 : 1);
		    // stable both-edges also reserves the inline-start edge: the whole page
		    // shifts by one gutter, not just narrows (browsers inset the scrollport
		    // on both sides).
		    if (gutter == scrollbar_gutter_stable_both_edges) root_place_x = scrollbar_width;
		    if (cb_context.width.value < 0) cb_context.width.value = 0;
	    }
        }
        else
        {
            // For vertical writing, the input max_width is mapped to physical height (inline-size)
            cb_context.height = max_width;
            cb_context.height.type = containing_block_context::cbc_value_type_absolute;
            cb_context.width = viewport.width;
            cb_context.width.type = containing_block_context::cbc_value_type_absolute;
            cb_context.size_mode |= containing_block_context::size_mode_content;
        }

		if(rt == render_fixed_only)
		{
			m_fixed_boxes.clear();
			m_root_render->render_positioned(rt);
		} else
		{
			reset_measure_budget(); ret = m_root_render->measure(cb_context, nullptr); m_root_render->place(root_place_x, 0, cb_context, nullptr); anchor_vertical_rl_root(m_root_render, viewport.width);
			
			// Container Queries support: 
			// After the first layout, container sizes are known.
			// We trigger a style refresh and a second layout pass.
			bool has_cq = m_master_css.has_container_queries() || m_styles.has_container_queries() || m_user_css.has_container_queries();
			// (tables once forced this second pass too; with it removed 1,084 visual tests and the table pages compared box by box come out the same)
			if (has_cq) {
			m_root->refresh_styles();
			m_root->compute_styles();
			propagate_body_writing_mode(m_root);

			// Rebuild rendering tree because structure might have changed (e.g. pseudo-elements)
			drop_render_links();
			m_root_render = m_root->create_render_item(nullptr);
			fix_tables_layout();
			if (m_root_render)
			{
				m_root_render = m_root_render->init();
			}
			
			// Second pass
			reset_measure_budget(); ret = m_root_render->measure(cb_context, nullptr); m_root_render->place(root_place_x, 0, cb_context, nullptr); anchor_vertical_rl_root(m_root_render, viewport.width);
			}

			// text-fit: scale the font of elements whose widest line misses the available width,
			// re-laying the document out until it converges (bounded).
			for (int pass = 0; pass < 3; pass++)
			{
				bool changed = false;
				std::function<void(const element::ptr&)> fit = [&](const element::ptr& el)
				{
					int tf = el->css().get_text_fit();
					if (tf != 0 && el->text_fit_natural() > 0 && el->text_fit_avail() > 0)
					{
						float ratio = (float)(el->text_fit_avail() / el->text_fit_natural());
						float cur = el->text_fit_scale();
						float want = cur;
						if (ratio < 0.999f && (tf & 2)) want = cur * ratio;
						else if (ratio > 1.001f && (tf & 1)) want = cur * ratio;
						int limit = tf >> 2;
						if (limit > 0)
						{
							if (want < cur) want = std::max(want, limit / 100.0f);
							else if (want > cur) want = std::min(want, limit / 100.0f);
						}
						if (std::fabs(want - cur) > 0.005f * cur)
						{
							el->set_text_fit_scale(want);
							changed = true;
						}
					}
					for (const auto& child : el->children()) fit(child);
				};
				fit(m_root);
				if (!changed) break;
				m_root->compute_styles();
				drop_render_links();
				m_root_render = m_root->create_render_item(nullptr);
				fix_tables_layout();
				if (m_root_render) m_root_render = m_root_render->init();
				reset_measure_budget(); ret = m_root_render->measure(cb_context, nullptr); m_root_render->place(root_place_x, 0, cb_context, nullptr); anchor_vertical_rl_root(m_root_render, viewport.width);
			}

			if(m_root_render->fetch_positioned())
			{
				m_fixed_boxes.clear();
				m_root_render->render_positioned(rt);
			}
			m_size.width	= 0;
			m_size.height	= 0;
			m_root_render->calc_document_size(m_size);
		}
	}
	return ret;
}

void document::draw( uint_ptr hdc, pixel_t x, pixel_t y, const position* clip )
{
	if(m_root && m_root_render)
	{
		float opacity = m_root->css().get_opacity();
		blend_mode mix_blend = m_root->css().get_mix_blend_mode();
		if (opacity < 1.0f || mix_blend != blend_mode_normal) m_container->push_layer(hdc, opacity, mix_blend);

		m_root->draw(hdc, x, y, clip, m_root_render);
		m_root_render->draw_stacking_context(hdc, x, y, clip, true);

		if (opacity < 1.0f) m_container->pop_layer(hdc);
	}
}

pixel_t document::to_pixels( const css_length& val, const font_metrics& metrics, pixel_t size ) const
{
	if(val.is_predefined())
	{
		return 0;
	}
	if (val.is_calc())
	{
		// calc() keeps its em/rem components symbolic; they resolve against
		// the font metrics the caller supplies (the owning element's size,
		// the parent's for font-size itself) and the root font size.
		pixel_t rem_base = metrics.font_size;
		if (m_root && m_root->css().get_font_size() > 0)
		{
			rem_base = m_root->css().get_font_size();
		}
		return val.calc_percent(size, (pixel_t)metrics.font_size, rem_base);
	}
	pixel_t ret;
	switch(val.units())
	{
	case css_units_percentage:
		ret = val.calc_percent(size);
		break;
	case css_units_em:
		ret = val.val() * metrics.font_size;
		break;

	// https://drafts.csswg.org/css-values-4/#absolute-lengths
	case css_units_pt:
		ret = m_container->pt_to_px(val.val());
		break;
	case css_units_in:
		ret = m_container->pt_to_px(val.val() * 72); // 1in = 72pt
		break;
	case css_units_pc:
		ret = m_container->pt_to_px(val.val() * 12); // 1pc = (1/6)in = 12pt
		break;
	case css_units_cm:
		ret = m_container->pt_to_px(val.val() * 72 / 2.54f); // 1cm = (1/2.54)in = (72/2.54)pt
		break;
	case css_units_mm:
		ret = m_container->pt_to_px(val.val() * 72 / 2.54f / 10);
		break;

	case css_units_vw:
		ret = (pixel_t) (m_media.width * val.val() / 100.0);
		break;
	case css_units_vh:
		ret = (pixel_t) (m_media.height * val.val() / 100.0);
		break;
	case css_units_vmin:
		ret = (pixel_t) (std::min(m_media.height, m_media.width) * val.val() / 100.0);
		break;
	case css_units_vmax:
		ret = (pixel_t) (std::max(m_media.height, m_media.width) * val.val() / 100.0);
		break;
	case css_units_rem:
		if (m_root && m_root->css().get_font_size() > 0)
			ret = (pixel_t) (m_root->css().get_font_size() * val.val());
		else
			ret = (pixel_t) (metrics.font_size * val.val());
		break;
	case css_units_ex:
		ret = (pixel_t) (metrics.x_height * val.val());
		break;
	case css_units_ch:
		ret = (pixel_t) (metrics.ch_width * val.val());
		break;
	case css_units_lh:
		// The element's own computed line-height, carried in its font metrics;
		// 'normal' (the font's natural height) when it was never set.
		ret = (pixel_t) ((metrics.line_height > 0 ? metrics.line_height : metrics.height) * val.val());
		break;
	case css_units_rlh:
		if (m_root && m_root->css().line_height().computed_value > 0)
			ret = (pixel_t) (m_root->css().line_height().computed_value * val.val());
		else
			ret = (pixel_t) (metrics.height * val.val());
		break;
	default:
		ret = (pixel_t) val.val();
		break;
	}
	return ret;
}

void document::cvt_units( css_length& val, const font_metrics& metrics, pixel_t size ) const
{
	if(val.is_predefined())
	{
		return;
	}
	if(val.is_calc())
	{
		pixel_t rem_base = metrics.font_size;
		if (m_root && m_root->css().get_font_size() > 0)
		{
			rem_base = m_root->css().get_font_size();
		}
		val.resolve_font_units((pixel_t)metrics.font_size, rem_base);
	}
	if(val.units() != css_units_percentage && val.units() != css_units_fr)
	{
		val.set_value((float)to_pixels(val, metrics, size), css_units_px);
	}
}

void document::cvt_units( css_length& val, const font_metrics& metrics, pixel_t size, pixel_t percent_base ) const
{
	if(val.is_predefined())
	{
		return;
	}
	if(val.is_calc())
	{
		pixel_t rem_base = metrics.font_size;
		if (m_root && m_root->css().get_font_size() > 0)
		{
			rem_base = m_root->css().get_font_size();
		}
		val.resolve_font_units((pixel_t)metrics.font_size, rem_base);
	}
	if(val.units() == css_units_percentage)
	{
		// The reference of a percentage is property specific, so it is given
		// by the caller (the font size for the text decoration properties).
		val.set_value(val.val() * (float)percent_base / 100.0f, css_units_px);
		return;
	}
	if(val.units() != css_units_fr)
	{
		val.set_value((float)to_pixels(val, metrics, size), css_units_px);
	}
}

pixel_t document::width() const
{
	return m_size.width;
}

pixel_t document::height() const
{
	return m_size.height;
}

void document::add_stylesheet( const char* str, const char* baseurl, const char* media )
{
	if(str && str[0])
	{
		m_css.emplace_back(str, baseurl, media);
	}
}

bool document::on_mouse_over( pixel_t x, pixel_t y, pixel_t client_x, pixel_t client_y, position::vector& redraw_boxes )
{
	if(!m_root || !m_root_render)
	{
		return false;
	}

	element::ptr over_el   = m_root_render->get_element_by_point(x, y, client_x, client_y, nullptr);

	bool state_was_changed = false;

	if(over_el != m_over_element)
	{
		if(m_over_element)
		{
			if(m_over_element->on_mouse_leave())
			{
				m_container->on_mouse_event(m_over_element, mouse_event_leave);
				state_was_changed = true;
			}
		}
		m_over_element = over_el;
	}

	string cursor;

	if(m_over_element)
	{
		if(m_over_element->on_mouse_over())
		{
			state_was_changed = true;
		}
		cursor = m_over_element->css().get_cursor();
	}

	m_container->set_cursor(cursor.c_str());

	if(state_was_changed)
	{
		m_container->on_mouse_event(m_over_element, mouse_event_enter);
		return m_root->find_styles_changes(redraw_boxes);
	}
	return false;
}

std::vector<scroll_values> document::on_scroll(pixel_t dx, pixel_t dy, pixel_t x, pixel_t y, pixel_t client_x, pixel_t client_y) const
{
	if(dy == 0 && dx == 0)
		return {};

	element::ptr vscroll_el;
	element::ptr hscroll_el;

	if(dy != 0.f)
	{
		vscroll_el = m_root_render->get_element_by_point(
			x, y, client_x, client_y,
			[dy](const shared_ptr<render_item>& el) -> bool { return el->is_v_scrollable(dy); });
	}

	if(dx != 0.f)
	{
		hscroll_el = m_root_render->get_element_by_point(
			x, y, client_x, client_y,
			[dx](const shared_ptr<render_item>& el) -> bool { return el->is_h_scrollable(dx); });
	}

	if(!vscroll_el && !hscroll_el)
		return {};

	if(vscroll_el == hscroll_el)
	{
		scroll_values sv;
		sv.dx = hscroll_el->h_scroll(dx);
		sv.dy = vscroll_el->v_scroll(dy);
		sv.scroll_box = hscroll_el->get_placement();
		return {sv};
	}

	std::vector<scroll_values> ret;
	ret.reserve(2);

	if(vscroll_el)
	{
		scroll_values sv;
		sv.dy = vscroll_el->v_scroll(dy);
		sv.scroll_box = vscroll_el->get_placement();
		ret.push_back(sv);
	}

	if(hscroll_el)
	{
		scroll_values sv;
		sv.dx = hscroll_el->h_scroll(dx);
		sv.scroll_box = vscroll_el->get_placement();
		ret.push_back(sv);
	}

	return ret;
}

bool document::on_mouse_leave( position::vector& redraw_boxes )
{
	if(!m_root || !m_root_render)
	{
		return false;
	}
	if(m_over_element)
	{
		auto el = m_over_element;
		m_over_element = nullptr;
		if(el->on_mouse_leave())
		{
			m_container->on_mouse_event(el, mouse_event_leave);
			return m_root->find_styles_changes(redraw_boxes);
		}
	}
	return false;
}

bool document::on_lbutton_down( pixel_t x, pixel_t y, pixel_t client_x, pixel_t client_y, position::vector& redraw_boxes )
{
	if(!m_root || !m_root_render)
	{
		return false;
	}

	element::ptr over_el = m_root_render->get_element_by_point(x, y, client_x, client_y, nullptr);
    m_active_element = over_el;

	bool state_was_changed = false;

	if(over_el != m_over_element)
	{
		if(m_over_element)
		{
			if(m_over_element->on_mouse_leave())
			{
				m_container->on_mouse_event(m_over_element, mouse_event_leave);
				state_was_changed = true;
			}
		}
		m_over_element = over_el;
		if(m_over_element)
		{
			if(m_over_element->on_mouse_over())
			{
				state_was_changed = true;
			}
		}
	}

	string cursor;

	if(m_over_element)
	{
		if(m_over_element->on_lbutton_down())
		{
			state_was_changed = true;
		}
		cursor = m_over_element->css().get_cursor();
	}

	m_container->set_cursor(cursor.c_str());

	if(state_was_changed)
	{
		m_container->on_mouse_event(m_over_element, mouse_event_enter);
		return m_root->find_styles_changes(redraw_boxes);
	}

	return false;
}

bool document::on_lbutton_up( pixel_t /*x*/, pixel_t /*y*/, pixel_t /*client_x*/, pixel_t /*client_y*/, position::vector& redraw_boxes )
{
	if(!m_root || !m_root_render)
	{
		return false;
	}
	if(m_over_element)
	{
		if(m_over_element->on_lbutton_up(m_active_element == m_over_element))
		{
			return m_root->find_styles_changes(redraw_boxes);
		}
	}
	return false;
}

bool document::on_button_cancel(position::vector& redraw_boxes) {
	m_active_element = nullptr;
	return on_mouse_leave(redraw_boxes);
}

void document::get_fixed_boxes( position::vector& fixed_boxes )
{
	fixed_boxes = m_fixed_boxes;
}

void document::add_fixed_box( const position& pos )
{
	m_fixed_boxes.push_back(pos);
}

bool document::media_changed()
{
	container()->get_media_features(m_media);
	css_length::set_viewport((float) m_media.width, (float) m_media.height);
	if (update_media_lists(m_media))
	{
		m_root->refresh_styles();
		m_root->compute_styles();
		return true;
	}
	return false;
}

bool document::lang_changed()
{
	if (!m_media_lists.empty())
	{
		string culture;
		container()->get_language(m_lang, culture);
		if (!culture.empty())
		{
			m_culture = m_lang + '-' + culture;
		}
		else
		{
			m_culture.clear();
		}
		m_root->refresh_styles();
		m_root->compute_styles();
		return true;
	}
	return false;
}

// Apply media features (determine which selectors are active).
bool document::update_media_lists(const media_features& features)
{
	bool update_styles = false;
	for (auto& media_list : m_media_lists)
	{
		if (media_list->apply_media_features(features))
		{
			update_styles = true;
		}
	}
	return update_styles;
}

void document::add_media_list(media_query_list_list::ptr list)
{
	if (list && !contains(m_media_lists, list))
		m_media_lists.push_back(list);
}

void document::fix_tables_layout()
{
	for (const auto& el_ptr : m_tabular_elements)
	{
		switch (el_ptr->src_el()->css().get_display())
		{
		case display_inline_table:
		case display_table:
			fix_table_children(el_ptr, display_table_row_group, "table-row-group");
			break;
		case display_table_footer_group:
		case display_table_row_group:
		case display_table_header_group:
			{
				auto parent = el_ptr->parent();
				if (parent)
				{
					if (parent->src_el()->css().get_display() != display_inline_table)
						fix_table_parent(el_ptr, display_table, "table");
				}
				fix_table_children(el_ptr, display_table_row, "table-row");
			}
			break;
		case display_table_row:
			{
				// A row directly inside a header / footer group is already in a valid parent.
				auto parent = el_ptr->parent();
				style_display parent_disp = parent ? parent->src_el()->css().get_display() : display_none;
				if (parent_disp != display_table_header_group && parent_disp != display_table_footer_group)
					fix_table_parent(el_ptr, display_table_row_group, "table-row-group");
			}
			fix_table_children(el_ptr, display_table_cell, "table-cell");
			break;
		case display_table_cell:
			fix_table_parent(el_ptr, display_table_row, "table-row");
			break;
		// table-caption / table-column / table-column-group need no restructuring: they are valid
		// direct children of a table and render_item_table lays them out / paints them itself.
		case display_table_caption:
		case display_table_column:
		case display_table_column_group:
		default:
			break;
		}
	}
}

void document::fix_table_children(const std::shared_ptr<render_item>& el_ptr, style_display disp, const char* disp_str)
{
	std::list<std::shared_ptr<render_item>> tmp;
	auto first_iter = el_ptr->children().begin();
	auto cur_iter = el_ptr->children().begin();

	auto flush_elements = [&]()
	{
		element::ptr annon_tag = std::make_shared<el_anonymous>(shared_from_this(), disp);
			annon_tag->parent(el_ptr->src_el());
			annon_tag->compute_styles(false);
		std::shared_ptr<render_item> annon_ri;
		if(annon_tag->css().get_display() == display_table_cell)
		{
			annon_tag->set_tagName("table_cell");
			annon_ri = std::make_shared<render_item_block>(annon_tag);
		} else if(annon_tag->css().get_display() == display_table_row)
		{
			annon_ri = std::make_shared<render_item_table_row>(annon_tag);
		} else
		{
			annon_ri = std::make_shared<render_item_table_part>(annon_tag);
		}
		for(const auto& el : tmp)
		{
			annon_ri->add_child(el);
		}
		// add annon item as tabular for future processing
		add_tabular(annon_ri);
		annon_ri->parent(el_ptr);
		first_iter = el_ptr->children().insert(first_iter, annon_ri);
		cur_iter = std::next(first_iter);
		while (cur_iter != el_ptr->children().end() && (*cur_iter)->parent() != el_ptr)
		{
			cur_iter = el_ptr->children().erase(cur_iter);
		}
		first_iter = cur_iter;
		tmp.clear();
	};

	while (cur_iter != el_ptr->children().end())
	{
		if ((*cur_iter)->src_el()->css().get_display() != disp)
		{
			if (!(*cur_iter)->src_el()->is_table_skip() || ((*cur_iter)->src_el()->is_table_skip() && !tmp.empty()))
			{
				// Direct children of a table that are already valid table parts must not be wrapped
				// in an anonymous row group (captions, columns and header/footer row groups).
				if (disp != display_table_row_group || 
					((*cur_iter)->src_el()->css().get_display() != display_table_caption &&
					 (*cur_iter)->src_el()->css().get_display() != display_table_column &&
					 (*cur_iter)->src_el()->css().get_display() != display_table_column_group &&
					 (*cur_iter)->src_el()->css().get_display() != display_table_header_group &&
					 (*cur_iter)->src_el()->css().get_display() != display_table_footer_group))
				{
					if (tmp.empty())
					{
						first_iter = cur_iter;
					}
					tmp.push_back((*cur_iter));
				}
			}
			cur_iter++;
		}
		else if (!tmp.empty())
		{
			flush_elements();
		}
		else
		{
			cur_iter++;
		}
	}
	if (!tmp.empty())
	{
		flush_elements();
	}
}

void document::fix_table_parent(const std::shared_ptr<render_item>& el_ptr, style_display disp, const char* disp_str)
{
	auto parent = el_ptr->parent();

	if (parent->src_el()->css().get_display() != disp)
	{
		auto this_element = std::find_if(parent->children().begin(), parent->children().end(),
			[&](const std::shared_ptr<render_item>& el)
			{
				if (el == el_ptr)
				{
					return true;
				}
				return false;
			}
		);
		if (this_element != parent->children().end())
		{
			style_display el_disp = el_ptr->src_el()->css().get_display();
			auto first = this_element;
			auto last = this_element;
			auto cur = this_element;

			// find first element with same display
			while (true)
			{
				if (cur == parent->children().begin()) break;
				cur--;
				if ((*cur)->src_el()->is_table_skip() || (*cur)->src_el()->css().get_display() == el_disp)
				{
					first = cur;
				}
				else
				{
					break;
				}
			}

			// find last element with same display
			cur = this_element;
			while (true)
			{
				cur++;
				if (cur == parent->children().end()) break;

				if ((*cur)->src_el()->is_table_skip() || (*cur)->src_el()->css().get_display() == el_disp)
				{
					last = cur;
				}
				else
				{
					break;
				}
			}

			// extract elements with the same display and wrap them with anonymous object
			element::ptr annon_tag = std::make_shared<el_anonymous>(shared_from_this(), disp);
			annon_tag->parent(parent->src_el());
			annon_tag->compute_styles(false);
			std::shared_ptr<render_item> annon_ri;
			if(annon_tag->css().get_display() == display_table || annon_tag->css().get_display() == display_inline_table)
			{
				annon_ri = std::make_shared<render_item_table>(annon_tag);
			} else if(annon_tag->css().get_display() == display_table_row)
			{
				annon_ri = std::make_shared<render_item_table_row>(annon_tag);
			} else
			{
				annon_ri = std::make_shared<render_item_table_part>(annon_tag);
			}
			std::for_each(first, std::next(last, 1),
				[&annon_ri](std::shared_ptr<render_item>& el)
				{
					annon_ri->add_child(el);
				}
			);
			first = parent->children().erase(first, std::next(last));
			parent->children().insert(first, annon_ri);
			add_tabular(annon_ri);
			annon_ri->parent(parent);
		}
	}
}

void document::append_children_from_string(element& parent, const char* str, bool replace_existing)
{
	// parent must belong to this document
	if (parent.get_document().get() != this)
	{
		return;
	}

	GumboOptions opts = kGumboDefaultOptions;
	// This is require to prevent creating html, head, body tags around the fragment
	// Although Gumbo always creates html tag anyway. We have to ignore it in create_node.
	opts.fragment_context = GUMBO_TAG_BODY;
	// parse document into GumboOutput
	GumboOutput* output = gumbo_parse_with_options(&opts, str, strlen(str));

	// Create litehtml::elements.
	elements_list child_elements;
	// Create elements excluding the root node
	create_node(output->root, child_elements, true, false);

	// Destroy GumboOutput
	gumbo_destroy_output(&kGumboDefaultOptions, output);

	auto parent_render = parent.get_render_item();

	if (replace_existing)
	{
		parent.clearRecursive();
		parent_render->children().clear();
	}

	// Let's process created elements tree
	for (const auto& child : child_elements)
	{
		// Add the child element to parent
		parent.appendChild(child);

		// apply master CSS
		child->apply_stylesheet(m_master_css);

		// parse elements attributes
		child->parse_attributes();

		// Apply parsed styles.
		child->apply_stylesheet(m_styles);

		// Apply user styles if any
		child->apply_stylesheet(m_user_css);

		// Initialize m_css
		child->compute_styles();

		// Apply word-break splitting
		child->apply_word_break();

		// Finally initialize elements
		if(parent_render)
		{
			auto child_render = child->create_render_item(parent_render);
			if (child_render)
			{
				child_render = child_render->init();
				parent_render->add_child(child_render);
			}
		}
	}
	// Now the m_tabular_elements is filled with tabular elements.
	// We have to check the tabular elements for missing table elements
	// and create the anonymous boxes in visual table layout
	fix_tables_layout();
}

// The render items of the tree about to be replaced: every element lists them as weak pointers, and a weak pointer keeps the
// storage of an item made by make_shared alive after the item is gone. A tree built again and again (live layout, container
// queries, tables) would otherwise keep every old one.
void document::drop_render_links()
{
	std::function<void(const element::ptr&)> drop = [&](const element::ptr& el)
	{
		el->m_renders.clear();
		for (const auto& c : el->m_children) drop(c);
	};
	if (m_root) drop(m_root);
	m_root_render.reset();
}

bool document::live_set_attr(const std::shared_ptr<element>& el, const char* name, const char* value)
{
	if (!el || !name || el->get_document().get() != this) return false;
	auto* tag = dynamic_cast<html_tag*>(el.get());
	if (!tag) return false;
	if (value) tag->set_attr(name, value);
	else tag->remove_attr(name);
	return true;
}

bool document::live_parse_fragment(const char* html, std::vector<std::shared_ptr<element>>& out)
{
	if (!html) return false;
	GumboOptions opts = kGumboDefaultOptions;
	opts.fragment_context = GUMBO_TAG_BODY;
	GumboOutput* output = gumbo_parse_with_options(&opts, html, strlen(html));
	elements_list parsed;
	create_node(output->root, parsed, true, false);
	gumbo_destroy_output(&kGumboDefaultOptions, output);
	for (const auto& e : parsed) out.push_back(e);
	return true;
}

std::vector<std::shared_ptr<element>> document::live_set_children(const std::shared_ptr<element>& parent,
	const std::vector<std::shared_ptr<element>>& list, const std::vector<std::shared_ptr<element>>& fresh)
{
	std::vector<element::ptr> restyle;
	if (!parent) return restyle;
	std::unordered_set<const element*> keep;
	for (const auto& e : list) keep.insert(e.get());
	std::unordered_set<const element*> fresh_set;
	for (const auto& e : fresh) fresh_set.insert(e.get());
	// the ones that stay in place: only a position-dependent selector can restyle them
	std::vector<element::ptr> stay;
	for (const auto& e : list)
		if (e->parent() == parent && !fresh_set.count(e.get())) stay.push_back(e);
	std::vector<element::ptr> old(parent->m_children.begin(), parent->m_children.end());
	for (const auto& e : old)
		if (!keep.count(e.get())) e->parent(nullptr);
	parent->m_children.clear();
	for (const auto& e : list)
	{
		element::ptr from = e->parent();
		if (from && from != parent) from->removeChild(e);
		e->parent(nullptr);
		parent->appendChild(e);
		if (fresh_set.count(e.get()) || !(from == parent)) restyle.push_back(e); // new, or moved in from elsewhere
	}
	for (const auto& e : fresh) m_live_new.push_back(e);
	const bool siblings = m_master_css.sibling_sensitive() || m_styles.sibling_sensitive() || m_user_css.sibling_sensitive();
	const bool structural = m_master_css.structural_sensitive() || m_styles.structural_sensitive() || m_user_css.structural_sensitive();
	if (siblings)
	{
		restyle.clear();
		restyle.push_back(parent->parent() ? parent->parent() : parent);
	}
	else if (structural)
	{
		// Positions counted from the start only change for the new elements and the siblings after the first change; counted from
		// the end (or :empty), or with many siblings behind it, the whole parent is restyled.
		const bool backward = m_master_css.backward_sensitive() || m_styles.backward_sensitive() || m_user_css.backward_sensitive();
		size_t first = 0;
		while (!backward && first < old.size() && first < list.size() && old[first] == list[first]) first++;
		const size_t behind = list.size() > first ? list.size() - first : 0;
		if (backward || behind > 48)
		{
			restyle.clear();
			restyle.push_back(parent);
		}
		else
		{
			std::unordered_set<const element*> have;
			for (const auto& e : restyle) have.insert(e.get());
			for (size_t i = first; i < list.size(); i++)
				if (!have.count(list[i].get())) restyle.push_back(list[i]);
		}
	}
	return restyle;
}

namespace
{
	// Properties whose value never moves a box: a change to only these needs no new layout.
	bool paint_only_property(string_id name)
	{
		switch (name)
		{
		case _color_: case _background_color_: case _opacity_: case _cursor_:
		case _border_color_: case _border_top_color_: case _border_right_color_: case _border_bottom_color_: case _border_left_color_:
		case _outline_color_: case _text_decoration_color_: case _text_emphasis_color_: case _column_rule_color_:
		case __webkit_text_fill_color_: case __webkit_text_stroke_color_:
			return true;
		default:
			return false;
		}
	}

	// Are two cascaded values the same? Only the kinds that are cheap to compare exactly say yes; the rest say no (-> layout).
	bool same_value(const property_value& a, const property_value& b)
	{
		if (a.index() != b.index() || a.m_has_var || b.m_has_var) return false;
		if (a.is<invalid>() || a.is<inherit>() || a.is<initial>() || a.is<unset>()) return true;
		if (a.is<int>()) return a.get<int>() == b.get<int>();
		if (a.is<float>()) return a.get<float>() == b.get<float>();
		if (a.is<web_color>()) return a.get<web_color>() == b.get<web_color>();
		if (a.is<string>()) return a.get<string>() == b.get<string>();
		if (a.is<css_length>()) return a.get<css_length>().to_string() == b.get<css_length>().to_string();
		return false;
	}

	struct style_snapshot
	{
		std::shared_ptr<element> el;
		props_map props;
	};

	// The cascaded styles of a subtree, if it is small enough to be worth comparing.
	bool snapshot_subtree(const std::shared_ptr<element>& el, std::vector<style_snapshot>& out, size_t limit)
	{
		auto tag = std::dynamic_pointer_cast<html_tag>(el);
		if (tag)
		{
			if (out.size() >= limit) return false;
			out.push_back({el, tag->cascaded_style().properties()});
		}
		for (const auto& c : el->children())
			if (!snapshot_subtree(c, out, limit)) return false;
		return true;
	}

	// Did the restyle change nothing but paint-only properties?
	bool only_paint_changed(const std::vector<style_snapshot>& before, const std::vector<std::shared_ptr<element>>& scopes)
	{
		std::vector<style_snapshot> after;
		for (const auto& s : scopes)
			if (!snapshot_subtree(s, after, before.size())) return false;
		if (after.size() != before.size()) return false;
		for (size_t i = 0; i < before.size(); i++)
		{
			if (before[i].el != after[i].el) return false;
			const props_map& x = before[i].props;
			const props_map& y = after[i].props;
			std::vector<bool> matched(y.size(), false);
			for (const auto& px : x)
			{
				bool found = false;
				for (size_t k = 0; k < y.size(); k++)
				{
					if (matched[k] || y[k].first != px.first) continue;
					matched[k] = true;
					found = true;
					if (!same_value(px.second, y[k].second) && !paint_only_property(px.first)) return false;
					break;
				}
				if (!found && !paint_only_property(px.first)) return false;
			}
			for (size_t k = 0; k < y.size(); k++)
				if (!matched[k] && !paint_only_property(y[k].first)) return false;
		}
		return true;
	}
}

document::live_timing document::live_relayout(const std::vector<std::shared_ptr<element>>& changed, const std::vector<std::shared_ptr<element>>& extra, pixel_t max_width, bool attrs_only)
{
	live_timing t;
	if (!m_root) return t;
	auto now = []() { return std::chrono::steady_clock::now(); };
	auto ms = [](std::chrono::steady_clock::time_point a, std::chrono::steady_clock::time_point b)
	{
		return std::chrono::duration<double, std::milli>(b - a).count();
	};
	auto t0 = now();
	// What a change can reach: the element and its descendants (descendant / child selectors, inheritance); with a selector
	// that looks at siblings or descendants (+ ~ :has) the whole parent, since a sibling or an ancestor may change too.
	const bool wide = m_master_css.sibling_sensitive() || m_styles.sibling_sensitive() || m_user_css.sibling_sensitive();
	std::vector<element::ptr> scopes;
	std::vector<element::ptr> wanted;
	for (const auto& el : changed) wanted.push_back(wide && el->parent() ? el->parent() : el);
	for (const auto& el : extra) wanted.push_back(el);
	for (const auto& s : wanted)
	{
		bool covered = false;
		for (const auto& other : scopes)
			for (element::ptr a = s; a; a = a->parent())
				if (a == other) { covered = true; break; }
		if (covered) continue;
		// drop scopes this one covers
		scopes.erase(std::remove_if(scopes.begin(), scopes.end(), [&](const element::ptr& o)
		{
			for (element::ptr a = o; a; a = a->parent()) if (a == s) return true;
			return false;
		}), scopes.end());
		scopes.push_back(s);
	}
	std::function<void(const element::ptr&)> clear = [&](const element::ptr& el)
	{
		el->m_used_styles.clear();
		el->reset_style();
		for (const auto& c : el->m_children) clear(c);
	};
	// An attribute change that only touches a small subtree may move nothing: keep the cascade of it to compare.
	std::vector<style_snapshot> before;
	bool compare = attrs_only && extra.empty() && !scopes.empty() && m_root_render;
	if (compare)
		for (const auto& s : scopes)
			if (!snapshot_subtree(s, before, 400)) { compare = false; break; }
	for (const auto& s : scopes) clear(s);
	auto t1 = now();
	for (const auto& s : scopes)
	{
		s->apply_stylesheet(m_master_css);
		s->parse_attributes();
		s->apply_stylesheet(m_styles);
		s->apply_stylesheet(m_user_css);
	}
	auto t2 = now();
	for (const auto& s : scopes) s->compute_styles();
	for (const auto& c : m_live_new) c->apply_word_break();
	m_live_new.clear();
	auto t3 = now();
	if (compare && only_paint_changed(before, scopes))
	{
		// the boxes are where they were: the render tree and the layout stay as they are
		t.clear = ms(t0, t1); t.apply = ms(t1, t2); t.compute = ms(t2, t3);
		t.paint_only = true;
		return t;
	}
	m_tabular_elements.clear();
	drop_render_links();
	m_root_render = m_root->create_render_item(nullptr);
	fix_tables_layout();
	if (m_root_render) m_root_render = m_root_render->init();
	auto t4 = now();
	render(max_width);
	auto t5 = now();
	t.clear = ms(t0, t1); t.apply = ms(t1, t2); t.compute = ms(t2, t3); t.tree = ms(t3, t4); t.layout = ms(t4, t5);
	return t;
}

document::live_timing document::live_probe(pixel_t max_width, int mode)
{
	live_timing t;
	if (!m_root) return t;
	auto now = []() { return std::chrono::steady_clock::now(); };
	auto ms = [](std::chrono::steady_clock::time_point a, std::chrono::steady_clock::time_point b)
	{
		return std::chrono::duration<double, std::milli>(b - a).count();
	};
	auto t0 = now();
	if (mode == 0)
	{
		std::function<void(const element::ptr&)> clear = [&](const element::ptr& el)
		{
			el->m_used_styles.clear();
			el->reset_style();
			for (const auto& c : el->m_children) clear(c);
		};
		clear(m_root);
	}
	auto t1 = now();
	if (mode == 0)
	{
		m_root->apply_stylesheet(m_master_css);
		m_root->parse_attributes();
		m_root->apply_stylesheet(m_styles);
		m_root->apply_stylesheet(m_user_css);
	}
	else
	{
		m_root->refresh_styles();
	}
	auto t2 = now();
	m_root->compute_styles();
	auto t3 = now();
	m_tabular_elements.clear();
	drop_render_links();
	m_root_render = m_root->create_render_item(nullptr);
	fix_tables_layout();
	if (m_root_render) m_root_render = m_root_render->init();
	auto t4 = now();
	render(max_width);
	auto t5 = now();
	t.clear = ms(t0, t1); t.apply = ms(t1, t2); t.compute = ms(t2, t3); t.tree = ms(t3, t4); t.layout = ms(t4, t5);
	return t;
}

void document::dump(dumper& cout)
{
	if(m_root_render)
	{
		m_root_render->dump(cout);
	}
}

} // namespace litehtml
