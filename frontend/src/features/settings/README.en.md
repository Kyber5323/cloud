# settings: space information settings

## Responsibility

Owns collaboration-space settings navigation and the general page. Administrators can rename with a version guard, which also updates the tenant name; the slug stays fixed. Member and billing pages belong to their own feature modules.

It does not implement membership authorization or space archival.

## Files

| File | Purpose |
| --- | --- |
| `settings-layout.tsx` | Settings navigation and nested-route container |
| `general-settings-page.tsx` | Space name editing and read-only slug |
| `*.test.tsx` | Tests for navigation, administrator editing, and member read-only state |

## Dependencies and invariants

Depends on `features/spaces`, routing, and UI components; app routes consume it. The server still checks role and version; disabled UI controls are not authorization.

## Testing

MSW simulates the rename endpoint and verifies ordinary members cannot submit edits.
