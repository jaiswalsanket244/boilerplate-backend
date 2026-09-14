# Auth — Session Invalidation on Password Change / Reset

When a user's password changes, the backend enforces a fixed session-invalidation
policy on our own refresh-token sessions. Use this to answer questions such as
"does changing my password sign me out everywhere else?".

## Support answer

- **Changing your password while signed in signs you out on every _other_ device.
  The device you changed it from stays signed in.**
- **Resetting your password from the emailed link signs you out on _every_ device,
  including the one you reset from — you'll need to sign in again afterwards.**

## Policy

| Flow                                              | Route                            | What happens to sessions                                                |
| ------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| Authenticated change-password (user signed in)    | `POST /api/user/change-password` | All **other** sessions are revoked; the current device stays signed in. |
| Password reset via emailed link (unauthenticated) | `POST /api/auth/update-password` | **All** sessions for the user are revoked.                              |

## Why the two flows differ

- On change-password there is a trusted current device, so we keep it signed in
  for a smooth experience while cutting off every other session.
- A reset implies the account may be compromised and there is no trusted current
  device in that flow, so every session is revoked.

## Implementation notes

- Change-password re-issues fresh tokens to the current device (minting a new
  `sessionId`), then calls `revokeOtherSessions(userId, newSessionId)` — so the
  only surviving session is the newly authenticated current one.
- Reset calls `revokeAllSessions(userId)` after the password is updated.
- Both operate only on our `RefreshToken` rows for the affected user; there is no
  cross-user impact. Revoked sessions can no longer refresh and no longer appear
  in `GET /api/auth/sessions`.
- The password is held by WorkOS; revoking WorkOS-side sessions is out of scope.
