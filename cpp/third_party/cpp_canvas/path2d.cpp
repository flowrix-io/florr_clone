#include "canvas.h"
#include <algorithm>

// Path2D is the same retained segment list on every backend; each one turns
// the segments into its own geometry when the path is drawn.

namespace {
Path2D::Segment segment(Path2D::Command command, std::initializer_list<float> values, bool ccw = false) {
    Path2D::Segment result{}; result.command = command; result.counterClockwise = ccw;
    std::copy(values.begin(), values.end(), result.v); return result;
}
}

// Lazily allocated so that the paths a frame builds and throws away never
// consume one. Never reused: a key names one geometry for the life of the
// process, which is what lets the page keep a cache entry that outlives the
// path that filled it.
std::uint32_t Path2D::cacheKey() const {
    static std::uint32_t next = 1;
    if (key_ == 0) key_ = next++;
    return key_;
}

void Path2D::moveTo(float x, float y) { touch(); segments_.push_back(segment(Command::Move, {x, y})); }
void Path2D::lineTo(float x, float y) { touch(); segments_.push_back(segment(Command::Line, {x, y})); }
void Path2D::closePath() { touch(); segments_.push_back(segment(Command::Close, {})); }
void Path2D::quadraticCurveTo(float a,float b,float c,float d) { touch(); segments_.push_back(segment(Command::Quadratic,{a,b,c,d})); }
void Path2D::bezierCurveTo(float a,float b,float c,float d,float e,float f) { touch(); segments_.push_back(segment(Command::Bezier,{a,b,c,d,e,f})); }
void Path2D::arc(float a,float b,float c,float d,float e,bool f) { touch(); segments_.push_back(segment(Command::Arc,{a,b,c,d,e},f)); }
void Path2D::arcTo(float a,float b,float c,float d,float e) { touch(); segments_.push_back(segment(Command::ArcTo,{a,b,c,d,e})); }
void Path2D::ellipse(float a,float b,float c,float d,float e,float f,float g,bool h) { touch(); segments_.push_back(segment(Command::Ellipse,{a,b,c,d,e,f,g},h)); }
void Path2D::rect(float a,float b,float c,float d) { touch(); segments_.push_back(segment(Command::Rect,{a,b,c,d})); }
void Path2D::roundRect(float a,float b,float c,float d,float e) { touch(); segments_.push_back(segment(Command::RoundRect,{a,b,c,d,e})); }
void Path2D::addPath(const Path2D& other) {
    touch();
    segments_.insert(segments_.end(), other.segments_.begin(), other.segments_.end());
    // A path that has absorbed glyphs is a glyph path: losing the mark here
    // would silently drop the text gamma on any composed run.
    glyphOutlines_ = glyphOutlines_ || other.glyphOutlines_;
}
