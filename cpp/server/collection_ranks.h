#pragma once
#include "server/db.h"
#include "server/systems/loot.h"
#include "shared/game/collection.h"
#include <cmath>
namespace flix {
// An acquisition-difficulty INDEX, not a literal drop probability. Prefer
// the easiest source, with minimum mob tier, spawn/replacement weight, drop
// chance, and quantity all contributing. Special/conversion-only forms are
// handled separately instead of pretending they have ordinary mob drops.
inline std::vector<int> collectionBaseRanks(const ContentRegistry& content,const DropTables& drops) {
    std::vector<double> availability(content.petalCount(),0);
    for(std::uint16_t mob=0;mob<content.mobCount();++mob) {
        const auto& m=content.mob(mob);
        if(m.npc.service!=NpcService::None)continue;
        const int tier=ladderIndex(m.minRarity);
        double weight=std::clamp(m.spawnWeight,0.000001,1.0);
        if(m.replacesMobs())weight=std::clamp(m.replaceChance[tier],0.000001,1.0);
        weight/=std::pow(3.0,tier);
        for(const auto& row:drops.forMob(mob)) {
            const double chance=weight*std::clamp(row.probability,0.0,1.0)*std::max(1.0,(row.minCount+row.maxCount)*.5);
            if(row.kind==DropTables::Kind::Petal && row.petalIndex<availability.size())availability[row.petalIndex]=std::max(availability[row.petalIndex],chance);
            else if(row.kind==DropTables::Kind::RandomPetal && !drops.droppablePetals().empty())
                for(const auto index:drops.droppablePetals())availability[index]=std::max(availability[index],chance/drops.droppablePetals().size());
        }
    }
    std::vector<int> result(content.petalCount(),100);
    for(std::uint16_t i=0;i<result.size();++i) {
        const auto& p=content.petal(i);
        if(availability[i]>0)result[i]=std::clamp(int(std::lround(1-19.8*std::log10(std::min(1.0,availability[i]))))+ladderIndex(p.minRarity)*3,1,100);
        if(p.id=="basic")result[i]=1;
    }
    for(std::uint16_t i=0;i<result.size();++i){const auto source=content.magicSourceOf(i);if(source!=kInvalidIndex)result[i]=std::min(100,result[source]+12);}
    return result;
}
inline double collectionUnitScore(const ContentRegistry& content,const std::vector<int>& ranks,std::uint16_t index,Rarity rarity) {
    if(index>=ranks.size()||rarityIndex(rarity)>=kRarityCount||content.petal(index).isAdminPetal)return 0;
    return ranks[index]*kCollectionMultipliers[rarityIndex(rarity)];
}
inline double collectionRecordScore(const ContentRegistry& content,const std::vector<int>& ranks,const PlayerRecord& record) {
    double score=0;
    // Walk only sparse owned entries; presets are references, not ownership.
    for(const auto& tier:record.inventory.keys()) {
        Rarity rarity;if(!tryParseRarity(tier,rarity))continue;
        const auto& items=record.inventory[tier];
        for(const auto& key:items.keys())if(key.compare(0,6,"petal_")==0) {
            const auto index=content.petalIndex(key.substr(6));
            score+=collectionUnitScore(content,ranks,index,rarity)*PlayerRecord::stackCount(items[key]);
        }
    }
    for(const auto& slot:record.loadout)if(slot && slot->type=="petal")score+=collectionUnitScore(content,ranks,content.petalIndex(slot->petalType),slot->rarity);
    return score;
}
}
