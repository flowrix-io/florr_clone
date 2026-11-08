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
  (`/admin grant_admin <username> [tier]`). It ends when they respawn, leave the
  world, disconnect, have it revoked (`/admin revoke_admin`), or sign in again
  on the same connection, as anyone: a sign-in from inside the world takes the
  flower out first, as leaving does.

Both see the dashboard and may use all of it except announcements, as far as
their tier allows:

| | full admin | temporary admin |
|---|---|---|
| player list and bags | yes | yes |
| control a player's flower | yes | yes, except a full admin's |
| spawn, give | by tier | by tier |
| announce | yes | no |

### Tiers

Every admin has a tier from 1 to 4, or is the server owner. Tier 1 can do
everything; each tier below it loses one more power and keeps the losses of the
tiers above it. The server owner ranks above tier 1:

| tier | update the server | give petals | spawn mobs |
|---|---|---|---|
| owner | yes | yes | yes |
| 1 | yes | yes | yes |
| 2 | no | yes | yes |
| 3 | no | to themselves | yes |
| 4 | no | to themselves | no |

- **Update** is `/admin update`, every form of it, `status` included.
- **Give** is `/admin give` and the database editor (`/admin db`), which can
  write any player's bag. Tiers 3 and 4 may still `/admin give` to their own
  account (by account, not by name), but not open the editor; a temporary
  grant at tier 3 or 4 gives nothing, or a tier 3 admin could hand petals to
  anyone by lending the console.
- **Spawn** is `/admin spawn` and `/admin spawn_npc`.

A refused command says which tiers may run it, for example "Tier 3 admins
cannot give petals (tiers 1-2 only)." The dashboard's Spawn and Give tabs stay
on screen for every tier; the server refuses, and the refusal lands in chat.
`/help` says which tier you are.

The **server owner** has tier 1's powers and is the one rank above tier 1, so
it can ban, unban, demote and promote tier 1 admins as every tier does the
tiers below it. Nobody can ban or demote the owner. Owner is not a tier you can
hand out in game: the owner promotes to tier 1 at most, a grant from the owner
is tier 1 unless it names a lower one, and the database editor refuses the
field. More than one account can be owner; owners
cannot act on each other.

A full admin's tier is the account's `adminTier` in the database, beside
`"admin": true`: `"adminTier": 3`. Without it the account is tier 1, which is
every admin from before tiers. A value that is not a whole number from 1 to 4
reads as tier 4. The database editor refuses to change it, as it refuses the
admin flag; in game, only promotion and demotion move it.

The owner is its own field, `"owner": true`, beside `"admin": true`, and it
beats any `adminTier` on the same account. Only a JSON `true` counts. The owner
is never `"adminTier": 0`, which reads as tier 4 like any other bad tier, so a
typo never makes an owner. Take `"owner"` out and the account is tier 1.

### Promoting and demoting an admin

A full admin can move an admin of a **lower** tier:

- `/admin promote_admin <username> [tier]` raises them, up to the promoter's
  own tier and no further; one tier up without a tier.
- `/admin demote_admin <username> [tier]` lowers them, down to tier 4; one
  tier down without a tier.

So a tier 2 admin can raise a tier 4 admin to tier 3 or 2 (not 1), lower a
tier 3 admin to tier 4, and cannot move another tier 2 admin, a tier 1 admin,
or themselves. Only the owner demotes a tier 1 admin. Like a ban, both work by account
name, online or offline, and an online admin's new powers apply at once: a
demotion past tier 2 locks the database editor again, and a later promotion
asks for its key again.

