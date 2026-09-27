# onboarding: create or join a collaboration space

## Responsibility

Shows creation and joining options when a signed-in user has no space; users with spaces enter an existing one. Creation provisions a new tenant and its sole space. Public joining supports one-use invitations and application links requiring approval; pending applications appear on the empty-space screen. Corporate users are directed to a directory-adding administrator.

It does not own authentication, member management, or the corporate directory.

## Files

| File | Purpose |
| --- | --- |
| `onboarding-page.tsx` | Creation form, link entry, pending status, and existing-space redirect |
| `join-page.tsx` | Restores a private link after login, then confirms redemption or application |
| `api.ts` | Hooks for redemption, application, and the user's requests |
| `*.test.tsx` | Page and network-state tests |

## Dependencies and invariants

Depends on `features/auth/session`, `features/spaces`, the generated client, `src/lib/paths`, and UI components; only the router consumes its pages.

- `/join/invite/:token` and `/join/apply/:token` run inside `RequireSession`. While signed out, the token path stays in this browser tab; Gateway receives only the tokenless `/join/continue` return path, which restores the link after login.
- Invitations grant ordinary membership only. An application cannot enter the space before administrator approval.
- Link entry accepts only this site's supported private join paths; creation validates slugs against the backend rule.

## Testing

Real routes with MSW cover creation, redirects, failures, and pending status without contacting a gateway.
