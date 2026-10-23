#include "test.h"

#include "server/chat_moderation.h"

#include <string>

using flix::blockedWordIn;
using flix::chatLineDrawsNothing;
using flix::chatLineFloods;
using flix::chatRepeatKey;

// Chat moderation judges a line on what a reader will see, so most of these
// are a word spelled some way the raw bytes do not show, and the rest are
// real words -- and real conversation -- a careless check would have refused.

namespace {

bool blocked(const std::string& line) { return !blockedWordIn(line).empty(); }

} // namespace

TEST(a_listed_word_is_found_wherever_it_sits_in_the_line) {
    CHECK_EQ(blockedWordIn("what the fuck is that"), std::string("fuck"));
    CHECK_EQ(blockedWordIn("FUCK"), std::string("fuck"));
    CHECK_EQ(blockedWordIn("you ass!"), std::string("ass"));
    CHECK_EQ(blockedWordIn("bullshit"), std::string("shit"));
    CHECK(blocked("motherfucker"));
    CHECK(blocked("cunts"));
    CHECK(!blocked("hello there"));
}

TEST(the_ways_people_spell_round_a_filter_are_read_through) {
    // Stand-ins, a held letter, punctuation, spaces, an invisible character.
    CHECK(blocked("sh1t"));
    CHECK(blocked("a$$"));
    CHECK(blocked("b!tch"));
    CHECK(blocked("fuuuuck"));
    CHECK(blocked("asss"));
    CHECK(blocked("f.u.c.k"));
    CHECK(blocked("fu-ck"));
    CHECK(blocked("f u c k"));
    CHECK(blocked("fu\xE2\x80\x8B" "ck"));                              // U+200B
    CHECK(blocked("fvck"));
    // Accents, a Cyrillic look-alike, fullwidth and mathematical letters, a
    // combining strike-through drawn over each letter.
    CHECK(blocked("F\xC3\xBC" "CK"));                                   // ü
    CHECK(blocked("f\xD1\x86" "ck"));                                   // ц
    CHECK(blocked("\xEF\xBD\x86\xEF\xBD\x95\xEF\xBD\x83\xEF\xBD\x8B"));
    CHECK(blocked("\xF0\x9D\x90\x9F\xF0\x9D\x90\xAE\xF0\x9D\x90\x9C\xF0\x9D\x90\xA4"));
    CHECK(blocked("s\xCC\xB6h\xCC\xB6i\xCC\xB6t\xCC\xB6"));
}

TEST(a_word_hidden_in_markup_is_found) {
    // Each draws "fuck".
    CHECK(blocked("fu<b></b>ck"));
    CHECK(blocked("f&#117;ck"));
    CHECK(blocked("fu<x>junk</x>ck"));
    CHECK(blocked("<b style=\"color: red\">fuck</b> off"));
    // A web client draws the link's text and a native one drops it, so this
    // is "fuzzck" to one and "fuck" to the other.
    CHECK(blocked("fu<a href=\"https://florr.io/\">zz</a>ck"));
    CHECK(blocked("look <img src=\"https://i.imgur.com/a.png\">shit"));
    // Words in a tag's attributes are not drawn.
    CHECK(!blocked("<span style=\"color: red\" title=\"shit\">hi</span>"));
}

TEST(real_words_that_contain_a_listed_one_are_not_blocked) {
    const char* const kInnocent[] = {
        "I passed the class and the assessment",
        "Scunthorpe United",
        "the assassin hit me with a bass",
        "grapes, a drape and a therapist",
        "a cocktail in the cockpit with a peacock",
        "shiitake mushrooms",
        "I read Dickens",
        "raccoon cocoon tycoon",
        "Pakistan is spicy",
        "the titan's title",
        "a snigger from Niger",
        "saltwater",
        "cumulative circumstance document",
        "poorness rapping Shiite",
        "push it, this hit, mis-hit, rabbit-chasing",
        "Essex Sussex Middlesex",
        "Fukushima",
        "flame retardant",
        "hell damn crap",
        "I asked as a joke",
        // A number is not a word spelled in stand-ins, though 455 reads
        // "ass" letter for letter.
        "I have 455 coins",
        "100% at 1.5x, +1, c++",
    };
    for (const char* line : kInnocent) CHECK_EQ(blockedWordIn(line), std::string());
}

TEST(a_repeat_is_the_same_drawn_line_whatever_its_dress) {
    CHECK_EQ(chatRepeatKey("Hi!!"), chatRepeatKey("hi"));
    CHECK_EQ(chatRepeatKey("<b>HI</b>"), chatRepeatKey("hi"));
    CHECK_EQ(chatRepeatKey("h i ."), chatRepeatKey("hi"));
    CHECK_EQ(chatRepeatKey("H\xC3\xAF"), chatRepeatKey("hi"));       // ï
    CHECK_EQ(chatRepeatKey("h\xE2\x80\x8Bi"), chatRepeatKey("hi"));  // U+200B
    CHECK(chatRepeatKey("hi") != chatRepeatKey("hello"));
    CHECK(chatRepeatKey("gg") != chatRepeatKey("99"));
    // Nothing left once folded: each keeps its own text, so two different
    // smileys are two different lines.
    CHECK(chatRepeatKey(":)") != chatRepeatKey("?"));
    CHECK_EQ(chatRepeatKey(":)"), chatRepeatKey(" :) "));
    // Pictures by address.
    CHECK(chatRepeatKey("<img src=\"https://i.imgur.com/a.png\">") !=
          chatRepeatKey("<img src=\"https://i.imgur.com/b.png\">"));
}

TEST(a_line_that_is_mostly_one_stretch_over_and_over_floods) {
    CHECK(chatLineFloods(std::string(20, 'a')));
    CHECK(chatLineFloods("AaAaAaAaAaAaAaAaAaAa"));
    CHECK(chatLineFloods("spam spam spam spam spam"));
    CHECK(chatLineFloods("look at this " + std::string(30, '!')));
    CHECK(chatLineFloods("lolololololololololol"));
    // Zero-width spaces between the letters do not break the run.
    std::string spaced;
    for (int i = 0; i < 20; ++i) spaced += "a\xE2\x80\x8B";
    CHECK(chatLineFloods(spaced));

    // Ordinary emphasis and laughter, and a short repeated word.
    CHECK(!chatLineFloods(std::string(19, 'a')));
    CHECK(!chatLineFloods("nooooooooo way"));
    CHECK(!chatLineFloods("hahahaha"));
    CHECK(!chatLineFloods("no no no no"));
    CHECK(!chatLineFloods("the quick brown fox jumps over the lazy dog"));
    CHECK(!chatLineFloods("1000000 xp"));
    CHECK(!chatLineFloods("left" + std::string(30, ' ') + "right"));
}

TEST(a_line_of_nothing_but_dropped_markup_draws_nothing) {
    CHECK(chatLineDrawsNothing("<x>hidden</x>"));
    CHECK(chatLineDrawsNothing("<b></b> <i></i>"));
    CHECK(chatLineDrawsNothing("\xE2\x80\x8B\xE2\x80\x8B"));   // zero-width spaces
    CHECK(chatLineDrawsNothing("<!-- only a comment -->"));
    CHECK(!chatLineDrawsNothing("hi"));
    CHECK(!chatLineDrawsNothing(":)"));
    CHECK(!chatLineDrawsNothing("<img src=\"https://i.imgur.com/a.png\">"));
}
