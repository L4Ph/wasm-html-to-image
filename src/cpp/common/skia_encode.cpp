#include "skia_encode.h"

#include <algorithm>
#include <cstring>
#include <jxl/encode.h>
#include <zlib.h>

#include <vector>

#include "skia_utils.h"
#include "thumbhash.h"
#include "apng_encoder.h"
#include "gif_encoder.h"
#include "tiff_encoder.h"
#include "webp_anim_encoder.h"
#include "avif/avif.h"
#include "include/core/SkStream.h"
#include "include/encode/SkJpegEncoder.h"
#include "include/encode/SkPngEncoder.h"
#include "include/encode/SkWebpEncoder.h"

// rgbaToThumbHash 実体は common/thumbhash.h/.cpp (namespace html_to_image)。
// image-opt版 `utils/thumbhash.h` のグローバル関数を同ロジックで移植したもの。
namespace html_to_image {

// ---- indexed (palette) PNG for images of at most 256 colors ---------------------------------
//
// Flat UI renders (OG cards, diagrams, list markers) often hold fewer than 256 distinct colors.
// Stored as one palette index per pixel they deflate to a fraction of the RGBA size (about 30%
// of it on the visual-test assets that qualify). The check is cheap: a row sample (every 16th
// row) rejects richer images after a small part of the pixels.

namespace {

void to_straight_rgba_row(const uint8_t* src, uint8_t* dst, int width, bool bgra, bool premul);

struct ColorTable {
    static constexpr int kSlots = 1024;  // power of two, > 2 * 256
    uint32_t keys[kSlots];
    int16_t index[kSlots];
    int count = 0;

    ColorTable() { std::fill(index, index + kSlots, (int16_t)-1); }

