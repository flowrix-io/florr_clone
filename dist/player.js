"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EquipmentFlags = exports.FaceFlags = void 0;
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
})(EquipmentFlags || (exports.EquipmentFlags = EquipmentFlags = {}));
