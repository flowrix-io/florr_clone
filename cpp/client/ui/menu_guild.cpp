// The guild overlay: the player's guild and its roster, or the create form and
// any pending invitation when they are in none.
//
// Three stacked parts on one card. The header carries the title, the guild's
// name with its [TAG] under it and the description in a sunken box. The
// roster is a band in the frame's own darker cyan that runs edge to edge, so
// the list reads as cut into the card rather than set on it. The footer holds
// the buttons.
//
// Every value the player types is typed where it is shown: the create form's
// fields sit in the header box, Edit turns the name and the description into
// fields in place, and Invite turns the footer into one. Confirmations take
// over the footer the same way. Nothing floats over the game.
//
// The roster and the pending invitation both come from NetClient: the server
// pushes a GuildUpdate to every member whenever one changes -- membership, the
// name or description, or anyone's presence or biome -- and a
// GuildInviteReceived to whoever was invited. Nothing here caches either, so
// there is only ever one answer to "what guild am I in".

#include <algorithm>
#include <cctype>
#include <cmath>
#include <initializer_list>
#include <string>
#include <utility>
#include <vector>

#include "client/ui/menu_theme.h"
#include "client/ui/menu_widgets.h"
#include "client/ui/menus.h"
#include "client/ui/text.h"
#include "client/ui/text_input.h"
#include "client/ui/text_select.h"

namespace flix {

using namespace flix::ui;

namespace {

// --- the card ----------------------------------------------------------------

constexpr double kPanelWidth = 549.0;
constexpr double kPanelHeight = 598.0;
/// The shortest the card is allowed to get on a short viewport. The header is
/// fixed, so everything it gives up comes out of the roster band.
constexpr double kPanelMinHeight = 380.0;

constexpr std::uint32_t kGuildFrame = kGuildSkin.border;
constexpr std::uint32_t kGuildThumb = kGuildSkin.accent;
/// The thumb's own shade one step down: the rim of a button that sits on the
/// roster band, where a rim in the band's colour would vanish.
constexpr std::uint32_t kGuildDeep = 0x107173u;

// --- the header, measured from the card's top edge ---------------------------

constexpr double kGuildTitleSize = 24.0;
constexpr double kTitleBaseline = 39.0;
constexpr double kNameSize = 22.0;
constexpr double kNameBaseline = 85.0;
constexpr double kTagSize = 18.0;
constexpr double kTagBaseline = 111.0;

/// The description box: centred, square-cornered, in the frame's colour.
constexpr double kAboutTop = 136.5;
constexpr double kAboutWidth = 387.0;
constexpr double kAboutTextSize = 14.0;
constexpr double kAboutLine = 20.0;
/// Above the first line and below the last.
constexpr double kAboutPad = 9.5;
/// From the box's left edge to the first glyph.
constexpr double kAboutInset = 12.5;
/// The box grows a line at a time up to this; 120 characters fit in it.
constexpr int kAboutMaxLines = 3;

/// "Members (n)": its baseline under the box's foot, and the band under it.
constexpr double kMembersSize = 16.0;
constexpr double kMembersDrop = 37.5;
constexpr double kBandGap = 11.0;

// --- fields -------------------------------------------------------------------

/// The standard panel field (ui::inputField), at the height of the buttons it
/// shares a row with.
constexpr double kFieldHeight = 32.0;
/// The name field that replaces the name line while editing.
constexpr double kNameFieldWidth = 300.0;
/// Its top, from the card's top: centred on where the name's letters stand.
constexpr double kNameFieldTop = 61.0;
/// A field's inset inside the description box.
constexpr double kBoxFieldInset = 10.0;
constexpr double kTagFieldWidth = 110.0;

/// The server's own limits (server/guilds.h), held at the field so an
/// over-long value is never typed only to be refused.
constexpr std::size_t kNameLimit = 20;
constexpr std::size_t kTagLimit = 5;
constexpr std::size_t kDescriptionLimit = 120;
constexpr std::size_t kUsernameLimit = 24;

// --- the roster band ----------------------------------------------------------

constexpr double kRowPitch = 32.4;
/// The band's top edge to the first row's top, and the margin the rows are
/// clipped to at either end of the band.
constexpr double kRowLead = 9.0;
constexpr double kNameTextSize = 16.0;
constexpr double kDetailTextSize = 14.0;
/// Column starts, from the card's left edge.
constexpr double kDotX = 27.0;
constexpr double kNameX = 45.0;
constexpr double kLocationX = 235.0;
constexpr double kLeaderX = 375.0;
/// The presence dot: a 9-radius disc under a 2-unit ring a shade darker, so 20
/// units across outside the ring and 16 of colour inside it.
constexpr double kDotRadius = 9.0;
constexpr double kDotRing = 2.0;
constexpr std::uint32_t kOnlineDot = 0x62FF74u;
constexpr std::uint32_t kOnlineRing = 0x4FCF60u;
constexpr std::uint32_t kOfflineDot = 0xFF6362u;
constexpr std::uint32_t kOfflineRing = 0xCF5050u;

/// A bare pill, no track: 8 wide, its right edge 16.5 inside the card's.
constexpr double kThumbWidth = 8.0;
constexpr double kThumbRight = 16.5;
constexpr double kThumbInset = 10.0;   ///< from the band's top and bottom
constexpr double kThumbMinHeight = 32.0;
/// One wheel notch is ~100px of deltaY in a browser, consumed unscaled and in
/// the conventional direction.
constexpr double kWheelStep = 100.0;

// --- the footer ---------------------------------------------------------------

/// The light strip under the band that the buttons stand on.
constexpr double kFooterHeight = 48.0;
constexpr double kButtonHeight = 32.0;
constexpr double kButtonMinWidth = 82.0;
constexpr double kCardButtonTextSize = 16.0;
/// From the card's edge to the outermost button, and between two buttons.
constexpr double kButtonMargin = 15.0;
constexpr double kButtonGap = 8.0;

/// The small buttons a hovered row grows at its right end.
constexpr double kRowButtonHeight = 22.0;
constexpr double kRowButtonTextSize = 13.0;
/// Their right edge, clear of the scrollbar.
constexpr double kRowButtonRight = 34.0;

constexpr std::uint32_t kAcceptFace = 0x6CBF5Eu;
constexpr std::uint32_t kAcceptRim = 0x56994Bu;

/// How far below the true middle a `Baseline::Middle` line is set. At the
/// card's 13-16 unit bold sizes this rasterizer's 'middle' seats the letters a
/// unit high of their visual centre.
constexpr double kMiddleNudge = 1.0;

/// What the footer -- and with Edit, the header -- is doing.
enum class Mode : std::uint8_t {
    View,
    Edit,           ///< the name and the description are fields
    Invite,         ///< the footer is a username field
    ConfirmLeave,
    ConfirmKick,
};

/// A field the card owns: its value and its caret.
struct Field {
    std::string value;
    TextFieldState state;
};

/// Everything the card keeps between frames beyond its scroll.
///
/// At file scope for the same reason the drag state below is: there is exactly
/// one panel instance, and menus.h is a header twelve panels share.
struct Form {
    Mode mode = Mode::View;
    Field createName;
    Field createTag;
    Field editName;
    Field editAbout;
    Field invitee;
    /// Who a kick confirm is about.
    std::string member;

