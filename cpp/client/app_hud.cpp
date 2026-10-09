// The HUD: the flower's own corner, the squad's bars under it, the boss bars
// across the top, and an admin's announcement under those.
//
// While this client steers another player's flower (the admin dashboard's
// control), the snapshot's self block describes THAT flower, and so does the
// corner here: its name, its health, its level. That is the flower on the
// screen and under the controls, so it is the one to show. What describes
// this account instead is read from the profile -- the shop's balance, the
// talent card's numbers -- and the loadout bar, which would mix the two, is
// taken off the screen for the length of it (MenuSystem::drawLoadoutBar).
//
// The bar painters are the reason this file is worth reading. A HUD bar is
// not a generic inset bar and a flower's health bar is not a mob's -- both
// are drawn as non-overlapping rings punched out of one path, so that every
// pixel is blended with the world exactly once and the layer comes out flat
// rather than muddy. See hudBar() and flowerBar().

#include "client/app.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "client/ui/draw.h"
#include "client/ui/text.h"
#include "client/ui/text_input.h"
#include "shared/game/config.h"

namespace flix {

using namespace flix::ui;

namespace {

// Absolute pixel anchors, exactly as the reference's are. Nothing in this
// block is derived from the viewport or from the icon strip: the browser lays
// it out at fixed coordinates and never reflows it, so deriving it here would
// put it somewhere the reference never has it.
constexpr double kFlowerCentreX = 60.0;
/// The flower's ART radius, the space drawFlowerBody() is authored in. The
/// body's rim lands at 26.5/25 of it, so the drawn disc is 31.8 across the
/// middle -- which is what the reference's avatar measures.
constexpr double kHudFlowerRadius = 30.0;
/// The disc the layout has to clear, rim included.
constexpr double kHudFlowerBody = kHudFlowerRadius * (26.5 / 25.0);
constexpr double kHudBarWidth = 186.0;
constexpr double kHudBarHeight = 24.0;
constexpr double kHudBarX = kFlowerCentreX + 44.0;    // 104, clear of the flower's rim
constexpr double kHudHealthY = 98.0;
/// The avatar sits on the HEALTH bar's centre line, not between the two bars:
/// the XP bar is the narrower strip tucked under it.
constexpr double kFlowerCentreY = kHudHealthY + kHudBarHeight * 0.5;   // 110
constexpr double kHudXpWidth = 163.0;
constexpr double kHudXpHeight = 12.0;
/// Centred under the health bar rather than sharing its left edge.
constexpr double kHudXpX = kHudBarX + (kHudBarWidth - kHudXpWidth) * 0.5;
constexpr double kHudXpY = kHudHealthY + kHudBarHeight + 12.0;   // 134
/// The mana bar is NOT here. It stands in the slot the viewer's own health
/// bar used to occupy, under the flower itself -- WorldRenderer::drawSelfManaBar
/// -- which is why this block goes straight from the XP bar to the avatar.
/// How far the black plate of a bar stands out past its fill, and how far the
/// white health pill is inset inside the track it rides in.
constexpr double kHudPlatePad = 6.0;
/// The plate runs back to the flower's CENTRE, so its rounded left cap is
/// hidden behind the disc and the bar meets the flower along a straight edge
/// with no crescent of background between them. Stopping it at the rim leaves
/// the cap's arc showing, which is a bar that floats beside the flower rather
/// than plugging into it.
constexpr double kHudPlateLeft = kHudBarX - kFlowerCentreX;
constexpr double kHudXpPad = 3.0;
constexpr double kHudFillInset = 3.0;
/// The nameplate written across the health bar, and the level across the XP
/// bar under it.
constexpr double kHudNameSize = 22.0;
constexpr double kHudLevelSize = 14.0;

/// An admin's announcement (drawAdminAnnouncement): a plate at the top of the
/// screen, centred, for this long after it arrives, fading out over the last
/// stretch of it.
constexpr double kAnnouncementSeconds = 8.0;
constexpr double kAnnouncementFadeSeconds = 0.4;
/// No wider than this, and never closer to a side of the window than the
/// margin -- a phone held upright gets a narrower plate, not smaller text.
constexpr double kAnnouncementWidth = 650.0;
constexpr double kAnnouncementMargin = 20.0;
/// Where the plate's top edge sits with nothing above it, and how far under
/// the boss bars it drops when there are some.
constexpr double kAnnouncementTop = 85.0;
constexpr double kAnnouncementGap = 12.0;
constexpr double kAnnouncementPad = 15.0;
constexpr double kAnnouncementHeaderSize = 17.0;
/// The header's line, and the gap under it before the text starts.
constexpr double kAnnouncementHeaderHeight = 26.0;
constexpr double kAnnouncementTextSize = 16.0;
constexpr double kAnnouncementLineHeight = 21.0;
constexpr std::uint32_t kAnnouncementFill = 0x332B18u;
/// The header in the chat box's Admin-tab gold, so the banner and the line it
/// leaves in the transcript read as the same thing.
constexpr std::uint32_t kAnnouncementHeaderInk = 0xFFD166u;

/// Greedy word wrap for the banner at `size`, `width` wide. A word that will
/// not fit a line of its own is broken between its characters rather than
/// left to run off the plate: an announcement can be one long URL.
std::vector<std::string> wrapAnnouncement(const std::string& body, double size, double width) {
    std::vector<std::string> lines;
    std::string line;
    const auto flush = [&] {
        if (!line.empty()) lines.push_back(line);
        line.clear();
    };
    std::size_t at = 0;
    while (at < body.size()) {
        const std::size_t space = body.find(' ', at);
        const std::size_t end = space == std::string::npos ? body.size() : space;
        std::string word = body.substr(at, end - at);
        at = space == std::string::npos ? body.size() : space + 1;
        if (word.empty()) continue;
        const std::string joined = line.empty() ? word : line + " " + word;
        if (measure(joined, size) <= width) {
            line = joined;
            continue;
        }
        flush();
        // Too long for a line of its own: as many characters as fit, then
        // the rest on the next line, on UTF-8 boundaries.
        while (measure(word, size) > width) {
            std::size_t cut = 0;
            for (std::size_t next = utf8Next(word, 0); next <= word.size();
                 next = utf8Next(word, next)) {
                if (measure(word.substr(0, next), size) > width) break;
                cut = next;
                if (next == word.size()) break;
            }
            if (cut == 0) cut = utf8Next(word, 0);   // a single glyph wider than the plate
            lines.push_back(word.substr(0, cut));
            word.erase(0, cut);
        }
        line = word;
    }
    flush();
    return lines;
}

/// The reference's `formatNumber`: one decimal place and a suffix past a
/// thousand, and the exact integer while ALT is held.
std::string formatNumber(double value, bool raw) {
    return raw ? std::to_string(static_cast<long long>(std::llround(value)))
               : ui::formatCompact(value);
}

/// One HUD bar: an oversized black pill with the fill sitting flush inside it.
///
/// Deliberately not a generic inset bar (the old ui::bar, since removed as
/// unused), which insets the fill by its own outline width and clamps the
/// fraction to the bar; the reference does neither, so a bar that is somehow
/// over-full overhangs its plate there and has to here, and a one-pixel
/// sliver of XP still shows as a rounded cap.
/// The plate is punched out where the fill covers it rather than drawn whole
/// and painted over. Under the HUD's layer alpha those are NOT the same
/// picture: a fill laid over a plate that is already blended with the world
/// blends with the PLATE as well and comes out muddy, which is what a bar
/// drawn the obvious way looks like once it is see-through. Nothing in this
/// painter overlaps anything else, so every pixel is blended with the world
/// exactly once -- the flattened layer the reference composites.
void hudBar(Canvas& canvas, double x, double y, double w, double h, double fillWidth,
            std::uint32_t colour, double pad = 2.0, std::uint32_t plateColour = kInk) {
    const float radius = static_cast<float>(h * 0.5);
    // The hole is clamped to the plate; an over-full bar still overhangs it,
    // and the overhang is simply outside the shape being punched.
    const double hole = clamp(fillWidth, 0.0, w);

    Path2D plate;
    plate.roundRect(static_cast<float>(x - pad), static_cast<float>(y - pad),
                    static_cast<float>(w + pad * 2.0), static_cast<float>(h + pad * 2.0),
                    static_cast<float>(radius + pad));
    if (hole > 0) {
        plate.roundRect(static_cast<float>(x), static_cast<float>(y),
                        static_cast<float>(hole), static_cast<float>(h), radius);
    }
    setFill(canvas, plateColour);
    canvas.fill(plate, hole > 0 ? "evenodd" : "nonzero");

    if (fillWidth <= 0) return;
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(x), static_cast<float>(y),
                     static_cast<float>(fillWidth), static_cast<float>(h), radius);
    setFill(canvas, colour);
    canvas.fill();
}

/// A FLOWER's health bar, which is not shaped like a mob's.
///
/// A mob spends a black track down and fills it green, and that is the whole
/// bar. A flower's has THREE zones:
///
///   * the green fill -- health, exactly as a mob's is.
///   * the white pill riding inside it -- the SHIELD. Its own length, not a
///     share of the health: a flower with no shield up shows no pill at all,
///     and the bar is then an ordinary green one.
///   * the dark plate past the fill -- health that is gone.
///
/// `fill` is the colour of the health, which is what invulnerability tints;
/// the shield pill is always white.
void flowerBar(Canvas& canvas, double x, double y, double w, double h, double fraction,
               double shield, std::uint32_t fill, double scale) {
    const double pad = kHudPlatePad * scale;
    const double left = kHudPlateLeft * scale;
    const double inset = kHudFillInset * scale;
    const double innerHeight = h - inset * 2.0;

    const double health = clamp(fraction, 0.0, 1.0);
    const double healthWidth = w * health;
    // Clamped to the health under it: the pill is drawn INSIDE the fill, so a
    // shield larger than what is left of the pool reads as "all of it", not as
    // a white cap hanging off the end of the green.
    const double pillWidth = std::min(w * clamp(shield, 0.0, 1.0), healthWidth) - inset * 2.0;
    const bool hasHealth = healthWidth > 0;
    const bool hasPill = pillWidth > 0 && innerHeight > 0;

    // Three rings, none of them overlapping: see hudBar. The pill is punched
    // out of the fill and the fill out of the plate, so the layer stays flat
    // and its alpha lands on each pixel once.
    Path2D plate;
    plate.roundRect(static_cast<float>(x - left), static_cast<float>(y - pad),
                    static_cast<float>(w + left + pad), static_cast<float>(h + pad * 2.0),
                    static_cast<float>(h * 0.5 + pad));
    if (hasHealth) {
        plate.roundRect(static_cast<float>(x), static_cast<float>(y),
                        static_cast<float>(healthWidth), static_cast<float>(h),
                        static_cast<float>(h * 0.5));
    }
    setFill(canvas, kInk);
    canvas.fill(plate, hasHealth ? "evenodd" : "nonzero");

    if (!hasHealth) return;
    Path2D green;
    green.roundRect(static_cast<float>(x), static_cast<float>(y),
                    static_cast<float>(healthWidth), static_cast<float>(h),
                    static_cast<float>(h * 0.5));
    if (hasPill) {
        green.roundRect(static_cast<float>(x + inset), static_cast<float>(y + inset),
                        static_cast<float>(pillWidth), static_cast<float>(innerHeight),
                        static_cast<float>(innerHeight * 0.5));
    }
    setFill(canvas, fill);
    canvas.fill(green, hasPill ? "evenodd" : "nonzero");

    if (!hasPill) return;
    canvas.beginPath();
    canvas.roundRect(static_cast<float>(x + inset), static_cast<float>(y + inset),
                     static_cast<float>(pillWidth), static_cast<float>(innerHeight),
                     static_cast<float>(innerHeight * 0.5));
    setFill(canvas, kPaper);
    canvas.fill();
}

/// The white pointer that rides on a ring around a squadmate's avatar, aimed
/// at where that flower actually is. `angle` is the bearing from the viewer.
void squadArrow(Canvas& canvas, double centreX, double centreY, double angle, double scale) {
    const double ring = 42.0 * scale;
    const double length = 20.0 * scale;
    const double width = 16.0 * scale;

    canvas.save();
    canvas.translate(static_cast<float>(centreX + std::cos(angle) * ring),
                     static_cast<float>(centreY + std::sin(angle) * ring));
    canvas.rotate(static_cast<float>(angle));
    canvas.beginPath();
    canvas.moveTo(static_cast<float>(length * 0.5), 0);
    canvas.lineTo(static_cast<float>(-length * 0.5), static_cast<float>(-width * 0.5));
    canvas.lineTo(static_cast<float>(-length * 0.5), static_cast<float>(width * 0.5));
    canvas.closePath();
    setFill(canvas, kPaper);
    canvas.fill();
    setStroke(canvas, kInk);
    canvas.setLineWidth(static_cast<float>(3.0 * scale));
    canvas.setLineJoin("round");
    canvas.stroke();
    canvas.restore();
}

/// The reference's `drawFlower` with its default face, in a space whose origin
/// is the flower's centre.
///
/// Only the fallback: the plain yellow face drawHudFlower draws when the
/// flower's body is not in the stream -- a squadmate between a death and a
/// respawn, or the frames before the first snapshot. The avatar proper is the
/// body itself, drawn by the world's own painter
/// (WorldRenderer::drawFlowerBody). With no body there is no colour, face,
/// skin or equipment to show, which is why this takes nothing but a colour
/// and the face's numbers.
void drawFlowerFace(Canvas& canvas, std::uint32_t colour, double radius, double eyeX,
                    double eyeY, double mouth) {
    setFill(canvas, shade(colour, 0.8));
    canvas.fillCircle(0, 0, static_cast<float>(radius * (26.5 / 25.0)));
    setFill(canvas, colour);
    canvas.fillCircle(0, 0, static_cast<float>(radius * (23.5 / 25.0)));

    canvas.save();
    // The face is authored against a radius-25 flower; everything below is in
    // that space, which is why the eye and mouth numbers can be the
    // reference's own literals.
    const float scale = static_cast<float>(radius / 25.0);
    canvas.scale(scale, scale);

    // The eye whites are filled, then used as the clip for the pupils AND for
    // their own outline, so only the inner half of that outline survives --
    // which is what gives the eye its heavy upper lid.
    Path2D eyes;
    eyes.ellipse(-7.0f, -4.8f, 3.2f, 6.5f, 0, 0, static_cast<float>(kTau));
    eyes.moveTo(10.2f, -4.8f);
    eyes.ellipse(7.0f, -4.8f, 3.2f, 6.5f, 0, 0, static_cast<float>(kTau));
    canvas.save();
    setFill(canvas, kInk);
    canvas.fill(eyes);
    canvas.clip(eyes);
    setFill(canvas, kPaper);
    canvas.beginPath();
    canvas.arc(static_cast<float>(-7.0 + eyeX), static_cast<float>(-4.8 + eyeY), 3.0f, 0,
               static_cast<float>(kTau));
    canvas.fill();
    canvas.beginPath();
    canvas.arc(static_cast<float>(7.0 + eyeX), static_cast<float>(-4.8 + eyeY), 3.0f, 0,
               static_cast<float>(kTau));
    canvas.fill();
    canvas.setLineWidth(1.0f);
    setStroke(canvas, kInk);
    canvas.stroke(eyes);
    canvas.restore();

    canvas.save();
    setStroke(canvas, 0x222222u);
    canvas.setLineWidth(1.5f);
    canvas.setLineCap("round");
    canvas.beginPath();
    canvas.moveTo(-6.0f, 10.0f);
    canvas.quadraticCurveTo(0.0f, static_cast<float>(mouth), 6.0f, 10.0f);
    canvas.stroke();
    canvas.restore();

    canvas.restore();
}

} // namespace

