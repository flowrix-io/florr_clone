#pragma once

#include <cstdint>
#include <array>
#include <functional>
#include <memory>
#include <string>
#include <vector>

struct Color {
    std::uint8_t r = 0, g = 0, b = 0, a = 255;
    constexpr Color() = default;
    constexpr Color(std::uint8_t red, std::uint8_t green, std::uint8_t blue, std::uint8_t alpha = 255)
        : r(red), g(green), b(blue), a(alpha) {}
};

// Retained path object, equivalent to the browser's Path2D.
class Path2D {
public:
    enum class Command : unsigned char { Move, Line, Quadratic, Bezier, Arc, ArcTo, Ellipse, Rect, RoundRect, Close };
    struct Segment { Command command; float v[8]{}; bool counterClockwise = false; };
    void moveTo(float x, float y); void lineTo(float x, float y); void closePath();
    void quadraticCurveTo(float cpx, float cpy, float x, float y);
    void bezierCurveTo(float cp1x, float cp1y, float cp2x, float cp2y, float x, float y);
    void arc(float x, float y, float radius, float startAngle, float endAngle, bool counterClockwise = false);
    void arcTo(float x1, float y1, float x2, float y2, float radius);
    void ellipse(float x, float y, float radiusX, float radiusY, float rotation, float startAngle, float endAngle, bool counterClockwise = false);
    void rect(float x, float y, float width, float height); void roundRect(float x, float y, float width, float height, float radius);
    void addPath(const Path2D& other);
    void clear() { segments_.clear(); glyphOutlines_ = false; }
    bool empty() const { return segments_.empty(); }
    const std::vector<Segment>& segments() const { return segments_; }
    std::vector<Segment>& segments() { return segments_; }
    // True once Font::appendText has put glyph outlines in here. The browser
    // does not rasterize text the way it rasterizes a shape -- glyph coverage
    // goes up a gamma ramp, shape coverage does not -- and this is how the
    // rasterizer tells the two apart, since a glyph here IS an ordinary path.
    bool glyphOutlines() const { return glyphOutlines_; }
    void markGlyphOutlines() { glyphOutlines_ = true; }
private: std::vector<Segment> segments_; bool glyphOutlines_ = false;
};

// CanvasRenderingContext2D-style API. Emscripten calls the real browser context
// for every operation. createVirtual() uses an OffscreenCanvas (with a detached
// HTMLCanvasElement fallback) and can be composited with drawCanvas().
class Canvas {
public:
    Canvas(int width, int height, std::string elementId = "canvas");
    static Canvas createVirtual(int width, int height);
    Canvas(const Canvas&) = delete; Canvas& operator=(const Canvas&) = delete;
    Canvas(Canvas&& other) noexcept; Canvas& operator=(Canvas&& other) noexcept;
    ~Canvas();
    int width() const { return width_; } int height() const { return height_; } bool isVirtual() const { return virtual_; }
    void present(const std::string& elementId);

    void save(); void restore(); void reset();
    void scale(float x, float y); void rotate(float radians); void translate(float x, float y);
    void transform(float a, float b, float c, float d, float e, float f);
    void setTransform(float a = 1, float b = 0, float c = 0, float d = 1, float e = 0, float f = 0); void resetTransform();
    void setFillStyle(Color color); void setStrokeStyle(Color color);
    void setFillStyle(const std::string& cssColor); void setStrokeStyle(const std::string& cssColor);
    void setGlobalAlpha(float alpha); void setGlobalCompositeOperation(const std::string& operation); void setFilter(const std::string& filter);
    void setLineWidth(float width); void setLineCap(const std::string& cap); void setLineJoin(const std::string& join); void setMiterLimit(float limit);
    void setLineDash(const std::vector<float>& segments); void setLineDashOffset(float offset);
    void setShadow(Color color, float blur, float offsetX = 0, float offsetY = 0);
    void setFont(const std::string& font); void setTextAlign(const std::string& align); void setTextBaseline(const std::string& baseline); void setDirection(const std::string& direction);
    void setImageSmoothingEnabled(bool enabled); void setImageSmoothingQuality(const std::string& quality);

