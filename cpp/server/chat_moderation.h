#pragma once
// Chat auto-moderation: the lines a player may not say to other players. One
// that fails is not sent at all, on any channel, and the speaker is told why
// (GameServer::screenChatLine). Two kinds:
//
//  * a line with a blocked word in it -- profanity, sexual vulgarity, slurs;
//  * spam: a line repeating what the speaker just said to the same place, a
//    line that is mostly one stretch over and over ("aaaaaaaa..."), and a
//    line that draws nothing. Flooding -- many lines, fast -- is the session's
//    rate limit, which every channel spends (session.cpp).
//
// Every check judges what a reader's client will DRAW, not the line's bytes.
// Chat is markup (shared/game/markup.h), so "fu<b></b>ck", "f&#117;ck" and
// "fu<x>junk</x>ck" (an unknown tag is dropped with its content) all draw a
// word their source does not spell. Lines are parsed with the client's own
// parser, and for words read both ways a client may read one: with and
// without <a>, which only the web build honours.
//
// On top of that, the word check reads through the ways people spell round a
// filter:
//
//  * case, accents and look-alike letters: "FüCK", Cyrillic "а", fullwidth
//    and "fancy text" letters (mathematical bold, circled, squared);
//  * digits and symbols for letters: "sh1t", "a$$", "b!tch";
//  * a letter held, three times or more: "fuuuck" is "fuck" -- but
//    "poorness" holds no "porn", and "as" is never "ass";
//  * punctuation and invisible characters inside a word: "f.u.c.k",
//    "fu-ck", a zero-width space;
//  * a word spelled out a letter at a time: "f u c k";
//  * whole backwards tokens and multi-glyph leet substitutions;
//  * explicit Chinese phrases, simplified/traditional, with hidden characters
//    and short separator runs removed. Ordinary Chinese remains allowed.
//
// Each listed word says how much of a word it must be, which is what keeps
// "class", "assassin", "Scunthorpe", "grape" and "therapist" out of it; the
// few real words that still contain a listed one ("snigger", "shiitake") are
// listed as allowed.
//
// Both lists are built in and editable in game: chat moderators and admins
// add, switch off and re-fit terms with `/mod terms` (server/chat_commands.cpp).
// What they change is kept as edits OVER the built-in lists -- the database's
// `chatTerms` table, ChatTermEdits below -- so a term a later build adds to the
// built-in list still reaches a server that edited others. The Chinese
// phrases are built in only.

#include <cstdint>
#include <string>
#include <vector>

namespace flix {

class Json;

/// How much of a word a listed term has to be.
enum class TermFit : std::uint8_t {
    /// Anywhere in a word: "fuck" in "motherfucking".
    Anywhere,
    /// The start of a word: "cunt" in "cunts", but not in "Scunthorpe".
    Start,
    /// The whole word, or its plural: "ass" and "asses", but not "class",
    /// "assassin" or "assess".
    Word,
};

/// "anywhere", "start" or "word": what the `chatTerms` table stores and what
/// `/mod terms block` takes.
const char* termFitName(TermFit fit);
/// "anywhere in a word", for a sentence.
const char* termFitLabel(TermFit fit);
/// The fit `name` says -- termFitName's words, or "inside" and "whole" -- or
/// false.
bool parseTermFit(const std::string& name, TermFit& out);

struct ChatTerm {
    std::string word;   ///< lower-case a-z
    TermFit fit = TermFit::Word;
};

/// The lists the word check reads.
struct ChatTerms {
    /// Profanity, sexual vulgarity, slurs.
    std::vector<ChatTerm> blocked;
    /// Real words a blocked one sits inside ("snigger"): a match that lies
    /// wholly within one of these is let through.
    std::vector<ChatTerm> allowed;

    /// The built-in lists, unedited.
    static const ChatTerms& builtIn();
};

/// What a server changed of the built-in lists: the `chatTerms` table.
///
/// Each edit says what it did in `said`, a sentence for whoever asked, and
/// returns whether it changed anything. `word` must already be a validTerm.
struct ChatTermEdits {
    /// Terms added, and built-in terms blocked with another fit than their own.
    std::vector<ChatTerm> blocked;
    /// Built-in blocked terms switched off.
    std::vector<std::string> unblocked;
    /// Allowed words added.
    std::vector<std::string> allowed;
    /// Built-in allowed words switched off.
    std::vector<std::string> unallowed;

