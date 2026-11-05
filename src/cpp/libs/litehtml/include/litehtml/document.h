#ifndef LH_DOCUMENT_H
#define LH_DOCUMENT_H

#include "stylesheet.h"
#include "types.h"
#include "master_css.h"
#include "encodings.h"
#include "font_description.h"
#include <vector>

typedef struct GumboInternalOutput GumboOutput;

namespace litehtml
{
	struct css_text
	{
		typedef std::vector<css_text>	vector;

		string	text;
		string	baseurl;
		string	media;

		css_text() = default;

		css_text(const char* txt, const char* url, const char* media_str)
		{
			text	= txt ? txt : "";
			baseurl	= url ? url : "";
			media	= media_str ? media_str : "";
		}
	};

	class dumper
	{
	public:
		virtual ~dumper() {}
		virtual void begin_node(const string& descr) = 0;
		virtual void end_node() = 0;
		virtual void begin_attrs_group(const string& descr) = 0;
		virtual void end_attrs_group() = 0;
		virtual void add_attr(const string& name, const string& value) = 0;
	};

	class html_tag;
	class render_item;

	struct custom_property_definition
	{
		string_id name;
		string syntax;
		bool inherits;
		css_token_vector initial_value;
	};

	class document : public std::enable_shared_from_this<document>
	{
	public:
		// Counts one measure() call; true once the per-pass budget is used up (see render_item::measure).
		bool measure_budget_exhausted() { return ++m_measure_calls > k_measure_budget; }
		bool measure_budget_over() const { return m_measure_calls > k_measure_budget; }
		void reset_measure_budget() { m_measure_calls = 0; ++m_layout_epoch; }
		// Drops the per-pass memos of intrinsic-size queries (styles changed mid-pass).
		void invalidate_measure_memos() { ++m_layout_epoch; }
		unsigned layout_epoch() const { return m_layout_epoch; }
		typedef std::shared_ptr<document>	ptr;
		typedef std::weak_ptr<document>		weak_ptr;
		struct fragment_band { pixel_t top; pixel_t bottom; };
	private:
		std::shared_ptr<element>			m_root;
		std::shared_ptr<render_item>		m_root_render;
		std::map<const element*, fragment_band>	m_fragment_bands;
		document_container*					m_container;
		fonts_map							m_fonts;
		css_text::vector					m_css;
		litehtml::css						m_styles;
		litehtml::web_color					m_def_color;
		litehtml::css						m_master_css;
		litehtml::css						m_user_css;
		litehtml::size						m_size;
		position::vector					m_fixed_boxes;
		std::shared_ptr<element>			m_over_element;
		std::shared_ptr<element>			m_active_element;
		std::list<shared_ptr<render_item>>	m_tabular_elements;
		media_query_list_list::vector		m_media_lists;
		media_features						m_media;
		long								m_measure_calls = 0;
		unsigned							m_layout_epoch = 0;
		static constexpr long				k_measure_budget = 2000000;
		string								m_lang;
		string								m_culture;
		string								m_text;
		document_mode						m_mode = no_quirks_mode;
		std::map<string_id, custom_property_definition> m_custom_properties;
	public:
		document(document_container* objContainer);
		virtual ~document();

		document_container*				container()	{ return m_container; }
		document_mode					mode() const { return m_mode; }
		uint_ptr						get_font(const font_description& descr, font_metrics* fm);
		pixel_t							render(pixel_t max_width, render_type rt = render_all);
		void							draw(uint_ptr hdc, pixel_t x, pixel_t y, const position* clip);
		web_color						get_def_color()	{ return m_def_color; }
		void 							cvt_units(css_length& val, const font_metrics& metrics, pixel_t size) const;
		// Same, but percentages are resolved against `percent_base` instead of
		// being left untouched (the reference of a percentage is property
		// specific, so it cannot be handled by the generic conversion).
		void 							cvt_units(css_length& val, const font_metrics& metrics, pixel_t size, pixel_t percent_base) const;
		pixel_t							to_pixels(const css_length& val, const font_metrics& metrics, pixel_t size) const;
		pixel_t							width() const;
		pixel_t							height() const;
        void                            set_size(pixel_t w, pixel_t h) { m_size.width = w; m_size.height = h; }
		pixel_t							content_width() const;
		pixel_t							content_height() const;
		void							add_stylesheet(const char* str, const char* baseurl, const char* media);
		bool							on_mouse_over(pixel_t x, pixel_t y, pixel_t client_x, pixel_t client_y, position::vector& redraw_boxes);
		std::vector<scroll_values>		on_scroll(pixel_t dx, pixel_t dy, pixel_t x, pixel_t y, pixel_t client_x, pixel_t client_y) const;
		bool							on_lbutton_down(pixel_t x, pixel_t y, pixel_t client_x, pixel_t client_y, position::vector& redraw_boxes);
		bool							on_lbutton_up(pixel_t x, pixel_t y, pixel_t client_x, pixel_t client_y, position::vector& redraw_boxes);
		bool							on_button_cancel(position::vector& redraw_boxes);
		bool							on_mouse_leave(position::vector& redraw_boxes);
		std::shared_ptr<element>		create_element(const char* tag_name, const string_map& attributes);
		std::shared_ptr<element>		create_element(const char* tag_name, int gumbo_tag = -1, const string_map* attributes = nullptr);
		std::shared_ptr<element>		root() const;
		std::shared_ptr<render_item>	root_render();
		// box-decoration-break: clone support for fragmented output (PDF pages). The band is the
		// visible part [top, bottom) of an element's border box (relative to its top edge);
		// decorations (background, border, shadow) of that element are painted as a complete
		// box fitted to the band instead of being sliced.
		void							set_fragment_band(const element* el, pixel_t top, pixel_t bottom) { m_fragment_bands[el] = {top, bottom}; }
		void							clear_fragment_bands() { m_fragment_bands.clear(); }
		const fragment_band*			fragment_band_of(const element* el) const
		{
			if (m_fragment_bands.empty()) return nullptr;
			auto it = m_fragment_bands.find(el);
			return it == m_fragment_bands.end() ? nullptr : &it->second;
		}
		void							get_fixed_boxes(position::vector& fixed_boxes);
		void							add_fixed_box(const position& pos);
		void							add_media_list(media_query_list_list::ptr list);
		bool							media_changed();
		bool							lang_changed();
		bool							match_lang(const string& lang);
		void							add_tabular(const std::shared_ptr<render_item>& el);
		std::shared_ptr<const element>	get_over_element() const { return m_over_element; }

