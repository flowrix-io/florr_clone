#include "client/ui/touch_scroll.h"

namespace flix::ui {

TouchScrollRegions& TouchScrollRegions::instance() {
    static TouchScrollRegions regions;
    return regions;
}

double touchScroll(const Window& window, Rect view, bool scrollable) {
    if (scrollable) TouchScrollRegions::instance().record(view);
    const TouchPan& pan = window.touchPan();
    if (!pan.active || !view.contains({pan.originX, pan.originY})) return 0.0;
    return pan.dy;
}

} // namespace flix::ui