    /// How many terms, and how many allowed words, a server may add: each one
    /// is read against every word of every line.
    static constexpr std::size_t kMaxAdded = 300;

    /// Whether `word` is something the lists can hold: 2 to 32 letters a-z.
    /// The reason is a sentence for whoever typed it.
    static bool validTerm(const std::string& word, std::string& reasonOut);

    /// Blocks `word` -- a new term, a built-in one switched back on, or either
    /// re-fitted. With no `fit`, a new term is a whole word and a known one
    /// keeps the fit it has.
    bool block(const std::string& word, const TermFit* fit, std::string& said);
    /// Stops blocking `word`: a term added here is dropped, a built-in one is
    /// switched off.
    bool unblock(const std::string& word, std::string& said);
    bool allow(const std::string& word, std::string& said);
    bool unallow(const std::string& word, std::string& said);

    bool empty() const {
        return blocked.empty() && unblocked.empty() && allowed.empty() && unallowed.empty();
    }

    /// The built-in lists with these edits made.
    ChatTerms applied() const;

    /// The table's shape: {"blocked": {word: fit name}, "unblocked": [word],
    /// "allowed": [word], "unallowed": [word]}. The read drops anything that
    /// is not a valid term, a fit, or -- for the switched-off lists -- a
    /// built-in word, so a hand edit of the table cannot break the filter.
    static ChatTermEdits fromJson(const Json& table);
    Json toJson() const;
};

/// The blocked word `line` -- one chat line's markup -- draws, as the list
/// spells it, or an empty string when it draws none. The word is for the
/// server's log; a speaker is never shown it. The server passes its own
/// lists (Database::chatTerms); the built-in ones are for tests.
std::string blockedWordIn(const std::string& line,
                          const ChatTerms& terms = ChatTerms::builtIn());

/// The same check for a name a player chose -- a username, a nameplate, a
/// skin's name -- as `blockedWordIn` says it. A name differs from a chat line
/// twice over. It is plain text wherever it is drawn, so "<x>fuck</x>" is not
/// a tag but what it says. And it has no spaces to end a word with, so the
/// words listed as whole ones are also read where its capitals and digits
/// start a new word ("BigAss", "xXDickXx", "dick4u") and after a lead-in like
/// "big" or "my" ("bigdick", "kissmyass"). Run together with anything else, a
/// whole word still passes ("pussylover"): that is the price of "Hitchcock".
std::string blockedWordInName(const std::string& name,
                              const ChatTerms& terms = ChatTerms::builtIn());

/// What a line draws, folded for "is this the same line again": lower-cased,
/// spaces, punctuation and invisible characters gone, pictures kept by
/// address. "Hi!!", "hi" and "<b>HI</b>" are one line; a line with nothing
/// left once folded (":)", "?") keeps its own drawn text, so two different
/// ones are not both the empty line.
std::string chatRepeatKey(const std::string& line);

/// Whether `line` is mostly one short stretch over and over: a run of one to
/// ten characters repeated at least four times that covers at least
/// kChatFloodSpan of them -- "aaaaaaaaaaaaaaaaaaaa", "spam spam spam spam
/// spam". Laughter and emphasis ("hahahaha", "nooooooo") stay under it.
inline constexpr int kChatFloodSpan = 20;
bool chatLineFloods(const std::string& line);

/// Whether `line` draws nothing at all -- only spaces and invisible
/// characters, or only markup a client drops, like "<x>hidden</x>" -- which
/// would reach everyone as an empty line under the speaker's name.
bool chatLineDrawsNothing(const std::string& line);

/// Whether `line` would start a row of its own anywhere -- a <br>, or a <pre>
/// opened mid-line -- as read by the same parser every client draws it with.
/// A row a player's line starts has no "[Global] name:" in front of it, so it
/// can be dressed as a System line or an admin's announcement.
bool chatLineBreaksRows(const std::string& line);

/// Whether `line` draws a control that makes a browser put its letters in
/// another order than they are stored in: U+202E turns "kcuf" into "fuck", and
/// U+202B, U+2067 and U+2068 do the same with a U+200F between the letters.
/// Every other check here reads stored order, so such a line is not judged but
/// refused. The native client ignores these controls; the web client does not.
bool chatLineReversesText(const std::string& line);

} // namespace flix
