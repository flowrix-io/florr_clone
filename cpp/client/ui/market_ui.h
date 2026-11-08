#pragma once
#include "client/ui/menus.h"
namespace flix {
// Keep ordinary amounts exact; abbreviate million-plus readouts only.
std::string marketNumber(double value, bool exact=false);
std::vector<std::uint16_t> marketPetalSuggestions(std::string query);
std::optional<std::uint16_t> renderMarketPetalSuggestions(MenuContext&,Rect,const std::vector<std::uint16_t>&);
void refreshMarketUi();
void renderMarket(MenuContext&,Rect,bool orders);
}
