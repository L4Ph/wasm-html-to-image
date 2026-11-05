#ifndef LH_STYLESHEET_H
#define LH_STYLESHEET_H

#include "css_selector.h"
#include "css_tokenizer.h"

namespace litehtml
{

// https://www.w3.org/TR/cssom-1/#css-declarations
struct raw_declaration
{
	using vector = std::vector<raw_declaration>;

	string name; // property name
	css_token_vector value = {}; // default value is specified here to get rid of gcc warning "missing initializer for member"
	bool important = false;

	operator bool() const { return name != ""; }
};

// intermediate half-parsed rule that is used internally by the parser
class raw_rule
{
public:
	using ptr = shared_ptr<raw_rule>;
	using vector = std::vector<ptr>;

	enum rule_type { qualified, at };

	raw_rule(rule_type type, string name = "") : type(type), name(name) {}

	rule_type type;
	// An at-rule has a name, a prelude consisting of a list of component values, and an optional block consisting of a simple {} block.
	string name;
	// https://www.w3.org/TR/css-syntax-3/#qualified-rule
	// A qualified rule has a prelude consisting of a list of component values, and a block consisting of a simple {} block.
	// Note: Most qualified rules will be style rules, where the prelude is a selector and the block a list of declarations.
	css_token_vector prelude;
	css_token block;
};

class css
{
	bool	m_has_container_queries = false;
	bool	m_sibling_sensitive = false;
	bool	m_structural_sensitive = false;
public:
	bool has_container_queries() const { return m_has_container_queries; }
	// True when a selector looks at siblings (`+`, `~`) or at descendants (`:has()`), so a change to one element can restyle
	// a sibling or an ancestor (live layout restyles a wider scope then).
	bool sibling_sensitive() const { return m_sibling_sensitive; }
	// True when a selector looks at a position among siblings (:first-child, :nth-child(), :empty, ...): inserting or removing a
	// child can restyle the children that stay.
	bool structural_sensitive() const { return m_structural_sensitive; }
private:
	css_selector::vector	m_selectors;
	std::map<string_id, css_selector::vector> m_id_selectors;
	std::map<string_id, css_selector::vector> m_class_selectors;
	std::map<string_id, css_selector::vector> m_tag_selectors;
	css_selector::vector	m_universal_selectors;

	std::map<string, int>	m_resolved_ranks;
	std::map<string, int>	m_segment_orders;
	std::map<string, int>	m_next_order;
	int						m_anon_count = 0;
public:
	static const int unlayered_id = 2000000000;

	const css_selector::vector* id_selectors(string_id id) const
	{
		auto it = m_id_selectors.find(id);
		if (it != m_id_selectors.end()) return &it->second;
		return nullptr;
	}
	const css_selector::vector* class_selectors(string_id id) const
	{
		auto it = m_class_selectors.find(id);
		if (it != m_class_selectors.end()) return &it->second;
		return nullptr;
	}
	const css_selector::vector* tag_selectors(string_id id) const
	{
		auto it = m_tag_selectors.find(id);
		if (it != m_tag_selectors.end()) return &it->second;
		return nullptr;
	}
	const css_selector::vector& universal_selectors() const { return m_universal_selectors; }

	template<class Input>
	void	parse_css_stylesheet(const Input& input, string baseurl, shared_ptr<document> doc, media_query_list_list::ptr media = nullptr, container_query_list_list::ptr container = nullptr, bool top_level = true, int layer = unlayered_id, string layer_prefix = "");

	void	sort_selectors();
	size_t	get_selectors_count() const { return m_selectors.size(); }

private:
	bool	parse_style_rule(raw_rule::ptr rule, string baseurl, shared_ptr<document> doc, media_query_list_list::ptr media, container_query_list_list::ptr container, int layer);
	void	parse_import_rule(raw_rule::ptr rule, string baseurl, shared_ptr<document> doc, media_query_list_list::ptr media, container_query_list_list::ptr container, int layer, string layer_prefix);
	void	add_selector(const css_selector::ptr& selector, int layer);
	int		get_layer_id(const string& name);
	void	parse_property_rule(raw_rule::ptr rule, shared_ptr<document> doc);
	bool	evaluate_supports(const css_token_vector& tokens, shared_ptr<document> doc);
	bool	evaluate_supports_condition(const css_token_vector& tokens, int& index, shared_ptr<document> doc);
	bool	evaluate_supports_feature(const css_token& token, shared_ptr<document> doc);
};

// bit 1: looks at siblings or descendants (+ ~ :has); bit 2: looks at the position among siblings
inline int selector_sensitivity(const css_selector& sel)
{
	static const string_id empty_pseudo = _id("empty");
	int bits = 0;
	for (const css_selector* s = &sel; s; s = s->m_left.get())
	{
		if (s->m_combinator == combinator_adjacent_sibling || s->m_combinator == combinator_general_sibling) bits |= 1;
		for (const auto& attr : s->m_right.m_attrs)
		{
			if (attr.name == _has_) bits |= 1;
			if (attr.type == select_pseudo_class &&
			    (attr.name == _first_child_ || attr.name == _last_child_ || attr.name == _only_child_ || attr.name == _nth_child_ ||
			     attr.name == _nth_last_child_ || attr.name == _first_of_type_ || attr.name == _last_of_type_ ||
			     attr.name == _only_of_type_ || attr.name == _nth_of_type_ || attr.name == _nth_last_of_type_ ||
			     attr.name == empty_pseudo))
				bits |= 2;
			for (const auto& inner : attr.selector_list)
				if (inner) bits |= selector_sensitivity(*inner);
		}
	}
	return bits;
}

inline void css::add_selector(const css_selector::ptr& selector, int layer)
{
	const int sensitivity = selector_sensitivity(*selector);
	if (sensitivity & 1) m_sibling_sensitive = true;
	if (sensitivity & 2) m_structural_sensitive = true;
	selector->m_order = (int)m_selectors.size();
	selector->m_layer = layer;
	m_selectors.push_back(selector);
}


} // namespace litehtml

#endif  // LH_STYLESHEET_H
