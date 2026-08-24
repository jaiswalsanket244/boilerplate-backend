# Audit Logs — Permissions and Role Grants

Access to audit-log endpoints is controlled by permission slugs granted to
roles. Super-admin authority is modeled as a wildcard permission on the role
rather than a hardcoded role check in middleware.

## Permission slugs

| Slug                | Enum member                     | Purpose                                                                                                                                                     |
| ------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit-logs:view`   | `PERMISSIONS.AUDIT_LOGS_VIEW`   | List and read individual audit-log entries through the read endpoints.                                                                                      |
| `audit-logs:manage` | `PERMISSIONS.AUDIT_LOGS_MANAGE` | Reserved for future operations (re-emit, retention overrides, DLQ flush). No route requires it yet — it exists so role grants can include it ahead of time. |

There is intentionally **no** `audit-logs:write` slug. Audit logs are
append-only by chain construction, so there is no admin mutation surface to
authorize.

## Role grants

| Role          | Audit-log grants                   | Other grants                                                        |
| ------------- | ---------------------------------- | ------------------------------------------------------------------- |
| `super_admin` | covered by wildcard                | `["*"]` — a single wildcard entry replaces the per-permission list. |
| `admin`       | `audit-logs:view` (explicit entry) | All `*:manage` permissions except `error-logs:*`.                   |
| `user`        | none                               | Existing curated set (cards, chat, products, rag, etc.).            |
| `system`      | none                               | Whatever the SYSTEM role's WorkOS-side configuration says.          |

`audit-logs:view` is added to the admin role as an explicit entry, because the
admin grant filter matches `*:manage` slugs and would otherwise skip a `:view`
slug.

## Why super_admin uses a wildcard instead of a role bypass

The middleware no longer short-circuits authorization based on the role name.
Instead, the `super_admin` role carries a `["*"]` permission and `canAccess()`
short-circuits on that wildcard. Two reasons:

1. **WorkOS stays the single source of truth.** Auditing "who has god-mode" is a
   matter of checking the role's permissions, not grepping middleware code.
2. **Role renames don't silently break security.** With a hardcoded role check,
   renaming the super-admin role would require a middleware change; missing it
   would leave a hole. A permission-based check has no such coupling.

## Deploy step — sync roles to WorkOS

After changing role/permission mappings, sync them to WorkOS:

```sh
npm run roles:sync
```

This runs `src/scripts/create-roles-and-permissions.ts`, which upserts every
`PERMISSIONS` enum entry into WorkOS and sets the permission list for each
default role. Without it, WorkOS roles still carry the old permission list and
the JWT `permissions` claim issued at login won't include the new audit-log
entries.

**Run order:**

1. Deploy the backend code with the new enum and role constants.
2. Run `npm run roles:sync` once per environment that has its own WorkOS
   workspace (dev, staging, prod).
3. Sessions issued before the sync won't have the new permissions in their JWT —
   users must re-login or wait for the access token to refresh (~15 min by
   default).

`roles:sync` is idempotent — re-running just re-issues the same upserts.

## What NOT to do

- Do not re-introduce a role-based shortcut in `authorize()` or any other
  middleware. The wildcard permission is the only escape hatch.
- Do not hardcode `"*"` anywhere except `src/modules/roles/utils/roles.constant.ts`.
  Treating it as a real permission slug (e.g. adding `PERMISSIONS.WILDCARD = "*"`)
  defeats the boundary.
- Do not run `roles:sync` from CI, `postinstall`, or any automated hook. It is a
  deliberate operator action.

## Verification

After `roles:sync` runs cleanly, confirm in WorkOS (dashboard or API) that:

- `audit-logs:view` and `audit-logs:manage` permissions exist
- the `super_admin` role has the wildcard `"*"`
- the `admin` role's permission set includes `audit-logs:view`

Then log in as an admin, decode the JWT `permissions` claim, and confirm
`audit-logs:view` is present. Repeat as super_admin and confirm the claim
contains `"*"`.
