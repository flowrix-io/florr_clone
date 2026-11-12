// Signing in and out: registration (guests included), login, resuming a saved
// session, password and username changes, logout, and the one-session rule.

#include "server/game_server.h"

#include <cstdio>
#include <utility>

#include "server/game_server_internal.h"
#include "server/guilds.h"
#include "server/text.h"

namespace flix {

namespace {

/// The wire's answer for each way createUser refuses. Every refusal used to go
/// out as UsernameTaken, which the client reads as "that account exists, log
/// in instead" -- so a name the format rules refused sent an auto-login rig
/// off to sign in to an account that was never made.
net::AuthStatus refusalStatus(CreateStatus status) {
    switch (status) {
        case CreateStatus::UsernameInvalid: return net::AuthStatus::UsernameInvalid;
        case CreateStatus::UsernameTaken:   return net::AuthStatus::UsernameTaken;
        case CreateStatus::PasswordInvalid: return net::AuthStatus::PasswordInvalid;
        // "Made" with no account to show for it is no account either.
        case CreateStatus::Ok:
        case CreateStatus::ServerError:     break;
    }
    return net::AuthStatus::ServerError;
}

} // namespace

void GameServer::sendAuthResult(net::Connection& connection, net::AuthStatus status,
                                const std::string& token, const std::string& username,
                                const std::string& reason) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::AuthResult));
    w.u8(static_cast<std::uint8_t>(status));
    w.str(token);
    w.str(username);
    w.str(reason);
    connection.send(w);
}

bool GameServer::spendLoginBudget(Session& session, net::Connection& connection) {
    if (spend(session.loginAttemptsAllowed)) return true;
    sendAuthResult(connection, net::AuthStatus::RateLimited, "", "", "Too many attempts. Wait a moment.");
    return false;
}

void GameServer::signInAs(Session& session, const std::string& userId, const std::string& username,
                          const std::string& token) {
    // A socket still in the world leaves it first, its body saved into the
    // account it belonged to -- this one again, or another (see leaveWorld).
    leaveWorld(session);
    releaseOnAccountChange(session, userId);
    replaceOtherSessions(session, userId);
    session.userId = userId;
    session.username = username;
    // Assigned whether or not the lookup lands, and never left as it was: a
    // flag left on this socket by whoever was signed in on it before must not
    // ride along -- not even into an account that socket has just made.
    const Account* account = std::as_const(database_).findUserById(userId);
    session.admin = account != nullptr && account->adminActive();
    session.adminTier = account != nullptr ? account->adminTier : kTopAdminTier;
    session.token = token.empty() ? database_.createSession(userId, username) : token;
    session.stage = SessionStage::Authenticated;
}

void GameServer::welcomeSignedIn(Session& session, net::Connection& connection) {
    sendAuthResult(connection, net::AuthStatus::Ok, session.token, session.username, "");
    sendDailyStreak(session, connection);
    sendFullProfile(session, connection);
    sendSkinCatalog(session, connection);
    sendGuildState(session, connection);
    sendChatHistory(connection);
}

void GameServer::handleRegister(Session& session, net::Connection& connection, ByteReader& reader) {
    const std::string username = reader.str();
    const std::string password = reader.str();
    if (!reader.ok()) return;

    if (!spendLoginBudget(session, connection)) return;

    // The database's own rules -- the one copy, which createUser applies again
    // below -- so this answer and that one cannot disagree.
    std::string reason;
    if (!Database::validUsername(username, reason, database_.chatTerms())) {
        sendAuthResult(connection, net::AuthStatus::UsernameInvalid, "", "", reason);
        return;
    }
    if (!Database::validPassword(password, reason)) {
        sendAuthResult(connection, net::AuthStatus::PasswordInvalid, "", "", reason);
        return;
    }

    // Below the format checks, so mistyping a password does not cost one of the
    // three accounts an address gets: those checks are pure string work and are
    // already bounded by the per-session budget above. Above the bcrypt hash and
    // the database write, which are the work an unlimited registration endpoint
    // hands an attacker.
    const std::string addressHash = database_.accountAddressHash(addressKey(session.clientAddress));
    if (!spendRegistration(session, connection, addressHash)) return;

    const CreateResult result = database_.createUser(username, password, addressHash);
    if (!result.ok() || !result.account) {
        sendAuthResult(connection, refusalStatus(result.status), "", "", result.reason);
        return;
    }
    beginNewAccount(session, connection, *result.account);
}

