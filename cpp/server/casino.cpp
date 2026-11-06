#include "server/game_server.h"
#include "server/text.h"
#include "shared/game/casino.h"
#include "server/crypto.h"
#include "server/systems/npcs.h"
#include <cmath>
#include <algorithm>
#include <sstream>
namespace flix {
namespace {
std::vector<std::string> casinoWords(const std::string& s) { std::istringstream in(s); std::vector<std::string> out; for(std::string word;in>>word;) out.push_back(word); return out; }
bool parseInteger(const std::string& s,int& n) { try { std::size_t used=0; const long v=std::stol(s,&used); if(used!=s.size()||v<0||v>10000)return false; n=int(v); return true; } catch(...) {return false;} }
std::string wholeNumber(double n) {return std::to_string(static_cast<long long>(n));}
}
void GameServer::runCasino(Session& session, net::Connection& connection, const std::string& argument) {
    const auto out = [&](const std::string& message) { sendCommerce(session,connection,"casino",true,message); sendSystem(connection,message); };
        if (!session.authenticated()) return;
        // Casino chips belong to the permanent account. An arena stash must
        // never be convertible to permanent stars through an admin-spawned NPC.
        if (session.arena || session.eventKit || session.controlling || session.controlledBy) { out("The casino is unavailable during an arena run."); return; }
        persistPlayer(session);
        PlayerRecord& record = database_.progress(session.userId);
        const auto words = casinoWords(argument);
        const auto status = [&] {
            out("Hel's Casino: " + wholeNumber(record.casinoChips) + " chips. 1 star = 10 chips.");
            out("Coin flip: 40% win (2x total payout), 60% lose. Expected return: 80%.");
            out("Plinko slots: 4x / 2x / 2x / 0x / 2x / 2x / 4x. "
                "Chances: 2% / 6% / 12% / 60% / 12% / 6% / 2%. Expected return: 88%.");
            out("Near Hel: /casino buy <stars>, /casino cashout <chips>, "
                "/casino flip <chips> <heads|tails>, /casino plinko <chips>. "
                "Bets: 1-10000 chips. Cashout in multiples of 10. One action per second.");
        };
        if (words.empty() || (words.size() == 1 && words[0] == "status")) {
            status();
            return;
        }
        int amount = 0;
        const bool flip = words[0] == "flip";
        const bool plinko = words[0] == "plinko";
        const bool buy = words[0] == "buy";
        const bool cashout = words[0] == "cashout";
        if ((!flip && !plinko && !buy && !cashout) ||
            words.size() != (flip ? 3u : 2u) || !parseInteger(words[1], amount) ||
            amount <= 0 || amount > kCasinoMaxBet ||
            (flip && words[2] != "heads" && words[2] != "tails") ||
            (cashout && amount % kCasinoChipsPerStar != 0)) {
            out("Invalid casino request. Type /casino for rules and commands.");
            return;
        }
        const Transform* body = session.playing() && world_.isAlive(session.entity) &&
                                !world_.has<Dead>(session.entity)
                                    ? world_.tryGet<Transform>(session.entity) : nullptr;
        if (!body || npcs_->findService(world_, NpcService::Casino, body->position, body->realm,
                                       kNpcServiceReach + kNpcServiceSlack) == NULL_ENTITY) {
            out("Stand beside Hel's Casino NPC to buy, cash out, or gamble.");
            return;
        }
        PlayerProgress* live = world_.tryGet<PlayerProgress>(session.entity);
        const double stars = live ? live->stars : record.stars;
        if (!std::isfinite(stars) || stars < 0 || stars > 9007199254740991.0 ||
            
            !casinoBalanceValid(record.casinoChips)) {
            out("Invalid balance. Ask an admin to review your account.");
            return;
        }
        const double now = database_.nowMillis() * 0.001;
        if (!std::isfinite(record.casinoReadyAt) || now < record.casinoReadyAt) {
            out("Please wait one second between casino actions.");
            return;
        }
        double chips = record.casinoChips;
        double nextStars = stars;
        std::string result;
        if (buy) {
            if (stars < amount || chips > kCasinoMaxBalance - amount * kCasinoChipsPerStar) {
                out("Not enough stars or chip balance limit reached.");
                return;
            }
            nextStars -= amount;
            chips += amount * kCasinoChipsPerStar;
            result = "Bought " + std::to_string(amount * kCasinoChipsPerStar) + " chips.";
        } else if (cashout) {
            if (chips < amount || stars > 9007199254740991.0 - amount / kCasinoChipsPerStar) {
                out("Not enough chips or star balance limit reached.");
                return;
            }
            chips -= amount;
            nextStars += amount / kCasinoChipsPerStar;
            result = "Cashed out for " + std::to_string(amount / kCasinoChipsPerStar) + " stars.";
        } else {
            // Check the maximum possible payout BEFORE drawing any randomness.
            if (chips < amount || chips > kCasinoMaxBalance - amount * 3) {
                out("Not enough chips or chip balance limit reached.");
                return;
            }
            auto& random = crypto::secureRandom();
            if (!random.seededFromKernel()) {
                out("Casino randomness unavailable. Try again later.");
                return;
            }
            // Rejection sampling avoids modulo bias and never shares the world RNG.
            std::uint8_t roll = 255;
            do { random.bytes(&roll, 1); } while (roll >= 200);
            const int percent = roll % 100;
            int multiplier = 0;
            if (flip) {
                const bool won = percent < 40;
                multiplier = won ? 2 : 0;
                const std::string landed = won ? words[2] : (words[2] == "heads" ? "tails" : "heads");
                result = "Coin flip landed " + landed + ": ";
            } else {
                const int slot = plinkoSlot(percent);
                multiplier = kPlinkoPayouts[slot];
                result = "Plinko landed in slot " + std::to_string(slot + 1) + ": ";
            }
            chips += amount * (multiplier - 1);
            result += std::to_string(multiplier) + "x, total payout " +
                      std::to_string(amount * multiplier) + " chips.";
        }
        record.stars = nextStars;
        record.casinoChips = chips;
        record.casinoReadyAt = now + 1;
        // Split bodies share an account; update both to prevent a stale copy
        // restoring the old star balance on a later save or body switch.
        for (Entity entity : {session.entity, session.splitOther}) {
            if (PlayerProgress* progress = world_.tryGet<PlayerProgress>(entity)) {
                progress->stars = nextStars;
            }
        }
        database_.markDirty();
        sendProfile(session, connection);
        out(result + " Balance: " + wholeNumber(chips) + " chips, " + wholeNumber(nextStars) + " stars.");
        return;

}
}
