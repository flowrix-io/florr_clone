#include "test.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "client/net_client.h"
#include "server/db.h"
#include "server/game_server.h"
#include "server_harness.h"
#include "server/systems/loot.h"
#include "shared/game/config.h"

using namespace flix;

// A modified client can send any request with any values, in any order, as
// fast as its budget allows: that is what a console on the page gives anyone.
// The server's promise is that no such stream mints a petal. This drives the
// real server with exactly that -- requests the UI never builds, slots and
// counts at their edges, joins into the arena and the maze, splits, drops and
// resumes, a second tab taking the account -- and checks after every step that
// the account is worth no more than it was.
//
// "Worth" is each petal counted at 5^rarity, bag and bar together. A craft
// turns five into one of the next tier and a failure loses some, an absorb
// destroys, a move moves: none of them can raise it. What can is a purchase
// (stars go down), a drop picked up (counted off the snapshots' PickedUp
// events -- the only human on the server, so every one is this account's,
// either half), and the quarter of a run's loot the arena hands back; all
// three are allowed for, and anything else that raises it is a dupe.

namespace {

using flix::testsupport::GameServerPeer;
using flix::testsupport::Harness;

constexpr const char* kName = "fuzzer";
constexpr const char* kPassword = "hunter2!";

const char* const kSeedPetals[] = {"basic", "rose",   "stinger", "light",    "rock",
                                   "clover", "splitter", "magnet", "egg",    "dandelion"};

double worth(const PlayerRecord& record) {
    double total = 0;
    for (const std::string& rarityName : record.inventory.keys()) {
        const Rarity rarity = parseRarity(rarityName);
        const Json& byType = record.inventory[rarityName];
        for (const std::string& key : byType.keys()) {
            total += PlayerRecord::stackCount(byType[key]) * std::pow(5.0, rarityIndex(rarity));
        }
    }
    for (const std::optional<StoredItem>& slot : record.loadout) {
        if (slot && !slot->petalType.empty()) total += std::pow(5.0, rarityIndex(slot->rarity));
    }
    return total;
}

struct Fuzzer {
    Harness& h;
    Rng rng;
    std::vector<std::uint16_t> petals;
    std::string userId;

    std::uint32_t below(std::uint32_t n) { return static_cast<std::uint32_t>(rng.next() % n); }
    bool coin(double p) { return rng.unit() < p; }

    // Half of every value is what the shipping client could send -- a petal
    // the account owns, a tier it has, a count it can afford -- so requests
    // land and move the account; the rest is what only a modified one sends.
    std::uint16_t petal() {
        if (coin(0.05)) return kNoPetal;
        if (coin(0.05)) return static_cast<std::uint16_t>(rng.next());
        return petals[below(static_cast<std::uint32_t>(petals.size()))];
    }
    Rarity rarity() {
        if (coin(0.5)) return static_cast<Rarity>(below(rarityIndex(Rarity::Apex)));
        if (coin(0.05)) return static_cast<Rarity>(static_cast<std::uint8_t>(rng.next()));
        return static_cast<Rarity>(below(kRarityCount));
    }
    int slot() { return coin(0.05) ? static_cast<int>(below(256)) : static_cast<int>(below(22)); }
    std::uint32_t count() {
        if (coin(0.5)) return 5 + below(10);
        static const std::uint32_t edges[] = {0u, 1u, 4u, 5u, 6u, 9u, 10u, 25u, 0x7FFFFFFFu,
                                              0x80000000u, 0xFFFFFFFFu, 0x80000005u};
        return coin(0.5) ? edges[below(sizeof edges / sizeof edges[0])] : below(60);
    }

    const PlayerRecord& record() const { return *h.server.database().findProgress(userId); }
    bool inArena() {
        const Session* session = GameServerPeer::sessionOf(h.server, kName);
        return session != nullptr && session->arena != nullptr;
    }

    /// Every tick of the run goes through here, logins and resumes included,
    /// so `picked` is what every drop this account picked up since the last
    /// take() was worth -- read off the server's own pickup list, which a
    /// snapshot can neither drop nor merge. Only a live body of this account
    /// counts: an idle tick runs no loot pass and leaves the last list there.
    double picked = 0;
    NetClient* clients[2] = {nullptr, nullptr};
    void tick() {
        h.step(1, {clients[0], clients[1]});
        const Session* session = GameServerPeer::sessionOf(h.server, kName);
        for (const LootSystem::Pickup& pickup : GameServerPeer::lastPickups(h.server)) {
            if (session == nullptr || !session->owns(pickup.player)) continue;
            if (!h.server.world().isAlive(pickup.player)) continue;
            picked += std::pow(5.0, rarityIndex(pickup.rarity));
        }
    }
    template <class F>
    bool until(F done, int maxTicks = 400) {
        for (int i = 0; i < maxTicks; ++i) {
            tick();
            if (done()) return true;
        }
        return false;
    }
    double take() {
        const double was = picked;
        picked = 0;
        return was;
    }
    bool connect(NetClient& c) {
        c.contentHash = content().contentHash();
        if (!c.connect("127.0.0.1", h.port)) return false;
        return until([&] { return c.status() == NetClient::Status::Ready; });
    }
    bool login(NetClient& c) {
        if (!connect(c)) return false;
        c.requestLogin(kName, kPassword);
        return until([&] { return c.status() == NetClient::Status::LoggedIn; });
    }
};

} // namespace

