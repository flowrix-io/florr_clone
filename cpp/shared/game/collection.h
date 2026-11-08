#pragma once
#include "shared/game/rarity.h"
#include <algorithm>
#include <array>
#include <cctype>
#include <string>
namespace flix {
// Each copy has equal weight; each rung is five times the previous one.
// Universal is collectible; operator-created Admin petals earn no points.
inline constexpr std::array<double,kRarityCount> kCollectionMultipliers{{1,5,25,125,625,3125,15625,78125,390625,1953125,9765625,0}};
inline bool collectionRarityFilter(std::string filter,int& minimum,int& maximum) {
    minimum=0;maximum=kLadderRarityCount-1;
    filter.erase(std::remove_if(filter.begin(),filter.end(),[](unsigned char c){return std::isspace(c);}),filter.end());
    for(char& c:filter)c=char(std::tolower(static_cast<unsigned char>(c)));
    if(filter.empty()||filter=="all")return true;
    char range=0;if(filter.back()=='+'||filter.back()=='-'){range=filter.back();filter.pop_back();}
    if(filter=="eternal")filter="unique";if(filter=="unusual")filter="uncommon";
    Rarity rarity;if(!tryParseRarity(filter,rarity)||rarityIndex(rarity)>=kLadderRarityCount)return false;
    const int index=rarityIndex(rarity);
    if(range!='-')minimum=index;
    if(range!='+')maximum=index;
    return true;
}
}
