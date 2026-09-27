# layout: Authenticated application shell

[中文](README.md) | [English](README.en.md)

This module composes the sidebar, page header, and route outlet. Authentication is not decided here: the router wraps `DashboardLayout` in `RequireSession` from `features/auth`, which sends a 401 to the login page while preserving the current in-app path, reports a 403 (disabled account) in place, and offers a retry for transient failures. Only once the session is confirmed does this module resolve `:workspaceSlug` against the member's real spaces (`CurrentSpaceProvider`) and subscribe to that space's event stream; a member with no space is sent to `/onboarding`, and an unknown or archived slug falls back to the first space.

`AppSidebar` reads the current user through `useSession` and lists every tenant space returned by `/me/spaces`. After switching, resource calls use the selected space's `tenantId`; "new workspace" provisions a new tenant. It also offers sign-out and, when the gateway lists `github`, GitHub logout. Business navigation may still use simulated data, but this module must never store tokens or duplicate authentication state.

Tests cover current-user display, space resolution and fallback, event-stream subscription, sign-out and the GitHub sign-out.
