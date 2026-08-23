/**
 * Wire opcodes for event names.
 *
 * Every frame is `[event, ...args]`, so the event NAME was being UTF-8 encoded
 * into every single message. A probe at 12 clients measured those root-level
 * strings at 4.8% of all outbound bytes — "gameStateUpdate" alone is 16 bytes
 * (15 + a length tag) on a frame sent 20x/second to every client.
 *
 * Replacing the name with its index here costs ONE byte: the codec encodes
 * 0-127 as a positive fixint (see binary_codec.ts). Both sides import this same
 * table, and its fingerprint is folded into the connection handshake's
 * protocol signature, so a client built against a different table is told to
 * reload rather than silently decoding opcode 42 as the wrong event.
 *
 * An event NOT in this table still travels as a plain string, so adding a new
 * event without touching this file works — it just costs its name in bytes.
 *
 * `__sys` is deliberately absent: it carries the handshake that establishes
 * protocol compatibility in the first place, so it must decode before the
 * client can know whether this table is even valid.
 */
export const WIRE_EVENTS = [
    'absorbFailed',
    'absorbItems',
    'animateViewportToMob',
    'authenticate',
    'authenticated',
    'chatHistory',
    'chatMessage',
    'codeRedeemError',
    'codeRedeemSuccess',
    'collectDot',
    'craftItems',
    'craftingFailed',
    'craftingFinished',
    'currentPlayers',
    'dailyStreakStatus',
    'debugStats',
    'deleteSkin',
    'disconnect',
    'dotCollected',
    'enemiesDamaged',
    'enemiesUpdate',
    'enemyDamaged',
    'enemyDestroyed',
    'enemyMoved',
    'enemySpawned',
    'equipSkin',
    'gameStateUpdate',
    'groundPollenRemoved',
    'groundPollenSpawned',
    'guildAccept',
    'guildChat',
    'guildCreate',
    'guildDecline',
    'guildInvite',
    'guildInviteReceived',
    'guildInviteToSquad',
    'guildKick',
    'guildLeave',
    'guildSquadAll',
    'guildTagUpdate',
    'guildUpdate',
    'inventoryUpdate',
    'inventoryUpdated',
    'itemCollected',
    'itemPickedUp',
    'itemRemoved',
    'itemSpawned',
    'itemUsed',
    'itemsAbsorbed',
    'itemsSpawned',
    'itemsUpdate',
    'leaveGame',
    'levelUp',
    'lightningStrike',
    'mazeInfo',
    'mazeLoadoutUpdated',
    'mobKillUpdate',
    'mpRemove',
    'mpSpawn',
    'newPlayer',
    'obstacleDamaged',
    'obstacleDestroyed',
    'obstaclesUpdate',
    'outsideXpGained',
    'petalBroken',
    'petalExplosion',
    'petalRestored',
    'ping',
    'playerDamaged',
    'playerDied',
    'playerDisconnected',
    'playerHealed',
    'playerInput',
    'playerInvulnerabilityEnded',
    'playerLeft',
    'playerMoved',
    'playerRespawned',
    'playerRevived',
    'playerSplit',
    'playerSwitched',
    'playerTeleported',
    'playerTransferred',
    'playerUpdated',
    'pong',
    'positionCorrected',
    'ppRemove',
    'ppSpawn',
    'publishSkin',
    'redeemCode',
    'requestChatHistory',
    'requestRespawn',
    'resetSkills',
    'runJS',
    'savePlayerProgress',
    'serverRestarting',
    'serverType',
    'sessionReplaced',
    'shopBuy',
    'shopPurchaseError',
    'shopPurchaseSuccess',
    'skillResetError',
    'skillUpgradeError',
    'skillsUpdated',
    'skinDeleted',
    'skinPublished',
    'skinsUpdate',
    'speedBoostActive',
    'squadAccept',
    'squadChat',
    'squadCreate',
    'squadDecline',
    'squadInvite',
    'squadInviteReceived',
    'squadLeave',
    'squadUpdate',
    'starsEarned',
    'targetDummyDPS',
    'teleporterEntered',
    'teleporterExited',
    'transferFailed',
    'updateEnemies',
    'updateItems',
    'updateLoadout',
    'updateName',
    'updatePlayers',
    'upgradeSkill',
    'useItem',
    'webRemoved',
    'webSpawned',
    'xpGained',
    'zoneUpdate',
] as const;

/**
 * An event name that has an opcode.
 *
 * `as const` above is what makes this a union of the literal names rather than
 * plain `string`, and the ECS outbox (ecs/net/outbox.ts) types its whole API
 * against it. That turns "this event is missing from the table, so it costs its
 * own name in bytes on every frame" from something you would only discover with
 * a bandwidth probe into a compile error.
 */
export type WireEvent = typeof WIRE_EVENTS[number];

/** Whether a name has an opcode — the runtime half of the check above. */
export function isWireEvent(name: string): name is WireEvent {
    return WIRE_EVENT_IDS.has(name);
}

/** name -> opcode. Built once; the reverse direction is WIRE_EVENTS itself. */
export const WIRE_EVENT_IDS: ReadonlyMap<string, number> =
    new Map(WIRE_EVENTS.map((n, i) => [n, i]));

/**
 * Fingerprint of the table above, mixed into the handshake signature. Any
 * add/remove/reorder changes this, which forces stale clients to reload.
 */
export function wireEventsSignature(): string {
    let h = 2166136261;
    for (const n of WIRE_EVENTS) {
        for (let i = 0; i < n.length; i++) {
            h = Math.imul(h ^ n.charCodeAt(i), 16777619);
        }
        h = Math.imul(h ^ 44, 16777619);
    }
    return (h >>> 0).toString(36);
}