    void clear(Color color = Color{255, 255, 255}); void clearRect(float x, float y, float width, float height);
    void fillRect(float x, float y, float width, float height); void strokeRect(float x, float y, float width, float height);
    void beginPath(); void closePath(); void moveTo(float x, float y); void lineTo(float x, float y);
    void quadraticCurveTo(float cpx, float cpy, float x, float y); void bezierCurveTo(float cp1x, float cp1y, float cp2x, float cp2y, float x, float y);
    void arc(float x, float y, float radius, float startAngle, float endAngle, bool counterClockwise = false);
    void arcTo(float x1, float y1, float x2, float y2, float radius);
    void ellipse(float x, float y, float radiusX, float radiusY, float rotation, float startAngle, float endAngle, bool counterClockwise = false);
    void rect(float x, float y, float width, float height); void roundRect(float x, float y, float width, float height, float radius);
    void fill(const std::string& rule = "nonzero"); void stroke(); void clip(const std::string& rule = "nonzero");
    void fill(const Path2D& path, const std::string& rule = "nonzero"); void stroke(const Path2D& path); void clip(const Path2D& path, const std::string& rule = "nonzero");
    bool isPointInPath(float x, float y, const std::string& rule = "nonzero") const; bool isPointInStroke(float x, float y) const;

    void fillText(const std::string& text, float x, float y, float maxWidth = -1); void strokeText(const std::string& text, float x, float y, float maxWidth = -1); float measureText(const std::string& text) const;
    void drawCanvas(const Canvas& source, float dx, float dy); void drawCanvas(const Canvas& source, float dx, float dy, float dw, float dh);
    // Draws tightly-packed 8-bit RGBA pixels into the user-space box
    // (dx, dy, dw, dh), through the current transform, clip and globalAlpha.
    // This is the real drawImage, not drawCanvas: the destination is sampled by
    // inverse-mapping every covered device pixel, so an image under a rotation
    // stays an image instead of the axis-aligned smear a corner-mapped blit
    // would give. Minification box-filters, so downscaled artwork does not
    // alias into noise.
    // `alpha` multiplies the source, the way a fill folds a node's opacity
    // into its colour; it composes with globalAlpha rather than replacing it.
    void drawImage(const std::uint8_t* rgba, int imageWidth, int imageHeight,
                   float dx, float dy, float dw, float dh, float alpha = 1.0f);
    std::vector<std::uint8_t> getImageData(int x, int y, int width, int height) const;
    void putImageData(const std::vector<std::uint8_t>& rgba, int sourceWidth, int sourceHeight, int dx, int dy);
    void fillCircle(float centerX, float centerY, float radius); void strokeCircle(float centerX, float centerY, float radius);
    bool savePPM(const std::string& path) const;
    // Native-only interactive presentation. Blocks until the user closes the window.
    bool showWindow(const std::string& title = "C++ Canvas",
                    const std::function<void(Canvas&, float)>& drawFrame = {});

private:
    Canvas(int width, int height, bool isVirtual);
    int width_, height_, contextId_ = -1; bool virtual_ = false; std::string elementId_;
    Color fill_{0, 0, 0}, stroke_{0, 0, 0}; float lineWidth_ = 1.0f; Path2D currentPath_; std::vector<Color> pixels_;
#ifndef __EMSCRIPTEN__
    // Software backend state. Everything the browser context tracks per save()
    // lives here; clip is a shared coverage mask so restore() is a pointer swap.
    struct ClipMask { int x0 = 0, y0 = 0, x1 = 0, y1 = 0; std::vector<std::uint8_t> alpha; };
    struct State {
        std::array<float, 6> matrix{1,0,0,1,0,0};
        Color fill{0,0,0}, stroke{0,0,0};
        float lineWidth = 1, alpha = 1, miterLimit = 10, dashOffset = 0, fontSize = 10;
        unsigned char lineCap = 0, lineJoin = 0, textAlign = 0, textBaseline = 3, fontFamily = 0;
        std::vector<float> dash;
        std::shared_ptr<const ClipMask> clip;
    };
    State state_; std::vector<State> stack_;
    void blendPixel(int x, int y, Color color); void paint(int x, int y, Color color, float coverage);
    float clipAt(int x, int y) const;
    std::pair<float,float> mapPoint(float x, float y) const;
    void fillDevice(const Path2D& path, bool evenOdd, Color color);
    void strokeDevice(const Path2D& path);
    void glyphs(const std::string& text, float x, float y, float maxWidth, Color color);
#endif
};
