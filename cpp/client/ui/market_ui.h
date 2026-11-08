#pragma once
#include "client/ui/menus.h"
namespace flix {
// Keep ordinary amounts exact; abbreviate million-plus readouts only.
std::string marketNumber(double value, bool exact=false);
std::vector<std::uint16_t> marketPetalSuggestions(std::string query);
std::optional<std::uint16_t> renderMarketPetalSuggestions(MenuContext&,Rect,const std::vector<std::uint16_t>&);
enum class MarketConfirmResult { Pending, Cancel, Confirm };
MarketConfirmResult renderMarketConfirmation(MenuContext&,Rect,const std::string&,const std::vector<std::string>&);
void refreshMarketUi();
void renderMarket(MenuContext&,Rect,bool orders);
}
