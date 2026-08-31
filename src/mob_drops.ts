// Mob-drop behaviour. The editable rates live in mob_drops.json so tools and
// the native server can consume the same source of truth without parsing TS.

import rawDropTables from './mob_drops.json';
import { BASE_MOB_CONFIGS } from './mob_configs';
import { RARITY_ORDER, Rarity } from './server/shared/rarity';

export interface DropItem {
    type: 'petal' | 'consumable';
    itemType: string;
    rarity: Rarity;
    probability: number;
    minQuantity?: number;
    maxQuantity?: number;
}

export interface MobDropTable {
    guaranteed: boolean;
    drops: DropItem[];
}

// JSON imports are intentionally cloned before the automatic egg entries are
// added. A module import is shared by every consumer, while the generated
// runtime entries are game state rather than authored drop-rate data.
const authoredTables = rawDropTables as unknown as Record<string, MobDropTable>;
export const MOB_DROP_TABLES: Record<string, MobDropTable> = {};
for (const [mobType, table] of Object.entries(authoredTables)) {
    MOB_DROP_TABLES[mobType] = {
        guaranteed: table.guaranteed,
        drops: table.drops.map(drop => ({ ...drop })),
    };
}

// Ensure every mob type drops its egg with 100% chance for common rarity.
for (const mobType in BASE_MOB_CONFIGS) {
    if (mobType.endsWith('_pet') || BASE_MOB_CONFIGS[mobType].noEggDrop) continue;

    const eggName = `${mobType}_egg`;
    if (!MOB_DROP_TABLES[mobType]) {
        MOB_DROP_TABLES[mobType] = { guaranteed: true, drops: [] };
    }

    const existingEggIndex = MOB_DROP_TABLES[mobType].drops.findIndex(
        drop => drop.type === 'petal' && drop.itemType === eggName && drop.rarity === 'common',
    );
    if (existingEggIndex >= 0) {
        MOB_DROP_TABLES[mobType].drops[existingEggIndex].probability = 1.0;
    } else {
        MOB_DROP_TABLES[mobType].drops.unshift({
            type: 'petal',
            itemType: eggName,
            rarity: 'common',
            probability: 1.0,
            minQuantity: 1,
            maxQuantity: 1,
        });
    }
}

// Scale a drop's rarity to the mob's rarity: 90% chance the item is one tier
// below the mob, 10% chance it keeps its table rarity.
function scaleDropRarity(drop: DropItem, mobRarityIndex: number): DropItem {
    const adjusted = { ...drop };
    if (mobRarityIndex > 0 && Math.random() < 0.9) {
        adjusted.rarity = RARITY_ORDER[mobRarityIndex - 1];
    }
    return adjusted;
}

// Function to calculate drops for a mob based on its rarity.
export function calculateMobDrops(mobType: string, mobRarity: string): DropItem[] {
    const dropTable = MOB_DROP_TABLES[mobType];
    if (!dropTable || dropTable.drops.length === 0) return [];

    const rarityIndex = RARITY_ORDER.indexOf(mobRarity as Rarity);
    const uncommonIndex = RARITY_ORDER.indexOf('uncommon');

    // Unusual mobs drop every item in their table, guaranteed, at table rarity.
    if (rarityIndex === uncommonIndex) return dropTable.drops.map(drop => ({ ...drop }));

    // Above unusual: probabilities are weights and exactly one drop is chosen.
    if (rarityIndex > uncommonIndex) {
        const totalWeight = dropTable.drops.reduce((sum, drop) => sum + drop.probability, 0);
        if (totalWeight <= 0) return [];
        let roll = Math.random() * totalWeight;
        for (const drop of dropTable.drops) {
            roll -= drop.probability;
            if (roll <= 0) return [scaleDropRarity(drop, rarityIndex)];
        }
        return [scaleDropRarity(dropTable.drops[dropTable.drops.length - 1], rarityIndex)];
    }

    // Common mobs roll entries independently, so they cannot exceed the full
    // set an unusual mob receives.
    const drops: DropItem[] = [];
    for (const drop of dropTable.drops) {
        if (Math.random() < drop.probability) drops.push({ ...drop });
    }
    return drops;
}