void GameServer::handleRegisterGuest(Session& session, net::Connection& connection) {
    // A guest IS an account -- a row in the file, a starter kit, a name on the
    // leaderboard -- so it is held to everything Register is, the per-socket
    // budget and the address limits both. Making guests cheaper than accounts
    // would only move the nine thousand spam accounts to this door.
    if (!spendLoginBudget(session, connection)) return;
    const std::string addressHash = database_.accountAddressHash(addressKey(session.clientAddress));
    if (!spendRegistration(session, connection, addressHash)) return;

    const CreateResult result = database_.createGuest(addressHash);
    if (!result.ok() || !result.account) {
        sendAuthResult(connection, net::AuthStatus::ServerError, "", "",
                       result.reason.empty() ? "Could not make a guest account." : result.reason);
        return;
    }
    beginNewAccount(session, connection, *result.account);
}

bool GameServer::spendRegistration(const Session& session, net::Connection& connection,
                                   const std::string& addressHash) {
    // The session budget each caller spends first bounds one SOCKET; it does
    // not bound one client, which can hang up and dial again for a fresh
    // allowance. These limits are keyed on the address instead, and outlive
    // any one connection -- and the address's standing, which sizes them, is
    // read from the accounts it made, so they outlive a restart too.
    const std::string address = addressKey(session.clientAddress);
    const LimitVerdict verdict = accountLimits_.spendRegistration(
        address,
        [&] {
            const Database::CreatorStanding made =
                database_.creatorStanding(addressHash, kIdleWindowMillis, kStandingWindowMillis);
            return AddressStanding{made.idleToday, made.played};
        },
        monotonicMillis());
    if (verdict.allowed) return true;
    // The moment an address goes to the penalty box is always worth a line;
    // the refusals around it are throttled, so a flood is not also a log flood.
    if (verdict.newlyBlocked) {
        std::printf("[ABUSE] %s kept asking after being refused; no new accounts from it for "
                    "%d minutes\n",
                    address.c_str(), static_cast<int>(kBlockMillis / 60000));
    }
    const std::string line = accountLimits_.refusalLogLine(address, verdict.scope, monotonicMillis());
    if (!line.empty()) std::printf("%s\n", line.c_str());
    sendAuthResult(connection, net::AuthStatus::RateLimited, "", "", verdict.message);
    return false;
}

void GameServer::beginNewAccount(Session& session, net::Connection& connection,
                                 const Account& account) {
    // Copied: signing in saves the socket's old body, and `account` is a row
    // of the table that save writes to.
    signInAs(session, std::string(account.id), std::string(account.username), {});
    grantStarterKit(database_.progress(session.userId));
    database_.markDirty();
    welcomeSignedIn(session, connection);
}

void GameServer::handleLogin(Session& session, net::Connection& connection, ByteReader& reader) {
    const std::string username = reader.str();
    const std::string password = reader.str();
    if (!reader.ok()) return;

    if (!spendLoginBudget(session, connection)) return;
    // Same reasoning as handleRegister: a reconnect resets the session budget,
    // and every attempt costs this server a bcrypt verify.
    const std::string address = addressKey(session.clientAddress);
    const LimitVerdict verdict = accountLimits_.spendLoginAttempt(address, monotonicMillis());
    if (!verdict.allowed) {
        sendAuthResult(connection, net::AuthStatus::RateLimited, "", "", verdict.message);
        return;
    }

    if (!database_.verifyPassword(username, password)) {
        // Deliberately the same answer for a wrong password and an unknown
        // account: distinguishing them tells an attacker which names exist.
        sendAuthResult(connection, net::AuthStatus::BadCredentials, "", "",
                       "Invalid username or password");
        return;
    }

    const Account* account = database_.findUser(username);
    if (!account) {
        sendAuthResult(connection, net::AuthStatus::ServerError, "", "", "Account could not be read.");
        return;
    }
    // A player who signed in is not what the limit is for.
    accountLimits_.refundLoginAttempt(address);

    signInAs(session, std::string(account->id), std::string(account->username), {});
    welcomeSignedIn(session, connection);
}