void App::drawHud(Canvas& canvas, double time) {
    const SelfState& self = net_.view().self();
    // ALT swaps every abbreviated number on this surface for its exact value,
    // and reveals the other players on the minimap.
    const bool altHeld = window_.keyDown(Key::LeftAlt) || window_.keyDown(Key::RightAlt);

    // Invulnerability rides in the replicated state bits of the player's own
    // body rather than in SelfState, so the flag is read back off the entity.
    bool invulnerable = false;
    const auto selfEntity = net_.view().entities().find(self.netId);
    if (selfEntity != net_.view().entities().end()) {
        invulnerable = (selfEntity->second.state & net::StateInvulnerable) != 0;
    }
    if (wasInvulnerable_ && !invulnerable) invulEndedAt_ = time;
    wasInvulnerable_ = invulnerable;

    std::uint32_t healthColour = kHealth;
    if (invulnerable) {
        healthColour = kInvulnerableHealth;
    } else if (invulEndedAt_ >= 0 && time - invulEndedAt_ < kInvulnerableFadeSeconds) {
        // Linear, per channel, and the in-world plate's own fade rather than a
        // copy of it. The reference eases this not at all, and a curve here
        // would be visible against an in-world bar that does not.
        healthColour = invulnerableFadeColor(time - invulEndedAt_);
    }

    // The whole block goes down as ONE see-through layer. Everything between
    // here and the restore -- plates, tracks, pills, names, avatars and every
    // squad row -- is drawn so that no two of its shapes overlap, which is
    // what lets a plain global alpha stand in for compositing the group.
    canvas.save();
    canvas.setGlobalAlpha(static_cast<float>(kHudLayerAlpha));

    // Both strings are written ACROSS their bar rather than beside it, which
    // is why they are centred on a middle baseline: the reference's HUD reads
    // the flower's name, not its hit points, and its level, not its XP.
    TextStyle label;
    label.size = kHudNameSize;
    label.align = Align::Centre;
    label.baseline = Baseline::Middle;

    const double health = std::max(0.0, self.health);
    const double healthFraction = self.maxHealth > 0 ? health / self.maxHealth : 0.0;
    // The shield rides in off the wire on the player's own body record, the
    // same field every other flower's bar reads.
    const double shield = selfEntity != net_.view().entities().end()
                              ? selfEntity->second.shieldFraction
                              : 0.0;
    flowerBar(canvas, kHudBarX, kHudHealthY, kHudBarWidth, kHudBarHeight, healthFraction, shield,
              healthColour, 1.0);
    // ALT is the only way to the exact figures now that the plate carries the
    // name: it is already what every other abbreviated number on this surface
    // answers to, so there is nowhere else a player would look for them.
    const std::string plate =
        altHeld
            ? formatNumber(std::round(health), true) + "/" + formatNumber(self.maxHealth, true)
            : (selfEntity != net_.view().entities().end() && !selfEntity->second.name.empty()
                   ? selfEntity->second.name
                   : std::string("Flower"));
    text(canvas, plate, kHudBarX + kHudBarWidth * 0.5, kHudHealthY + kHudBarHeight * 0.5, label);

    const LevelProgress progress = levelFromTotalXp(self.totalXp);
    hudBar(canvas, kHudXpX, kHudXpY, kHudXpWidth, kHudXpHeight,
           progress.xpForNext > 0 ? progress.xpIntoLevel / progress.xpForNext * kHudXpWidth : 0.0,
           kXpBar, kHudXpPad);
    TextStyle levelLabel = label;
    levelLabel.size = kHudLevelSize;
    text(canvas,
         altHeld ? "Lvl " + std::to_string(progress.level) + " - " +
                       formatNumber(progress.xpIntoLevel, true) + "/" +
                       formatNumber(progress.xpForNext, true)
                 : "Lvl " + std::to_string(progress.level),
         kHudXpX + kHudXpWidth * 0.5, kHudXpY + kHudXpHeight * 0.5, levelLabel);

    // The flower goes down LAST, so it covers the rounded left cap of the
    // health bar. Drawing it first would leave a black stub poking out of it.
    // No outline ring: the reference's avatar is the flower's own body, rim
    // and all, and a ring around it is not part of that picture.
    drawHudFlower(canvas, self.netId, kFlowerCentreX, kFlowerCentreY, kHudFlowerRadius, time);

    drawSquadHud(canvas, time);

    canvas.restore();

    drawMinimap(canvas);

    const double bossBarsBottom = drawBossBars(canvas, altHeld);
    // Under the boss bars, which share the top of the screen with it and are
    // what the player is fighting.
    drawAdminAnnouncement(canvas, bossBarsBottom);

    // Over the HUD and under everything the menu system paints. A panel is the
    // one thing that takes the controls away, and it takes them away entirely
    // -- see touchControlsVisible -- so there is no case where a card lands on
    // a stick that is still answering for presses under it.
    if (touchControlsVisible()) mobile_.draw(canvas);

    // The loadout is NOT drawn here. The menu system's strip is the same set of
    // slots and is a live drop target; a second, inert copy of it a few pixels
    // away was two things that looked like one.
}

