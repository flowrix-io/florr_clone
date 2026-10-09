#pragma once
// The mobs whose picture is CODE rather than a document.
//
// Almost every sprite in the game is an inline SVG in mobs.json, compiled once
// and fitted into whatever box a call site asks for (see sprites.h). That works
// because almost every mob is ONE size: the document is drawn at the radius the
// mob happens to have and nothing about the picture depends on how big that is.
//
// A handful of mobs are not one size. A cactus spawns anywhere from 30 to 60
// units across, a rock grows a tier at a time, a sandstorm jitters between two
// bounds -- and a fitted document answers that by magnifying, which is exactly
// what it must not do. A rock twice as wide is not a rock photographed closer:
// it has MORE facets, cut the same size. A bigger cactus grows more spines, not
// longer ones. gardn draws those mobs by generating their geometry from the
// radius every frame, and this is that code, ported: the vertex counts come out
// of `radius`, the spine and the outline widths do not.
//
// The crab and the spider are here for the other reason -- their claws and
// legs move, legs with the ground the body covers and claws on a clock,
// which a static document cannot do.
//
// So is every other bug in the game: gardn's own drawing where gardn has one
// -- ladybugs, bee, ants, beetle, hornet, centipedes -- and florr's client,
// ported, where it does not. florr draws all of its mobs in code, with legs
// that step on how far the body has walked and claws, mandibles and wings
// that keep a clock of their own. The attributes below carry florr's own
// numbers for them, and every drawing -- gardn's, florr's, the reference
// captures' -- is one case of paintMobArt.
//
// The oracle is here for the same reason, and one more: its ten tendrils wave,
// and its EYE looks at something. Where it looks is not a fact about the
// picture -- it is a fact about the creature, eased frame to frame by the
// world renderer exactly as a flower's pupils are -- so it arrives as an
// attribute (`gaze`) rather than out of the clock.
//
// The trader is a flower -- a player's own face, ring and body -- standing in a
// ring of basic petals, and it is here for the oracle's reason: its eyes are a
// flower's eyes, moved by where it is looking. They are drawn by the one
// function every flower's eyes are (paintFlowerEyes), so they move exactly as
// a player's do. The titan's glints are moved by `gaze` the same way.
//
// The leech is here for a third reason. Its body is not a row of beads, it is
// one smooth tube, and the reference draws it by stroking a single polyline
// through every segment's centre. Our renderer draws one entity at a time and
// no entity knows its neighbours -- but a segment is turned to FACE its
// leader and held exactly `kSegmentSpacingPerRadius` radii from it, so each
// one can paint the joint between itself and the one in front and let the
// union of those bars be the tube. No document can express that, because the
// length of the bar is a fact about the chain rather than about the picture.
//
// The moon is the one petal here: gardn draws it in code -- a seeded scatter
// of craters clipped to the disc -- and so does this. Unlike the rock it IS
// one picture photographed closer as it grows: a moon ten times as wide has
// the same ten craters, ten times the size.
//
// Every painter draws about the ORIGIN, in WORLD units, with the body's radius
// equal to the `radius` it is handed: a caller that wants it on screen scales
// and translates first, exactly as it would around a fitted document. Nothing
// here reads the clock, the camera, or the entity -- a painter is a pure
// function of the attributes it is given, which is what lets the world, the
// bestiary and a contact sheet all call it and get the same picture.

#include <cmath>
#include <cstdint>
#include <string>

#include "canvas.h"
#include "client/ease.h"
#include "shared/core/types.h"

