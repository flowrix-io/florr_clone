#include "test.h"

#include "server/chat_moderation.h"

#include <string>

using flix::blockedWordIn;
using flix::chatLineBreaksRows;
using flix::chatLineDrawsNothing;
using flix::chatLineFloods;
using flix::chatLineReversesText;
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

TEST(a_line_that_would_start_a_row_of_its_own_breaks_rows) {
    // The forged System line: a break, then a row dressed as the server.
    CHECK(chatLineBreaksRows("hi<br><span style=\"color:#ffb74d\">[Admin] owner: wipe</span>"));
    CHECK(chatLineBreaksRows("hi<br/>there"));
    CHECK(chatLineBreaksRows("hi<BR >there"));
    CHECK(chatLineBreaksRows("<b>hi<br></b>"));
    // A <pre> opened mid-line starts its own row too.
    CHECK(chatLineBreaksRows("hi <pre>there</pre>"));
    // Inside a link, in a build that honours links and one that drops them.
    CHECK(chatLineBreaksRows("<a href=\"https://example.com\">x<br>y</a>"));
    // Ordinary dress, an escaped tag, and the word in prose are all one row.
    CHECK(!chatLineBreaksRows("<b>bold</b> and <span style=\"color:red\">red</span>"));
    CHECK(!chatLineBreaksRows("type &lt;br&gt; for a break"));
    CHECK(!chatLineBreaksRows("a br b"));
}

TEST(a_control_that_reorders_the_letters_is_found_however_it_is_written) {
    // The four a browser reverses Latin letters under: RLO, RLE, RLI, FSI.
    CHECK(chatLineReversesText("\xE2\x80\xAE" "kcuf"));
    CHECK(chatLineReversesText("\xE2\x80\xAB" "ck\xE2\x80\x8F" "fu"));
    CHECK(chatLineReversesText("\xE2\x81\xA7" "ck\xE2\x80\x8F" "fu\xE2\x81\xA9"));
    CHECK(chatLineReversesText("\xE2\x81\xA8\xE2\x80\x8F" "ck\xE2\x80\x8F" "fu\xE2\x81\xA9"));
    // Anywhere in the line, whatever it is dressed in, in every spelling.
    CHECK(chatLineReversesText("fu\xE2\x80\xAE" "kc"));
    CHECK(chatLineReversesText("<b>\xE2\x80\xAE" "kcuf</b>"));
    CHECK(chatLineReversesText("&#x202E;kcuf"));
    CHECK(chatLineReversesText("&#8238;kcuf"));
    // Drawn by a web client only, inside a link; by a native one only, after
    // what it reads as a dropped link.
    CHECK(chatLineReversesText("<a href=\"https://florr.io/\">\xE2\x80\xAE" "kcuf</a>"));
    CHECK(chatLineReversesText("<a><x></a>\xE2\x80\xAE" "kcuf</x>"));

    // Nothing drawn: a dropped tag's content, an attribute, an escaped reference.
    CHECK(!chatLineReversesText("<x>\xE2\x80\xAE</x>hi"));
    CHECK(!chatLineReversesText("<span title=\"&#x202E;\">hi</span>"));
    CHECK(!chatLineReversesText("&amp;#x202E;"));
    // These do not reorder Latin letters: typed Hebrew and Arabic, a bare
    // right-to-left mark, the left-to-right controls, and a stray terminator.
    CHECK(!chatLineReversesText("hello there"));
    CHECK(!chatLineReversesText("\xD7\xA9\xD7\x9C\xD7\x95\xD7\x9D"));
    CHECK(!chatLineReversesText("\xD8\xB3\xD9\x84\xD8\xA7\xD9\x85"));
    CHECK(!chatLineReversesText("ok\xE2\x80\x8F"));
    CHECK(!chatLineReversesText("\xE2\x80\xAA" "ok\xE2\x80\xAC"));
    CHECK(!chatLineReversesText("\xE2\x80\xAD" "ok"));
    CHECK(!chatLineReversesText("\xE2\x81\xA6" "ok\xE2\x81\xA9"));
}

