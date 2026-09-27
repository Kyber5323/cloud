# members: tenant membership management

## Responsibility

Shows the selected collaboration space's tenant roster and lets administrators change active roles or disable members. A disabled member rejoins only after a fresh directory check, invitation, or approved request. Huawei deployments search employed people through Tianzhou and add them; public deployments create and revoke invitation/application links and decide requests.

It does not own login, space switching, or durable plaintext invitation tokens.

## Files

| File | Purpose |
| --- | --- |
| `api.ts` | Generated-client hooks for members, directory, links, and requests; local random tokens |
| `members-page.tsx` | Roster and management entry points selected by login provider |
| `members-page.test.tsx` | Tests for permissions, disabling, link creation, and directory additions |

## Dependencies and invariants

Depends on `features/spaces/current-space`, `features/auth/providers`, the generated client, and UI components; the settings route consumes it.

- Roles and status come only from tenant membership; removal writes `disabled` and retains the row.
- The tenant member update endpoint cannot create or reactivate membership directly, preserving directory employment checks and private joining.
- Management is displayed only to `admin`; corporate additions are rechecked by Ora server-side without exposing Tianzhou keys.
- The browser creates 256-bit tokens and shows a share link only after successful creation; later lists hold metadata only.

## Testing

MSW verifies real endpoints, strict request bodies, and controls for each deployment mode.
