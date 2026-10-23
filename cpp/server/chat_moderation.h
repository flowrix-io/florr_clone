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
//  * a word spelled out a letter at a time: "f u c k".
//
// Each listed word says how much of a word it must be, which is what keeps
// "class", "assassin", "Scunthorpe", "grape" and "therapist" out of it; the
// few real words that still contain a listed one ("snigger", "shiitake") are
// listed as allowed.

#include <string>

namespace flix {

/// The blocked word `line` -- one chat line's markup -- draws, as the list
/// spells it, or an empty string when it draws none. The word is for the
/// server's log; a speaker is never shown it.
std::string blockedWordIn(const std::string& line);

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

} // namespace flix
