#include "test.h"

#include <cstdio>
#include <functional>
#include <string>
#include <unistd.h>

#include "server/routine_log_policy.h"
#include "server_harness.h"

using namespace flix;
using namespace flix::testsupport;

namespace {

std::string capturedOutput(const std::function<void()>& action) {
    FILE* file = std::tmpfile();
    if (!file) { CHECK(false); return {}; }
    std::fflush(stdout);
    const int original = dup(fileno(stdout));
    if (original < 0) { std::fclose(file); CHECK(false); return {}; }
    if (dup2(fileno(file), fileno(stdout)) < 0) {
        close(original); std::fclose(file); CHECK(false); return {};
    }
    action();
    std::fflush(stdout);
    dup2(original, fileno(stdout));
    close(original);
    std::rewind(file);
    std::string result;
    char buffer[1024];
    while (const auto count = std::fread(buffer, 1, sizeof buffer, file)) {
        result.append(buffer, count);
    }
    std::fclose(file);
    return result;
}

} // namespace

TEST(routine_logging_policy_matches_only_the_configured_account) {
    CHECK(!shouldLogRoutineActivity("a19kisme"));
    CHECK(!shouldLogRoutineActivity("A19KIsMe"));
    CHECK(shouldLogRoutineActivity("a19kisme2"));
    CHECK(shouldLogRoutineActivity("other"));
    CHECK(shouldLogRoutineActivity(""));
}

TEST(routine_logging_exclusion_keeps_admin_and_database_audits) {
    Harness h("routine-logging-audits", [](const std::string& path) {
        seedUser(path, "a19kisme", "hunter2!", true);
    }, dataDir(), 0);
    CHECK(h.ready);
    if (!h.ready) return;
    NetClient admin;
    CHECK(loginAs(h, admin, "a19kisme", "hunter2!"));
    const auto output = capturedOutput([&] {
        CHECK(say(h, admin, "/admin give_xp 1"));
        CHECK(say(h, admin, "/admin db " + h.server.adminDbKey()));
        admin.adminDbOpen(net::AdminDbScope::Account, "a19kisme");
        CHECK(h.stepUntil({&admin}, [&] { return admin.adminDb().loaded; }));
        const auto before = admin.adminDb().resultSeq;
        admin.adminDbSet({"progress", "stars"}, "1");
        CHECK(h.stepUntil({&admin}, [&] { return admin.adminDb().resultSeq != before; }));
        CHECK(admin.adminDb().resultOk);
    });
    CHECK(output.find("[admin] a19kisme") != std::string::npos);
    CHECK(output.find("gave 1 XP to a19kisme") != std::string::npos);
    CHECK(output.find("[ADMIN-DB] a19kisme") != std::string::npos);
}