void GameServer::handleResume(Session& session, net::Connection& connection, ByteReader& reader) {
    const std::string token = reader.str();
    if (!reader.ok()) return;

    // On the login budget like every other way in. A token cannot be guessed,
    // but each resume is answered with the whole welcome -- Profile, skin
    // catalogue, guild, chat backlog -- and unbudgeted, one socket replaying
    // its own token could ask for that as fast as it could send.
    if (!spendLoginBudget(session, connection)) return;

    const Database::Session* record = database_.resolveSession(token);
    if (!record) {
        sendAuthResult(connection, net::AuthStatus::SessionExpired, "", "", "Please log in again.");
        return;
    }

    // Copied out before the other sessions are signed out: that saves their
    // bodies into the database, and `record` points into it.
    signInAs(session, std::string(record->userId), std::string(record->username), token);
    welcomeSignedIn(session, connection);
}

void GameServer::sendChangePasswordResult(net::Connection& connection, bool ok,
                                          const std::string& token, const std::string& reason) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::ChangePasswordResult));
    w.boolean(ok);
    w.str(token);
    w.str(reason);
    connection.send(w);
}

void GameServer::handleChangePassword(Session& session, net::Connection& connection,
                                      ByteReader& reader) {
    const std::string current = reader.str();
    const std::string next = reader.str();
    if (!reader.ok()) return;

    // WHOSE password this is comes from the session and from nowhere else. A
    // username on the wire would make this an endpoint for changing another
    // account's password, and an anonymous socket has no account to name.
    if (!session.authenticated() || session.username.empty()) {
        sendChangePasswordResult(connection, false, "", "You are not signed in.");
        return;
    }

    // An admin account's password is never changed in game (setPassword says
    // why, and refuses it again), so it is refused before a bcrypt verify or
    // an attempt from the budget is spent finding that out. On the account's
    // flag, not the session's: a banned admin is locked all the same.
    if (const Account* own = std::as_const(database_).findUserById(session.userId);
        own != nullptr && own->admin) {
        sendChangePasswordResult(connection, false, "", Database::kAdminPasswordLocked);
        return;
    }

    // Held to the login budgets, both of them: this costs a bcrypt verify and
    // then a bcrypt hash, so it is strictly dearer than a login, and a wrong
    // `current` is a password guess like any other -- against an account whose
    // socket may have been left open on a shared machine. The per-session
    // budget bounds this connection; the per-address one outlives a reconnect.
    if (!spend(session.loginAttemptsAllowed)) {
        sendChangePasswordResult(connection, false, "", "Too many attempts. Wait a moment.");
        return;
    }
    const std::string address = addressKey(session.clientAddress);
    const LimitVerdict verdict = accountLimits_.spendLoginAttempt(address, monotonicMillis());
    if (!verdict.allowed) {
        sendChangePasswordResult(connection, false, "", verdict.message);
        return;
    }

    // An account whose owner was never told its password -- a guest's random
    // one -- has no current password to produce, so the session is the proof:
    // the token that opened it is the only credential the account has ever
    // had. Every other account proves itself again, because a socket left open
    // on a shared machine is exactly who must not be able to lock its owner out.
    const Account* account = std::as_const(database_).findUserById(session.userId);
    const bool proven = account != nullptr && !account->passwordChosen;
    if (!proven && !database_.verifyPassword(session.username, current)) {
        sendChangePasswordResult(connection, false, "", "Your current password is not correct.");
        return;
    }
    // Producing the current password is proof of the account, not a guess at
    // it, so it does not spend from the budget -- the same reason a successful
    // login refunds its attempt.
    accountLimits_.refundLoginAttempt(address);

    if (!proven && current == next) {
        // Refused rather than quietly accepted: the sessions below would be
        // revoked and the token reissued for a change that did not happen, so
        // the player would be signed out elsewhere for nothing.
        sendChangePasswordResult(connection, false, "", "That is already your password.");
        return;
    }

    std::string reason;
    if (!database_.setPassword(session.username, next, reason)) {
        sendChangePasswordResult(connection, false, "", reason);
        return;
    }

    // Every token the account had dies with the old password. That is most of
    // what changing one is for: a session somebody else is holding would
    // otherwise outlive it by up to thirty days, and a stolen token is the
    // case a player changes their password over. This connection's own token
    // is among them, so it is replaced in the same breath -- the socket stays
    // authenticated either way, because the stage is in memory rather than in
    // the token, but the client has to be holding a live one to resume with.
    database_.revokeSessionsForUser(session.username);
    session.token = database_.createSession(session.userId, session.username);

    // Rate-limited rather than immediate, and not left to the thirty-second
    // persist either: a player who changes a password and closes the game must
    // not find the old one still working, and a whole-file write per request
    // would be a stall anyone could ask for.
    database_.maybeSave(monotonicMillis());

    sendChangePasswordResult(connection, true, session.token, "");
    // The Account panel draws its form from the Profile's flags, and an account
    // that just chose its first password has a different form now.
    if (proven) sendProfile(session, connection);
}

