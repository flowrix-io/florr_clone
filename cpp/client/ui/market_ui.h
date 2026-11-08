#pragma once
#include "client/ui/menus.h"
namespace flix {
struct MarketFeedback {
    double revision=-1,until=0;
    std::string message;
    bool ok=true;
    void update(const Json&,double now);
    void clear(){message.clear();until=0;}
    bool visible(double now)const{return !message.empty()&&now<until;}
};
// Keep ordinary amounts exact; abbreviate million-plus readouts only.
std::string marketNumber(double value, bool exact=false);
std::vector<std::uint16_t> marketPetalSuggestions(std::string query);
std::optional<std::uint16_t> renderMarketPetalSuggestions(MenuContext&,Rect,const std::vector<std::uint16_t>&);
enum class MarketConfirmResult { Pending, Cancel, Confirm };
MarketConfirmResult renderMarketConfirmation(MenuContext&,Rect,const std::string&,const std::vector<std::string>&);
void refreshMarketUi();
void renderMarket(MenuContext&,Rect,bool orders);
}