    // Palette index of `color`, adding it; -1 when the 257th color shows up.
    int add(uint32_t color) {
        uint32_t h = (color * 2654435761u) >> 22;  // 10 bits
        for (;;) {
            const int16_t i = index[h];
            if (i < 0) {
                if (count >= 256) return -1;
                keys[h] = color;
                index[h] = (int16_t)count;
                return count++;
            }
            if (keys[h] == color) return i;
            h = (h + 1) & (kSlots - 1);
        }
    }
};

void put_be32(std::vector<uint8_t>& out, uint32_t v) {
    out.push_back((uint8_t)(v >> 24));
    out.push_back((uint8_t)(v >> 16));
    out.push_back((uint8_t)(v >> 8));
    out.push_back((uint8_t)v);
}

void put_chunk(std::vector<uint8_t>& out, const char type[4], const uint8_t* data, size_t len) {
    put_be32(out, (uint32_t)len);
    const size_t start = out.size();
    out.insert(out.end(), type, type + 4);
    out.insert(out.end(), data, data + len);
    uLong crc = crc32(0L, out.data() + start, (uInt)(out.size() - start));
    put_be32(out, (uint32_t)crc);
}

sk_sp<SkData> encode_png_indexed(const SkPixmap& pixmap, int level) {
    const int width = pixmap.width(), height = pixmap.height();
    if (width <= 0 || height <= 0) return nullptr;
    if (pixmap.colorType() != kRGBA_8888_SkColorType && pixmap.colorType() != kBGRA_8888_SkColorType)
        return nullptr;

    // 1. Reject rich images early: every 16th row is enough to see more than 256 colors.
    {
        ColorTable sample;
        for (int y = 0; y < height; y += 16) {
            const uint32_t* row = (const uint32_t*)pixmap.addr32(0, y);
            for (int x = 0; x < width; ++x)
                if (sample.add(row[x]) < 0) return nullptr;
        }
    }

    // 2. PNG stores straight (unpremultiplied) RGBA: convert once, then index every pixel.
    const bool bgra = pixmap.colorType() == kBGRA_8888_SkColorType;
    const bool premul = pixmap.alphaType() == kPremul_SkAlphaType;
    std::vector<uint32_t> straight((size_t)width * height);
    for (int y = 0; y < height; ++y)
        to_straight_rgba_row((const uint8_t*)pixmap.addr(0, y), (uint8_t*)&straight[(size_t)y * width],
                             width, bgra, premul);
    ColorTable table;
    std::vector<uint32_t> colors;  // palette entries (RGBA8888 straight)
    colors.reserve(256);
    std::vector<uint8_t> raw((size_t)(width + 1) * height);
    uint32_t prev_color = 0;
    int prev_index = -1;
    for (int y = 0; y < height; ++y) {
        const uint32_t* row = &straight[(size_t)y * width];
        uint8_t* out = &raw[(size_t)y * (width + 1)];
        *out++ = 0;  // filter: none (indices deflate best unfiltered)
        for (int x = 0; x < width; ++x) {
            const uint32_t c = row[x];
            if (prev_index < 0 || c != prev_color) {
                const int before = table.count;
                const int idx = table.add(c);
                if (idx < 0) return nullptr;
                if (table.count != before) colors.push_back(c);
                prev_color = c;
                prev_index = idx;
            }
            *out++ = (uint8_t)prev_index;
        }
    }

    // 3. Chunks.
    std::vector<uint8_t> png = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    uint8_t ihdr[13];
    for (int i = 0; i < 4; ++i) {
        ihdr[i] = (uint8_t)((uint32_t)width >> (24 - 8 * i));
        ihdr[4 + i] = (uint8_t)((uint32_t)height >> (24 - 8 * i));
    }
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 3;   // color type: indexed
    ihdr[10] = 0;  // compression
    ihdr[11] = 0;  // filter
    ihdr[12] = 0;  // no interlace
    put_chunk(png, "IHDR", ihdr, 13);

    std::vector<uint8_t> plte, trns;
    bool has_alpha = false;
    for (uint32_t c : colors) {
        // RGBA8888 in memory order: R, G, B, A (little endian uint32 -> bytes r,g,b,a).
        const uint8_t r = (uint8_t)(c & 0xFF), g = (uint8_t)((c >> 8) & 0xFF),
                      b = (uint8_t)((c >> 16) & 0xFF), a = (uint8_t)(c >> 24);
        plte.push_back(r);
        plte.push_back(g);
        plte.push_back(b);
        trns.push_back(a);
        has_alpha = has_alpha || a != 255;
    }
    put_chunk(png, "PLTE", plte.data(), plte.size());
    if (has_alpha) put_chunk(png, "tRNS", trns.data(), trns.size());

    uLongf bound = compressBound((uLong)raw.size());
    std::vector<uint8_t> idat(bound);
    if (compress2(idat.data(), &bound, raw.data(), (uLong)raw.size(), level) != Z_OK) return nullptr;
    put_chunk(png, "IDAT", idat.data(), bound);
    put_chunk(png, "IEND", nullptr, 0);
    return SkData::MakeWithCopy(png.data(), png.size());
}

}  // namespace

// ---- fast RGBA/RGB PNG writer ---------------------------------------------------------------
//
// SkPngEncoder converts premultiplied pixels through Skia's portable raster pipeline (about
// 20 ms for a 800x1200 page on wasm) before libpng filters and deflates. Doing the (rare)
// un-premultiply by hand, filtering with Up and streaming rows straight into zlib removes that
// cost; an image without translucent pixels is written as 8-bit RGB (a quarter less to deflate).

namespace {

// RGBA8888 (bytes r,g,b,a) from a row of premultiplied / straight / opaque N32 pixels.
void to_straight_rgba_row(const uint8_t* src, uint8_t* dst, int width, bool bgra, bool premul) {
    for (int x = 0; x < width; ++x, src += 4, dst += 4) {
        uint8_t r = bgra ? src[2] : src[0];
        const uint8_t g = src[1];
        uint8_t b = bgra ? src[0] : src[2];
        const uint8_t a = src[3];
        uint8_t gg = g;
        if (premul && a != 255) {
            if (a == 0) {
                r = gg = b = 0;
            } else {
                r = (uint8_t)std::min(255, (r * 255 + a / 2) / a);
                gg = (uint8_t)std::min(255, (g * 255 + a / 2) / a);
                b = (uint8_t)std::min(255, (b * 255 + a / 2) / a);
            }
        }
        dst[0] = r;
        dst[1] = gg;
        dst[2] = b;
        dst[3] = a;
    }
}

bool pixmap_has_translucent_pixels(const SkPixmap& pm) {
    if (pm.alphaType() == kOpaque_SkAlphaType) return false;
    for (int y = 0; y < pm.height(); ++y) {
        const uint8_t* row = (const uint8_t*)pm.addr(0, y);
        for (int x = 0; x < pm.width(); ++x)
            if (row[x * 4 + 3] != 255) return true;
    }
    return false;
}

// Returns nullptr when the pixmap is not 8888 (the caller falls back to SkPngEncoder).
sk_sp<SkData> encode_png_fast(const SkPixmap& pm, bool allow_rgb, int level) {
    const int width = pm.width(), height = pm.height();
    if (width <= 0 || height <= 0) return nullptr;
    if (pm.colorType() != kRGBA_8888_SkColorType && pm.colorType() != kBGRA_8888_SkColorType)
        return nullptr;
    const bool bgra = pm.colorType() == kBGRA_8888_SkColorType;
    const bool premul = pm.alphaType() == kPremul_SkAlphaType;
    const bool rgb = allow_rgb && !pixmap_has_translucent_pixels(pm);
    const int bpp = rgb ? 3 : 4;
    const size_t stride = (size_t)width * bpp;

    z_stream zs;
    std::memset(&zs, 0, sizeof(zs));
    if (deflateInit2(&zs, level, Z_DEFLATED, 15, 8, rgb ? Z_DEFAULT_STRATEGY : Z_FILTERED) != Z_OK) return nullptr;
    std::vector<uint8_t> idat(deflateBound(&zs, (uLong)((stride + 1) * height)));
    zs.next_out = idat.data();
    zs.avail_out = (uInt)idat.size();

    std::vector<uint8_t> straight((size_t)width * 4);
    std::vector<uint8_t> cur(stride), prev(stride, 0), filtered(stride + 1);
    bool ok = true;
    for (int y = 0; y < height && ok; ++y) {
        to_straight_rgba_row((const uint8_t*)pm.addr(0, y), straight.data(), width, bgra, premul);
        if (rgb) {
            for (int x = 0; x < width; ++x) {
                cur[x * 3] = straight[x * 4];
                cur[x * 3 + 1] = straight[x * 4 + 1];
                cur[x * 3 + 2] = straight[x * 4 + 2];
            }
        } else {
            std::memcpy(cur.data(), straight.data(), stride);
        }
        filtered[0] = 2;  // filter type Up
        for (size_t i = 0; i < stride; ++i) filtered[i + 1] = (uint8_t)(cur[i] - prev[i]);
        zs.next_in = filtered.data();
        zs.avail_in = (uInt)filtered.size();
        ok = deflate(&zs, Z_NO_FLUSH) == Z_OK;
        cur.swap(prev);
    }
    if (ok) ok = deflate(&zs, Z_FINISH) == Z_STREAM_END;
    const size_t idat_size = zs.total_out;
    deflateEnd(&zs);
    if (!ok) return nullptr;

    std::vector<uint8_t> png = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    png.reserve(idat_size + 128);
    uint8_t ihdr[13];
    for (int i = 0; i < 4; ++i) {
        ihdr[i] = (uint8_t)((uint32_t)width >> (24 - 8 * i));
        ihdr[4 + i] = (uint8_t)((uint32_t)height >> (24 - 8 * i));
    }
    ihdr[8] = 8;
    ihdr[9] = rgb ? 2 : 6;
    ihdr[10] = ihdr[11] = ihdr[12] = 0;
    put_chunk(png, "IHDR", ihdr, 13);
    put_chunk(png, "IDAT", idat.data(), idat_size);
    put_chunk(png, "IEND", nullptr, 0);
    return SkData::MakeWithCopy(png.data(), png.size());
}

}  // namespace

sk_sp<SkData> encode_png_rgba(const SkPixmap& pixmap, bool allow_rgb, int level) {
    if (sk_sp<SkData> fast = encode_png_fast(pixmap, allow_rgb, level)) return fast;
    SkDynamicMemoryWStream stream;
    SkPngEncoder::Options options;
    // Up filter only: trying all five filters per row (Skia default) cost 20-40%
    // more encode time for output within ~4% of the size (photos: the same size).
    // No filter is faster still on flat UI but more than doubles photo output.
    options.fFilterFlags = SkPngEncoder::FilterFlag::kUp;
    if (!SkPngEncoder::Encode(&stream, pixmap, options)) return nullptr;
    return stream.detachAsData();
}

sk_sp<SkData> encode_png(const SkPixmap& pixmap, int level) {
    // Images of at most 256 colors are stored indexed (about 3x smaller); everything else
    // takes the regular RGBA path.
    if (sk_sp<SkData> indexed = encode_png_indexed(pixmap, level)) return indexed;
    return encode_png_rgba(pixmap, true, level);
}

std::string encode_png_data_url(const SkBitmap& bitmap) {
    if (bitmap.isNull() || bitmap.width() <= 0 || bitmap.height() <= 0) return "";
    if (bitmap.getPixels() == nullptr) return "";
    sk_sp<SkData> png = encode_png(bitmap.pixmap());
    if (!png || png->size() == 0) return "";
    return "data:image/png;base64," +
           base64_encode((const uint8_t*)png->data(), png->size());
}

sk_sp<SkData> encode_webp_single(const SkPixmap& pixmap, float quality) {
    SkDynamicMemoryWStream stream;
    SkWebpEncoder::Options options;
    options.fQuality = (int)quality;
    if (quality >= 100.0f) {
        options.fCompression = SkWebpEncoder::Compression::kLossless;
    } else {
        options.fCompression = SkWebpEncoder::Compression::kLossy;
    }
    if (!SkWebpEncoder::Encode(&stream, pixmap, options)) return nullptr;
    return stream.detachAsData();
}

sk_sp<SkData> encode_jpeg(const SkPixmap& pixmap, int quality) {
    SkDynamicMemoryWStream stream;
    SkJpegEncoder::Options options;
    options.fQuality = quality;
    if (!SkJpegEncoder::Encode(&stream, pixmap, options)) return nullptr;
    return stream.detachAsData();
}

sk_sp<SkData> encode_avif(const SkBitmap& bitmap, int quality, int speed) {
    SkDynamicMemoryWStream stream;
    avifRWData output = AVIF_DATA_EMPTY;
    avifImage* avif_image =
        avifImageCreate(bitmap.width(), bitmap.height(), 8, AVIF_PIXEL_FORMAT_YUV444);

    // Convert SkBitmap to AVIF RGB image
    avifRGBImage rgb;
    avifRGBImageSetDefaults(&rgb, avif_image);
    rgb.format = AVIF_RGB_FORMAT_RGBA;
    rgb.depth = 8;
    rgb.pixels = (uint8_t*)bitmap.getPixels();
    rgb.rowBytes = (uint32_t)bitmap.rowBytes();

    if (avifImageRGBToYUV(avif_image, &rgb) != AVIF_RESULT_OK) {
        avifImageDestroy(avif_image);
        return nullptr;
    }

    avifEncoder* encoder = avifEncoderCreate();
    encoder->quality = quality;
    encoder->qualityAlpha = quality;
    encoder->speed = speed;

    sk_sp<SkData> result;
    avifResult avif_result = avifEncoderWrite(encoder, avif_image, &output);
    if (avif_result == AVIF_RESULT_OK) {
        stream.write(output.data, output.size);
        result = stream.detachAsData();
    }

    avifRWDataFree(&output);
    avifEncoderDestroy(encoder);
    avifImageDestroy(avif_image);
    return result;
}

sk_sp<SkData> encode_raw(const SkBitmap& bitmap) {
    return SkData::MakeWithCopy(bitmap.getPixels(), bitmap.computeByteSize());
}

std::vector<uint8_t> encode_jxl(const SkBitmap& bitmap, int quality, int speed) {
    const int width = bitmap.width();
    const int height = bitmap.height();
    const uint8_t* pixels = (const uint8_t*)bitmap.getPixels();
    if (width <= 0 || height <= 0 || pixels == nullptr) return {};
    // AVIF実装と同様にSkBitmapの画素をRGBA 8bit前提で取得する。
    // JxlEncoderAddImageFrameは連続バッファを要求するためrowBytesの
    // パディングを除去してtightなRGBAへ詰め直す。
    const size_t src_row_bytes = (size_t)bitmap.rowBytes();
    const size_t tight_row_bytes = (size_t)width * 4;
    std::vector<uint8_t> rgba(tight_row_bytes * (size_t)height);
    for (int y = 0; y < height; ++y) {
        std::memcpy(rgba.data() + (size_t)y * tight_row_bytes,
                    pixels + (size_t)y * src_row_bytes, tight_row_bytes);
    }
    const bool has_alpha = !bitmap.isOpaque();

    JxlEncoder* enc = JxlEncoderCreate(nullptr);
    if (enc == nullptr) return {};

    auto fail = [&enc]() {
        JxlEncoderDestroy(enc);
        return std::vector<uint8_t>{};
    };

    JxlBasicInfo basic_info;
    JxlEncoderInitBasicInfo(&basic_info);
    basic_info.xsize = (uint32_t)width;
    basic_info.ysize = (uint32_t)height;
    basic_info.bits_per_sample = 8;
    basic_info.exponent_bits_per_sample = 0;
    basic_info.num_color_channels = 3;
    basic_info.num_extra_channels = has_alpha ? 1 : 0;
    basic_info.alpha_bits = has_alpha ? 8 : 0;
    // libjxl requires uses_original_profile=true for lossless encoding
    // (JxlEncoderSetFrameLossless errors out otherwise, see encode.cc).
    const bool lossless = (quality >= 100);
    basic_info.uses_original_profile = lossless ? JXL_TRUE : JXL_FALSE;
    if (JxlEncoderSetBasicInfo(enc, &basic_info) != JXL_ENC_SUCCESS) return fail();

    JxlColorEncoding color_encoding;
    JxlColorEncodingSetToSRGB(&color_encoding, JXL_FALSE);
    if (JxlEncoderSetColorEncoding(enc, &color_encoding) != JXL_ENC_SUCCESS) return fail();

    JxlEncoderFrameSettings* frame_settings = JxlEncoderFrameSettingsCreate(enc, nullptr);
    if (frame_settings == nullptr) return fail();
    if (quality >= 100) {
        if (JxlEncoderSetFrameLossless(frame_settings, JXL_TRUE) != JXL_ENC_SUCCESS) {
            return fail();
        }
    } else {
        const float distance =
            std::clamp((100 - (float)quality) * 0.08f, 0.3f, 10.0f);
        if (JxlEncoderSetFrameDistance(frame_settings, distance) != JXL_ENC_SUCCESS) {
            return fail();
        }
    }
    const int64_t effort = std::clamp(10 - (int64_t)speed, (int64_t)1, (int64_t)9);
    if (JxlEncoderFrameSettingsSetOption(frame_settings, JXL_ENC_FRAME_SETTING_EFFORT,
                                         effort) != JXL_ENC_SUCCESS) {
        return fail();
    }

    JxlPixelFormat pixel_format;
    pixel_format.num_channels = 4;
    pixel_format.data_type = JXL_TYPE_UINT8;
    pixel_format.endianness = JXL_NATIVE_ENDIAN;
    pixel_format.align = 0;
    if (JxlEncoderAddImageFrame(frame_settings, &pixel_format, rgba.data(), rgba.size()) !=
        JXL_ENC_SUCCESS) {
        return fail();
    }
    JxlEncoderCloseInput(enc);

    // シングルスレッド (ParallelRunner不使用、WASM_THREADS=OFF前提)。
    std::vector<uint8_t> output(64 * 1024);
    uint8_t* next_out = output.data();
    size_t avail_out = output.size();
    while (true) {
        JxlEncoderStatus status = JxlEncoderProcessOutput(enc, &next_out, &avail_out);
        if (status == JXL_ENC_SUCCESS) break;
        if (status != JXL_ENC_NEED_MORE_OUTPUT) return fail();
        // avail_out>=32を保証しながら出力バッファを拡張する。
        const size_t offset = (size_t)(next_out - output.data());
        const size_t need = offset + 32;
        size_t grown = output.size() * 2;
        if (grown < need) grown = need;
        output.resize(grown);
        next_out = output.data() + offset;
        avail_out = output.size() - offset;
    }
    output.resize((size_t)(next_out - output.data()));
    JxlEncoderDestroy(enc);
    return output;
}

sk_sp<SkData> encode_thumbhash(const SkBitmap& bitmap) {
    std::vector<uint8_t> hash =
        rgbaToThumbHash(bitmap.width(), bitmap.height(), (const uint8_t*)bitmap.getPixels());
    return SkData::MakeWithCopy(hash.data(), hash.size());
}

EncodeResult encode_frames(const EncodeFrameView* frames, size_t count,
                           const ConverterEncodeOptions& options,
                           sk_sp<SkData> raw_passthrough) {
    EncodeResult out;
    out.format_name = "unknown";
    if (frames == nullptr || count == 0 || frames[0].bitmap == nullptr) return out;
    const SkBitmap& first = *frames[0].bitmap;

    switch (options.format) {
        case RenderFormat::None: {
            if (raw_passthrough) {
                out.data = std::move(raw_passthrough);
                // 元実装は元画像の animation/format を引き継ぐのみで、
                // is_animation は false のまま (output_animation は事前に false へ初期化)。
                out.format_name = "passthrough";
            }
            return out;
        }
        case RenderFormat::PNG: {
            out.format_name = "png";
            out.data = encode_png(first.pixmap(), png_zlib_level(options.speed));
            return out;
        }
        case RenderFormat::WebP: {
            out.format_name = "webp";
            if (options.animation && count > 1) {
                // libwebp `WebPAnimEncoder` 直呼び (loop_count / bgcolor 指定可)。
                // loop_count=0・bgcolor=白 の既定値は Skia `EncodeAnimated` と
                // 同一の libwebp 呼び出し列なので、出力は従来とバイト一致する。
                std::vector<WebpAnimFrame> anim_frames;
                anim_frames.reserve(count);
                for (size_t i = 0; i < count; ++i) {
                    if (frames[i].bitmap == nullptr) return out;
                    anim_frames.push_back(
                        {frames[i].bitmap->pixmap(), frames[i].duration});
                }
                const bool lossless = options.quality >= 100.0f;
                // Skia の `SkWebpEncoder::Options::fQuality` は int なので、
                // quality も同じく整数へ切り捨ててから libwebp へ渡す
                // (Skia と同じ config を作るため)。
                const float quality = (float)(int)options.quality;
                out.data = encode_webp_animated(
                    anim_frames.data(), anim_frames.size(), quality, lossless,
                    options.animation_loop, options.animation_bgcolor,
                    // speed 6 (default) = method 2 (~25% faster than Skia method 3 for ~4% size, same PSNR); a higher speed is a lower method.
                    std::clamp(8 - options.speed, 0, 6));
                if (out.data) {
                    out.is_animation = true;
                }
                return out;
            }
            out.data = encode_webp_single(first.pixmap(), options.quality);
            return out;
        }
        case RenderFormat::APNG: {
            // Animated PNG when several frames are requested; a single frame is a plain PNG.
            if (options.animation && count > 1) {
                std::vector<ApngFrame> anim_frames;
                anim_frames.reserve(count);
                for (size_t i = 0; i < count; ++i) {
                    if (frames[i].bitmap == nullptr) return out;
                    anim_frames.push_back({frames[i].bitmap->pixmap(), frames[i].duration});
                }
                out.format_name = "apng";
                out.data = encode_apng(anim_frames.data(), anim_frames.size(), options.animation_loop);
                out.is_animation = out.data != nullptr;
                return out;
            }
            out.format_name = "png";
            out.data = encode_png(first.pixmap(), png_zlib_level(options.speed));
            return out;
        }
        case RenderFormat::GIF: {
            out.format_name = "gif";
            const size_t n = (options.animation && count > 1) ? count : 1;
            std::vector<GifFrame> gif_frames;
            gif_frames.reserve(n);
            for (size_t i = 0; i < n; ++i) {
                if (frames[i].bitmap == nullptr) return out;
                gif_frames.push_back({frames[i].bitmap->pixmap(), frames[i].duration});
            }
            out.data = encode_gif(gif_frames.data(), gif_frames.size(), options.animation_loop,
                                  options.animation_bgcolor);
            out.is_animation = out.data != nullptr && n > 1;
            return out;
        }
        case RenderFormat::TIFF:
        case RenderFormat::TIFFCmyk: {
            out.format_name = "tiff";
            out.data = encode_tiff(first.pixmap(),
                                   options.format == RenderFormat::TIFFCmyk ? ColorSpace::CMYK
                                                                            : ColorSpace::SRGB,
                                   options.animation_bgcolor, options.dpi);
            return out;
        }
        case RenderFormat::JPEG: {
            out.format_name = "jpeg";
            out.data = encode_jpeg(first.pixmap(), (int)options.quality);
            return out;
        }
        case RenderFormat::SVG: {
            out.format_name = "svg";
            // dispatcherでは未対応のまま (画像→SVGは converter_encode_svg 経由)。
            // (SkiaのSVG出力はcanvas再描画が必要なため元実装どおり。)
            return out;
        }
        case RenderFormat::AVIF: {
            out.format_name = "avif";
            out.data = encode_avif(first, (int)options.quality, options.speed);
            return out;
        }
        case RenderFormat::JXL: {
            out.format_name = "jxl";
            // 単帧のみ (animation無視)。
            std::vector<uint8_t> bytes =
                encode_jxl(first, (int)options.quality, options.speed);
            if (!bytes.empty()) {
                out.data = SkData::MakeWithCopy(bytes.data(), bytes.size());
            }
            return out;
        }
        case RenderFormat::PDF: {
            out.format_name = "pdf";
            // dispatcherでは未対応のまま (画像→PDFは converter_encode_pdf 経由。
            // 単画像からのPDF化は SkPDF 側の責務のため元実装どおり)。
            return out;
        }
        case RenderFormat::RAW: {
            out.format_name = "raw";
            out.data = encode_raw(first);
            return out;
        }
        case RenderFormat::ThumbHash: {
            out.format_name = "thumbhash";
            out.data = encode_thumbhash(first);
            return out;
        }
        default:
            return out;
    }
}

EncodeResult encode_single_bitmap(const SkBitmap& bitmap, const ConverterEncodeOptions& options,
                                  sk_sp<SkData> raw_passthrough) {
    EncodeFrameView view{&bitmap, 0};
    return encode_frames(&view, 1, options, std::move(raw_passthrough));
}

}  // namespace html_to_image