void GameServer::sendSetUsernameResult(net::Connection& connection, bool ok,
                                       const std::string& username, const std::string& reason) {
    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::SetUsernameResult));
    w.boolean(ok);
    w.str(username);
    w.str(reason);
    connection.send(w);
}

void GameServer::handleSetUsername(Session& session, net::Connection& connection,
                                   ByteReader& reader) {
    const std::string requested = trimmed(reader.str());
    if (!reader.ok()) return;

    // WHOSE name this is comes from the session, as a password change's does.
    if (!session.authenticated() || session.userId.empty()) {
        sendSetUsernameResult(connection, false, "", "You are not signed in.");
        return;
    }
    // On the login budget: every refusal says whether a name is free, and a
    // free loop of these is a free walk of the user table.
    if (!spend(session.loginAttemptsAllowed)) {
        sendSetUsernameResult(connection, false, "", "Too many attempts. Wait a moment.");
        return;
    }
    // A guest names itself once, and only a guest: the flag is the server's,
    // set when it made the account and cleared by the rename below, so
    // neither a registered account nor a guest that already chose can ask
    // again, whatever its name looks like.
    const Account* account = std::as_const(database_).findUserById(session.userId);
    if (account == nullptr || !account->guest) {
        sendSetUsernameResult(connection, false, "",
                              "Only a guest account can set its username, and only once.");
        return;
    }

    const std::string oldName = account->username;
    std::string reason;
    if (!database_.renameUser(session.userId, requested, reason)) {
        sendSetUsernameResult(connection, false, "", reason);
        return;
    }
    const std::string newName = database_.findUserById(session.userId)->username;
    session.username = newName;
    std::printf("[ACCOUNT] guest %s is now %s\n", oldName.c_str(), newName.c_str());

    // The guild records name their members, and their leader, by account.
    const std::string oldKey = lowerCase(oldName);
    const std::string guildName = guildNameForUser(oldName);
    if (!guildName.empty()) {
        Json& guild = database_.rawTable("guilds")[guildName];
        if (isGuildLeader(guild, oldName)) {
            guild["leaderUsername"] = newName;
        }
        Json members = guild["memberUsernames"];
        Json renamed = Json::array();
        for (const Json& member : members.items()) {
            renamed.push(lowerCase(member.asString()) == oldKey ? Json(newName) : member);
        }
        guild["memberUsernames"] = std::move(renamed);
        database_.markDirty();
    }
    // An invitation is addressed to the name it was sent to.
    if (auto invite = guildInvites_.find(oldKey); invite != guildInvites_.end()) {
        guildInvites_[lowerCase(newName)] = invite->second;
        guildInvites_.erase(oldKey);
    }
    // The titan's memo of who holds what is a list of names; one of them may
    // be this one. Forgotten whole -- it is a cache, refilled on the next ask.
    universalHolders_.clear();
    // Soon, not at the next periodic persist: the old name is free from this
    // moment, and a crash that brought it back would hand the player a name
    // somebody else may have taken in the meantime.
    database_.maybeSave(monotonicMillis());

    sendSetUsernameResult(connection, true, newName, "");
    sendProfile(session, connection);
    if (const Squad* squad = squads_.forMember(squadIdOf(session))) broadcastSquadUpdate(*squad);
    if (!guildName.empty()) {
        broadcastGuildRoster(std::as_const(database_).storedTable("guilds")[guildName]);
    }
}

void GameServer::handleLogout(Session& session) {
    // An anonymous socket has no account to log out of.
    if (!session.authenticated()) return;
    const std::string userId = session.userId;

    // Every token the account holds, not only this connection's. A logout
    // that left the others alive would leave a copy on a shared machine, or
    // one somebody lifted, good for up to thirty more days -- and "log out"
    // is the button a player reaches for in exactly that situation.
    database_.revokeSessionsForUser(session.username);
    signOut(session);

    // The tokens were only half of it: a connection that already resumed one
    // is authenticated in memory, not by the token, and would play on as the
    // account until it dropped. Each is signed out here and told so with the
    // answer a dead token gets, which is the one its client already knows
    // means "back to the login form".
    for (auto& [id, other] : sessions_) {
        if (id == session.connection || !other.authenticated() || other.userId != userId) continue;
        signOut(other);
        if (net::Connection* connection = listener_.find(id)) {
            sendAuthResult(*connection, net::AuthStatus::SessionExpired, "", "",
                           "This account was logged out elsewhere.");
        }
    }

    // Same reason as a password change: a revocation still waiting for the
    // thirty-second persist is undone by a crash inside that window.
    database_.maybeSave(monotonicMillis());
}

