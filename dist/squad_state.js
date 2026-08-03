"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setSquadMemberIds = setSquadMemberIds;
exports.getSquadMemberIds = getSquadMemberIds;
/**
 * Squad membership for the local player, so the minimap and the world renderer
 * can tint squadmates without ALT being held.
 *
 * Was `window.squadMemberIds` — chat wrote it, three render modules read it.
 * Same one-writer/several-readers shape, without publishing the squad roster
 * to the page.
 */
let squadMemberIds = [];
function setSquadMemberIds(ids) {
    squadMemberIds = Array.isArray(ids) ? ids : [];
}
function getSquadMemberIds() {
    return squadMemberIds;
}
