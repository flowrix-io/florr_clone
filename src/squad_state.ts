/**
 * Squad membership for the local player, so the minimap and the world renderer
 * can tint squadmates without ALT being held.
 *
 * Was `window.squadMemberIds` — chat wrote it, three render modules read it.
 * Same one-writer/several-readers shape, without publishing the squad roster
 * to the page.
 */
let squadMemberIds: string[] = [];

export function setSquadMemberIds(ids: string[] | null | undefined): void {
    squadMemberIds = Array.isArray(ids) ? ids : [];
}

export function getSquadMemberIds(): string[] {
    return squadMemberIds;
}