void GameServer::replaceOtherSessions(const Session& incoming, const std::string& userId) {
    // Two live connections on one account are two bodies playing one record:
    // each carries its own XP and stars and the later save wins, and one
    // person farming with several flowers at once is the multiboxing this
    // rule exists to stop. The NEWER sign-in wins, rather than the first
    // being defended: the player at the new tab is the one at the keyboard,
    // and a crashed tab whose socket has not timed out yet must not lock its
    // own owner out.
    //
    // No exemption for loopback. The browser server spared a pair of local
    // tabs, but everything nginx proxies arrives from loopback too, and the
    // peer this transport records carries no forwarding header to tell the
    // two apart -- an exemption here would switch the rule off in production.
    for (auto& [id, other] : sessions_) {
        if (id == incoming.connection || !other.authenticated() || other.userId != userId) continue;
        net::Connection* connection = listener_.find(id);
        std::printf("[SESSION] %s signed in on connection %u; closing connection %u\n",
                    other.username.c_str(), static_cast<unsigned>(incoming.connection),
                    static_cast<unsigned>(id));

        // What a disconnect does, and while the session still has a name: the
        // squad is told who left, and the body is saved into the record BEFORE
        // the incoming connection reads it back, so it starts from where this
        // one stopped rather than from the last periodic save.
        departSquad(other, nullptr, squadDisplayName(squadIdOf(other)));
        // Anonymous from here on, so the close that follows has no account left
        // to persist into -- a late save from this side would overwrite
        // whatever the new session does in the meantime.
        signOut(other);

        if (connection) {
            ByteWriter w;
            w.u8(static_cast<std::uint8_t>(net::ServerMessage::SessionReplaced));
            w.str("You logged in from another tab or device.");
            connection->send(w);
            // Gracefully: the reason has to reach the client before the socket
            // goes, or all it sees is a drop -- which it would redial.
            connection->closeGracefully();
        }
    }
}

void GameServer::signOut(Session& session) {
    // The squad first, while the session still has the name the squad knows
    // it by: a squad is keyed by connection, and an anonymous socket left in
    // one would be handed to whoever signs in on it next, as a disconnect
    // never would. Callers that already departed (replaceOtherSessions, the
    // database editor's sign-out) make this a no-op.
    departSquad(session, listener_.find(session.connection),
                squadDisplayName(squadIdOf(session)));
    // A body in the world belongs to the account that is going away, so it
    // comes off first -- and with its progress saved, because a logout is a
    // deliberate exit, not a drop. Left alone it would be an orphan: a flower
    // nobody can steer and no account can persist. Taking it off is also what
    // ends any flower control this connection is part of, from either end:
    // control needs a body on both sides, and despawnPlayer lets go of it
    // through the back-references.
    dropBody(session);
    revokeTempAdmin(session.connection);
    session.token.clear();
    session.userId.clear();
    // Both of these gate later messages -- `admin` unlocks the console
    // commands, `username` is who the chat and the guild take this connection
    // for -- so an anonymous session must not keep either.
    session.username.clear();
    session.admin = false;
    session.adminTier = kTopAdminTier;
    session.adminArenaAdmitted = false;
    session.adminArenaHasReturn = false;
    session.adminArenaReturnChoice.clear();
    session.displayName.clear();
    // The client forgets the account with it, so the next Profile is whole.
    session.profileShadow = Session::ProfileShadow{};
    // Last: despawnPlayer() puts the stage back to Authenticated, and this is
    // what the socket actually is now.
    session.stage = SessionStage::Anonymous;
}

void GameServer::sendDailyStreak(Session& session, net::Connection& connection) {
    const DailyStreakResult streak = database_.processDailyStreak(session.userId);

    ByteWriter w;
    w.u8(static_cast<std::uint8_t>(net::ServerMessage::DailyStreak));
    w.u16(static_cast<std::uint16_t>(std::max(0, streak.streak)));
    w.boolean(streak.newDay);
    w.u16(static_cast<std::uint16_t>(std::max(0, streak.starsAwarded)));
    w.i64(streak.nextClaimAtMillis);
    w.i64(streak.streakExpiresAtMillis);
    connection.send(w);
}

} // namespace flix
