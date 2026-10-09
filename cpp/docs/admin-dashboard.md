# Admin dashboard

Open the upper-left **Admin** button or type `/admin gui`.

- **Players & inventory:** search an online flower, select it, and browse its inventory. Refresh fetches the current server state. Inventory pages contain six stacks to keep large inventories within the network message limit.
- **Control flower:** steer another online player's movement and attacks with your normal controls. The camera follows their flower. **Release flower** returns to yours. Control ends when either player leaves or dies, or the target changes realm. Accounts, inventories and chat identity stay with their owners.
- **Spawn mobs / Give petals:** search the catalog, cycle matching items, pick a rarity and enter an amount. Server responses appear in chat.
- **Announcements:** only the authenticated account `a19kisme` can send. Every player sees an eight-second banner and can read the message in the Admin chat tab.

`a19kisme` receives owner access after authentication, the exclusive `[ADMIN]` public-chat label, and exemptions from chat/command cooldowns, chat mutes, boss-spawn cooldowns and the database-editor key prompt. Other admins retain their existing restrictions. Network validation, item capacity and the 500-mob batch bound remain enforced.

All permissions are checked by the server. Display names and edited clients cannot grant access. The web client and server must both be updated together (protocol 50).

Validation: native and web builds, admin regression tests, two-player control/permission tests, and a rendered dashboard preview.