    /// Back to View, dropping whatever was being typed into it.
    void view() {
        mode = Mode::View;
        editName = {};
        editAbout = {};
        invitee = {};
        member.clear();
    }
};

Form& form() {
    static Form state;
    return state;
}

/// Thumb-drag state for the scrollbar.
struct ThumbDrag {
    bool active = false;
    double startY = 0;
    double startOffset = 0;
};

ThumbDrag& thumbDrag() {
    static ThumbDrag drag;
    return drag;
}

enum class GuildAction : std::uint8_t {
    None,
    Close,
    Create,
    Edit,
    Save,
    Invite,
    SendInvite,
    Leave,
    Confirm,
    Cancel,
    SquadAll,
    AcceptInvite,
    DeclineInvite,
    Kick,
    SquadOne,
};

struct HitRegion {
    Rect rect;
    GuildAction action = GuildAction::None;
    std::string member;
};

std::string lowered(const std::string& s) {
    std::string out = s;
    std::transform(out.begin(), out.end(), out.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return out;
}

bool sameName(const std::string& a, const std::string& b) { return lowered(a) == lowered(b); }

std::string trimmedText(const std::string& s) {
    const std::size_t first = s.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const std::size_t last = s.find_last_not_of(" \t\r\n");
    return s.substr(first, last - first + 1);
}

/// Bold white over the default size-scaled outline: every line of text on the
/// card is this, at one of five sizes.
TextStyle cardText(double size, Align align = Align::Left, Baseline baseline = Baseline::Middle) {
    TextStyle style;
    style.size = size;
    style.bold = true;
    style.fill = kPaper;
    style.align = align;
    style.baseline = baseline;
    style.roundJoin = true;
    return style;
}

/// White at an alpha, which TextStyle cannot express -- it carries a colour,
/// not a coverage -- and which a pre-mixed grey would get wrong over cyan.
void dimText(Canvas& canvas, const std::string& s, double x, double y, const TextStyle& style,
             double alpha) {
    canvas.setGlobalAlpha(static_cast<float>(alpha));
    text(canvas, s, x, y, style);
    canvas.setGlobalAlpha(1.0f);
}

/// Every button on the card: a rim with the face one step inside it, the
/// label in the card's own outlined white.
void cardButton(Canvas& canvas, Rect r, const std::string& label, std::uint32_t face,
                std::uint32_t rim, bool hovered, double textSize = kCardButtonTextSize) {
    TextCaptureScope off(false);
    const double inset = r.h >= kButtonHeight ? 3.5 : 3.0;
    fillRound(canvas, r, 6.0, rim);
    fillRound(canvas, Rect{r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2}, 3.0,
              hovered ? lighten(face, 0.18) : face);
    text(canvas, label, r.x + r.w * 0.5, r.y + r.h * 0.5 + kMiddleNudge,
         cardText(textSize, Align::Centre));
}

/// A button's width: the label with 18.5 units either side of it, and never
/// narrower than Leave.
double buttonWidth(const std::string& label, double textSize = kCardButtonTextSize,
                   double minWidth = kButtonMinWidth) {
    return std::max(minWidth, std::ceil(measure(label, textSize, true)) + 37.0);
}

/// Greedy word wrap that keeps the description's own spacing: a run of spaces
/// a leader typed to push something to the far side of the box stays a run,
/// and only the space a line breaks at -- and any that would lead the next
/// line -- is dropped. A word too long for a line is broken where it fills it.
std::vector<std::string> wrapAbout(const std::string& s, double width, double size,
                                   int maxLines) {
    std::vector<std::string> words;
    std::size_t at = 0;
    while (true) {
        const std::size_t space = s.find(' ', at);
        words.push_back(s.substr(at, space == std::string::npos ? std::string::npos : space - at));
        if (space == std::string::npos) break;
        at = space + 1;
    }

    std::vector<std::string> lines;
    std::string line;
    bool fresh = true;   ///< nothing placed on `line` yet
    const auto fits = [&](const std::string& t) { return measure(t, size, true) <= width; };
    for (std::string word : words) {
        if (fresh && word.empty()) continue;
        const std::string joined = fresh ? word : line + " " + word;
        if (fits(joined)) {
            line = joined;
            fresh = false;
            continue;
        }
        if (!fresh) {
            lines.push_back(line);
            line.clear();
            fresh = true;
            if (word.empty()) continue;
        }
        // Alone on a line and still too wide: cut it into line-sized pieces.
        while (!fits(word)) {
            std::size_t cut = word.size();
            while (cut > 1 && !fits(word.substr(0, cut))) --cut;
            lines.push_back(word.substr(0, cut));
            word.erase(0, cut);
        }
        line = word;
        fresh = word.empty();
    }
    if (!fresh) lines.push_back(line);

    if (static_cast<int>(lines.size()) > maxLines) {
        lines.resize(static_cast<std::size_t>(maxLines));
        std::string& last = lines.back();
        while (!last.empty() && !fits(last + "...")) last.pop_back();
        last += "...";
    }
    return lines;
}

void presenceDot(Canvas& canvas, double cx, double cy, bool online) {
    canvas.beginPath();
    canvas.arc(static_cast<float>(cx), static_cast<float>(cy), static_cast<float>(kDotRadius),
               0.0f, static_cast<float>(kTau));
    setFill(canvas, online ? kOnlineDot : kOfflineDot);
    canvas.fill();
    setStroke(canvas, online ? kOnlineRing : kOfflineRing);
    canvas.setLineWidth(static_cast<float>(kDotRing));
    canvas.stroke();
}

/// One field visible this frame: where it is, what it edits, and its rules.
struct LiveField {
    Field* field = nullptr;
    Rect rect;
    std::size_t limit = 0;
    bool upperCase = false;
};

} // namespace

double GuildPanel::preferredWidth() { return kPanelWidth; }

Rect GuildPanel::bounds(int, int viewHeight) {
    // Full height wherever it fits, and shorter -- out of the roster -- on a
    // viewport that would otherwise run the footer off its bottom edge.
    const double room = static_cast<double>(viewHeight) - kMenuCornerY - 8.0;
    return {kMenuCornerX, kMenuCornerY, kPanelWidth,
            clamp(room, kPanelMinHeight, kPanelHeight)};
}

void GuildPanel::reset() {
    scroll_ = {};
    thumbDrag() = {};
    // A half-typed edit or a pending confirmation belongs to the opening that
    // raised it, so a reopened card starts from View.
    form() = {};
}

bool GuildPanel::render(MenuContext& ctx) {
    Canvas& canvas = ctx.canvas;
    const Rect panel = ctx.bounds;
    const Vec2 mouse = ctx.mouse();
    const GuildState& guild = ctx.net.guild();
    // Not const: answering an invitation clears the banner on the click, as
    // the reference drops `pendingInvite` before the server has replied.
    GuildInvite& pending = ctx.net.guildInvite();
    Form& f = form();
    const std::string me = ctx.net.profile().username;
    const bool leaderIsMe = guild.joined && sameName(guild.leader, me);
    const double centreX = panel.x + panel.w * 0.5;

    // A mode can outlive what it was about: kicked mid-edit, or the leader
    // handing over while this player was editing. Back to View when it has.
    if (!guild.joined && f.mode != Mode::View) f.view();
    // In a guild, the create form has done its job; leaving later starts a
    // fresh one rather than showing the last guild's name and tag.
    if (guild.joined) {
        f.createName = {};
        f.createTag = {};
    }
    if (f.mode == Mode::Edit && !leaderIsMe) f.view();
    if (f.mode == Mode::Invite && !leaderIsMe) f.view();

    std::vector<HitRegion> regions;
    std::vector<LiveField> fields;

    panelCard(canvas, panel, kGuildSkin);

    text(canvas, "Guild", centreX, panel.y + kTitleBaseline,
         cardText(kGuildTitleSize, Align::Centre, Baseline::Alphabetic));

    const Rect closeRect = closeButtonRect(panel);
    panelClose(canvas, closeRect, closeRect.contains(mouse));
    regions.push_back({closeRect, GuildAction::Close, {}});

    // --- header ---------------------------------------------------------------

    const bool editing = f.mode == Mode::Edit;
    std::vector<std::string> aboutLines;
    if (guild.joined) {
        if (editing) {
            const Rect nameField{centreX - kNameFieldWidth * 0.5, panel.y + kNameFieldTop,
                                 kNameFieldWidth, kFieldHeight};
            inputField(canvas, nameField, f.editName.value, "Guild name",
                       f.editName.state.focused, ctx.timeSeconds, &f.editName.state);
            fields.push_back({&f.editName, nameField, kNameLimit, false});
        } else {
            text(canvas, guild.name, centreX, panel.y + kNameBaseline,
                 cardText(kNameSize, Align::Centre, Baseline::Alphabetic));
        }
        text(canvas, "[" + guild.tag + "]", centreX, panel.y + kTagBaseline,
             cardText(kTagSize, Align::Centre, Baseline::Alphabetic));
        aboutLines = wrapAbout(guild.description, kAboutWidth - kAboutInset * 2,
                               kAboutTextSize, kAboutMaxLines);
    } else {
        text(canvas, "No guild", centreX, panel.y + kNameBaseline,
             cardText(kNameSize, Align::Centre, Baseline::Alphabetic));
        dimText(canvas, "Name a guild and pick a 5-letter tag to start one",
                centreX, panel.y + kTagBaseline,
                cardText(kDetailTextSize, Align::Centre, Baseline::Alphabetic), 0.85);
    }

    // The box is as tall as the description it shows. Holding a field instead
    // -- the create form, or the description being edited -- it is at least
    // tall enough for one with a margin round it.
    const bool boxHoldsFields = !guild.joined || editing;
    const int lineCount = std::max(1, static_cast<int>(aboutLines.size()));
    const double textHeight = kAboutPad * 2 + lineCount * kAboutLine;
    const double boxHeight =
        boxHoldsFields ? std::max(textHeight, kFieldHeight + kBoxFieldInset * 2) : textHeight;
    const Rect aboutBox{centreX - kAboutWidth * 0.5, panel.y + kAboutTop, kAboutWidth,
                        boxHeight};
    setFill(canvas, kGuildFrame);
    canvas.fillRect(static_cast<float>(aboutBox.x), static_cast<float>(aboutBox.y),
                    static_cast<float>(aboutBox.w), static_cast<float>(aboutBox.h));
    const double boxFieldY = aboutBox.y + (aboutBox.h - kFieldHeight) * 0.5;

    if (!guild.joined) {
        const Rect tagField{aboutBox.right() - kBoxFieldInset - kTagFieldWidth, boxFieldY,
                            kTagFieldWidth, kFieldHeight};
        const Rect nameField{aboutBox.x + kBoxFieldInset, boxFieldY,
                             tagField.x - kButtonGap - (aboutBox.x + kBoxFieldInset),
                             kFieldHeight};
        inputField(canvas, nameField, f.createName.value, "Guild name",
                   f.createName.state.focused, ctx.timeSeconds, &f.createName.state);
        inputField(canvas, tagField, f.createTag.value, "Tag", f.createTag.state.focused,
                   ctx.timeSeconds, &f.createTag.state);
        fields.push_back({&f.createName, nameField, kNameLimit, false});
        fields.push_back({&f.createTag, tagField, kTagLimit, true});
    } else if (editing) {
        const Rect aboutField{aboutBox.x + kBoxFieldInset, boxFieldY,
                              aboutBox.w - kBoxFieldInset * 2, kFieldHeight};
        inputField(canvas, aboutField, f.editAbout.value, "Description (optional)",
                   f.editAbout.state.focused, ctx.timeSeconds, &f.editAbout.state);
        fields.push_back({&f.editAbout, aboutField, kDescriptionLimit, false});
    } else if (aboutLines.empty()) {
        dimText(canvas, leaderIsMe ? "No description yet. Edit to add one." : "No description.",
                aboutBox.x + kAboutInset,
                aboutBox.y + kAboutPad + kAboutLine * 0.5 + kMiddleNudge,
                cardText(kAboutTextSize), 0.6);
    } else {
        for (std::size_t i = 0; i < aboutLines.size(); ++i) {
            text(canvas, aboutLines[i], aboutBox.x + kAboutInset,
                 aboutBox.y + kAboutPad + kAboutLine * (static_cast<double>(i) + 0.5) +
                     kMiddleNudge,
                 cardText(kAboutTextSize));
        }
    }

    const double membersBaseline = aboutBox.bottom() + kMembersDrop;
    const std::string listHeading =
        guild.joined ? "Members (" + std::to_string(guild.members.size()) + ")"
                     : std::string("Invitations");
    text(canvas, listHeading, centreX, membersBaseline,
         cardText(kMembersSize, Align::Centre, Baseline::Alphabetic));

    // --- the roster band --------------------------------------------------------

    const double inner = panel.bottom() - kMenuBorder;
    const Rect band{panel.x, membersBaseline + kBandGap, panel.w,
                    std::max(0.0, inner - kFooterHeight - (membersBaseline + kBandGap))};
    setFill(canvas, kGuildFrame);
    canvas.fillRect(static_cast<float>(band.x), static_cast<float>(band.y),
                    static_cast<float>(band.w), static_cast<float>(band.h));

    // This panel measures its body by drawing it, so the scroll bounds are
    // last frame's -- as they are in the reference, whose pointer handlers read
    // the contentHeight the previous render left behind.
    const double visible = band.h;
    const double maxScroll = std::max(0.0, scroll_.contentHeight - visible);
    const Rect track{panel.right() - kThumbRight - kThumbWidth, band.y + kThumbInset,
                     kThumbWidth, std::max(0.0, band.h - kThumbInset * 2)};
    // A finger-wide grab zone around the thumb's column.
    const Rect grab{track.x - 6.0, band.y, track.w + 12.0, band.h};

    if (panel.contains(mouse)) scroll_.offset -= ctx.wheel() * kWheelStep;

    ThumbDrag& drag = thumbDrag();
    const bool scrollable = scroll_.contentHeight > visible;
    // Everything in the band but the grab zone, which a finger drags the other
    // way.
    scroll_.offset -=
        touchScroll(ctx.window, Rect{band.x, band.y, grab.x - band.x, band.h}, scrollable);
    if (ctx.pressed() && scrollable && grab.contains(mouse)) {
        drag.active = true;
        drag.startY = mouse.y;
        drag.startOffset = scroll_.offset;
    }
    if (!ctx.window.mouseDown(MouseButton::Left)) drag.active = false;
    // The thumb's size from last frame's content, as everything here is.
    const double thumbHeight =
        scrollable ? std::min(track.h, std::max(kThumbMinHeight,
                                                track.h * visible / scroll_.contentHeight))
                   : track.h;
    if (drag.active) {
        // A thumb dragged its whole travel scrolls the whole list.
        const double travel = std::max(1.0, track.h - thumbHeight);
        scroll_.offset = drag.startOffset + (mouse.y - drag.startY) / travel * maxScroll;
    }
    scroll_.offset = clamp(scroll_.offset, 0.0, maxScroll);

    // Rows are clipped a row-lead inside the band at either end, so one
    // scrolled to the foot is cut short of the footer rather than flush on it.
    const Rect listView{band.x, band.y + kRowLead, band.w, std::max(0.0, band.h - kRowLead * 2)};
    canvas.save();
    canvas.beginPath();
    canvas.rect(static_cast<float>(listView.x), static_cast<float>(listView.y),
                static_cast<float>(listView.w), static_cast<float>(listView.h));
    canvas.clip();

    double contentHeight = 0;
    // Row hover only counts where rows are drawn, and only while the footer is
    // not already asking something.
    const bool pointing =
        listView.contains(mouse) && !grab.contains(mouse) && f.mode == Mode::View;

    if (!guild.joined) {
        if (pending.waiting) {
            const Rect card{panel.x + kButtonMargin, band.y + 12.0 - scroll_.offset,
                            panel.w - kButtonMargin * 2, 58.0};
            fillRound(canvas, card, 6.0, kGuildThumb);
            dimText(canvas, "@" + pending.fromUsername + " invited you to join", card.x + 14.0,
                    card.y + 18.0, cardText(kDetailTextSize), 0.9);
            text(canvas, pending.displayName + " [" + pending.guildName + "]", card.x + 14.0,
                 card.y + 39.0, cardText(kTagSize));

            const double declineW = buttonWidth("Decline");
            const double acceptW = buttonWidth("Accept");
            const double buttonY = card.y + (card.h - kButtonHeight) * 0.5;
            const Rect decline{card.right() - 13.0 - declineW, buttonY, declineW, kButtonHeight};
            const Rect accept{decline.x - kButtonGap - acceptW, buttonY, acceptW, kButtonHeight};
            cardButton(canvas, accept, "Accept", kAcceptFace, kAcceptRim,
                       pointing && accept.contains(mouse));
            cardButton(canvas, decline, "Decline", kCloseFace, kCloseRim,
                       pointing && decline.contains(mouse));
            if (pointing) {
                regions.push_back({accept, GuildAction::AcceptInvite, {}});
                regions.push_back({decline, GuildAction::DeclineInvite, {}});
            }
            contentHeight = 12.0 + card.h + 12.0;
        } else {
            dimText(canvas, "No pending invitations", centreX, band.y + 25.0,
                    cardText(kDetailTextSize, Align::Centre), 0.7);
            contentHeight = 50.0;
        }
    } else {
        std::vector<const GuildState::Member*> sorted;
        sorted.reserve(guild.members.size());
        for (const GuildState::Member& member : guild.members) sorted.push_back(&member);
        // The leader first, online or not; then everyone online, then everyone
        // else, each by name. localeCompare orders case-insensitively, and a
        // raw byte compare would file every capitalised name ahead of every
        // lower-case one.
        std::stable_sort(sorted.begin(), sorted.end(),
                         [&](const GuildState::Member* a, const GuildState::Member* b) {
                             const bool aLead = sameName(a->name, guild.leader);
                             const bool bLead = sameName(b->name, guild.leader);
                             if (aLead != bLead) return aLead;
                             if (a->online != b->online) return a->online;
                             const std::string al = lowered(a->name);
                             const std::string bl = lowered(b->name);
                             return al != bl ? al < bl : a->name < b->name;
                         });

        for (std::size_t i = 0; i < sorted.size(); ++i) {
            const GuildState::Member& member = *sorted[i];
            const Rect row{panel.x + kMenuBorder,
                           band.y + kRowLead + static_cast<double>(i) * kRowPitch -
                               scroll_.offset,
                           panel.w - kMenuBorder * 2, kRowPitch};
            if (row.bottom() < band.y || row.y > band.bottom()) continue;
            const double midY = row.y + row.h * 0.5;
            const double textY = midY + kMiddleNudge;

            const bool isSelf = sameName(member.name, me);
            const bool isLeader = sameName(member.name, guild.leader);
            const bool canSquad = !isSelf && member.online;
            const bool canKick = leaderIsMe && !isSelf;
            const bool hovered = pointing && row.contains(mouse) && (canSquad || canKick);

            if (hovered) fillRound(canvas, row, 4.0, kPaper, 0.08);

            presenceDot(canvas, panel.x + kDotX, midY, member.online);
            text(canvas, member.name, panel.x + kNameX, textY, cardText(kNameTextSize));
            if (!member.location.empty()) {
                text(canvas, member.location, panel.x + kLocationX, textY,
                     cardText(kDetailTextSize));
            }
            if (isLeader) {
                // On the true middle: parentheses reach below the baseline,
                // so the label already looks centred there and the nudge that
                // seats the letters would set it a unit low.
                text(canvas, "(Leader)", panel.x + kLeaderX, midY, cardText(kDetailTextSize));
            }

            // A row's own actions, only while it is pointed at: a column of
            // buttons down every row would bury the names it is a list of.
            if (!hovered) continue;
            double buttonRight = panel.right() - kRowButtonRight;
            const double buttonY = midY - kRowButtonHeight * 0.5;
            if (canKick) {
                const double w = buttonWidth("Kick", kRowButtonTextSize, 52.0);
                const Rect kick{buttonRight - w, buttonY, w, kRowButtonHeight};
                cardButton(canvas, kick, "Kick", kCloseFace, kCloseRim, kick.contains(mouse),
                           kRowButtonTextSize);
                regions.push_back({kick, GuildAction::Kick, member.name});
                buttonRight = kick.x - 6.0;
            }
            if (canSquad) {
                const double w = buttonWidth("Squad", kRowButtonTextSize, 52.0);
                const Rect squad{buttonRight - w, buttonY, w, kRowButtonHeight};
                cardButton(canvas, squad, "Squad", kGuildThumb, kGuildDeep, squad.contains(mouse),
                           kRowButtonTextSize);
                regions.push_back({squad, GuildAction::SquadOne, member.name});
            }
        }
        contentHeight = kRowLead * 2 + static_cast<double>(sorted.size()) * kRowPitch;
    }

    canvas.restore();
    scroll_.contentHeight = contentHeight;
    scroll_.viewHeight = visible;

    if (contentHeight > visible && track.h > 0) {
        const double size =
            std::min(track.h, std::max(kThumbMinHeight, track.h * visible / contentHeight));
        const double travel = std::max(1.0, contentHeight - visible);
        const Rect thumb{track.x, track.y + (scroll_.offset / travel) * (track.h - size),
                         track.w, size};
        fillRound(canvas, thumb, kThumbWidth * 0.5, kGuildThumb);
    }

    // --- footer -------------------------------------------------------------------

    const double buttonY = inner - kFooterHeight * 0.5 - kButtonHeight * 0.5;
    const auto footerButton = [&](double x, const std::string& label, std::uint32_t face,
                                  std::uint32_t rim, GuildAction action) {
        const Rect r{x, buttonY, buttonWidth(label), kButtonHeight};
        cardButton(canvas, r, label, face, rim, r.contains(mouse));
        regions.push_back({r, action, {}});
        return r;
    };
    // Lays buttons out leftwards from the card's right margin, the first named
    // outermost and in its own colours, the rest neutral. Returns the left
    // edge of the last one.
    const auto rightButtons = [&](std::initializer_list<std::pair<const char*, GuildAction>> row,
                                  std::uint32_t outerFace, std::uint32_t outerRim) {
        double x = panel.right() - kButtonMargin;
        bool first = true;
        for (const auto& [label, action] : row) {
            x -= buttonWidth(label);
            footerButton(x, label, first ? outerFace : kGuildFrame,
                         first ? outerRim : kGuildThumb, action);
            x -= kButtonGap;
            first = false;
        }
        return x + kButtonGap;
    };
    const auto footerQuestion = [&](const std::string& question) {
        text(canvas, question, panel.x + kButtonMargin + 4.0,
             buttonY + kButtonHeight * 0.5 + kMiddleNudge, cardText(kCardButtonTextSize));
    };

    if (!guild.joined) {
        rightButtons({{"Create guild", GuildAction::Create}}, kGuildFrame, kGuildThumb);
    } else {
        switch (f.mode) {
            case Mode::View: {
                // Leave alone on the right; everything else in a row from the
                // left, so the one irreversible button is never the neighbour
                // of one that is not.
                rightButtons({{"Leave", GuildAction::Leave}}, kCloseFace, kCloseRim);
                double x = panel.x + kButtonMargin;
                x = footerButton(x, "Squad up", kGuildFrame, kGuildThumb, GuildAction::SquadAll)
                        .right() +
                    kButtonGap;
                if (leaderIsMe) {
                    x = footerButton(x, "Invite", kGuildFrame, kGuildThumb, GuildAction::Invite)
                            .right() +
                        kButtonGap;
                    footerButton(x, "Edit", kGuildFrame, kGuildThumb, GuildAction::Edit);
                }
                break;
            }
            case Mode::Edit:
                rightButtons({{"Save", GuildAction::Save}, {"Cancel", GuildAction::Cancel}},
                             kAcceptFace, kAcceptRim);
                break;
            case Mode::Invite: {
                const double left = rightButtons(
                    {{"Send", GuildAction::SendInvite}, {"Cancel", GuildAction::Cancel}},
                    kAcceptFace, kAcceptRim);
                const Rect field{panel.x + kButtonMargin, buttonY,
                                 left - kButtonGap - (panel.x + kButtonMargin), kFieldHeight};
                inputField(canvas, field, f.invitee.value, "Username to invite",
                           f.invitee.state.focused, ctx.timeSeconds, &f.invitee.state);
                fields.push_back({&f.invitee, field, kUsernameLimit, false});
                break;
            }
            case Mode::ConfirmLeave:
                footerQuestion("Leave this guild?");
                rightButtons({{"Leave", GuildAction::Confirm}, {"Cancel", GuildAction::Cancel}},
                             kCloseFace, kCloseRim);
                break;
            case Mode::ConfirmKick:
                footerQuestion("Kick " + f.member + "?");
                rightButtons({{"Kick", GuildAction::Confirm}, {"Cancel", GuildAction::Cancel}},
                             kCloseFace, kCloseRim);
                break;
        }
    }

    // --- actions ------------------------------------------------------------------

    const auto submitCreate = [&] {
        const std::string name = trimmedText(f.createName.value);
        const std::string tag = trimmedText(f.createTag.value);
        // Whichever is missing takes the caret, rather than the server being
        // asked to refuse it.
        if (name.empty()) {
            f.createTag.state.blur();
            f.createName.state.focusAtEnd(f.createName.value, ctx.timeSeconds);
            return;
        }
        if (tag.empty()) {
            f.createName.state.blur();
            f.createTag.state.focusAtEnd(f.createTag.value, ctx.timeSeconds);
            return;
        }
        ctx.net.requestGuildCreate(tag, name);
        f.createName.state.blur();
        f.createTag.state.blur();
    };
    const auto saveEdit = [&] {
        const std::string name = trimmedText(f.editName.value);
        if (name.empty()) {
            f.editAbout.state.blur();
            f.editName.state.focusAtEnd(f.editName.value, ctx.timeSeconds);
            return;
        }
        ctx.net.requestGuildEdit(name, trimmedText(f.editAbout.value));
        f.view();
    };
    const auto sendInvite = [&] {
        const std::string name = trimmedText(f.invitee.value);
        if (!name.empty()) ctx.net.requestGuildInvite(name);
        f.view();
    };
    const auto confirm = [&] {
        if (f.mode == Mode::ConfirmLeave) ctx.net.requestGuildLeave();
        if (f.mode == Mode::ConfirmKick) ctx.net.requestGuildKick(f.member);
        f.view();
    };

    // --- fields -------------------------------------------------------------------

    // Pointer first: a press inside a field takes the caret, a press anywhere
    // else lets it go. Close is the exception -- it acts on its own and must
    // not cost a half-typed value its focus on the way.
    if (!(ctx.pressed() && closeRect.contains(mouse))) {
        for (const LiveField& live : fields) {
            trackTextMouse(ctx.window, live.field->state, live.rect,
                           inputFieldRun(live.rect, live.field->value, live.field->state),
                           live.field->value, ctx.timeSeconds);
            if (live.rect.contains(mouse)) ctx.window.setCursorShape(CursorShape::Text);
        }
    }

    const bool confirming = f.mode == Mode::ConfirmLeave || f.mode == Mode::ConfirmKick;
    if (confirming) {
        // The footer is asking: Enter answers yes, Escape no, and neither
        // reaches the menu system's own Escape-to-close.
        ctx.wantsText = true;
        if (ctx.window.keyPressed(Key::Enter)) confirm();
        else if (ctx.window.keyPressed(Key::Escape)) f.view();
    }

    for (std::size_t i = 0; i < fields.size(); ++i) {
        const LiveField& live = fields[i];
        if (!live.field->state.focused) continue;
        ctx.wantsText = true;
        // Printable ASCII only, which is what keeps the caret's byte index and
        // its character index the same thing. Guild names, tags, descriptions
        // and usernames are all ASCII by the server's own rules.
        TextEditOptions typing;
        typing.maxBytes = live.limit;
        typing.asciiOnly = true;
        editText(ctx.window, live.field->value, live.field->state, ctx.timeSeconds, typing);
        // The server upper-cases a tag anyway; showing it that way as it is
        // typed is what tells the player case does not matter. Same length,
        // so the caret's offsets survive it.
        if (live.upperCase) {
            for (char& c : live.field->value) {
                c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
            }
        }
        if (ctx.window.keyPressed(Key::Tab) && fields.size() > 1) {
            // Round the visible fields in order: name to tag, name to
            // description.
            const LiveField& next = fields[(i + 1) % fields.size()];
            live.field->state.blur();
            next.field->state.focusAtEnd(next.field->value, ctx.timeSeconds);
        } else if (ctx.window.keyPressed(Key::Enter)) {
            if (!guild.joined) submitCreate();
            else if (f.mode == Mode::Edit) saveEdit();
            else if (f.mode == Mode::Invite) sendInvite();
        } else if (ctx.window.keyPressed(Key::Escape)) {
            // Out of an edit or an invite entirely; the create form just lets
            // the caret go, since there is nothing to back out of.
            if (guild.joined) f.view();
            else live.field->state.blur();
        }
        break;
    }

    // --- clicks -------------------------------------------------------------------

    if (!ctx.released()) return true;
    for (const HitRegion& region : regions) {
        if (!region.rect.contains(mouse)) continue;
        switch (region.action) {
            case GuildAction::Close:
                f.view();
                return false;
            case GuildAction::Create:
                submitCreate();
                break;
            case GuildAction::Edit:
                f.view();
                f.mode = Mode::Edit;
                f.editName.value = guild.name.substr(0, kNameLimit);
                f.editAbout.value = guild.description.substr(0, kDescriptionLimit);
                f.editName.state.focusAtEnd(f.editName.value, ctx.timeSeconds);
                break;
            case GuildAction::Save:
                saveEdit();
                break;
            case GuildAction::Invite:
                f.view();
                f.mode = Mode::Invite;
                f.invitee.state.focusAtEnd(f.invitee.value, ctx.timeSeconds);
                break;
            case GuildAction::SendInvite:
                sendInvite();
                break;
            case GuildAction::Leave:
                f.view();
                f.mode = Mode::ConfirmLeave;
                break;
            case GuildAction::Kick:
                f.view();
                f.mode = Mode::ConfirmKick;
                f.member = region.member;
                break;
            case GuildAction::Confirm:
                confirm();
                break;
            case GuildAction::Cancel:
                f.view();
                break;
            case GuildAction::SquadAll:
                ctx.net.requestGuildSquadAll();
                break;
            case GuildAction::SquadOne:
                ctx.net.requestGuildInviteToSquad(region.member);
                break;
            case GuildAction::AcceptInvite:
                ctx.net.requestGuildAccept();
                pending = {};
                break;
            case GuildAction::DeclineInvite:
                ctx.net.requestGuildDecline();
                pending = {};
                break;
            case GuildAction::None:
                break;
        }
        break;
    }
    return true;
}

} // namespace flix
