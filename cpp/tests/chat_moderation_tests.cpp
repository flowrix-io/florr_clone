#include "test.h"

#include "server/chat_moderation.h"
#include "shared/core/json.h"

#include <string>
#include <vector>

using flix::blockedWordIn;
using flix::blockedWordInName;
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
        // Two real words that only spell a listed one with the space read through.
        "a red skin",
        "the pen is mine",
        "go ok",
        // Real names that only spell a listed one backwards.
        "Esra",
        "Nemes",
        "Huggin",
        "drat",
    };
    for (const char* line : kInnocent) CHECK_EQ(blockedWordIn(line), std::string());
}

TEST(a_real_name_is_let_through_backwards_only_in_plain_letters) {
    CHECK(blocked("3sra"));
    CHECK(blocked("n3m3s"));
    CHECK(blocked("Hugg1n"));
}

TEST(only_the_exact_innocent_pair_gets_past_the_read_across_spaces) {
    // The same letters cut anywhere else are spelled round the filter.
    CHECK(blocked("re dskin"));
    CHECK(blocked("pe nis"));
    CHECK(blocked("g ook"));
    CHECK(blocked("p e n i s"));
    // And a pair is not a licence for the word itself.
    CHECK(blocked("redskin"));
    CHECK(blocked("penis"));
    CHECK(blocked("gook"));
}

TEST(a_name_is_read_for_words_run_together) {
    const char* const kRefused[] = {
        // Everything a chat line is refused for.
        "fuck", "Fuck123", "shit_lord", "a55hole", "f_u_c_k", "Kcuf", "Big Ass", "fu ck",
        // Capitals and digits showing where a word starts.
        "BigAss", "MyDick", "xXDickXx", "KissMyAss", "PussyLover", "BIGAss", "dick4u", "Dick4U",
        "Bob2ass",
        // No capitals to go by: a lead-in and the word, and nothing else.
        "bigass", "BIGASS", "mydick", "bigdick", "kissmyass", "suckmydick", "hotwetpussy",
        "b1gd1ck", "bigdiiick", "69bigdick", "bigdick69",
    };
    for (const char* name : kRefused) CHECK(!blockedWordInName(name).empty());
}

TEST(a_name_is_plain_text_so_markup_hides_nothing_in_it) {
    // A client would drop this tag and its content from a chat line, and a
    // nameplate draws every letter of it.
    CHECK(!blocked("<x>fuck</x>"));
    CHECK_EQ(blockedWordInName("<x>fuck</x>"), std::string("fuck"));
    // And it draws these literally, so they are not the word they would decode to.
    CHECK(blockedWordInName("f&#117;ck").empty());
}

