"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayerRenderFlags = exports.EquipmentFlags = exports.FaceFlags = void 0;
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
var PlayerRenderFlags;
(function (PlayerRenderFlags) {
    PlayerRenderFlags[PlayerRenderFlags["Pumpkin"] = 1] = "Pumpkin";
    PlayerRenderFlags[PlayerRenderFlags["Robot"] = 2] = "Robot";
})(PlayerRenderFlags || (exports.PlayerRenderFlags = PlayerRenderFlags = {}));