void App::drawHudFlower(Canvas& canvas, std::uint32_t netId, double centreX, double centreY,
                        double radius, double time) {
    canvas.save();
    canvas.translate(static_cast<float>(centreX), static_cast<float>(centreY));
    const auto found = net_.view().entities().find(netId);
    if (found != net_.view().entities().end() && found->second.dead()) {
        // A dead flower's avatar is its corpse: dead eyes and a frown, turned
        // the way the body lies, as the death screen this was measured from
        // shows it.
        canvas.rotate(static_cast<float>(found->second.angle));
        canvas.scale(static_cast<float>(radius / 25.0), static_cast<float>(radius / 25.0));
        renderer_.drawDeadFlower(canvas, found->second.equipFlags, 5.0, time);
    } else if (found != net_.view().entities().end()) {
        // The world's own painter, not a HUD-local copy of it: the avatar
        // wears the flower's colour, face, antennae and skin because it IS
        // that flower, drawn small. Its art space is radius 25.
        canvas.scale(static_cast<float>(radius / 25.0), static_cast<float>(radius / 25.0));
        renderer_.drawFlowerBody(canvas, found->second, time);
    } else {
        // No body in the stream -- a squadmate between a death and a respawn,
        // or the player's own frame before the first snapshot lands.
        drawFlowerFace(canvas, 0xFFE763u, radius, 2.0 * (radius / 25.0), 0.0,
                       14.5 * (radius / 25.0));
    }
    canvas.restore();
}

