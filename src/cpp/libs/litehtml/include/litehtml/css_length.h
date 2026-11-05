#ifndef LH_CSS_LENGTH_H
#define LH_CSS_LENGTH_H

#include "types.h"
#include "css_tokenizer.h"
#include <memory>

namespace litehtml
{
	// from_token options (flags)
	enum {
		f_length     = 1, // <length> (includes unitless zero)
		f_percentage = 2, // <percentage>
		f_length_percentage = f_length | f_percentage, // <length-percentage>
		f_number     = 4, // <number>
		f_integer    = 8, // <integer>
		f_positive   = 16 // ⩾0 (non-negative)
	};

	// <length> | <percentage> | <number> | auto | none | normal
	// https://developer.mozilla.org/en-US/docs/Web/CSS/length
	class css_length
	{
		union
		{
			float	m_value;
			int		m_predef;
		};
		css_units	m_units;
		bool		m_is_predefined;
		bool		m_is_calc;

	public:
		enum math_op
		{
			op_none,
			op_min,
			op_max,
			op_clamp,
			op_minmax,
			op_repeat_auto_fit,
			op_repeat_auto_fill,
			op_fit_content
		};
	private:
		// Only a calc() / min() / max() / clamp() has these. Every element holds about seventy lengths (margins, paddings, borders,
		// offsets, sizes, ...) and almost none of them is a calculation, so the numbers live outside, behind a pointer: a length
		// costs 16 bytes instead of 44.
		struct calc_data
		{
			float px = 0, percent = 0, rem = 0, em = 0;
			math_op op = op_none;
			std::vector<css_length> operands;
		};
		std::unique_ptr<calc_data> m_calc;
		calc_data& calc_mut() { if (!m_calc) m_calc.reset(new calc_data()); return *m_calc; }
		static const std::vector<css_length>& no_operands() { static const std::vector<css_length> none; return none; }

	public:
		css_length();
		css_length(float val, css_units units = css_units_px);
		css_length(const css_length& other);
		css_length(css_length&& other) noexcept = default;
		css_length& operator=(const css_length& other);
		css_length& operator=(css_length&& other) noexcept = default;
		css_length&	operator=(float val);

		bool		is_predefined() const;
		void		predef(int val);
		int			predef() const;
		static css_length predef_value(int val = 0);
		void		set_value(float val, css_units units);
		float		val() const;
		css_units	units() const;
		pixel_t		calc_percent(pixel_t width) const;
		pixel_t		calc_percent(pixel_t width, pixel_t em_base, pixel_t rem_base) const;
		// Fold a calc()'s font-relative components (em, rem) into its px
		// component once the owning element's font sizes are known, so the
		// context-free calc_percent() below evaluates the length correctly.
		void		resolve_font_units(pixel_t em_base, pixel_t rem_base);
		bool		from_token(const css_token& token, int options, const string& predefined_keywords = "");
		string		to_string() const;

		static void set_viewport(float width, float height);
		void        set_calc(float px, float percent, float rem, float em = 0) { calc_data& c = calc_mut(); c.px = px; c.percent = percent; c.rem = rem; c.em = em; c.op = op_none; c.operands.clear(); m_is_calc = true; m_is_predefined = false; }
		void        set_math(math_op op, std::vector<css_length>&& operands) { calc_data& c = calc_mut(); c.px = 0; c.percent = 0; c.rem = 0; c.em = 0; c.op = op; c.operands = std::move(operands); m_is_calc = true; m_is_predefined = false; }
		bool        is_calc() const { return m_is_calc; }
		math_op     get_op() const { return m_calc ? m_calc->op : op_none; }
		const std::vector<css_length>& get_operands() const { return m_calc ? m_calc->operands : no_operands(); }
		float       calc_px() const { return m_calc ? m_calc->px : 0; }
		float       calc_percent() const { return m_calc ? m_calc->percent : 0; }
		float       calc_rem() const { return m_calc ? m_calc->rem : 0; }
		float       calc_em() const { return m_calc ? m_calc->em : 0; }
	};

	using length_vector = vector<css_length>;

	// css_length inlines

	inline css_length::css_length()
	{
		m_value			= 0;
		m_predef		= 0;
		m_units			= css_units_none;
		m_is_predefined	= false;
		m_is_calc       = false;
	}

	inline css_length::css_length(float val, css_units units)
	{
		m_value = val;
		m_units = units;
		m_is_predefined = false;
		m_is_calc       = false;
	}

	inline css_length::css_length(const css_length& other)
		: m_units(other.m_units), m_is_predefined(other.m_is_predefined), m_is_calc(other.m_is_calc),
		  m_calc(other.m_calc ? new calc_data(*other.m_calc) : nullptr)
	{
		m_predef = other.m_predef; // the same bits whichever member of the union was set
	}

