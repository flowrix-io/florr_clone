#pragma once
#include "shared/core/types.h"
namespace flix {
struct MenuContext;
void renderStarCodes(MenuContext&,Rect);
void renderEventSetup(MenuContext&,Rect);
void renderEventRules(MenuContext&,Rect);
void renderPetalBans(MenuContext&,Rect);
void renderEventTeams(MenuContext&,Rect);
void resetAdminToolsUi();
}
