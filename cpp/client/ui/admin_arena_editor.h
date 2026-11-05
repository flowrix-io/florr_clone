#pragma once
#include <algorithm>
#include <optional>
#include "shared/core/types.h"

namespace flix::ui {
struct ArenaTileRect { int x, y, width, height; };
// A drag is one bounded rectangle, independent of pointer direction. Border
// tiles remain visible but cannot be painted, even when a finger leaves the map.
inline std::optional<ArenaTileRect> arenaPaintRect(Vec2 start, Vec2 end, int cols, int rows) {
    if (cols < 4 || rows < 4) return std::nullopt;
    const int x0 = int(std::clamp(std::min(start.x,end.x),1.0,double(cols-2)));
    const int y0 = int(std::clamp(std::min(start.y,end.y),1.0,double(rows-2)));
    const int x1 = int(std::clamp(std::max(start.x,end.x),1.0,double(cols-2)));
    const int y1 = int(std::clamp(std::max(start.y,end.y),1.0,double(rows-2)));
    return ArenaTileRect{x0,y0,x1-x0+1,y1-y0+1};
}
}
