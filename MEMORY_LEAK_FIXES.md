# Memory Leak and Performance Fixes

## Problem
The server was experiencing performance degradation over time when deployed on AWS EC2, becoming slow after running for a while. This was caused by several memory leaks and resource management issues.

## Issues Fixed

### 1. **Unbounded setTimeout Accumulation**
- **Problem**: Item expiration timeouts and petal cooldown timeouts were created but never cleaned up if items were picked up early or players disconnected.
- **Fix**: 
  - Added `itemExpirationTimeouts` and `petalCooldownTimeouts` Maps to track all active timeouts
  - Clean up timeouts when items are picked up or removed
  - Clean up petal cooldown timeouts when players disconnect

### 2. **Growing petalLastProjectileTime Map**
- **Problem**: The `petalLastProjectileTime` Map could grow indefinitely as it tracked projectile times for all petal instances.
- **Fix**: Added periodic cleanup in the main game loop to keep only the most recent 1000 entries, preventing unbounded growth.

### 3. **Item Expiration Timeout Leaks**
- **Problem**: Items had setTimeout callbacks for expiration, but if items were removed early (picked up or out of bounds), the timeouts would still fire and try to access non-existent items.
- **Fix**: 
  - Track all item expiration timeouts in a Map
  - Clean up timeouts when items are removed
  - Added periodic cleanup in the main loop to remove expired items based on spawnTime, providing a backup cleanup mechanism

### 4. **Player Disconnect Cleanup**
- **Problem**: When players disconnected, petal cooldown timeouts and petalLastProjectileTime entries weren't cleaned up.
- **Fix**: 
  - Clean up all petal cooldown timeouts for the disconnecting player
  - Clean up all petalLastProjectileTime entries for the disconnecting player

### 5. **Periodic Item Expiration Cleanup**
- **Problem**: Relying solely on setTimeout for item expiration could lead to memory leaks if timeouts weren't properly cleaned up.
- **Fix**: Added periodic cleanup in the main game loop that checks item spawnTime and removes expired items, providing a safety net even if setTimeout callbacks fail.

## Files Modified

1. **src/server/gameState.ts**
   - Added `itemExpirationTimeouts` Map to track item expiration timeouts
   - Added `petalCooldownTimeouts` Map to track petal cooldown timeouts

2. **src/server.ts**
   - Imported new timeout tracking Maps
   - Updated petal cooldown timeout creation to track timeouts
   - Added cleanup in disconnect handler for petal timeouts and petalLastProjectileTime
   - Added periodic cleanup for expired items in main game loop
   - Added periodic cleanup for petalLastProjectileTime Map (keeps only 1000 most recent entries)
   - Clean up item expiration timeouts when items are removed
   - Skip game loop processing when there are no authenticated players
   - Only emit gameStateUpdate to authenticated players (prevents title screen memory leaks)
   - Added explicit socket event listener cleanup on disconnect

3. **src/server/itemManager.ts**
   - Updated item expiration timeout creation to track timeouts
   - Clean up timeouts when items expire

4. **src/server/playerState.ts**
   - Imported `itemExpirationTimeouts`
   - Updated item expiration timeout creation to track timeouts
   - Clean up timeouts when items are picked up
   - Added `cleanupEnemy()` call when enemies die from petal collisions

5. **src/server/utils.ts**
   - Added `cleanupEnemy()` function to clear all enemy data structures before removal
   - Clears damageContributors Map, poisonEffects array, dpsHistory array, and other optional properties

### 6. **Enemy Object Memory Leaks**
- **Problem**: When enemies were killed, their data structures (`damageContributors` Map, `poisonEffects` array, `dpsHistory` array) were never cleared, preventing garbage collection and causing memory to accumulate.
- **Fix**: 
  - Created `cleanupEnemy()` function to explicitly clear all enemy data structures
  - Clear `damageContributors` Map
  - Clear `poisonEffects` array
  - Clear `dpsHistory` array (for target dummies)
  - Clear other optional properties (dpsStartTime, currentDPS, wanderTarget, etc.)
  - Applied cleanup in all enemy removal locations (6 different places)

### 7. **Title Screen Memory Leaks**
- **Problem**: The main game loop was running continuously and emitting `gameStateUpdate` to ALL connected sockets (including unauthenticated players on the title screen), causing memory to accumulate even when no one was playing.
- **Fix**: 
  - Skip game loop processing when there are no authenticated players
  - Only emit `gameStateUpdate` to authenticated players, not all sockets
  - Added explicit socket event listener cleanup on disconnect
  - Only emit `playerDisconnected` events when there are authenticated players to receive them

## Benefits

1. **Prevents Memory Leaks**: All timeouts are now properly tracked and cleaned up
2. **Bounded Memory Growth**: Maps and arrays are periodically cleaned to prevent unbounded growth
3. **Better Resource Management**: Resources are cleaned up immediately when no longer needed
4. **Improved Long-Term Stability**: Server should maintain consistent performance over extended periods
5. **Enemy Memory Cleanup**: Enemy objects are fully cleaned up when killed, preventing accumulation of damage tracking data

## Testing Recommendations

1. Monitor server memory usage over extended periods (24+ hours)
2. Test with multiple players connecting and disconnecting frequently
3. Verify items are properly cleaned up when picked up or expired
4. Check that petal cooldowns work correctly after fixes
5. Monitor CPU usage to ensure periodic cleanup doesn't cause performance issues
6. **Test mob killing extensively** - Kill many mobs and verify memory returns to baseline
7. Monitor memory usage before and after killing waves of enemies
8. Check that damage tracking data doesn't accumulate over time
9. **Test title screen memory** - Leave players on title screen and verify memory doesn't increase
10. Monitor memory with multiple unauthenticated connections (title screen)
11. Verify game loop doesn't process when no authenticated players exist