TEST(chunked_filter_evasion_preserves_ordinary_word_boundaries) {
    for (const char* line : {"fu ck", "sh it", "bi tch", "kill your self", "hey fu ck you", "f uck"})
        CHECK(blocked(line));
    for (const char* line : {"push it", "this hit", "as soon as possible", "a classic", "rabbit chasing"})
        CHECK(!blocked(line));
}

TEST(unicode_dress_does_not_hide_a_repetitive_flood) {
    std::string line;
    for (int i = 0; i < 20; ++i) line += i % 3 == 0 ? "a" : i % 3 == 1 ? "á" : "а";
    CHECK(chatLineFloods(line));
}

TEST(additional_slurs_are_blocked_including_disguised_and_chunked_forms) {
    for (const char* line : {"niglet", "NIGLETS", "n1glet", "nig let", "nig.let",
                            "nignog", "nig nog", "zipperhead", "porch monkey",
                            "shemale", "mongoloid", "negroid"}) CHECK(blocked(line));
    for (const char* line : {"Nigeria", "Niger", "night light", "zipper", "monkey", "Mongolia"})
        CHECK(!blocked(line));
}

TEST(expanded_chat_filter_covers_sexual_language_slurs_and_harassment) {
    for(const char* line:{"semen","s3m3n","s e m e n","se.men","SPERM","masturbating",
        "orgasms","cumdumpster","deepthroat","niglet","n1g13t","niggah","faggit",
        "kill ur self","dickwad","shithead","hentai","penis","vaginas"})CHECK(blocked(line));
    for(const char* line:{"basement","semenov","semenova","semester","assessment","Nigel",
        "Nigeria","Niger","grapes","peninsula","classical music"}) {
        CHECK_EQ(blockedWordIn(line),std::string());
    }
}
TEST(chat_filter_ignores_hidden_unicode_and_recognizes_backwards_and_glyph_leet) {
    for(const char* line:{u8"s\u200Ce\u200Cm\u200Ce\u200Cn",u8"n\u034Fig\u2060let",
        u8"s\U000E0100emen","s&#x200c;emen","s<b>3</b>m3n","kcuf","tihs","n3m3s",
        u8"\u202Ekcuf",u8"\u2067kcuf\u2069","fu|<", "b!+ch","5h!+"}) {
        CHECK(blocked(line)||chatLineReversesText(line));
    }
    for(const char* line:{"desserts","parts","level","100% at 1.5x, +1, c++","I have 455 coins",
        "a scaffold","kernel","skeleton","hello 200c","drat","drats"})CHECK(!blocked(line));
}
TEST(chinese_chat_filter_handles_traditional_simplified_and_obfuscation) {
    for(const char* line:{u8"你是傻逼",u8"傻 比",u8"傻\u200C逼",u8"操你妈",u8"操你媽",
        "&#31934;&#28082;",u8"精液",u8"陰莖",u8"他<b>媽</b>的",u8"鸡.巴",u8"王八蛋",u8"婊子"})CHECK(blocked(line));
    for(const char* line:{u8"你好大家一起玩",u8"这是妈妈的花",u8"去操场玩",u8"干净的地图",
        u8"中文聊天没问题",u8"游戏角色和技能",u8"鸡蛋炒饭",u8"乌龟和小鸟",u8"我在学习中文"})CHECK(!blocked(line));
}

TEST(chat_filter_applies_obfuscation_rules_across_the_expanded_dictionary) {
    for(const char* raw:{"fuck","shit","bitch","niglet","nigger","faggot","semen","sperm",
        "orgasm","dildo","blowjob","hentai","masturbation","dickwad","shithead","cumslut","retard","kys"}) {
        const std::string word=raw;
        for(const char* separator:{u8"\u200C",u8"\u2060",u8"\uFEFF","."," "}) {
            std::string dressed;
            for(char c:word){if(!dressed.empty())dressed+=separator;dressed+=c;}
            CHECK(blocked(dressed));
        }
    }
}