Both move an admin; neither makes or unmakes one. The target must already be a
full admin (`"admin": true`, set on the server's machine); a temporary grant's
tier is chosen with `grant_admin`. A banned admin is unbanned before a
promotion, so a ban stays in reach of the admin who made it; a demotion does
not wait for it.

A temporary grant's tier is the grantor's own unless they name one, and they
may name only their own tier or a lower one (a larger number): a tier 2 admin
can lend tier 2, 3 or 4. `/admin list_admins` shows each grant's tier.

### Banning an admin

A full admin can bar an admin of a **lower** tier from every admin power with
`/admin ban_admin <username>`, and give them back with `/admin unban_admin
<username>`. Never their own tier or a higher one: the owner bans tiers 1-4,
tier 1 bans tiers 2-4, tier 2 bans 3-4, tier 3 bans 4, tier 4 bans nobody, and
nobody bans the owner.
A temporary admin cannot ban, and is not banned: `revoke_admin` takes a grant
back.

The ban is on the account, by account name, online or offline, and lasts
until a higher tier lifts it. The account keeps its admin flag and tier, but no
session of it holds any admin power: the console answers "You are banned from
using admin permissions.", the dashboard and database editor close, a flower it
was steering goes back, it can be muted like anyone else, and no one can lend
it a temporary grant. `/admin list_admins` lists banned admins, their tier and
who banned them. The database editor cannot change a ban (`adminBanned`,
`adminBannedBy`, `adminBannedAt` in the account's record).

### Admin passwords

No admin's password can be changed from inside the game, at any tier, banned
or not: not by its owner in Settings, not by another admin in the database
editor. The refusal is the database's own (`Database::setPassword`), under
every handler, so no other code path can reach an admin's password either. To
change one, stop the server, remove `"admin": true` from the account, start
it, change the password, then put the flag back the same way.

### Becoming an admin on a local server

Stop the server (Ctrl-C, `pm2 stop` or a SIGTERM; it saves everything on the
way out), open its database file (`inventory.json` in its working directory by
default, or whatever `--db` names; `npm start` uses `dist/inventory.json`),
find the account under `"users"` and add `"admin": true` to it (and
`"adminTier": N` for any tier but 1, or `"owner": true` for the server
owner), then start the server again. The server keeps the database in memory and writes it back on its
own, so an edit made while it runs is overwritten.

The single-file offline page has a **Grant Admin** button in Settings >
Advanced that makes the account its own client is signed into a tier 1 full
admin (an owner stays the owner), since that server runs in the player's own browser tab. It hands the server
that client's session token, never a name. The page's database editor key is
fixed, so its confirmation says it, as do `/admin db`'s usage line and its
wrong-key refusal there. Every other server keeps its key in
`admin_db_key.txt` beside the database, which is changed only by editing that
file on the server ([README.md](../../README.md#the-database-editor-key)).

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
  `/admin spawn <mob> <rarity> <amount>`, at your own flower. Tiers 1-3.
- **Give**: a petal, any rarity up to universal, and an amount, to the player
  picked on the Players tab; sent as `/admin give <username> <petal> <rarity>
  <amount>`. Tiers 1-2; tiers 3-4 to themselves only.
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
| `/admin grant_admin <username> [tier]` | lend the console for one life, at your tier or below (full admins only) |
| `/admin revoke_admin <username>` | take a temporary grant back |
| `/admin list_admins` | the temporary grants, with their tiers, and banned admins |
| `/admin ban_admin <username>` | bar a lower-tier admin from every admin power (full admins only) |
| `/admin unban_admin <username>` | lift it (full admins only, from a higher tier) |
| `/admin promote_admin <username> [tier]` | raise a lower-tier admin, up to your own tier; one tier up by default (full admins only) |
| `/admin demote_admin <username> [tier]` | lower a lower-tier admin, down to tier 4; one tier down by default (full admins only) |

A `<username>` is an account name, or a bot's name; there is no lookup by id.

## Searching the database editor

The database editor (`/admin db <key>`, full admins at tiers 1-2) is a
separate panel, but its account
search does more than names. Words are separated by spaces and an account must
answer every one (the grammar lives in `cpp/server/account_search.h`):

| search | finds accounts |
|---|---|
| `bob` | whose name contains "bob", in any case |
| `level>=50` | at level 50 or more; `>`, `>=`, `<`, `<=`, `=` all work |
| `stars>=1000`, `xp>=1e6`, `streak>=7` | by stars, total XP, or daily login streak |
| `created>=2026-10-01` | made on or after 1 October (UTC) |
| `active<2026-09` | last signed in before September |
| `created=2026-10-01T18:30` | made in that minute; a date is the whole month, day or minute it names |
| `active<7d` | signed in less than 7 days ago; `m`, `h`, `d` and `w` all work |
| `created>30d` | made more than 30 days ago |
| `is:guest`, `not:muted` | by a flag: `admin`, `muted` or `guest` |
| `petals>=5000` | owning 5,000 petals or more in all |
| `mythic>=100` | owning 100 or more mythic petals |
| `rose>10` | owning more than 10 roses, any rarity |
| `mythic:rose>10` | the same at one rarity (`rose:mythic` too) |
| `mythic:rose` | owning at least one mythic rose |
| `loadout:rose` | wearing a rose; `loadout:mythic:rose`, `loadout:rose>=3`, `loadout:mythic` |

Petals are named by id or display name, with case, spaces, underscores and
hyphens ignored (`yin_yang`, `yinyang`); rarities by name or label (`eternal`
is unique). Results are ordered by the first word's value, most first (fewest
first when it is a `<`), and each row shows what it was found by: a count, a
date, or how long ago. Counts come from the stored inventory (which includes
worn petals) and the saved loadout. A word the server cannot read lists nobody
and says why above the list.

`created` and `active` take either a date or a time ago, and each reads as it
is said: `active>=2026-10-20` is on or after the 20th, and `active<7d` is less
than 7 days ago. Two words make a range: `created>=2026-10-01
created<2026-10-08`. Accounts older than the server's records of these have
none. They show as "unknown" and "never", count as longer ago than any time
ago, and as earlier than any date.

### Editing as text

Next to the tree, any object or array in the editor can be opened as JSON text
and edited in one go. **Text** in an account's header opens its progress
record, which the database file keeps under the account's id (`players ›
"f78zsg7ns23v"` above the text). **Text** on any object's or array's row opens
that value: the account row, the inventory, or an entry of a table such as a
guild. The editor is the asset browser's: Ctrl+S saves, Ctrl+Z undoes, Esc lets
go of the caret. **Revert** goes back to what the database holds, and **Close**
returns to the tree.

A save applies only what you changed. The panel sends the text as it opened
it beside the text as you left it, and the server writes the difference onto
the record as it is now. A field you did not touch keeps its current value, so
a player who earns XP or picks up petals while you type keeps them. An array
is one value: change one loadout slot and the whole loadout is written. After
a save the text is rebuilt from what was stored. The line at the foot of the
panel names any change the server did not keep, for example `tp`, which it
works out from the level.

The same fields are locked as in the tree: `id`, `username`, `password`,
`admin`, `adminTier`, `owner` and the `adminBanned` fields. A save that adds,
changes or removes any of them is refused as a whole. Text with an error is
not sent, and the footer gives the line. A value that holds text too long to
send (over 4 KB) cannot be opened as text.

### Searching the backups

`backup_search` runs the same search over the database's backups
(`db_backups/`, one level above the database's directory), one backup at a
time, newest first. It answers when an account had something and when it went.

```sh
cmake --build cpp/build --target backup_search -j8
cpp/build/backup_search --user bob ~/db_backups 'mythic:rose>=5'
cpp/build/backup_search ~/db_backups 'loadout:mythic:rose petals>=5000'
```

The first argument is a backups directory, or one database file. The rest is
the search, quoted, since a shell reads `>` and `<` as redirections. A time
ago (`active<7d`) counts back from now, not from when the backup was taken;
give a date to ask about a backup's own week.

`--user NAME` keeps only the account with exactly that name and shows it in
every backup: its counts, marked `(no match)` where it misses the search, or
that it is not there. With a name and no search, it lists the backups the
account is in. `--limit N` caps the accounts printed per backup (20; 0 prints
all).

It only reads the files and never writes to them. Each backup holds every
password hash, and parses to several times its size, so do not run it on the
server: copy the backups off (`scp`, `rsync`), search the copy, and delete the
copy afterwards. It exits 0 when some backup matched, 1 when none did, and 2 on
an unreadable search or file.

## Protocol

The dashboard talks over `ClientMessage::AdminDashboard` and
`ServerMessage::AdminDashboard`, each opening with a sub-code; the layouts are
in `cpp/shared/net/admin_dashboard.h`. The Inventory and Control requests carry
the row's connection and its account name, and a request refused for coming too
fast is answered with a `Refused` reply naming the op, so the panel stops
waiting for it. As for every message, a change to any of them bumps
`kProtocolVersion` in `cpp/shared/net/protocol.h`, and the client and server
ship together.

## Admin Cursor petal

With an Admin-rarity Cursor in an active slot, admins with spawn privileges
(tiers 1–3 and the owner) can hold left mouse to drag a mob, NPC or non-admin player, regardless
of rarity or movement type. Release to drop it. The cursor has no deletion
or custom right-click action. The server checks permissions, equipment, realm
and viewport for every drag.

## Restart selected biomes

`/admin restart garden desert` (or `/admin restart garden,desert`) clears wild
mobs, NPCs, drops, projectiles and ground effects in those biomes, including
associated sublevels and prestige maps. Map NPCs return; wild mobs refill through the normal spawn system.
Players, inventories, pets and boss cooldowns remain. Requires spawn privileges.
All names are validated before changing anything. `/admin restart list` lists
valid names. With no biome, the existing whole-server restart is unchanged;
`status`, `cancel` and timed restarts retain their existing meanings.

Dragging a player cannot select a full or temporary admin, a player under
another admin's control, or a player already held by another cursor. The
player is placed on valid ground and protected from damage while held and for
three seconds after release. Existing longer protection is preserved. Death,
disconnect, lost permission, unequip, body changes and realm changes release
the grab. Their keyboard remains their own; this does not grant control of it.

### Hel Casino

Hel's casino NPC is currently removed from the map upstream while it is polished.
When placed, it is stationary and marked by a gold dot on the minimap. Stand
beside it and use `/casino` for the rules and balance, `/casino buy <stars>`
for chips (10 per star), `/casino cashout <chips>` in multiples of 10,
`/casino flip <chips> <heads|tails>` or `/casino plinko <chips>`.
Coin flip pays 2x with a 40% chance; Plinko has an 88% expected return.
Payouts include the stake. Bets are 1–10,000 chips, the account balance cap is
one billion chips, and there is a persisted one-second account cooldown.
Arena currency cannot be used. Casino chips and cooldowns persist in the
existing account database; there are no additional admin ranks or privileges.

### Giving XP

`/admin give_xp <amount> [username]` (alias `givexp`) adds a signed whole
amount of XP, defaulting to yourself. Scientific notation is accepted, for
example `/admin give_xp 1e12 a19kisme`. It follows the existing give permissions:
tiers 1–2 and Owner may give to anyone; full tier 3–4 admins may give only to
themselves, and temporary tier 3–4 admins cannot use it.

Online targets receive XP on their current track (maze XP inside the maze);
offline accounts receive regular XP. Arena runs must end before receiving a
grant. Both split bodies and the profile update immediately. Negative amounts
remove XP, stopping at zero; removing another admin's XP follows the existing
database editor rank rule (only lower-ranked admins may be targeted). Changes are
logged and persist with the account; invalid or overflowing amounts are refused.

### Hover kill

Equip an **Admin-rarity Cursor**, point at a mob, pet or non-admin player,
and press **Minus + Backspace** together. The combo is inactive in chat and
menus, and suppresses zoom-out while held. Each press selects one target
under the pointer in your current realm; holding does not repeat. Players
enter their normal death/respawn flow. Other admins, your own flower, NPCs
and dropped items are protected. No XP, drops or kill credit are awarded.
The server checks the Cursor's existing tier and equipment requirements and
enforces the visible viewport. When starting a drag, a valid player under
the pointer takes priority over overlapping mobs.

### Owner grabbing priority

The existing Owner rank has superior Admin Cursor grabbing rights. An Owner
can drag lower-ranked admins and take a mob, NPC or player out of a lower
admin's grab. The displaced grab is released immediately and cannot resume
until the lower admin releases and presses again. A grabbed admin's own grab
and flower control are released too. Other Owners remain protected, including
from `/admin control`; equal Owners cannot steal each other's grabs.

These rights come from the existing server-held Owner flag, with the usual
Admin Cursor equipment requirement. No username or new rank grants them.

### Cursor teleport and phase

With an Admin-rarity Cursor equipped, **Shift + =** teleports your active
flower to the pointer in its current realm. Each press teleports once; holding
cannot repeat. The existing admin tier/equipment checks apply on the server.
Teleporting releases your own grab. Terrain resolves the destination onto
open ground unless you enabled phase. Both Cursor chords claim their keys
before zoom/menu bindings; plain Minus and Equals still zoom normally, and
Ctrl/Cmd shortcuts and text entry do not activate Cursor actions.

`/admin phase [on|off|toggle]` toggles passing through walls for your current
flower and both splitter halves. Normal combat still applies. Phase ends
on respawn or loss of admin access, and turning it off resolves you out of
solid terrain. Map bounds remain enforced. Cursor dragging can carry players
through walls too; release restores normal collision without enabling phase
on the target.

### Wave survival: `/admin start_waves`

`/admin start_waves [garden|desert|ocean] [starting wave]` (default garden, wave
1; tiers 1-3, as spawning is) opens a black portal 450 units in front of you and
tells every player "A Mysterious rift has opened!". It only opens on a map, not
in the PVP arena, the maze or a hosted game, and one is open at a time. The rift
also shows as a black dot on that map's minimap.

Stand on it for a second, as on any teleporter, and you are on a disc in a realm
of its own. The disc starts at radius 1500 and grows by 50 each wave, up to 8000
(from wave 131); a game started at a later wave starts at that wave's size. The
first flower through starts wave 1. The rules are flooooio's, with the changes
noted in `shared/game/waves.h`: each wave spends 10 points per wave number on
the biome's mobs, at a rarity that climbs with the wave up to super (ultras from
about wave 55, supers from about 75, nothing else past 90); from wave 15, 15% of
waves are special, one mob family in a swarm. A wave lasts 60 seconds up to wave
10 and grows slowly after (67 at wave 30, 77 at wave 100), and its mobs come
fast enough to all be out by half of that. The disc holds at most 1500 mobs, and
at most 8 discs' worth of mob bodies; past that the rest of the wave waits until
there is room. A wave ends at once when all its mobs have spawned and 2 or fewer
are left. When the clock runs out with more than 4 mobs up, a red clock runs as
long again with no more spawns. Then the next wave starts. Whoever died watches
the nearest thing still up, and gets up beside a survivor at the next wave. When
nobody is left standing the game is over: the rift closes, the disc is cleared
and everyone is put back where they went in, standing. Mobs pay XP and drop
petals as they do anywhere else; the supers on the disc are not announced and
get no boss bar.

Leaving with the Exit button goes to the title screen, as anywhere. The rift
stays open until the game is over or `/admin stop_waves`, which closes it the
same way. If everyone walks out, the rift stays and the game starts over for the
next flower through.

### Admin-hosted arena and iPad Cursor

Admin Arena appears in the normal biome picker only for admins. The server
also refuses forged direct joins from non-admin accounts. Hosts can invite
active players with `/admin arena bring all` or `/admin arena bring <username>`.
`/admin arena return all` (or a username) returns guests to their previous realm.
Guests retain their normal inventory and XP; this is separate from the public
PvP arena and its scratch inventory. Invited guests can respawn inside the game,
but leaving removes their invitation. Hosts can spawn game mobs normally.

The default is Hel's layout and floor with garden walls, without ambient mobs
or copied map NPCs. Configuration and custom tiles survive server restarts:

- `/admin arena map <map-id>` copies a staged layout such as hel or garden.
- `/admin arena empty <width> [height]` creates an empty grid with boundary walls.
- `/admin arena wall <theme>` and `/admin arena floor <theme>` change appearance.
- Themes: garden, hel, desert, computer, jungle.
- `/admin arena build <x> <y> <width> <height> wall|open` paints an interior rectangle.
- Sizes and coordinates are in 256-unit tiles; dimensions are bounded to 4–128.
- `/admin arena pvp on|off` controls player fighting; default is off.
- `/admin arena status` or `help` lists settings and commands.

Only full admins with the existing spawning permission may host/configure games.
A map reset removes unowned arena objects; editing rescues players from new walls.

On iPad, with an Admin Cursor equipped, hold and move a finger on the world to
grab. The joystick stays independent, even with several fingers down. The red
button becomes KILL and the blue button TP, acting on the last world touch.
Opening a menu, dying, or unequipping the Cursor clears the world-touch state.

Open **Admin > Arena** (or `/admin arena gui`) to edit the hosted map visually. Select Admin Arena in
biomes first to receive the live preview. Choose Brush or Erase to paint, or
Box to drag a rectangle, then release to apply. Pan moves a zoomed preview;
plus/minus zoom in/out. Boundary walls remain protected. Layout and Create Empty
buttons replace the current map. Width and height accept 4–128 tiles. Theme
arrows, PvP buttons, Bring Everyone and Return Everyone need no typed commands.
Edits go through the same server permissions, validation and persistence as
host commands. The preview updates after the server accepts each edit.


The advanced panel adds **Star Codes** and **Events**. Star Codes lists active
codes and creates named codes with a star reward and use limit (0 is unlimited),
using the existing full tier 1–2 give permission. Give accepts a typed account
username; Spawn accepts optional tile X/Y coordinates. Database opens the existing
key-protected database editor.

Arena's **Open builder** expands the editor. Brush/Erase support sizes 1–16;
Box paints a rectangle; Pan and +/- navigate. A released brush gesture is one
bounded, atomic server edit (up to 512 cells), and accepted edits are saved in
the server configuration. Closing the browser does not undo them. **Save now**
also flushes the database to disk. Named Events preserve map tiles, themes, PvP,
kit and restrictions, and survive restarts. Boundary artwork repeats outside
the map; collision still stops players at the map boundary.

Events can capture a bag/loadout, create an empty kit, add/remove stacks and
set/clear any of the 20 slots. **Use personal gear** switches to temporary copies
of each player's own gear. Event restrictions can lock loadout edits, limit active
slots or maximum rarity, ban exact rarities, ban multiple petal IDs, and exclude
healing/revival/lifesteal, projectile petals, egg summons or Admin gear. The server
applies these to bags and both loadout rows, including modified-client requests.
Restrictions and kit changes require full tier 1–2 access. Rules apply immediately;
changing a kit resets participants to that kit. Joining or respawning gives a fresh
copy. Host edits never remove petals from permanent inventories.

Hosted participants always use temporary gear and rewards. Leaving restores their
saved gear, XP and stars. Crafting, trades, forging, purchases, talents, saved-loadout
presets and casino exchanges are unavailable during these events; star redemption
still credits the permanent wallet. New kit/preset data uses the existing inventory
representation, including its loadout-in-inventory marker.

Full admins can also select **Admin** while cycling chat channels with Tab or
Shift+Tab (or click its label), then press Enter to broadcast an announcement.
This sends the existing `/admin announce` command, with the same server-side
permissions, moderation and rate limit. Other accounts skip Admin when cycling;
its transcript checkbox still shows or hides received announcements.

Player chat has a server-enforced 500 ms minimum interval shared by Global,
Local, Squad, Guild, whispers and admin announcements. Rejected cooldown attempts
do not extend it; existing flood and repeat limits still apply.

### Timed polls

`/admin createpoll` opens a standalone creator for full admins. Choose 2–6 answers and a 10–3600 second duration. The top-center banner stays until the account votes or time expires; reconnecting cannot grant another vote. Results are in Debug → Polls, visible only to full admins.

Gambling commands have been removed. Legacy chip fields remain readable so existing databases load without losing stored data. Hel remains an NPC.

### Petal bans, teams and personal loadouts

In Admin → Events, use **Petal bans** to search display names, select one rarity or All rarities, and add/remove restrictions. Existing ID bans remain supported. Rules apply immediately to temporary event bags and both loadout rows; normal owned inventory is preserved.

The **Teams** tab offers Free for all, Me vs Everyone, Admins vs Players, and four manually assigned sides (Blue, Red, Green, Yellow). Me vs Everyone puts the acting host alone on Blue and every other participant on Red, including later entrants. Team modes enable PvP; allies cannot damage each other or their owned pets/projectiles. Teams and manual account assignments are autosaved and included in named event presets.

**Use personal gear** permits saving/loading normal presets against the temporary copy of personal gear. Bans, active-slot limits and loadout locks still apply. Custom host-provided kits and public arena runs cannot overwrite saved presets.

Hosted PvP toggles and live map updates preserve the current world view without a black teleport transition. Cursor teleport also skips that transition. The Arena editor's **Update** button broadcasts the current map and saves it to disk; brush edits continue to apply automatically.