void App::drawSquadHud(Canvas& canvas, double time) {
    const SquadState& squad = net_.squad();
    if (!squad.inSquad) return;

    // Uniformly 80% of the main HUD and laid out the same way, which is what
    // the reference scales its own squad block to.
    constexpr double kScale = 0.8;
    /// Centre to centre between two rows, which is what the reference spaces
    /// them by: the avatars, not the bars, are what set the pitch, and a row
    /// whose member wears no guild tag still holds its place.
    constexpr double kRowPitch = 100.0 * kScale;
    const double barWidth = kHudBarWidth * kScale;
    const double barHeight = kHudBarHeight * kScale;
    const double barX = kFlowerCentreX + 40.0 * kScale;
    const double flowerRadius = kHudFlowerRadius * kScale;

    // The name written across the bar, in the main HUD's own nameplate style.
    TextStyle label;
    label.size = kHudNameSize * kScale;
    label.align = Align::Centre;
    label.baseline = Baseline::Middle;

    // The guild tag under the bar's left end, in the same cyan the plate under
    // a flower in the world uses -- it is the same tag, in the same brackets.
    TextStyle tag;
    tag.size = kHudNameSize * kScale;
    tag.fill = 0x27DADEu;
    tag.baseline = Baseline::Alphabetic;

    // Where the main HUD actually ends: the XP bar's plate, or the bottom of
    // the avatar, whichever hangs further down.
    const double hudBottom =
        std::max(kHudXpY + kHudXpHeight + kHudXpPad, kFlowerCentreY + kHudFlowerBody);
    double centreY = hudBottom + 78.0 * kScale;

    const Vec2 eye = net_.view().self().position;
    for (const SquadState::Member& member : squad.members) {
        if (member.netId == 0) continue;
        const auto found = net_.view().entities().find(member.netId);
        // A member whose body is not in this client's world has nothing to
        // draw a bar from. They are streamed however far away they are, so in
        // practice this is the moment between a death and a respawn.
        if (found == net_.view().entities().end()) continue;
        const RemoteEntity& body = found->second;
        if (body.isSelf()) continue;

        const double barY = centreY - barHeight * 0.5;
        const bool invulnerable = (body.state & net::StateInvulnerable) != 0;
        flowerBar(canvas, barX, barY, barWidth, barHeight, body.healthFraction,
                  body.shieldFraction, invulnerable ? kInvulnerableHealth : kHealth, kScale);
        text(canvas, member.name.empty() ? std::string("Squadmate") : member.name,
             barX + barWidth * 0.5, centreY, label);

        if (!body.guildName.empty()) {
            text(canvas, "[" + body.guildName + "]", barX - 7.5 * kScale,
                 centreY + 40.0 * kScale, tag);
        }

        // The pointer first, so the avatar's rim covers the tail of an arrow
        // that happens to swing in over it.
        const Vec2 away = body.position - eye;
        if (away.x * away.x + away.y * away.y > 1.0) {
            squadArrow(canvas, kFlowerCentreX, centreY, std::atan2(away.y, away.x), kScale);
        }

        drawHudFlower(canvas, member.netId, kFlowerCentreX, centreY, flowerRadius, time);

        centreY += kRowPitch;
    }
}

