"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayerRenderFlags = exports.EquipmentFlags = exports.FaceFlags = void 0;
exports.effectiveRenderFlags = effectiveRenderFlags;
var FaceFlags;
(function (FaceFlags) {
    FaceFlags[FaceFlags["Poisoned"] = 1] = "Poisoned";
    FaceFlags[FaceFlags["Dandelioned"] = 2] = "Dandelioned";
    FaceFlags[FaceFlags["DeadEyes"] = 4] = "DeadEyes";
    FaceFlags[FaceFlags["SquareEyes"] = 8] = "SquareEyes";
    FaceFlags[FaceFlags["Attacking"] = 16] = "Attacking";
    FaceFlags[FaceFlags["Defending"] = 32] = "Defending";
})(FaceFlags || (exports.FaceFlags = FaceFlags = {}));
var EquipmentFlags;
(function (EquipmentFlags) {
    EquipmentFlags[EquipmentFlags["Cutter"] = 1] = "Cutter";
    EquipmentFlags[EquipmentFlags["ThirdEye"] = 2] = "ThirdEye";
    EquipmentFlags[EquipmentFlags["Observer"] = 4] = "Observer";
    EquipmentFlags[EquipmentFlags["Antennae"] = 8] = "Antennae";
    EquipmentFlags[EquipmentFlags["Test1"] = 16] = "Test1";
})(EquipmentFlags || (exports.EquipmentFlags = EquipmentFlags = {}));
// Bitmask flags that activate a custom player skin. Each bit maps to a skin
// registered in graphics/player-skins.ts whose render() replaces the default
// drawFlower() body. A skin only renders when its bit is set in player.renderFlags
// — with no bit set the player draws as the normal flower. Bits are checked in
// registration order, so the lowest-priority set bit wins if several are on.
//
// Glitch is the odd one out: it registers no skin and replaces no body. It is a
// post-process MODIFIER applied to whatever body ends up rendering (default
// flower, built-in skin or user-created skin), so it composes with the other
// bits — e.g. renderFlags = Pumpkin | Glitch is a glitching pumpkin. See
// graphics/glitch-effect.ts.
var PlayerRenderFlags;
(function (PlayerRenderFlags) {
    PlayerRenderFlags[PlayerRenderFlags["Pumpkin"] = 1] = "Pumpkin";
    PlayerRenderFlags[PlayerRenderFlags["Robot"] = 2] = "Robot";
    PlayerRenderFlags[PlayerRenderFlags["Glitch"] = 4] = "Glitch";
})(PlayerRenderFlags || (exports.PlayerRenderFlags = PlayerRenderFlags = {}));
/**
 * The render flags a client should actually draw this player with: the
 * persisted cosmetic bits plus the transient Glitch bit a glitch mob infects
 * them with (ServerPlayer.glitched).
 *
 * The two are kept apart on the server on purpose — `renderFlags` is account
 * content that savePlayerProgress writes to the database, and an affliction
 * that lasts until the next respawn must never end up in there. They are only
 * merged on the way out, so no wire field or codec change is needed: the
 * existing `r` field carries both.
 */
function effectiveRenderFlags(player) {
    return (player.renderFlags ?? 0) | (player.glitched ? PlayerRenderFlags.Glitch : 0);
}
