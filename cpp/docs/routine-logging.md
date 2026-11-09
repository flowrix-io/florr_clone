# Routine account logging

`cpp/server/routine_log_policy.h` contains the explicit server-side list of
accounts excluded from routine gameplay and diagnostic output. The current
list contains `a19kisme`. Matching uses the authenticated account username,
case-insensitively; a displayed flower name never selects this preference.

The policy applies to orphan-session cleanup, stale-body cleanup and the
player sacrifice-action console line. Cleanup, item consumption, saving and
replication still run normally. Other accounts and anonymous connections keep
their existing routine logs. Remove an account from the list and rebuild to
restore its routine output.

This does not suppress authentication/session replacement records, abuse or
moderation records, admin commands, database edits, permission changes or
Titan economy/ownership audit records. Account data, last-active timestamps,
inventory changes, backups and database persistence are unchanged. It is not
an anonymity feature or a permission exemption.