NpcService App::nearbyNpcService(Vec2 self) const {
    // Measured from the flower the player SEES against the NPC's skin, which
    // is what they walked up to. The server measures the body it simulates
    // and allows kNpcServiceSlack on top, so a panel opened here is never
    // refused for the frame of easing between the two.
    NpcService nearest = NpcService::None;
    double nearestGap = kNpcServiceReach;
    for (const auto& entry : net_.view().entities()) {
        const RemoteEntity& entity = entry.second;
        if (entity.kind != net::EntityKind::Npc) continue;
        const NpcService service = content().mob(entity.typeIndex).npc.service;
        if (service == NpcService::None) continue;
        const double gap = distance(self, entity.position) - entity.radius;
        if (gap > nearestGap) continue;
        nearest = service;
        nearestGap = gap;
    }
    return nearest;
}

double App::drawBossBars(Canvas& canvas, bool altHeld) {
    // Super, unique and apex only. An ultra is a big mob, not a boss: it wears
    // the ordinary bar under its body, which is also where its name is.
    // A pet is somebody's summon and a target dummy is a permanent DPS-test
    // fixture, so neither earns the screen-top bar whatever tier it wears.
    // A centipede or a leech is one boss however many bodies it drags: the
    // head wears the bar and the segments behind it none.
    std::vector<const RemoteEntity*> bosses;
    const Rect view = camera_.visibleWorld();
    for (const auto& entry : net_.view().entities()) {
        const RemoteEntity& entity = entry.second;
        if (entity.kind != net::EntityKind::Mob) continue;
        if (entity.rarity != Rarity::Super && entity.rarity != Rarity::Unique &&
            entity.rarity != Rarity::Apex) {
            continue;
        }
        if ((entity.spawnFlags & net::SpawnIsPet) != 0) continue;
        const MobConfig& config = content().mob(entity.typeIndex);
        if (config.id == "target_dummy" || config.chainBody) continue;

        // The same generous test the browser build makes: the drawn size plus
        // a buffer of at least 100 units, so a boss keeps its bar until it is
        // well clear of the edge rather than losing it mid-fight.
        const double visualScale = config.visualScale > 0 ? config.visualScale : 1.0;
        const double size = entity.radius * 2.0 * visualScale;
        const double margin = size * 0.5 + std::max(size, 100.0);
        if (entity.position.x + margin < view.left() || entity.position.x - margin > view.right() ||
            entity.position.y + margin < view.top() || entity.position.y - margin > view.bottom()) {
            continue;
        }
        bosses.push_back(&entity);
    }
    if (bosses.empty()) return 0.0;
    // The entity table is unordered, so two bosses on screen at once would
    // otherwise trade rows from frame to frame.
    std::sort(bosses.begin(), bosses.end(),
              [](const RemoteEntity* a, const RemoteEntity* b) { return a->netId < b->netId; });

    constexpr double kBarWidth = 400.0;
    constexpr double kBarHeight = 34.0;
    /// The plate the bar rides in: a charcoal pill standing this far out past
    /// it on every side, which is what the name and the tier overlap.
    constexpr double kBarPad = 8.0;
    constexpr double kNameSize = 33.0;
    constexpr double kTierSize = 20.0;
    /// The name's baseline sits just INSIDE the plate's top edge and the tier
    /// just below its bottom one, so both bite into the bar rather than
    /// floating clear of it.
    constexpr double kNameDrop = 4.0;
    constexpr double kTierDrop = 12.0;
    constexpr double kRowSpacing = 88.0;
    /// Where the fill's top edge lands on the first row. The block above it is
    /// the name, which is why this is not a plain margin.
    constexpr double kTopMargin = 108.0;
    const double centreX = window_.width() * 0.5;

    // One see-through layer, like the block in the corner. hudBar punches the
    // fill out of its plate so the two never blend into each other.
    canvas.save();
    canvas.setGlobalAlpha(static_cast<float>(kHudLayerAlpha));

    for (std::size_t i = 0; i < bosses.size(); ++i) {
        const RemoteEntity& boss = *bosses[i];
        const double barY = kTopMargin + static_cast<double>(i) * kRowSpacing;

        // Max health is not on the wire -- only the fraction is -- so it is
        // recomputed from the same config the server sized the mob from. The
        // two cannot disagree: nothing scales a mob's pool after it spawns.
        const double maxHealth = content().mobStats(boss.typeIndex, boss.rarity).health;
        const double health = std::max(0.0, clamp(boss.healthFraction, 0.0, 1.0) * maxHealth);
        hudBar(canvas, centreX - kBarWidth * 0.5, barY, kBarWidth, kBarHeight,
               maxHealth > 0 ? health / maxHealth * kBarWidth : 0.0, kHealth, kBarPad,
               kBossTrack);

        // Over the bar, not above it: the name goes down after the plate so
        // its outline reads against the fill.
        TextStyle name;
        name.size = kNameSize;
        name.align = Align::Centre;
        name.baseline = Baseline::Alphabetic;
        text(canvas, content().mob(boss.typeIndex).name, centreX, barY + kNameDrop, name);

        // The tier under it, in the tier's own colour -- the same label and
        // the same colour the plate under the body carries. ALT swaps it for
        // the figures, which is where the health numbers live now.
        TextStyle tier;
        tier.size = kTierSize;
        tier.align = Align::Centre;
        tier.baseline = Baseline::Alphabetic;
        tier.fill = altHeld ? kPaper : rarityColor(boss.rarity);
        text(canvas,
             altHeld ? formatNumber(std::round(health), true) + "/" +
                           formatNumber(maxHealth, true)
                     : std::string(rarityLabel(boss.rarity)),
             centreX, barY + kBarHeight + kTierDrop, tier);
    }

    canvas.restore();
    // The last row's tier line, which is the lowest thing in the block.
    const double lastBarY = kTopMargin + static_cast<double>(bosses.size() - 1) * kRowSpacing;
    return lastBarY + kBarHeight + kTierDrop - descent(kTierSize);
}

