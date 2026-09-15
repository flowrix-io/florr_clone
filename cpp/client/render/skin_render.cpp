#include "client/render/skin_render.h"

#include <cstdlib>

#include "client/ui/draw.h"
#include "shared/core/types.h"

namespace flix {

std::uint32_t skinHexColor(const std::string& text, std::uint32_t fallback) {
    if (!isSkinHexColor(text)) return fallback;
    return static_cast<std::uint32_t>(std::strtoul(text.c_str() + 1, nullptr, 16));
}

void renderSkinShapes(Canvas& canvas, const std::vector<SkinShape>& shapes, double radius) {
    const double scale = radius / 25.0;
    const float tau = static_cast<float>(kPi * 2.0);
    canvas.save();
    canvas.scale(static_cast<float>(scale), static_cast<float>(scale));
    canvas.beginPath();
    canvas.arc(0.0f, 0.0f, 100.0f, 0.0f, tau);
    canvas.clip();
    for (const SkinShape& s : shapes) {
        canvas.save();
        canvas.translate(static_cast<float>(s.x), static_cast<float>(s.y));
        if (s.rot != 0) canvas.rotate(static_cast<float>(s.rot * kPi / 180.0));
        canvas.beginPath();
        switch (s.t) {
            case SkinShapeType::Circle:
                canvas.arc(0.0f, 0.0f, static_cast<float>(s.r != 0 ? s.r : 1.0), 0.0f, tau);
                break;
            case SkinShapeType::Ellipse:
                canvas.ellipse(0.0f, 0.0f, static_cast<float>(s.rx != 0 ? s.rx : 1.0),
                               static_cast<float>(s.ry != 0 ? s.ry : 1.0), 0.0f, 0.0f, tau);
                break;
            case SkinShapeType::Rect: {
                const double rx = s.rx != 0 ? s.rx : 1.0;
                const double ry = s.ry != 0 ? s.ry : 1.0;
                canvas.rect(static_cast<float>(-rx), static_cast<float>(-ry),
                            static_cast<float>(rx * 2), static_cast<float>(ry * 2));
                break;
            }
            case SkinShapeType::Line:
                // The endpoint is absolute local space; translate() already
                // moved the origin onto (x, y).
                canvas.moveTo(0.0f, 0.0f);
                canvas.lineTo(static_cast<float>(s.x2 - s.x), static_cast<float>(s.y2 - s.y));
                break;
            case SkinShapeType::Curve:
                // Endpoint and both control points are absolute local space
                // too. A fill closes the path implicitly, chord from end back
                // to start, which is what turns a curve into a blob.
                canvas.moveTo(0.0f, 0.0f);
                canvas.bezierCurveTo(
                    static_cast<float>(s.cx1 - s.x), static_cast<float>(s.cy1 - s.y),
                    static_cast<float>(s.cx2 - s.x), static_cast<float>(s.cy2 - s.y),
                    static_cast<float>(s.x2 - s.x), static_cast<float>(s.y2 - s.y));
                break;
            case SkinShapeType::Polygon:
                if (s.points.size() >= 6) {
                    canvas.moveTo(static_cast<float>(s.points[0]), static_cast<float>(s.points[1]));
                    for (std::size_t j = 2; j + 1 < s.points.size(); j += 2) {
                        canvas.lineTo(static_cast<float>(s.points[j]),
                                      static_cast<float>(s.points[j + 1]));
                    }
                    canvas.closePath();
                }
                break;
        }
        if (!s.fill.empty() && s.t != SkinShapeType::Line) {
            ui::setFill(canvas, skinHexColor(s.fill, ui::kInk));
            canvas.fill();
        }
        if (!s.stroke.empty() && s.sw > 0) {
            ui::setStroke(canvas, skinHexColor(s.stroke, ui::kInk));
            canvas.setLineWidth(static_cast<float>(s.sw));
            canvas.setLineJoin("round");
            canvas.setLineCap("round");
            canvas.stroke();
        }
        canvas.restore();
    }
    canvas.restore();
}

} // namespace flix
