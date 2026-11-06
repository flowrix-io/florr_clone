#pragma once
#include "shared/core/types.h"
namespace flix {
struct MenuContext;
bool renderCasino(MenuContext&);
void renderMarket(MenuContext&,Rect,bool orders);
void renderStarCodes(MenuContext&,Rect);
void renderEventSetup(MenuContext&,Rect);
void resetCommerceUi();
void stopCasinoAuto();
}