TEST(a_name_with_a_real_word_in_it_is_not_refused) {
    const char* const kInnocent[] = {
        "Rose", "Petalwise", "Player_1", "a19kisme", "Unnamed", "x_Rose_x",
        "Cassandra", "Hitchcock", "Hancock", "Dickens", "Riddick", "Peacock", "Assassin", "Titan",
        "Basement", "Scunthorpe", "Shitake", "Therapist",
        // A capital or a lead-in in front of a word that merely ends the same.
        "ClassAct", "TheGrass", "BigBass", "MyClass", "HotDog", "Amyass",
        // A digit for a letter, which must not leave "ass" standing alone.
        "Gl4ss", "M4ss", "P4ss", "Cl4ss", "Mass5", "Player455",
        // What a skin is most likely to be called.
        "Red Skin", "Blue Skin", "Glass Skin", "Sun Flower", "Night Sky", "Bass Guy",
        // The names the server gives a guest, the digits of which spell things.
        "User12345678", "User45500000", "User80085000",
    };
    for (const char* name : kInnocent) CHECK_EQ(blockedWordInName(name), std::string());
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

// -- the lists as a server edits them (/mod terms) ----------------------------

namespace {

using flix::ChatTermEdits;
using flix::ChatTerms;
using flix::TermFit;

bool blockedBy(const ChatTermEdits& edits, const std::string& line) {
    return !blockedWordIn(line, edits.applied()).empty();
}

} // namespace

TEST(a_term_added_here_blocks_what_its_fit_says_with_every_spelling_rule) {
    ChatTermEdits edits;
    std::string said;
    CHECK(edits.block("noob", nullptr, said));
    // A new term is a whole word, or its plural, read through the same
    // spellings the built-in ones are.
    for (const char* line : {"you noob", "NOOBS", "n00b", "n o o b", "n.o.o.b"}) {
        CHECK(blockedBy(edits, line));
    }
    CHECK(!blockedBy(edits, "noobish"));
    CHECK(!blocked("you noob"));   // the built-in lists are untouched

    const TermFit anywhere = TermFit::Anywhere;
    CHECK(edits.block("noob", &anywhere, said));
    CHECK(blockedBy(edits, "noobish"));
    CHECK(!edits.block("noob", nullptr, said));   // already there, at its fit
    CHECK(said.find("already") != std::string::npos);

    CHECK(edits.unblock("noob", said));
    CHECK(!blockedBy(edits, "you noob"));
    CHECK(!edits.unblock("noob", said));
    CHECK(edits.empty());
}

TEST(a_built_in_term_is_switched_off_refitted_and_back_on) {
    ChatTermEdits edits;
    std::string said;
    CHECK(edits.unblock("ass", said));
    CHECK(!blockedBy(edits, "kick ass"));
    CHECK(blockedBy(edits, "fuck"));   // only that one
    CHECK_EQ(edits.unblocked.size(), std::size_t{1});

    // Blocked again with no fit named, it is its built-in self.
    CHECK(edits.block("ass", nullptr, said));
    CHECK(edits.empty());
    CHECK(blockedBy(edits, "kick ass"));
    CHECK(!blockedBy(edits, "class"));

    // Re-fitted, it is an edit; back at its own fit, no edit at all.
    const TermFit start = TermFit::Start;
    CHECK(edits.block("ass", &start, said));
    CHECK(blockedBy(edits, "assessment"));
    const TermFit word = TermFit::Word;
    CHECK(edits.block("ass", &word, said));
    CHECK(edits.empty());
}

TEST(an_allowed_word_lets_the_blocked_term_inside_it_through) {
    ChatTermEdits edits;
    std::string said;
    const TermFit anywhere = TermFit::Anywhere;
    CHECK(edits.block("hell", &anywhere, said));
    CHECK(blockedBy(edits, "hello there"));
    CHECK(edits.allow("hello", said));
    CHECK(!blockedBy(edits, "hello there"));
    CHECK(blockedBy(edits, "what the hell"));

    // A blocked term is not allowed whole: unblock is how it stops blocking.
    CHECK(!edits.allow("hell", said));
    CHECK(!edits.allow("fuck", said));
    CHECK(edits.unallow("hello", said));
    CHECK(blockedBy(edits, "hello there"));

    // A built-in allowed word switched off: what it held is blocked.
    CHECK(!blocked("he sniggered"));
    CHECK(edits.unallow("snigger", said));
    CHECK(blockedBy(edits, "he sniggered"));
    CHECK(edits.allow("snigger", said));
    CHECK(!blockedBy(edits, "he sniggered"));
}

TEST(a_term_is_plain_letters) {
    std::string reason;
    CHECK(ChatTermEdits::validTerm("noob", reason));
    CHECK(ChatTermEdits::validTerm("ab", reason));
    for (const char* word : {"", "a", "sh1t", "two words", "NOOB", "caf\xC3\xA9", "a$$",
                             "abcdefghijklmnopqrstuvwxyzabcdefg"}) {
        CHECK(!ChatTermEdits::validTerm(word, reason));
    }
    CHECK(!reason.empty());
}

TEST(a_name_is_held_to_the_edited_lists_too) {
    ChatTermEdits edits;
    std::string said;
    CHECK(edits.block("noob", nullptr, said));
    const ChatTerms terms = edits.applied();
    CHECK(!blockedWordInName("BigNoob", terms).empty());
    CHECK(!blockedWordInName("xXNoobXx", terms).empty());
    CHECK(blockedWordInName("BigNoob").empty());
    CHECK(edits.unblock("dick", said));
    CHECK(blockedWordInName("BigDick", edits.applied()).empty());
    CHECK(!blockedWordInName("BigDick").empty());
}

TEST(the_stored_edits_read_back_and_a_bad_hand_edit_is_dropped) {
    ChatTermEdits edits;
    std::string said;
    const TermFit start = TermFit::Start;
    CHECK(edits.block("noob", &start, said));
    CHECK(edits.unblock("ass", said));
    CHECK(edits.allow("grasshopper", said));
    CHECK(edits.unallow("shitzu", said));
    const ChatTermEdits read = ChatTermEdits::fromJson(edits.toJson());
    CHECK_EQ(read.toJson().dump(), edits.toJson().dump());

    flix::Json table;
    std::string error;
    CHECK(flix::Json::parse(R"({"blocked": {"two words": "word", "noob": "bogus", "good": "start",
                                          "ass": "word", "fuck": "start"},
                                "unblocked": ["notbuiltin", "ass", 7],
                                "allowed": ["fuck", "grassy", "grassy"],
                                "unallowed": ["grassy", "snigger"]})",
                            table, error));
    const ChatTermEdits cleaned = ChatTermEdits::fromJson(table);
    // "ass" at its own fit is no edit; "fuck" re-fitted is one.
    CHECK_EQ(cleaned.blocked.size(), std::size_t{2});
    CHECK_EQ(cleaned.blocked[0].word, std::string("good"));
    CHECK_EQ(cleaned.blocked[1].word, std::string("fuck"));
    CHECK(cleaned.unblocked == std::vector<std::string>{"ass"});
    CHECK(cleaned.allowed == std::vector<std::string>{"grassy"});
    CHECK(cleaned.unallowed == std::vector<std::string>{"snigger"});
    CHECK(ChatTermEdits::fromJson(flix::Json()).empty());
}
