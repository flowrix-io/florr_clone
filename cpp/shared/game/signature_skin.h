#pragma once
// A named, server-issued cosmetic using the ordinary skin data format.
// Its id selects a client painter; it grants no account privileges.
#include "shared/game/skin_format.h"
#include <algorithm>
namespace flix {
inline constexpr const char* kSignatureSkinId="signature_a19kisme";
inline CustomSkin makeSignatureSkin() {
    static const int rings[12][12]={
      {25,0,13,22,-13,22,-25,0,-13,-22,13,-22},
      {23,4,8,22,-15,18,-23,-4,-8,-22,15,-18},
      {20,7,4,21,-16,14,-20,-7,-4,-21,16,-14},
      {16,10,0,19,-16,10,-16,-10,0,-19,16,-10},
      {13,11,-3,17,-16,6,-13,-11,3,-17,16,-6},
      {10,12,-5,14,-15,3,-10,-12,5,-14,15,-3},
      {6,11,-6,11,-13,0,-6,-11,6,-11,13,0},
      {4,10,-7,8,-11,-2,-4,-10,7,-8,11,2},
      {2,9,-7,6,-9,-3,-2,-9,7,-6,9,3},
      {0,7,-6,4,-6,-4,0,-7,6,-4,6,4},
      {-1,5,-5,2,-4,-3,1,-5,5,-2,4,3},
      {-1,3,-3,1,-2,-3,1,-3,3,-1,2,3}};
    const double widths[]{2,1.8,1.5,1.5,1.2,1.2,1,1,1,1,0.8,0.8};
    const char* colors[]{"#111111","#222222","#333333","#444444","#555555","#666666","#777777","#888888","#999999","#aaaaaa","#bbbbbb","#cccccc"};
    CustomSkin skin;skin.id=kSignatureSkinId;skin.name="Hex Singularity";skin.author="a19kisme";
    for(int ring=0;ring<12;++ring)for(int edge=0;edge<6;++edge) {
        const int next=(edge+1)%6;SkinShape line;line.t=SkinShapeType::Line;
        line.x=rings[ring][2*edge];line.y=rings[ring][2*edge+1];line.x2=rings[ring][2*next];line.y2=rings[ring][2*next+1];line.stroke=colors[ring];line.sw=widths[ring];skin.shapes.push_back(line);
    }
    return skin;
}
inline bool hasSignatureAnimation(const CustomSkin& skin) {
    return skin.id==kSignatureSkinId && skin.author=="a19kisme" && skin.shapes.size()==72 &&
           std::all_of(skin.shapes.begin(),skin.shapes.end(),[](const SkinShape& shape){return shape.t==SkinShapeType::Line;});
}
}