TEST(no_stream_of_requests_mints_a_petal) {
    const char* steps = std::getenv("FLIX_FUZZ_STEPS");
    const int kSteps = steps != nullptr ? std::atoi(steps) : 400;
    const char* seedText = std::getenv("FLIX_FUZZ_SEED");
    const std::uint64_t seed = seedText != nullptr ? std::strtoull(seedText, nullptr, 10) : 7;

    Harness h("inventory-fuzz", [](const std::string& path) {
        flix::testsupport::seedUser(path, kName, kPassword);
        for (const char* id : kSeedPetals) {
            const std::string key = std::string("petal_") + id;
            for (int r = 0; r <= rarityIndex(Rarity::Apex); ++r) {
                flix::testsupport::seedStack(path, kName, key.c_str(), static_cast<Rarity>(r),
                                             r < 4 ? 40 : 7);
            }
        }
    }, flix::testsupport::dataDir(), 0);
    if (!h.ready) { CHECK(false); return; }

    Fuzzer f{h, Rng(seed), {}, {}};
    for (const char* id : kSeedPetals) {
        const std::uint16_t index = content().petalIndex(id);
        if (index != kInvalidIndex) f.petals.push_back(index);
    }
    f.userId = h.server.database().findUser(kName)->id;

    NetClient first, second;
    NetClient* live = &first;
    NetClient* spare = &second;
    f.clients[0] = live;
    f.clients[1] = spare;
    CHECK(f.login(*live));
    f.take();

    double was = worth(f.record());
    double starsWere = f.record().stars;
    bool arenaWas = f.inArena();
    double arenaLoot = 0;   // what drops picked up in the current run were worth
    int failures = 0;
    std::vector<std::string> recent;
    // What the run reached, so a pass can be told from a run that never got
    // anywhere: a fuzzer whose every request bounced proves nothing.
    int spent = 0, gained = 0, playing = 0, arena = 0, maze = 0, split = 0;

    for (int step = 0; step < kSteps && failures < 5; ++step) {
        NetClient& c = *live;
        std::string what;
        bool npc = false;
        const std::uint32_t pick = f.below(100);
        if (pick < 14) {
            const int s = f.slot();
            const std::uint16_t p = f.petal();
            const Rarity r = f.rarity();
            c.setLoadoutSlot(s, p, r);
            what = "setLoadout " + std::to_string(s) + " " + std::to_string(p) + " " +
                   std::to_string(rarityIndex(r));
        } else if (pick < 22) {
            const int a = f.slot(), b = f.slot();
            c.swapLoadoutSlots(a, b);
            what = "swap " + std::to_string(a) + " " + std::to_string(b);
        } else if (pick < 26) {
            c.swapLoadoutRows();
            what = "swapRows";
        } else if (pick < 31) {
            const int p = f.coin(0.1) ? static_cast<int>(f.below(256)) : static_cast<int>(f.below(4));
            c.saveLoadoutPreset(p);
            what = "savePreset " + std::to_string(p);
        } else if (pick < 37) {
            const int p = f.coin(0.1) ? static_cast<int>(f.below(256)) : static_cast<int>(f.below(4));
            c.loadLoadoutPreset(p);
            what = "loadPreset " + std::to_string(p);
        } else if (pick < 49) {
            const std::uint16_t p = f.petal();
            const Rarity r = f.rarity();
            const std::uint32_t n = f.count();
            c.requestCraft(p, r, static_cast<int>(n));
            what = "craft " + std::to_string(p) + " " + std::to_string(rarityIndex(r)) + " x" +
                   std::to_string(n);
        } else if (pick < 57) {
            std::vector<NetClient::AbsorbStack> stacks;
            const std::uint32_t n = 1 + f.below(4);
            for (std::uint32_t i = 0; i < n; ++i) {
                stacks.push_back({f.petal(), f.rarity(), f.count()});
                if (f.coin(0.3)) stacks.push_back(stacks.back());
            }
            c.requestAbsorb(stacks);
            what = "absorb " + std::to_string(stacks.size()) + " stacks";
        } else if (pick < 61) {
            npc = true;
            switch (f.below(4)) {
                case 0: c.requestOracleCraft(f.petal(), f.rarity()); what = "oracle"; break;
                case 1: c.requestTrade(f.petal(), f.rarity()); what = "trade"; break;
                case 2:
                    c.requestAssemble(f.rarity(), static_cast<std::uint8_t>(f.below(4)),
                                      static_cast<std::uint16_t>(f.count()));
                    what = "assemble";
                    break;
                default: c.requestTitanForge(f.petal()); what = "titan"; break;
            }
        } else if (pick < 65) {
            const int offer = f.coin(0.5) ? -1 : static_cast<int>(f.below(12));
            c.requestBuyPetal(f.petal(), f.rarity(), offer);
            what = "buy";
        } else if (pick < 68) {
            if (f.coin(0.5)) {
                c.requestUpgradeSkill(static_cast<SkillId>(f.below(40)), static_cast<int>(f.below(6)));
                what = "upgradeSkill";
            } else {
                c.requestResetSkills();
                what = "resetSkills";
            }
        } else if (pick < 72) {
            const int s = f.slot();
            c.usePetal(s);
            what = "usePetal " + std::to_string(s);
        } else if (pick < 79) {
            static const char* const doors[] = {"", "pvp", "maze", "garden", "desert"};
            const char* door = doors[f.below(5)];
            c.joinGame(1920, 1080, door, "fz", f.coin(0.3));
            what = std::string("join '") + door + "'";
        } else if (pick < 84) {
            c.leaveGame();
            what = "leave";
        } else if (pick < 88) {
            c.requestRespawn();
            what = "respawn";
        } else if (pick < 91) {
            // Drop the socket mid-whatever and come back on the token.
            const std::string token = c.sessionToken();
            c.disconnect();
            f.until([] { return false; }, 2);
            if (f.connect(c)) {
                c.resumeSession(token);
                f.until([&] { return c.haveSession(); }, 60);
            }
            what = "drop+resume";
        } else if (pick < 93) {
            // A second tab signs in and takes the account.
            spare->disconnect();
            if (f.login(*spare)) std::swap(live, spare);
            what = "second tab";
        } else {
            // A save and a fresh read of the file: the stored shape (worn
            // petals folded back into the bag) must not be worth more either.
            h.server.persistAll();
            Database reread;
            std::string error;
            reread.load(h.dbPath, error);
            const PlayerRecord* stored = reread.findProgress(f.userId);
            if (stored != nullptr && worth(*stored) > worth(f.record()) + 0.5) {
                std::printf("  FUZZ step %d: the saved file is worth %.0f, the live record %.0f\n",
                            step, worth(*stored), worth(f.record()));
                ++failures;
            }
            what = "save+reload";
        }

        f.until([] { return false; }, 4);
        const double picked = f.take();
        recent.push_back(what);
        if (recent.size() > 12) recent.erase(recent.begin());

        const double now = worth(f.record());
        const double stars = f.record().stars;
        const bool inRun = f.inArena();
        // A pickup inside a run lands in the run's bag, and a quarter of what
        // the run looted reaches the account when it ends.
        double allowed = picked;
        if (arenaWas) arenaLoot += picked;
        if (arenaWas && !inRun) {
            allowed += arenaLoot;
            arenaLoot = 0;
        }
        const bool bought = stars < starsWere;
        if (now > was + allowed + 0.5 && !bought) {
            std::printf("  FUZZ step %d (%s): worth %.0f -> %.0f with %.0f picked up%s; the "
                        "steps before it:\n",
                        step, what.c_str(), was, now, allowed, npc ? " (an NPC request)" : "");
            for (const std::string& line : recent) std::printf("      %s\n", line.c_str());
            if (!npc) ++failures;
        }
        arenaWas = inRun;
        if (now < was - 0.5) ++spent;
        if (now > was + 0.5) ++gained;
        if (const Session* session = GameServerPeer::sessionOf(h.server, kName)) {
            if (session->playing()) ++playing;
            if (session->arena) ++arena;
            if (session->playing() && session->realm == Realm::Maze) ++maze;
            if (session->split()) ++split;
        }
        was = now;
        starsWere = stars;
    }
    std::printf("  fuzz: %d steps; worth fell on %d and rose (bought or looted) on %d; in the "
                "world %d, the arena %d, the maze %d, split %d\n",
                kSteps, spent, gained, playing, arena, maze, split);
    CHECK_EQ(failures, 0);
}
