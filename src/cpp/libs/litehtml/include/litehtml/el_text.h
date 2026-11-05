#ifndef LH_EL_TEXT_H
#define LH_EL_TEXT_H

#include "element.h"
#include "document.h"

namespace litehtml
{
	// Fills the style of the text inside `parent` (see el_text.cpp).
	void build_text_css(css_properties& out, const element::ptr& parent);

	class el_text : public element
	{
	protected:
		string			m_text;
		std::shared_ptr<css_properties> m_text_css; // the style shared with the other text of the parent
		string			m_transformed_text;
		size			m_size;
		bool			m_use_transformed;
		bool			m_draw_spaces;
		bool			m_ends_shy = false;       // the word ends with a soft hyphen (U+00AD)
		bool			m_hyphen_visible = false; // the hyphen is shown (the word ends a line)
		string			m_shy_stripped;           // displayed text without soft hyphens
		// `overflow-wrap: break-word` / `word-break: break-word` split a word into
		// one run per character so the line breaker may split it. All characters of
		// a word share this flag; the first one also keeps the runs so the width of
		// the whole word can be measured while it still fits a line by itself.
		bool			m_word_break_part = false;
		bool			m_word_break_start = false;
		std::vector<std::shared_ptr<el_text>> m_word_break_chars;
	public:
		el_text(const char* text, const document::ptr& doc);

		void				get_text(string& text) const override;
		const string&		text() const { return m_use_transformed ? m_transformed_text : m_text; }
		void				set_text(const char* text) override;
		void				compute_styles(bool recursive) override;
		virtual void		apply_word_break() override;
		bool				is_text() const override { return true; }
		bool				is_tab() const override { return m_text == "\t"; }
		pixel_t				set_hyphen_visible(bool visible) override;

		// Character runs produced by a break-word split (see apply_word_break).
		bool				is_word_break_part() const { return m_word_break_part; }
		bool				is_word_break_start() const { return m_word_break_start; }
		void				set_word_break_member() { m_word_break_part = true; }
		void				set_word_break_start(const std::vector<std::shared_ptr<el_text>>& chars);
		// Inline size of the whole word this run starts; 0 for any other run.
		pixel_t				word_break_width() const;

		void draw(uint_ptr hdc, pixel_t x, pixel_t y, const position *clip, const std::shared_ptr<render_item> &ri) override;
		string				dump_get_name() override;
		std::vector<std::tuple<string, string>> dump_get_attrs() override;
	protected:
		void				get_content_size(size& sz, pixel_t max_width) override;
	};
}

#endif  // LH_EL_TEXT_H
