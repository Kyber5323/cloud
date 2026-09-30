# plans/

[English](README.en.md) | [中文](README.md)

This directory holds **working notes for an open pull request**. Product contracts, architecture, API, and database docs stay in `docs/`. Approved rules stay in the specs ADRs. `README.md` and `README.en.md` are the durable convention. Every topic subdirectory is intermediate.

Teams usually keep expiring implementation progress in the pull request or in working notes, not in the long-lived manual. What remains is the decision (ADR) and the contract the code still uses. Kubernetes KEPs and Rust RFCs are archived because they are decisions; a phase checklist is not. This repo therefore commits the notes on the feature branch so other people and later sessions can continue, and **deletes that topic directory before the work merges**. Do not put the notes under `docs/`, and do not cite them from `docs/INDEX.md`, the README, or the architecture doc as authority.

## How to use it

- One directory per active topic: `plans/<topic>/`, with a lowercase hyphenated name such as `runtime-control/`.
- Record only the current phase, what has landed, required reading, and what not to do. If a note disagrees with an ADR or a formal doc, the note is wrong.
- Commit the notes with the feature PR. Do not store secrets, tokens, or machine-local paths.
- The last PR for that topic deletes the whole `plans/<topic>/` directory before merge. Behavior that must survive belongs in code, tests, migrations, or specs evidence, not in a second specification here.
- After merge, `main` should contain no finished topic directory under `plans/` besides this explanation.

## Older locations not to copy

These files are earlier process notes that were committed under `docs/` and drifted from the implementation. Do not add new notes there, and do not move them in an unrelated PR:

- `docs/development/onboarding/progress.md`
- Stage write-ups and the issue-board implementation log under `docs/migrations/`
