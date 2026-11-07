#pragma once
#include "shared/core/types.h"
namespace flix {
struct MenuContext;
void renderStarCodes(MenuContext&,Rect);
void renderEventSetup(MenuContext&,Rect);
void renderEventRules(MenuContext&,Rect);
void resetAdminToolsUi();
}
