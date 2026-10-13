# Optimization and Hel casino branch

Base: origin/web at bb3fcf01. The older dirty Desktop checkout is untouched.
The Hel casino source was ported from local commit 77fbe150, without its
obsolete dist files, TypeScript files, or username-based owner privileges.

## Changes

- Replication retains its ECS query between client snapshots. The query still
  refreshes when archetypes appear and rebinds when used with another World.
- Arena standings reuse row storage, borrow player names, and select only the
  ten displayed entries. Equal-score ordering and player counts are preserved.
- Star shop offers are cached per rotation; invalid/non-finite purchase balances
  are rejected before debiting an account.
- Hel's Casino NPC supports /casino, chip purchase/cashout, coin flip and Plinko.
  One star buys ten chips. Rules disclose the 40% payout chance and 60% loss;
  payouts include the stake. Proximity, balances, cooldowns and randomness are
  checked server-side. There is no external checkout added here.
- Skittering Rock (Garden), Static Firefly (Hel), and Echo Jellyfish (Sewers)
  reuse existing renderers/AI and their base creatures' drops. Existing spawning
  population limits remain in effect.

## Account privileges

There is no concealed exemption or suppression of admin action logs. Rights
continue to come from server-held account state, never a chosen display name.
Authentication, anti-abuse checks and admin-command announcements remain.
No production database was changed. Clearing existing moderation flags requires
access to the correct deployment/database and identification of the stored
account; editing a live server's database file behind its in-memory state is
unsafe and would be overwritten by autosave.

## Validation

Native release build and paired release web client/server build succeeded.
Snapshot tests: 8 passed. Cached-query regression: 1 passed, covering a new
archetype and switching Worlds. Shipped-content validation: 26 passed.
Casino odds/balance validation and casino command registration passed.
Shop's pure tests passed. Casino purchase/wager and live shop-channel tests
could not start their fixture server: this environment denies local socket
bind (Operation not permitted). These live paths still need a permitted runtime
smoke test before production deployment.

A synthetic native -O3 benchmark (cpp/tools/query_cache_bench.cpp), 20,000
queries across 64 archetypes, measured 13.800 ms rebuilding queries versus
2.373 ms reusing one, with equal 2,560,000 total entity visits. This measures
query overhead only; it does not establish whole-game FPS or server capacity.
To reproduce after the native build:

    clang++ -O3 -std=c++17 -Icpp cpp/tools/query_cache_bench.cpp cpp/build/libflix_shared.a -o /tmp/flowrix-query-bench
    /tmp/flowrix-query-bench

The matching dist artifacts were rebuilt together. No protocol message layout
changed; the existing content hash detects the new data on both ends.
