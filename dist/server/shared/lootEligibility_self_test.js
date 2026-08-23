"use strict";
/**
 * Self-test for the loot-eligibility rule.
 *
 * Every case here failed before the rule was fixed, and the squad ones are the
 * reason it was worth extracting: the cap used to count ENTITIES, so a squad
 * counted as one slot and was then expanded with no limit afterwards.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLootEligibilitySelfTest = runLootEligibilitySelfTest;
const lootEligibility_1 = require("./lootEligibility");
function runLootEligibilitySelfTest() {
    const failures = [];
    const check = (name, ok, detail) => {
        if (!ok)
            failures.push(detail ? `${name}: ${detail}` : name);
    };
    /** No squads: every entity is its own player. */
    const solo = (contributors, tier) => (0, lootEligibility_1.selectLootRecipients)(contributors, tier, Array.from(contributors.entries()).sort((a, b) => b[1] - a[1]).map(e => e[0]), id => [id]);
    // -- per-tier caps --------------------------------------------------------
    const crowd = new Map();
    for (let i = 0; i < 40; i++)
        crowd.set(`p${i}`, 1000 - i);
    for (const tier of ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']) {
        check(`${tier} caps at ${lootEligibility_1.BASE_LOOT_SLOTS}`, solo(crowd, tier).length === lootEligibility_1.BASE_LOOT_SLOTS, `got ${solo(crowd, tier).length}`);
    }
    for (const [tier, want] of [['ultra', 15], ['super', 20], ['unique', 25]]) {
        check(`${tier} caps at ${want}`, solo(crowd, tier).length === want, `got ${solo(crowd, tier).length}`);
    }
    // apex is unspecified and inherits unique's count, NOT the base 4.
    check('apex inherits unique', (0, lootEligibility_1.lootSlotsForTier)('apex') === (0, lootEligibility_1.lootSlotsForTier)('unique'));
    check('unknown tier falls back to base', (0, lootEligibility_1.lootSlotsForTier)('not_a_tier') === lootEligibility_1.BASE_LOOT_SLOTS);
    // -- the cap goes to the biggest hitters ----------------------------------
    check('slots go to the top damage dealers', JSON.stringify(solo(crowd, 'common')) === JSON.stringify(['p0', 'p1', 'p2', 'p3']), JSON.stringify(solo(crowd, 'common')));
    // -- damage is required ---------------------------------------------------
    check('a zero-damage contributor is not eligible', !solo(new Map([['a', 100], ['b', 0], ['c', 50]]), 'common').includes('b'));
    check('no contributors means nobody', solo(new Map(), 'unique').length === 0);
    check('fewer contributors than slots is fine', solo(new Map([['a', 5], ['b', 3]]), 'unique').length === 2);
    // -- squads must not blow past the cap ------------------------------------
    {
        const contributors = new Map();
        const members = {};
        for (let s = 0; s < 4; s++) {
            members[`squad${s}`] = [];
            for (let m = 0; m < 10; m++) {
                const id = `s${s}_m${m}`;
                members[`squad${s}`].push(id);
                contributors.set(id, 500 - s * 10 - m);
            }
        }
        // An idler who is in the squad but never touched the mob.
        members.squad0.push('idler');
        const ranked = ['squad0', 'squad1', 'squad2', 'squad3'];
        const expand = (id) => members[id] ?? [id];
        const common = (0, lootEligibility_1.selectLootRecipients)(contributors, 'common', ranked, expand);
        check('4 squads of 10 still yield only 4 looters on a common mob', common.length === 4, `got ${common.length}`);
        check('an idle squad member never loots', !common.includes('idler'));
        const ultra = (0, lootEligibility_1.selectLootRecipients)(contributors, 'ultra', ranked, expand);
        check('squads on an ultra are capped at 15', ultra.length === 15, `got ${ultra.length}`);
        check('no duplicates across entities', new Set(ultra).size === ultra.length);
        check('a squad fills its slots best-first', ultra[0] === 's0_m0', ultra[0]);
    }
    // -- xp: every looter gets the mob's FULL value ---------------------------
    {
        const pay = (recipients, accounts = {}, mult = {}) => {
            const out = [];
            (0, lootEligibility_1.payFullXpToEach)(recipients, 30, id => accounts[id], id => mult[id] ?? 1, (id, xp) => out.push({ id, xp }));
            return out;
        };
        const four = pay(['a', 'b', 'c', 'd']);
        check('every looter is paid', four.length === 4, JSON.stringify(four));
        check('each gets the FULL amount, not a split share', four.every(p => p.xp === 30), JSON.stringify(four.map(p => p.xp)));
        // A split flower is two player records for one person.
        const split = pay(['7', '7_split2', 'z'], { '7': 'acc7', '7_split2': 'acc7', z: 'accZ' });
        check('a split player is paid once, not twice', split.filter(p => p.id === '7' || p.id === '7_split2').length === 1, JSON.stringify(split));
        check('and the other player is still paid', split.some(p => p.id === 'z'));
        // Bots have no account and must stay distinct from one another.
        check('recipients without an account are not collapsed together', pay(['bot_a', 'bot_b']).length === 2);
        // The leaderboard multiplier is per account, not per mob.
        // Null-safe on purpose: when this rule regresses to paying one player,
        // the lookup misses and a `!` would crash the whole self-test runner
        // instead of reporting which invariant broke.
        const scaled = pay(['a', 'b'], { a: 'accA', b: 'accB' }, { a: 0.5 });
        const paidA = scaled.find(p => p.id === 'a');
        const paidB = scaled.find(p => p.id === 'b');
        check('multiplier applies per recipient', paidA?.xp === 15 && paidB?.xp === 30, JSON.stringify(scaled));
        check('nobody eligible means nobody paid', pay([]).length === 0);
    }
    return failures;
}
