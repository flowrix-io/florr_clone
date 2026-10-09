# Admin dashboard

A panel for the server's admins: the flowers in the world and what each
account owns, steering another player's flower, spawning mobs, giving petals,
and announcements. It is the admin console (`/admin ...`) behind a form; the
server checks every request again and nothing is trusted from the panel being
open.

## Who can use it

Admin rights come only from server-held state, never from a name: no account,
username or nameplate is special.

- A **full admin** is an account whose database record says `"admin": true`.
- A **temporary admin** holds a one-life grant from a full admin
  (`/admin grant_admin <username>`). It ends when they respawn, leave the world,
  disconnect, have it revoked (`/admin revoke_admin`), or sign in again on the
  same connection, as anyone: a sign-in from inside the world takes the flower
  out first, as leaving does.

Both see the dashboard and may use all of it except announcements:

| | full admin | temporary admin |
|---|---|---|
| player list and bags | yes | yes |
| control a player's flower | yes | yes, except a full admin's |
| spawn, give | yes | yes |
| announce | yes | no |

### Becoming an admin on a local server

Stop the server (Ctrl-C, `pm2 stop` or a SIGTERM; it saves everything on the
way out), open its database file (`inventory.json` in its working directory by
default, or whatever `--db` names; `npm start` uses `dist/inventory.json`),
find the account under `"users"` and add `"admin": true` to it, then start the
server again. The server keeps the database in memory and writes it back on its
own, so an edit made while it runs is overwritten.

The single-file offline page has a **Grant Admin** button in Settings >
Advanced that makes the account its own client is signed into a full admin,
since that server runs in the player's own browser tab. It hands the server
that client's session token, never a name. The page's database editor key is
fixed, so its confirmation says it, as do `/admin db`'s usage line and its
wrong-key refusal there; every other server's key is derived from its machine
and appears only in its log.

## Opening it

- The crown button in the top icon strip, which only an admin is shown.
- `/admin gui`.
- `--menu admin` on the native client, for a scripted screenshot.

It closes the way every other panel does: its close button, opening another
panel (Escape opens Settings in its place), leaving to the title screen, or
logging out. It also closes itself the moment the server stops calling the
account an admin, and after a successful Control, so the world is in front of
you.

## Tabs

- **Players**: the flowers in the world, searched by account name or nameplate
  (case does not matter), in account-name order, `@username` first. Picking one
  shows its **bag**: the account's own record, which is what Give adds to, even
  while that player is in the PVP ring playing on the ring's kit. **Control**,
  **Release** and **Refresh** sit above the bag.
- **Spawn**: a mob, a rarity up to the top of the ladder, and an amount; sent as
  `/admin spawn <mob> <rarity> <amount>`, at your own flower.
- **Give**: a petal, any rarity up to universal, and an amount, to the player
  picked on the Players tab; sent as `/admin give <username> <petal> <rarity>
  <amount>`.
- **Announce**: the text of an announcement; sent as `/admin announce <text>`.

Spawn, Give and Announce go out as console commands, so the server's answer
lands in chat, where the console's answers always do. Control and Release are
answered on the panel's own status line.

Every request the panel makes — a page of players, a page of a bag, Control,
Release — is billed to the same budget as a console command (twelve deep,
refilling at two a second), so the panel is never the way round it: past it a
request is refused with the console's own "You are sending commands too
quickly." in chat and on the status line, and a page refused that way reads
"Not loaded" until Refresh asks again.

A picked player is named to the server by their connection and by the account
name the row showed. A connection is not a person: the next account to sign in
on the same socket takes over its id, and a restarted server deals ids out
again from 1. So if the connection now holds another account, the bag answers
"That player has left." and Control is refused with the same words, and the
panel lets go of its pick, and asks for the list again, whenever its own
connection drops or another account signs in on it.

Both lists come a page at a time (`kAdminDashboardPageSize`, 50 rows) with a
**Load more** row. A wire string is capped at 64 KiB and a message at 1 MiB, and
a list of every flower on a busy server, or every stack in a large bag, could
pass either.

## Controlling a flower

Control makes your movement, aim and attacks steer another player's flower; the
camera moves onto it. Its own player's input is ignored until it ends, whichever
splitter half they are in, and they are told when it starts and ends.

You may control another player's flower when you are both in the world, alive
and in the same realm. Each of these is refused with its own message: your own
flower (either half of a split one), a flower someone is already steering, a
flower whose player is steering another, anything while your own flower is being
steered, anything while you are already controlling someone (release first), a
full admin's flower when you hold only a temporary grant, and a bot.

Control ends, and your view goes back to your own flower, when either flower
dies, either player leaves the world or disconnects, the two of you end up in
different realms (a teleporter), your temporary grant ends, or either connection
signs in again, which takes its flower out of the world first. If the steered
player switches splitter halves, or the half being steered dies while the other
stands, control moves to the half they are in now.

While you control a flower:

- The corner plate (name, health, level) shows the flower you are steering.
- Your loadout bar is hidden, and its keys and clicks do nothing: it would show
  your loadout with the steered flower's reloads.
- The shop and the talent card read your own account, not the steered flower.
- The craft panel is the forge, wherever the steered flower stands: the oracle,
  the trader and the titan serve whoever is standing at them, which for your
  account is your own parked flower, so their cards are not offered.
- Your own flower stays where you left it, still in the world and still able to
  be hurt. If it dies, control ends.
- Spawn spawns at your own flower, and Local chat you say comes from it. Local
  chat you hear is what is said around the flower you are watching.
- A **Release @username** chip sits under the top icon strip.

## Announcements

Full admins only. An announcement is at most `net::kMaxAnnouncementBytes` (120)
bytes, is billed to the sender's chat budget like anything said to other
players, and is signed with the sender's account name. Every signed-in player,
in the world or on the title screen, gets an eight-second banner at the top of
the screen (under any boss bars), crediting the author, and the line in their
chat box's **Admin** tab.

The Admin tab only filters the transcript: nothing typed in the chat box is
sent to it. Announcing is done from the dashboard or with `/admin announce`.

## Console commands

| command | |
|---|---|
| `/admin gui` | open or close the dashboard |
| `/admin control <username>` | steer that player's flower |
| `/admin release` | give it back; says so when there is nothing to release |
| `/admin announce <message>` | a banner for everyone (full admins only) |

A `<username>` is an account name, or a bot's name; there is no lookup by id.

## Protocol

The dashboard talks over `ClientMessage::AdminDashboard` and
`ServerMessage::AdminDashboard`, each opening with a sub-code; the layouts are
in `cpp/shared/net/admin_dashboard.h`. The Inventory and Control requests carry
the row's connection and its account name, and a request refused for coming too
fast is answered with a `Refused` reply naming the op, so the panel stops
waiting for it. As for every message, a change to any of them bumps
`kProtocolVersion` in `cpp/shared/net/protocol.h`, and the client and server
ship together.
