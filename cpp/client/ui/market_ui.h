#pragma once
#include "client/ui/menus.h"
namespace flix {
// Keep ordinary amounts exact; abbreviate million-plus readouts only.
std::string marketNumber(double value, bool exact=false);
void refreshMarketUi();
void renderMarket(MenuContext&,Rect,bool orders);
}