namespace flix {

/// Which painter an `image` marker names. `None` is every ordinary mob.
///
/// Everything after `Trader` was first ported from florr's own client, and its
/// marker is florr's name for the mob -- `$ant_worker`, `$ladybug_dark`. Every
/// one gardn also draws is gardn's drawing now (the scorpion excepted: that
/// stays florr's); see the notes above paintMobArt.
enum class MobArt : std::uint8_t {
    None, Rock, Cactus, Sandstorm, Scorpion, Crab, LeechHead, LeechBody, Spider, Oracle, Trader,
    Ladybug, LadybugDark, LadybugShiny, Bee,
    AntBaby, AntWorker, AntSoldier, AntSoldierPet, AntQueen,
    FireAntBaby, FireAntWorker, FireAntSoldier, FireAntSoldierPet,
    AntHole, FireAntBurrow, Beetle, BeetleHel, Hornet, Wasp,
    Centipede, CentipedeBody, CentipedeEvil, CentipedeEvilBody, CentipedeDesert,
    CentipedeDesertBody, Bubble, BumbleBee, Shell, Starfish, Jellyfish, Dandelion, Fly,
    Leafbug, LeafbugShiny, Mantis, Bush, Roach, Moth, Firefly, FireflyMagic, Dummy, Titan,
    TermiteBaby, TermiteWorker, TermiteSoldier, TermiteOvermind, TermiteMound, TermiteEgg,
    /// The one PETAL drawn by code (petals.json `$moon`): gardn's seeded
    /// crater scatter, clipped to the disc, magnified to the moon's radius.
    Moon,
};

/// How fast a walk cycle runs, in radians of phase per second.
///
/// gardn advances a mob's phase by `(1 + 0.75 * speed) * 0.075` per frame; at
/// its 60 fps and at rest that is this. The world renderer already runs the
/// clock at double speed for a mob that has locked on, which is the same idea
/// as gardn's speed term arriving by a different road.
///
/// Legs no longer run on it: see kGaitRadiansPerUnitWalked.
inline constexpr double kMobWalkRadiansPerSecond = 4.5;

/// How far a leg's gait turns per world unit the body walks, in radians.
///
/// florr steps every walker's legs the same way: 0.015 rad per unit of a
/// counter it advances four units per unit travelled. Legs read
/// `MobArtAttributes::distance` through this, so they stand still with the
/// mob and race when it runs.
inline constexpr double kGaitRadiansPerUnitWalked = 0.015 * 4.0;

/// The painter a mobs.json `image` field selects, or `None`.
///
/// The marker is the bare painter name behind a '$' -- `$rock`, `$cactus` --
/// the same shape of escape the sponge palette marker uses, and for the same
/// reason: `image` is the one field that says what a mob LOOKS like, so a mob
/// drawn by code should say so there rather than in a table somewhere else
/// that a new mob has to be added to twice.
MobArt mobArtFor(const std::string& image);

struct MobArtAttributes {
    /// The body's radius in world units. Both the size the picture is drawn at
    /// and the number it derives its detail from -- those are the same number
    /// on purpose, so a rock that grows a tier gains facets rather than scale.
    double radius = 1.0;
    /// The walk phase, in radians. Drives what the gardn-era painters move on
    /// a clock -- the crab's claws, the leech's beak, the sandstorm's spin,
    /// the oracle's tendrils; ignored by the mobs that hold still and by every
    /// florr port. Legs read `distance` instead.
    double animation = 0.0;
    /// The mob's own colour, from its config. gardn bakes these into the
    /// painters; here they stay in mobs.json so one file still answers what a
    /// mob is coloured, whichever way its picture is made.
    std::uint32_t baseColor = 0xFFFFFFu;
    /// Where the mob's eye is looking, in the art's own frame, as a fraction
    /// of how far its pupil can travel: (1, 0) is hard along +X, which is the
    /// way every drawing faces. Only the oracle and the trader have eyes that
    /// read it. A call site with no creature behind it -- a bestiary tile --
    /// leaves the default, which is the pose the oracle's reference art is
    /// drawn in.
    Vec2 gaze{1.0, 0.0};

    // --- what florr's painters animate from ---------------------------------
    //
    // florr keeps a few numbers on each mob and advances them every frame it
    // draws one. The ports read the same numbers, so these are florr's, in
    // florr's units; the world renderer keeps them per mob (MobMotion).
    // `animation` above is the older walk phase the gardn-era painters read,
    // and a florr port ignores it.