void App::drawAdminAnnouncement(Canvas& canvas, double clearOf) {
    const AdminAnnouncement& announcement = net_.adminAnnouncement();
    // Timed on this clock, from the frame a new one is first seen: the
    // sequence says WHICH one, and nothing about the network's clock has to
    // be compared with the app's.
    if (announcement.sequence != announcementSeen_) {
        announcementSeen_ = announcement.sequence;
        announcementShownAt_ = timeSeconds_;
    }
    if (announcement.text.empty()) return;
    const double age = timeSeconds_ - announcementShownAt_;
    if (age >= kAnnouncementSeconds) return;
    const double alpha = clamp((kAnnouncementSeconds - age) / kAnnouncementFadeSeconds, 0.0, 1.0);

    const double width =
        std::min(kAnnouncementWidth, canvas.width() - kAnnouncementMargin * 2.0);
    if (width <= kAnnouncementPad * 2.0) return;
    // Wrapped, never shrunk: a full-length announcement on a narrow window is
    // three lines of the same type, not one line of type too small to read.
    const std::vector<std::string> lines =
        wrapAnnouncement(announcement.text, kAnnouncementTextSize, width - kAnnouncementPad * 2.0);
    const double top = std::max(kAnnouncementTop, clearOf > 0.0 ? clearOf + kAnnouncementGap : 0.0);
    const Rect plateRect{(canvas.width() - width) * 0.5, top, width,
                         kAnnouncementPad * 2.0 + kAnnouncementHeaderHeight +
                             static_cast<double>(lines.size()) * kAnnouncementLineHeight};

    canvas.save();
    canvas.setGlobalAlpha(static_cast<float>(alpha));
    plate(canvas, plateRect, kAnnouncementFill);
    TextStyle header;
    header.size = kAnnouncementHeaderSize;
    header.fill = kAnnouncementHeaderInk;
    header.baseline = Baseline::Middle;
    // Credited to the account that made it, which the server signs the line
    // with -- not to a name written into the client.
    text(canvas,
         announcement.author.empty() ? std::string("Announcement")
                                     : "Announcement from " + announcement.author,
         plateRect.x + kAnnouncementPad, plateRect.y + kAnnouncementPad + kAnnouncementHeaderSize * 0.5,
         header);
    TextStyle body;
    body.size = kAnnouncementTextSize;
    body.baseline = Baseline::Middle;
    double y = plateRect.y + kAnnouncementPad + kAnnouncementHeaderHeight +
               kAnnouncementLineHeight * 0.5;
    for (const std::string& line : lines) {
        text(canvas, line, plateRect.x + kAnnouncementPad, y, body);
        y += kAnnouncementLineHeight;
    }
    canvas.restore();
}

