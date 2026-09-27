# common: shared presentation components

Reusable presentation for projects, spaces and issues; these components own neither tenant authorization nor network state. `dialog-form-field.tsx` provides labeled inputs and validation hints. `create-form-submit.tsx` shares creation errors, disabled submission and pending feedback while each form owns validation and requests. `actor-avatar.tsx` and `issue-badges.tsx` display actors and issue markers.

Feature modules consume these components through the base UI layer. Tests verify pending and invalid submission guards and accessible error feedback.