    /// The mob's own clock, in MILLISECONDS: florr adds every frame's delta
    /// to it, moving or not, so whatever runs on it -- claws, mandibles,
    /// wings -- keeps one tempo. Only differences of it mean anything.
    double clockMs = 0.0;
    /// How far the mob has walked, in world units: its eased `speed`
    /// integrated over time. Legs step on this, so a mob standing still has
    /// still legs and one running flat out races them.
    double distance = 0.0;
    /// Ground speed in world units per MILLISECOND, eased the way florr eases
    /// it: toward the distance the body actually moved over the last frame,
    /// at 1 - e^(-0.0306 dt).
    double speed = 0.0;
    /// 0..1: eased toward 1 while the mob is locked on to a player and back
    /// toward 0 when it lets go, at 1 - e^(-0.0214 dt). florr blends some
    /// parts from an idle cycle into a frantic one by it (the scorpion's
    /// claws snap three times as fast).
    double aggro = 0.0;
    /// The clock again, run only as fast as `aggro`: the integral of it over
    /// time, in milliseconds. A part that turns only while the mob is worked
    /// up -- a starfish spinning on its chase -- turns by this, and so
    /// neither jumps when the mob calms down nor unwinds.
    double aggroMs = 0.0;
    /// Stable for the life of one mob and different between two: the
    /// replicated id. florr scatters a few details per mob from its own
    /// (a ladybug's spots); 0 is a fine answer for a bestiary tile.
    std::uint32_t seed = 0;
    /// What is left of the mob's health, 0..1, for a picture that wears its
    /// damage. 1 off the field.
    double health = 1.0;
    /// A creature in the world rather than its picture on a card. florr draws
    /// a few mobs differently with no entity behind them -- a firefly's lamp
    /// is lit only in the world, a dandelion's seeds are only part of its
    /// picture because in the world they are petals of their own.
    bool inWorld = false;
};

/// The time constants florr eases a mob's ground speed and its locked-on
/// blend with -- MobArtAttributes::speed and ::aggro, kept by the world
/// renderer. florr states them as rates per millisecond.
inline constexpr double kMobSpeedEaseSeconds =
    easeTimeConstantFromRatePerMs(0.030649537425959442);
inline constexpr double kMobAggroEaseSeconds =
    easeTimeConstantFromRatePerMs(0.021400496636323946);

/// The per-mob numbers above that only a creature walking through the world
/// has, gathered once a frame by the world renderer. A call site with no
/// creature behind it passes none and gets a mob standing still at rest.
struct MobMotion {
    double clockMs = 0.0;
    double distance = 0.0;
    double speed = 0.0;
    double aggro = 0.0;
    double aggroMs = 0.0;
    std::uint32_t seed = 0;
    double health = 1.0;
};

/// Paints `art` about the origin. `None` draws nothing.
void paintMobArt(Canvas&, MobArt art, const MobArtAttributes&);

/// The outline every gardn body wears: its own fill at 0.8 HSV value, which
/// for an opaque colour is the channels scaled. Also what a petal's
/// `rarityFills` repaint derives its strokes from.
std::uint32_t outlineOf(std::uint32_t rgb);

/// How far a flower's pupils travel from the middle of their eyes, across and
/// down: the client eases every flower's eye offset toward its facing's
/// (cos, sin) scaled by these two (world_view.cpp), and the trader scales its
/// `gaze` by the same pair, which is what makes its eyes move as a player's do.
inline constexpr double kFlowerEyeTravelX = 2.0;
inline constexpr double kFlowerEyeTravelY = 4.4;

/// A flower's two round eyes, in its radius-25 art space: the black sockets,
/// the white pupils `eyeX`, `eyeY` off the sockets' middles and clipped to
/// them, and a hairline rim over the pupils' edge. The one drawing of them --
/// every flower the world renderer draws, and the trader, come through here.
void paintFlowerEyes(Canvas&, double eyeX, double eyeY);

} // namespace flix