namespace {

/// The low-health vignette's shape, measured off death_ui_screenshot.png --
/// which was taken at zero health, so this is the vignette at full strength.
///
/// It is elliptical, fitted to the screen: `r` is 1 at the middle of every
/// edge and sqrt 2 in the corners, so a wide window darkens its sides no
/// further in than a tall one does. Nothing inside r = 0.8; from there black
/// rises 1.45 per unit of r, which is 0.29 at the edges' middles and 0.87 in
/// the corners -- what the screenshot's grass and walls both read.
constexpr double kVignetteInner = 0.8;
constexpr double kVignetteSlope = 1.45;
/// Health, as a fraction, below which the edges start to darken; the
/// vignette is at full strength at zero.
constexpr double kLowHealthStart = 0.5;
#ifdef __EMSCRIPTEN__
/// The browser's bitmap is baked at this fraction of the design size and
/// stretched: a falloff this gentle has nothing a bilinear stretch can lose.
constexpr int kVignetteBitmapDivisor = 4;
#endif

/// The falloff as one alpha byte per pixel of a `width` x `height` surface.
///
/// Per pixel rather than in rings: cpp_canvas has no gradient, and rings of
/// flat black leave a light hairline wherever two of them meet -- each one's
/// anti-aliased edge covers the shared pixel only partly, and two partial
/// coverages darken it less than either ring does. In the dark corners that
/// read as a set of contour lines.
void bakeVignette(std::vector<std::uint8_t>& mask, int width, int height) {
    mask.assign(static_cast<std::size_t>(width) * height, 0);
    const double cx = width * 0.5;
    const double cy = height * 0.5;
    for (int y = 0; y < height; ++y) {
        const double ny = (y + 0.5 - cy) / cy;
        for (int x = 0; x < width; ++x) {
            const double nx = (x + 0.5 - cx) / cx;
            const double r = std::sqrt(nx * nx + ny * ny);
            const double a = clamp(kVignetteSlope * (r - kVignetteInner), 0.0, 1.0);
            mask[static_cast<std::size_t>(y) * width + x] =
                static_cast<std::uint8_t>(std::lround(a * 255.0));
        }
    }
}

} // namespace

