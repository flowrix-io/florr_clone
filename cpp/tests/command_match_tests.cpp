#include "test.h"

#include "client/ui/command_match.h"

#include <string>
#include <vector>

using namespace flix;

namespace {

const std::vector<std::string> kTable = {
    "/biome",
    "/boss-timers",
    "/admin give_xp",
    "/admin give",
    "/admin arena gui",
    "/admin arena",
    "/admin spawn",
    "/admin spawn_npc",
    "/admin killall",
    "/admin start_waves",
    "/admin stop_waves",
    "/admin list_codes",
    "/mod terms",
    "/mod terms block",
    "/mod terms unblock",
    "/w",
    "/whisper",
};

std::vector<std::string> offered(const std::string& typed) {
    std::vector<std::string> out;
    for (const std::size_t i : ui::rankCommandMatches(typed, kTable)) out.push_back(kTable[i]);
    return out;
}

} // namespace

TEST(a_whole_typed_command_is_offered_before_the_longer_ones_it_starts) {
    // Enter completes the top row: "/admin give" must stay itself, not turn
    // into "/admin give_xp" because that row came first in the table.
    CHECK_EQ(offered("/admin give").front(), std::string("/admin give"));
    CHECK_EQ(offered("/admin arena").front(), std::string("/admin arena"));
    CHECK_EQ(offered("/w").front(), std::string("/w"));
    CHECK_EQ(offered("/admin give").size(), std::size_t(2));
}

TEST(command_suggestions_ignore_case_and_doubled_spaces) {
    CHECK_EQ(offered("/ADMIN  Spawn").front(), std::string("/admin spawn"));
    CHECK_EQ(offered("/admin sp").size(), std::size_t(2));
}

TEST(a_word_inside_a_command_finds_it) {
    const std::vector<std::string> waves = offered("/admin waves");
    CHECK_EQ(waves.size(), std::size_t(2));
    CHECK_EQ(waves.front(), std::string("/admin start_waves"));
    CHECK_EQ(offered("/admin codes").front(), std::string("/admin list_codes"));
    // At the top level the "/admin ..." rows are not searched through their
    // second word: "/give" is not a top-level command.
    CHECK(offered("/give").empty());
}

TEST(a_misspelt_command_is_still_offered) {
    CHECK_EQ(offered("/admin spwan").front(), std::string("/admin spawn"));
    CHECK_EQ(offered("/admin kill_all").front(), std::string("/admin killall"));
    CHECK_EQ(offered("/bioem").front(), std::string("/biome"));
    CHECK_EQ(offered("/mod terms blokc").front(), std::string("/mod terms block"));
    // Nothing close: no list, and Enter sends the line as typed.
    CHECK(offered("/admin xyzzy").empty());
}

TEST(a_line_already_on_its_arguments_offers_nothing) {
    // Otherwise Enter would complete over what was typed instead of sending.
    CHECK(offered("/admin give bob rose ultra").empty());
    CHECK(offered("/admin spawn ladybug").empty());
    CHECK(offered("/w bob hi").empty());
    CHECK(offered("/admin give ").empty());
}
