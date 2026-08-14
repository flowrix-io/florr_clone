/**
 * The per-tick delta stream — the decoder for the wire format that
 * server/tickBroadcast.ts produces. The two must be changed together.
 *
 * Also carries the bulk updatePlayers/updateEnemies/updateItems replacements
 * and the death/revive transitions, which share its player-ingestion helpers.
 */

import { ClientWorld } from '../../client_world';
import { Enemy } from '../../enemy';
import { WorldItem } from '../../item';
import { getMobStats } from '../../mobs';
import { Player, ServerPlayer } from '../../player';
import { isLocalPlayerId, isOwnPlayerId, padLoadout, toClientPlayer, withoutRawPetalPositions } from '../playerRefs';
import { applyEnemyUpdate, forgetEnemy } from '../enemyIngest';

export function registerGameStateHandlers(game: any): void {
    // `game` is untyped here (the handlers predate the split), but the world is
    // not: naming it gives every ingestion call below a real signature to check
    // against, which is the only compile-time safety this file has.
    const cw: ClientWorld = game.clientWorld;

    // Thin bindings over the shared ingestion helpers (see net/enemyIngest.ts),
    // so every call site below reads exactly as it did when they were local.
    const handleEnemyUpdate = (enemy: Enemy, snapTimeMs?: number) => applyEnemyUpdate(game, enemy, snapTimeMs);
    const handleEnemyOutOfView = (enemyId: string) => forgetEnemy(game, enemyId);


    // Listen for server game state updates for better synchronization.
    // Pure delta protocol — server only sends what *changed* this tick:
    //   P = newly-changed players (delta fields)
    //   E = newly-changed enemies (delta fields, or full fields on first sight)
    //   R = enemies to remove (left viewport or died)
    //   F = 1 marks a full-resync snapshot (server detected a dropped frame):
    //       E lists every viewport enemy, so unmentioned enemies are stale.
    // Otherwise, unmentioned entities keep their current state.
    // Per-player keys: i,n,x,y,a,h,H,l,s,e,f,q,r,k,m,v,V,z, p (petalPositions array).
    // Per-petal keys: L=loadoutIndex,I=instanceIndex,x,y,N=noPhysics.
    // Per-enemy keys: i,t=type,T=tier,x,y,a,h,H. Missing fields = unchanged.
    game.socket.on('gameStateUpdate', (data: any) => {
        const serverPlayers: any[] | undefined = data.P;
        const serverEnemies: any[] | undefined = data.E;
        const removedEnemyIds: string[] | undefined = data.R;
        const removedPlayerIds: string[] | undefined = data.D;

        // De-jittered snapshot timeline. Stamping snapshots with *arrival* time
        // lets network jitter distort the timeline: under latency, TCP delivers
        // several ticks in a burst with near-identical timestamps, and the
        // interpolator plays 100ms of movement in a few ms (stutter / rubber-
        // banding). Instead, map the server's tick timestamp (data.T) into
        // client time with a slowly-adapting offset: spacing between snapshots
        // then stays the server's true tick spacing no matter how packets
        // arrive. The 0.02 gain tracks genuine clock drift but barely reacts
        // to per-packet jitter; a >2s divergence means reconnect/clock jump,
        // so re-anchor immediately.
        const arrivalMs = performance.now();
        let snapTimeMs = arrivalMs;
        if (typeof data.T === 'number') {
            const g: any = game;
            const off = arrivalMs - data.T;
            if (g._srvClockOffset === undefined || Math.abs(off - g._srvClockOffset) > 2000) {
                g._srvClockOffset = off;
            } else {
                g._srvClockOffset += (off - g._srvClockOffset) * 0.02;
            }
            snapTimeMs = data.T + g._srvClockOffset;
        }

        if (serverPlayers) {
            for (const sp of serverPlayers) {
                const id = sp.i;
                const existing = cw.player(id);
                if (existing) {
                    // Players (self AND remote) only carry target*: game.ts eases
                    // every flower toward it with the same gardn exponential lerp,
                    // so remote players move exactly like the local one. They used
                    // to also feed the enemies' time-based `_snapshots` buffer,
                    // which replayed the server path at an 80ms render delay — a
                    // visibly different motion curve from the local flower's ease.
                    // Enemies still use snapshots (see the E-loop).
                    cw.movePlayer(id, sp.x, sp.y, sp.a);
                    if (sp.vx !== undefined) existing.velocityX = sp.vx;
                    if (sp.vy !== undefined) existing.velocityY = sp.vy;
                    if (sp.h !== undefined) existing.health = sp.h;
                    if (sp.H !== undefined) existing.maxHealth = sp.H;
                    if (sp.l !== undefined) existing.level = sp.l;
                    if (sp.n !== undefined) existing.name = sp.n;
                    if (!existing.forcedFlags) {
                        if (sp.f !== undefined) existing.faceFlags = sp.f;
                        if (sp.q !== undefined) existing.equipFlags = sp.q;
                        if (sp.r !== undefined) existing.renderFlags = sp.r;
                        if (sp.m !== undefined) existing.mouth = sp.m;
                    }
                    if (sp.k !== undefined) existing.equippedSkinId = sp.k;
                    if (sp.v !== undefined) (existing as any).inPvpArena = !!sp.v;
                    if (sp.M !== undefined) (existing as any).inMaze = !!sp.M;
                    if (sp.V !== undefined) (existing as any).pvpScore = sp.V;
                    if (sp.z !== undefined) (existing as any).sizeMultiplier = sp.z;
                    if (sp.s !== undefined) (existing as any).score = sp.s;
                    if (sp.sm !== undefined) existing.speedFactor = sp.sm;
                    if (sp.e !== undefined) existing.petalExtension = sp.e || 1.0;
                    if (Array.isArray(sp.p)) {
                        const serverPetalPositions = sp.p;
                        if (!existing.petalPositions) {
                            existing.petalPositions = serverPetalPositions.map((pos: any) => ({
                                loadoutIndex: pos.L,
                                instanceIndex: pos.I,
                                x: pos.x,
                                y: pos.y,
                                noPhysics: !!pos.N,
                                targetX: pos.x,
                                targetY: pos.y,
                            }));
                        } else {
                            serverPetalPositions.forEach((serverPos: any) => {
                                const existingPos = existing.petalPositions!.find(
                                    (p: any) => p.loadoutIndex === serverPos.L && p.instanceIndex === serverPos.I
                                );
                                if (existingPos) {
                                    existingPos.targetX = serverPos.x;
                                    existingPos.targetY = serverPos.y;
                                    existingPos.noPhysics = !!serverPos.N;
                                } else {
                                    existing.petalPositions!.push({
                                        loadoutIndex: serverPos.L,
                                        instanceIndex: serverPos.I,
                                        x: serverPos.x,
                                        y: serverPos.y,
                                        noPhysics: !!serverPos.N,
                                        targetX: serverPos.x,
                                        targetY: serverPos.y,
                                    } as any);
                                }
                            });
                            existing.petalPositions = existing.petalPositions!.filter((pos: any) =>
                                serverPetalPositions.some((sp2: any) =>
                                    sp2.L === pos.loadoutIndex && sp2.I === pos.instanceIndex
                                )
                            );
                        }
                    }
                } else {
                    // First sight: server omits fields equal to defaults. Apply matching defaults here.
                    // Position/facing are NOT on this object — they go straight
                    // into the entity below.
                    const newPlayer: any = {
                        id,
                        name: sp.n,
                        health: sp.h,
                        maxHealth: sp.H,
                        level: sp.l ?? 1,
                        score: sp.s ?? 0,
                        petalExtension: sp.e ?? 1.0,
                        faceFlags: sp.f ?? 0,
                        equipFlags: sp.q ?? 0,
                        renderFlags: sp.r ?? 0,
                        equippedSkinId: sp.k ?? '',
                        mouth: sp.m ?? 14.5,
                        inPvpArena: !!sp.v,
                        inMaze: !!sp.M,
                        pvpScore: sp.V ?? 0,
                        sizeMultiplier: sp.z ?? 1.0,
                        imageLoaded: true,
                        velocityX: 0,
                        velocityY: 0,
                        xp: 0,
                        xpToNextLevel: 100,
                    };
                    if (sp.vx !== undefined) newPlayer.velocityX = sp.vx;
                    if (sp.vy !== undefined) newPlayer.velocityY = sp.vy;
                    if (Array.isArray(sp.p)) {
                        newPlayer.petalPositions = sp.p.map((pos: any) => ({
                            loadoutIndex: pos.L,
                            instanceIndex: pos.I,
                            x: pos.x,
                            y: pos.y,
                            noPhysics: !!pos.N,
                            targetX: pos.x,
                            targetY: pos.y,
                        }));
                    }
                    cw.upsertPlayer(id, sp.x, sp.y, sp.a ?? 0, newPlayer);
                }
            }
        }

        // Players the server has culled: out of our visibility box, or gone.
        // Without this every flower we ever saw stayed in the map forever,
        // frozen at its last-known position and still drawn on the minimap.
        // Never drop a flower we own — the local halves are always streamed.
        if (removedPlayerIds) {
            for (const id of removedPlayerIds) {
                if (isOwnPlayerId(game, id)) continue;
                cw.removePlayer(id);
            }
        }

        // Explicit removes only: drop just the enemies the server told us to drop.
        // Stationary / unchanged enemies aren't mentioned at all and stay as-is.
        if (removedEnemyIds) {
            for (const id of removedEnemyIds) handleEnemyOutOfView(id);
        }

        // Full-resync snapshot: a frame to us was dropped under backpressure, so
        // one of our enemies may be a ghost whose one-shot removal never arrived.
        // E now lists the entire viewport — anything we hold beyond it is stale.
        // (Mid-death-animation enemies are skipped by handleEnemyOutOfView and
        // cleaned up by the game loop's 200ms animation timer.)
        if (data.F) {
            const mentioned = new Set<string>();
            if (serverEnemies) for (const e of serverEnemies) mentioned.add(e.i);
            for (const id of cw.enemyIds()) {
                if (!mentioned.has(id)) handleEnemyOutOfView(id);
            }
            // Same for players: after a resync the server re-sends every visible
            // flower as a first-sight record, so anything P doesn't mention is a
            // ghost whose D entry was lost with the dropped frame.
            const mentionedPlayers = new Set<string>();
            if (serverPlayers) for (const sp of serverPlayers) mentionedPlayers.add(sp.i);
            for (const id of cw.playerIds()) {
                if (!mentionedPlayers.has(id) && !isOwnPlayerId(game, id)) cw.removePlayer(id);
            }
        }

        if (serverEnemies) {
            for (const e of serverEnemies) {
                const existing = cw.enemyEntity(e.i);
                if (existing !== undefined) {
                    // Partial update - merge only fields that are present.
                    // Every fallback reads the last AUTHORITATIVE value
                    // (InterpTarget), never the render-mutated Position/Angle:
                    // the interpolation systems move those every frame, so
                    // feeding one back in as if it were fresh server data makes
                    // the mob chase its own tail and wobble after a turn.
                    const merged: any = {
                        id: e.i,
                        type: e.t !== undefined ? e.t : cw.mobType(existing),
                        tier: e.T !== undefined ? e.T : cw.mobTier(existing),
                        x: e.x !== undefined ? e.x : cw.mobTargetX(existing),
                        y: e.y !== undefined ? e.y : cw.mobTargetY(existing),
                        angle: e.a !== undefined ? e.a : cw.mobTargetAngle(existing),
                        health: e.h !== undefined ? e.h : cw.mobHealth(existing),
                        maxHealth: e.H !== undefined ? e.H : cw.mobMaxHealth(existing),
                    };
                    handleEnemyUpdate(merged, snapTimeMs);
                } else {
                    // First sight (or recovery if existing was malformed). Server omits
                    // tier/maxHealth/angle when they match defaults — apply fallbacks.
                    if (e.t === undefined) {
                        // Defensive: drop malformed entries rather than render an undefined-typed mob.
                        continue;
                    }
                    const tier = e.T ?? 'common';
                    const defaultStats = getMobStats(e.t, tier);
                    const maxHealth = e.H ?? (defaultStats ? defaultStats.health : e.h);
                    handleEnemyUpdate({
                        id: e.i,
                        type: e.t,
                        tier,
                        x: e.x,
                        y: e.y,
                        angle: e.a ?? 0,
                        health: e.h,
                        maxHealth,
                        isPet: e.o === 1,
                    } as any, snapTimeMs);
                }
            }
        }
    });

    game.socket.on('updatePlayers', (serverPlayers: ServerPlayer[]) => {
        const serverPlayerIds = new Set(serverPlayers.map(p => p.id));
        // Remove players that are no longer sent by the server
        for (const playerId of cw.playerIds()) {
            if (!serverPlayerIds.has(playerId)) cw.removePlayer(playerId);
        }

        serverPlayers.forEach(serverPlayer => {
            let player: Player | undefined = cw.player(serverPlayer.id);
            if (player) {
                // This is a bulk snapshot, not the per-tick delta: it carries an
                // authoritative position, which becomes the ease target like any
                // other. It must not be written as the drawn position or the
                // flower jumps every time one of these arrives.
                cw.movePlayer(serverPlayer.id, serverPlayer.x, serverPlayer.y, serverPlayer.angle);
                player.score = serverPlayer.score;
                player.health = serverPlayer.health;
                player.maxHealth = serverPlayer.maxHealth;
                player.damage = serverPlayer.damage;
                // Suppress stale server-driven loadout/inventory overwrites during in-flight
                // optimistic updates (swaps, drops, etc.) that haven't been round-tripped yet.
                const inv = (game as any).inventoryManager;
                const suppressMs = inv?.LOADOUT_SYNC_SUPPRESS_MS ?? 0;
                const lastLocal = inv?.lastLocalLoadoutChange ?? 0;
                const isLocal = isLocalPlayerId(game, serverPlayer.id);
                const suppress = isLocal && Date.now() - lastLocal < suppressMs;
                if (!suppress) {
                    player.inventory = serverPlayer.inventory;
                    player.loadout = padLoadout(serverPlayer.loadout, 20);
                    if (isLocal) game.inventoryManager?.reconcileStagedWithInventory();
                } else {
                    // Still overlay server-side per-petal state (cooldowns, health) onto matching
                    // client slots so cooldown animations tick correctly while we hold the swap.
                    const serverPad = padLoadout(serverPlayer.loadout, 20);
                    for (let i = 0; i < player.loadout.length && i < serverPad.length; i++) {
                        const local = player.loadout[i];
                        const remote = serverPad[i];
                        if (local && remote &&
                            local.type === remote.type &&
                            local.rarity === remote.rarity &&
                            (local.type !== 'petal' || local.petalType === remote.petalType)) {
                            local.health = remote.health;
                            local.maxHealth = remote.maxHealth;
                            local.onCooldown = remote.onCooldown;
                        }
                    }
                }
                player.isInvulnerable = serverPlayer.isInvulnerable;
                player.knockbackX = serverPlayer.knockbackX;
                player.knockbackY = serverPlayer.knockbackY;
                player.level = serverPlayer.level;
                player.xp = serverPlayer.xp;
                player.xpToNextLevel = serverPlayer.xpToNextLevel;
                player.lastDamageTime = serverPlayer.lastDamageTime;
                // ServerPlayer stores this as a numeric multiplier and the
                // client as a flag; the coercion used to be implicit because
                // `player` came out of an untyped Map.
                player.speed_boost = !!serverPlayer.speed_boost;
                // Sync petal extension from server
                player.petalExtension = serverPlayer.inputs?.petalExtension || 1.0;
                // Update mobKills if it changed (use reference check - server sends new objects)
                if (serverPlayer.mobKills !== undefined) {
                    const mobKillsChanged = player.mobKills !== serverPlayer.mobKills;
                    player.mobKills = serverPlayer.mobKills;
                    if (mobKillsChanged && isLocalPlayerId(game, serverPlayer.id) && game.inventoryManager) {
                        game.inventoryManager.updateMobGalleryIfOpen();
                    }
                }
                // Also update tp and skills if present
                if (serverPlayer.tp !== undefined) {
                    player.tp = serverPlayer.tp;
                }
                if (serverPlayer.skills !== undefined) {
                    player.skills = serverPlayer.skills;
                }
                // Update stars if present
                if (serverPlayer.stars !== undefined) {
                    player.stars = serverPlayer.stars;
                    if (game.shopManager && game.shopManager.isShopOpenState()) {
                        game.shopManager.updateStarsDisplay();
                    }
                }
            } else {
                // Add new player
                player = toClientPlayer(withoutRawPetalPositions({
                    ...serverPlayer,
                    image: new Image(),
                    imageLoaded: false,
                } as any));
                player.loadout = padLoadout(serverPlayer.loadout, 20);
                cw.upsertPlayer(serverPlayer.id, serverPlayer.x, serverPlayer.y, serverPlayer.angle, player);
            }
        });
    });

    game.socket.on('updateEnemies', (serverEnemies: Enemy[]) => {
        // Clear all enemies first - full refresh, no death animation
        for (const enemyId of cw.enemyIds()) {
            handleEnemyOutOfView(enemyId);
        }

        // Add all enemies - uses same path as all enemy updates
        serverEnemies.forEach(enemy => {
            handleEnemyUpdate(enemy);
        });
    });

    game.socket.on('updateItems', (serverItems: WorldItem[]) => {
        game.items.clear();
        serverItems.forEach(item => {
            game.items.set(item.id, item);
        });
    });

    game.socket.on('playerDied', (data: { playerId: string, x: number, y: number, angle: number, killedBy?: { type: string; tier: string } }) => {
        // Update the player's state to mark them as dead
        const player = cw.player(data.playerId);
        if (player) {
            player.isDead = true;
            // The corpse lies at a random rotation, and it is the entity's
            // facing that draws it.
            cw.movePlayer(data.playerId, undefined, undefined, data.angle);
        }

        if (isLocalPlayerId(game, data.playerId)) {
            game.isPlayerDead = true;
            game.showDeathScreen(data.killedBy);
        }
    });

    game.socket.on('playerRevived', (data: { 
        revivedPlayerId: string, 
        revivingPlayerId: string, 
        revivedPlayerName: string, 
        revivingPlayerName: string 
    }) => {
        // Update the revived player's state
        const revivedPlayer = cw.player(data.revivedPlayerId);
        if (revivedPlayer) {
            revivedPlayer.isDead = false;
            revivedPlayer.health = revivedPlayer.maxHealth;
        }

        // If the revived player is the local player, hide death screen
        if (isLocalPlayerId(game, data.revivedPlayerId)) {
            game.isPlayerDead = false;
            game.hideDeathScreen();
        }
    });
}