		void							append_children_from_string(element& parent, const char* str, bool replace_existing);

		// P0 probe of the live-layout design (doc/design/live-layout-incremental.md): redo the style and layout phases
		// of createFromString on the tree that already exists and report the time of each phase in ms.
		// mode 0: reapply every stylesheet (what a class / id / attribute change needs)
		// mode 1: refresh_styles only (re-evaluates the selectors the element already holds)
		struct live_timing { double clear = 0, apply = 0, compute = 0, tree = 0, layout = 0; };
		live_timing live_probe(pixel_t max_width, int mode);

		// Live layout (doc/design/live-layout-incremental.md, P1): change one attribute of an element of this document
		// (value == nullptr removes it). The styles are not recomputed until live_relayout().
		bool							live_set_attr(const std::shared_ptr<element>& el, const char* name, const char* value);
		// Restyle only what the changed elements can affect, rebuild the render tree and lay out again.
		live_timing						live_relayout(const std::vector<std::shared_ptr<element>>& changed, pixel_t max_width);
		void							dump(dumper& cout);

		void							add_custom_property(const custom_property_definition& def) { m_custom_properties[def.name] = def; }
		const custom_property_definition* get_custom_property_def(string_id name) const
		{
			auto it = m_custom_properties.find(name);
			if (it != m_custom_properties.end()) return &it->second;
			return nullptr;
		}

		// see doc/document_createFromString.txt
		// `page_styles` holds CSS fetched for the document itself (<link rel=stylesheet> /
		// @import). It is page content, so it is parsed at author origin (unlayered) rather
		// than as a user stylesheet; `user_styles` stays user origin.
		static document::ptr  createFromString(
			const estring&       str,
			document_container*  container,
			const string&        master_styles = litehtml::master_css,
			const string&        user_styles = "",
			const string&        page_styles = "");

	private:
		uint_ptr	add_font(const font_description& descr, font_metrics* fm);

		GumboOutput* parse_html(estring str);

		// Declarative shadow DOM (<template shadowrootmode>) is flattened into the host: see create_shadow_children.
		struct shadow_ctx
		{
			int id;
			std::vector<std::pair<string, elements_list>>* lights; // light-DOM children by slot name
		};
		std::vector<shadow_ctx>	m_shadow_stack;
		int						m_shadow_counter = 0;
		bool create_shadow_children(void* ghost, void* gshadow, const std::shared_ptr<element>& host, bool parseTextNode);
		void create_slot(void* gslot, elements_list& elements, bool parseTextNode);
		void create_node(void* gnode, elements_list& elements, bool parseTextNode, bool process_root);
		bool update_media_lists(const media_features& features);
		void fix_tables_layout();
		void fix_table_children(const std::shared_ptr<render_item>& el_ptr, style_display disp, const char* disp_str);
		void fix_table_parent(const std::shared_ptr<render_item> & el_ptr, style_display disp, const char* disp_str);
	};

	inline std::shared_ptr<element> document::root() const
	{
		return m_root;
	}

	inline std::shared_ptr<render_item> document::root_render()
	{
		return m_root_render;
	}

	inline void document::add_tabular(const std::shared_ptr<render_item>& el)
	{
		m_tabular_elements.push_back(el);
	}
	inline bool document::match_lang(const string& lang)
	{
		return lang == m_lang || lang == m_culture;
	}
}

#endif  // LH_DOCUMENT_H
