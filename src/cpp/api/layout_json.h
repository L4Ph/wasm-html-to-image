#ifndef HTML_TO_IMAGE_LAYOUT_JSON_H
#define HTML_TO_IMAGE_LAYOUT_JSON_H

#include <string>

#include "satoru_api.h"

// Debug aid for comparing the engine against a reference browser: every laid-out element's border
// box in page coordinates, as a JSON array
//   [{"p":"0.1.3","t":"div","i":"id","c":"class","x":0,"y":0,"w":100,"h":20}, ...]
// `p` is the element's path in the (shadow-flattened) element tree: the index among the parent's
// element children, joined by ".", so the same walk in a browser yields the same keys.
// Inline boxes (they fragment across lines) are left out except replaced ones (img, svg, ...).
// With `include_inline`, inline elements are reported too, as the box enclosing all their line fragments.
// Lays the document out first when it is not ready for these inputs.
// The same walk over the document the instance holds now, without checking it against any input (live layout).
std::string satoru_api_layout_json_current(SatoruInstance* inst, bool include_inline, bool include_style);
void satoru_api_live_open(SatoruInstance* inst, const std::string& html, int width, int mediaType);
bool satoru_api_live_apply(SatoruInstance* inst, const std::string& ops, int width);
std::string satoru_api_live_boxes(SatoruInstance* inst, bool delta);
std::string satoru_api_layout_json(SatoruInstance* inst, const std::string& html, int width,
                                   int height, int mediaType, bool include_inline = false,
                                   bool include_style = false);

#endif  // HTML_TO_IMAGE_LAYOUT_JSON_H
