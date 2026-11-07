#pragma once
#include "shared/core/types.h"
namespace flix {
class NetClient;
struct MenuContext;
Rect pollOverlayBounds(const NetClient&,int w,int h);
void renderPollOverlay(MenuContext&);
void renderPollResults(MenuContext&,Rect);
}
