#ifndef HTML_TO_IMAGE_SKIA_ENCODE_H
#define HTML_TO_IMAGE_SKIA_ENCODE_H

// common/skia_encode: PNG/WebP/JPEG/AVIF/RAW/ThumbHash encode分岐の共通化。
// 正本: `@node-libraries/wasm-image-optimization/src/cpp/api/image_converter_api.cpp:172-309`
//       `ImageConverterInstance::encode` の switch 全分岐を、インスタンス非依存の
//       フレームview + オプション受けに切り出したもの。animated WebP対応は
//       image-opt版を正とする (animation && frames>1 のときanimated WebPを生成)。
//       animated WebP の実体は `common/webp_anim_encoder` (libwebp
//       `WebPAnimEncoder` 直呼び。loop_count / bgcolor 指定可)。
//
// satoru側 renderers との対応 (いずれも下記primitiveの特殊化と等価):
//  - png_renderer.cpp: `SkPngEncoder::Encode(&stream, bitmap.pixmap(), {})`
//    == encode_png(pixmap)
//  - webp_renderer.cpp: lossless固定 + quality=100.0f の単帧Encode
//    == encode_webp_single(pixmap, 100.0f)
//  - pdf_renderer.cpp: PdfJpegEncoder (quality int受け)
//    == encode_jpeg(pixmap, quality)
// PDFドキュメント自体 (SkPDF::MakeDocument) は対象外。dispatcherでの
// SVG/PDF形式指定は未対応 (null result) のまま: 画像→SVG/PDFは dispatcher
// を経由せず `converter_encode_svg` / `converter_encode_pdf` (unified_api経由)
// で対応済みのため。

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "../bridge/bridge_types.h"
#include "include/core/SkBitmap.h"
#include "include/core/SkData.h"

namespace html_to_image {

// 呼び出し側 (converterのImageFrame / rendererの単体SkBitmap) に依存しない
// 最小view。bitmapの所有権は呼び出し側が保持する。
struct EncodeFrameView {
    const SkBitmap* bitmap = nullptr;
    int duration = 0;  // ms。animated WebP以外では不使用
};

struct EncodeResult {
    sk_sp<SkData> data;          // 成功時のみ非null
    std::string format_name;     // "png"/"apng"/"gif"/"webp"/"jpeg"/"avif"/"jxl"/"raw"/"thumbhash"/"unknown"
    bool is_animation = false;   // animated WebPで実際に複数帧を符号化したときのみtrue
    bool success() const { return data != nullptr; }
};

// --- 単形式primitive (satoru renderersの使い方と1:1) ---

// `level` is the zlib level (6 = the default). `png_zlib_level(speed)` maps the encode `speed` option to it.
sk_sp<SkData> encode_png(const SkPixmap& pixmap, int level = 6);
inline int png_zlib_level(int speed) { return speed >= 11 ? 1 : speed <= 5 ? 7 : 12 - speed; }  // 6 (default) -> 6; above 7 costs 4x the time for ~2% size
// Always RGBA (no palette): for callers that need a fixed color type, e.g. APNG frames.
sk_sp<SkData> encode_png_rgba(const SkPixmap& pixmap, bool allow_rgb = false, int level = 6);

// PNG encode + base64 `data:image/png` URL. Shared implementation behind
// `encode_image_to_svg` and direct `encode_png_data_url` callers (e.g. svg_renderer.cpp).
// Returns "" when the bitmap cannot be encoded.
std::string encode_png_data_url(const SkBitmap& bitmap);
sk_sp<SkData> encode_webp_single(const SkPixmap& pixmap, float quality);
sk_sp<SkData> encode_jpeg(const SkPixmap& pixmap, int quality);
sk_sp<SkData> encode_avif(const SkBitmap& bitmap, int quality, int speed);
std::vector<uint8_t> encode_jxl(const SkBitmap& bitmap, int quality, int speed);
sk_sp<SkData> encode_raw(const SkBitmap& bitmap);

// ThumbHash実体 (rgbaToThumbHash) は common/thumbhash 移植時に持ち込む。
// 本ファイルは呼び出すのみ (image-opt版 `utils/thumbhash.h` と同シグネチャ)。
sk_sp<SkData> encode_thumbhash(const SkBitmap& bitmap);

// --- 分岐dispatcher (image-opt encode() switchの移植) ---
//
// P1: `encode_frames` が唯一入口。`encode_single_bitmap` は単帧用 overload
// (1要素view化して `encode_frames` へ委譲する薄い層) として残すが、新規呼び出しは
// `encode_frames` へ寄せる (converter_api.cpp / unified_api.cpp は直呼び済み)。
// frames[0] を単帧encoder入力とする点、None→raw_passthrough素通し、
// RAW/ThumbHashの即時return相当を含め、元switchの挙動を維持する。
// 文脈保持 (context.set_last_output等) は呼び出し側の責務とし、ここでは行わない。
EncodeResult encode_frames(const EncodeFrameView* frames, size_t count,
                           const ConverterEncodeOptions& options,
                           sk_sp<SkData> raw_passthrough = nullptr);

// 単体bitmap用 overload (P1: encode_frames への薄い委譲。新規呼び出しは encode_frames 直呼びを推奨)。
EncodeResult encode_single_bitmap(const SkBitmap& bitmap, const ConverterEncodeOptions& options,
                                  sk_sp<SkData> raw_passthrough = nullptr);

}  // namespace html_to_image

#endif  // HTML_TO_IMAGE_SKIA_ENCODE_H