	inline css_length& css_length::operator=(const css_length& other)
	{
		if (this != &other)
		{
			m_predef = other.m_predef;
			m_units = other.m_units;
			m_is_predefined = other.m_is_predefined;
			m_is_calc = other.m_is_calc;
			m_calc.reset(other.m_calc ? new calc_data(*other.m_calc) : nullptr);
		}
		return *this;
	}

	inline css_length&	css_length::operator=(float val)
	{
		m_value = val;
		m_units = css_units_px;
		m_is_predefined = false;
		m_is_calc       = false;
		m_calc.reset();
		return *this;
	}

	inline bool css_length::is_predefined() const
	{ 
		return m_is_predefined;					
	}

	inline void css_length::predef(int val)		
	{ 
		m_predef		= val; 
		m_is_predefined = true;	
	}

	inline int css_length::predef() const
	{ 
		if(m_is_predefined)
		{
			return m_predef; 
		}
		return 0;
	}

	inline void css_length::set_value(float val, css_units units)
	{ 
		m_value			= val; 
		m_is_predefined = false;	
		m_units			= units;
	}

	inline float css_length::val() const
	{
		if(!m_is_predefined)
		{
			return m_value;
		}
		return 0;
	}

	inline css_units css_length::units() const
	{
		return m_units;
	}

	inline pixel_t css_length::calc_percent(pixel_t width) const
	{
		// Context-free fallback (media queries and other element-less
		// evaluations): font-relative components use the initial 16px.
		// Element lengths pass through document::cvt_units first, which
		// folds em/rem at the element's own sizes, so this fallback is
		// not what layout normally sees.
		return calc_percent(width, 16, 16);
	}

	inline pixel_t css_length::calc_percent(pixel_t width, pixel_t em_base, pixel_t rem_base) const
	{
		if(!is_predefined())
		{
			if (m_is_calc && m_calc)
			{
				const calc_data& c = *m_calc;
				if (c.op == op_none)
				{
					return (pixel_t)(c.px + (width * c.percent / 100.0) + (c.rem * rem_base) + (c.em * em_base));
				}
				else if (c.op == op_min && !c.operands.empty())
				{
					pixel_t res = c.operands[0].calc_percent(width, em_base, rem_base);
					for (size_t i = 1; i < c.operands.size(); i++)
					{
						res = std::min(res, c.operands[i].calc_percent(width, em_base, rem_base));
					}
					return res;
				}
				else if (c.op == op_max && !c.operands.empty())
				{
					pixel_t res = c.operands[0].calc_percent(width, em_base, rem_base);
					for (size_t i = 1; i < c.operands.size(); i++)
					{
						res = std::max(res, c.operands[i].calc_percent(width, em_base, rem_base));
					}
					return res;
				}
				else if (c.op == op_clamp && c.operands.size() >= 3)
				{
					pixel_t min_v = c.operands[0].calc_percent(width, em_base, rem_base);
					pixel_t val = c.operands[1].calc_percent(width, em_base, rem_base);
					pixel_t max_v = c.operands[2].calc_percent(width, em_base, rem_base);
					return std::max(min_v, std::min(val, max_v));
				}
				return (pixel_t)(c.px + (width * c.percent / 100.0) + (c.rem * rem_base) + (c.em * em_base));
			}
			if(units() == css_units_percentage)
			{
				return (pixel_t) (width * m_value / 100.0);
			} else if (units() == css_units_rem)
			{
				return (pixel_t) (m_value * rem_base);
			} else if (units() == css_units_em)
			{
				return (pixel_t) (m_value * em_base);
			} else
			{
				return (pixel_t) val();
			}
		}
		return 0;
	}

	inline void css_length::resolve_font_units(pixel_t em_base, pixel_t rem_base)
	{
		if (!m_is_calc || !m_calc) return;
		calc_data& c = *m_calc;
		if (c.op == op_none)
		{
			c.px += (float)(c.em * em_base + c.rem * rem_base);
			c.em = 0;
			c.rem = 0;
		} else
		{
			for (auto& op : c.operands)
			{
				if (op.is_calc())
				{
					op.resolve_font_units(em_base, rem_base);
				} else if (op.units() == css_units_em)
				{
					// A plain em operand of min()/max()/clamp(): unlike a
					// top-level length it is not converted by cvt_units on
					// its own, and the math evaluation would otherwise use
					// the context-free fallback size.
					op.set_value(op.val() * (float)em_base, css_units_px);
				} else if (op.units() == css_units_rem)
				{
					op.set_value(op.val() * (float)rem_base, css_units_px);
				}
			}
		}
	}

} // namespace litehtml

#endif  // LH_CSS_LENGTH_H