double App::lowHealthTarget() const {
    // Dead is zero health, which is the screenshot's own full-strength state.
    // It is not the death card's: Close leaves it, since the flower is still
    // at zero.
    if (screen_ == Screen::Dead) return 1.0;
    if (screen_ != Screen::Playing || !net_.selfPlaced()) return 0.0;
    const SelfState& self = net_.view().self();
    // No max yet is no snapshot yet, not an empty bar.
    if (self.maxHealth <= 0) return 0.0;
    const double fraction = clamp(self.health / self.maxHealth, 0.0, 1.0);
    return clamp(1.0 - fraction / kLowHealthStart, 0.0, 1.0);
}

void App::drawLowHealthVignette(Canvas& canvas) {
    if (lowHealthVignette_ <= 0.01) return;
#ifdef __EMSCRIPTEN__
    // One bitmap, stretched over the frame by the browser -- a single GPU draw
    // a frame, and baked again only when the viewport changes shape.
    const int width = std::max(1, canvas.width() / kVignetteBitmapDivisor);
    const int height = std::max(1, canvas.height() / kVignetteBitmapDivisor);
    if (!vignetteBitmap_ || width != vignetteWidth_ || height != vignetteHeight_) {
        bakeVignette(vignetteMask_, width, height);
        std::vector<std::uint8_t> rgba(vignetteMask_.size() * 4, 0);
        for (std::size_t i = 0; i < vignetteMask_.size(); ++i) rgba[i * 4 + 3] = vignetteMask_[i];
        vignetteBitmap_ = std::make_unique<Canvas>(Canvas::createVirtual(width, height));
        vignetteBitmap_->putImageData(rgba, width, height, 0, 0);
        vignetteWidth_ = width;
        vignetteHeight_ = height;
    }
    canvas.setGlobalAlpha(static_cast<float>(lowHealthVignette_));
    canvas.drawCanvas(*vignetteBitmap_, 0, 0, static_cast<float>(canvas.width()),
                      static_cast<float>(canvas.height()));
    canvas.setGlobalAlpha(1.0f);
#else
    // Straight onto the device pixels, at their own resolution: a stretched
    // bitmap costs a filtered sample per pixel here, and darkenDevice is the
    // one-to-one integer path built for exactly this -- about what the death
    // wash's flat fillRect costs.
    const int width = canvas.pixelWidth();
    const int height = canvas.pixelHeight();
    if (width != vignetteWidth_ || height != vignetteHeight_) {
        bakeVignette(vignetteMask_, width, height);
        vignetteWidth_ = width;
        vignetteHeight_ = height;
    }
    canvas.setGlobalAlpha(static_cast<float>(lowHealthVignette_));
    canvas.darkenDevice(vignetteMask_.data(), width, height, 0, 0);
    canvas.setGlobalAlpha(1.0f);
#endif
}

} // namespace flix
