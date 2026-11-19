#pragma once
// Panel palettes.
//
// Every menu in the game is the same object -- a rounded card in a saturated
// colour, a darker border of the same hue, white outlined text -- and is told
// apart by that colour alone. A player learns "blue is my petals, tan is the
// forge, yellow is the bestiary" long before they read a title, so the colours
// are the identity and belong in one table rather than in eight files.

#include <cstdint>

#include "client/ui/theme.h"

namespace flix::ui {

/// The fill a panel is built from, its border, and the colours of the chrome
/// that sits on it. The border is always borderOf(fill) -- it cannot be given.
struct PanelSkin {
    std::uint32_t fill = kPanel;
    std::uint32_t border = kPanelDark;
    /// Divider rules and the scrollbar thumb. Defaults to the border colour,
    /// which is what makes both read as part of the frame rather than content.
    std::uint32_t accent = kPanelDark;

    constexpr PanelSkin() = default;
    constexpr explicit PanelSkin(std::uint32_t f)
        : fill(f), border(borderOf(f)), accent(borderOf(f)) {}
    constexpr PanelSkin(std::uint32_t f, std::uint32_t a)
        : fill(f), border(borderOf(f)), accent(a) {}
};

/// The close button's face and rim, shared by EVERY panel rather than carried
/// per skin.
///
/// It is the one control on a card that does not belong to the card: it means
/// the same thing everywhere and it is the one a player hits without looking,
/// so tinting it per panel makes the muscle memory hunt for a different button
/// each time. These are the inventory's, which is what the rest were dragged
/// to match.
inline constexpr std::uint32_t kCloseFace = 0xAE5B58u;
inline constexpr std::uint32_t kCloseRim = borderOf(kCloseFace);

inline constexpr PanelSkin kInventorySkin{0x6B9DD6u};
/// The craft key's four windows are florr's, in florr's themes: each is the
/// colour its controller answers with. Its border is borderOf(theme), like
/// every menu's; its empty slots and cells are slotCardShade(theme).
/// Forge tan, oracle slate, trader yellow, the titan's charcoal and the
/// assembler's machine grey.
inline constexpr PanelSkin kCraftingSkin{0xDB9D5Au};
/// The forge's other side, Absorb: florr's old client's purple (its absorb
/// controller's theme), under the same border shade.
inline constexpr PanelSkin kAbsorbSkin{0x895ADBu};
inline constexpr PanelSkin kOracleSkin{0x66869Eu};
inline constexpr PanelSkin kTraderSkin{0xFFE763u};
inline constexpr PanelSkin kTitanSkin{0x333333u};
inline constexpr PanelSkin kAssemblerSkin{0x999999u};
inline constexpr PanelSkin kGallerySkin{0xE6D64Cu};
/// florr's Talents window. The tree's own ink -- every connector, the node
/// rims, the flower's hub and the TP badge -- is slotCardShade of its theme.
inline constexpr PanelSkin kTalentsSkin{0xDB5A5Au};
/// The Account card wears the purple of the talents STRIP button (not the
/// talent card's red above), and so does its own button on the top row.
inline constexpr PanelSkin kAccountSkin{0x9D4EDDu};
/// The shop is drawn against a reference screenshot rather than against the
/// browser build's CSS, so its greens are that shot's. Its frame
/// is NOT in that shot -- the shot's card runs to its own edge -- but a shop
/// with no frame is the one menu in the game that is not a card, so it wears
/// the same border every other panel does.
inline constexpr PanelSkin kShopSkin{0x65c359u, 0x7DC065u};
inline constexpr PanelSkin kSkinsSkin{0x8737B6u};
inline constexpr PanelSkin kLeaderboardSkin{0xE8A023u};
/// Settings and the debug panel share one grey card.
inline constexpr PanelSkin kSettingsSkin{0xAAAAAAu};
inline constexpr PanelSkin kDebugSkin = kSettingsSkin;
inline constexpr PanelSkin kChangelogSkin{0x49C46Fu};
inline constexpr PanelSkin kNotificationsSkin{0x4A90E2u};
/// The guild card is the mythic cyan, its frame -- which is also the roster
/// band and the description box -- that cyan's border shade, and the scroll
/// thumb one step darker again.
inline constexpr PanelSkin kGuildSkin{0x1FDBDEu, borderOf(borderOf(0x1FDBDEu))};
/// The database editor: a slate no player-facing panel wears, because it is not
/// one -- an admin should never mistake it for the settings card beside it.
inline constexpr PanelSkin kAdminDbSkin{0x55606Bu, 0x7A8794u};
/// The admin dashboard: an indigo no player-facing panel wears either, for the
/// editor's reason. Its strip button and the Release chip wear it too, so both
/// say which card they belong to.
inline constexpr PanelSkin kAdminDashboardSkin{0x5C5B9Cu, 0x7F7EBFu};
/// The asset browser: the teal of the debug panel's Assets button, which is
/// the one way in, so the card it opens reads as that button's.
inline constexpr PanelSkin kAssetsSkin{0x3E7C74u, 0x63A89Eu};
/// The Trial Grounds floor picker: the purple of its tab in the spawn picker,
/// which is the one way in. Its Refreshing page a deeper violet, so the two
/// pages read as two rooms of the same card.
inline constexpr PanelSkin kTrialsSkin{0x8A63D2u};
inline constexpr PanelSkin kRefreshingTrialsSkin{0x6A4AAEu};

// --- shared panel metrics ---------------------------------------------------

/// Border width and corner radius. A heavy frame on a softly rounded corner:
/// the list panels read as a slab the content is sunk into, and the corner is
/// round enough to be seen past the border's own thickness.
inline constexpr double kMenuBorder = 7.0;
inline constexpr double kMenuRadius = 5.0;
inline constexpr double kMenuPadding = 14.0;

/// Title, then the line under it that says what to do with the panel. The gap
/// between the two is wide enough that they read as a heading and a caption
/// rather than as one block.
inline constexpr double kMenuTitleSize = 24.0;
inline constexpr double kMenuSubtitleSize = 16.0;

/// Where those two sit, measured from the panel's top edge rather than from
/// `kMenuPadding`: the heading is clear of the border, and the gap under it is
/// wide enough that the title and the instruction line read as two things.
inline constexpr double kMenuTitleTop = 19.0;
inline constexpr double kMenuSubtitleDrop = 43.0;

/// The square close button in every panel's top-right corner.
inline constexpr double kCloseSize = 29.0;


/// One inventory/shop/gallery cell. Five of them plus their gaps is what sets
/// the inventory panel's width, so these two are load-bearing.
///
/// 60 is `kItemTileDesign`: at exactly that size a tile is drawn 1:1 with the
/// design cell it is written in, so no icon, name or badge is resampled.
inline constexpr double kCellSize = 60.0;
inline constexpr double kCellGap = 10.0;

/// The dark chrome the toggle and the TP badge are made of. Text inputs have
/// their own colours, in client/ui/theme.h.
inline constexpr std::uint32_t kControlDark = 0x3A3A3Au;
inline constexpr std::uint32_t kControlMid = 0x666666u;
inline constexpr std::uint32_t kControlLit = 0xCFCFCFu;

/// The two anchors the browser build hangs panels off.
///
/// The tall list panels (inventory, craft, talents) sit a third of the way
/// down and kMenuInsetX in from the left, clear of the icon column, and run
/// two thirds of the viewport tall. The corner panels (settings, changelog,
/// notifications, guild, leaderboard, skins, shop, gallery, debug and the two
/// admin cards) are pinned directly under the top icon row instead, at their
/// own fixed sizes.
inline constexpr double kMenuInsetX = 91.0;
inline constexpr double kMenuListTopFraction = 1.0 / 3.0;
inline constexpr double kMenuListHeightFraction = 2.0 / 3.0;
/// ...less this, so the card stops short of the bottom edge instead of being
/// clipped by it. `top + height` is exactly 1.0, so without a pad every list
/// panel runs off the screen whatever the viewport is.
inline constexpr double kMenuListBottomPad = 16.0;
/// The corner panels hang off the top-left corner, tucked in under the icon
/// row: 6 in from the edge -- a shade further out than the row's own 9, so the
/// card reads as a page under the buttons rather than as one more button --
/// and 5 below the row's bottom edge.
inline constexpr double kMenuCornerX = 6.0;
inline constexpr double kMenuCornerY = 62.0;

} // namespace flix::ui
