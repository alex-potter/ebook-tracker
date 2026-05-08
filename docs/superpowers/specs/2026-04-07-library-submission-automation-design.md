# Library Submission Automation Design

**Date:** 2026-04-07
**Status:** Draft

## Problem

The current `.bookbuddy` library submission process has two manual pain points:
1. User downloads a ZIP, opens a GitHub issue, and manually attaches the ZIP
2. A developer manually creates a PR to place the file in `books/AuthorName/`

## Scope

Automate step 2 only. The user-facing submission flow (download ZIP, attach to GitHub issue) stays as-is.

## Design

### Frontend Changes

None. The existing `LibrarySubmitModal.tsx` flow is unchanged:
1. User clicks "Prepare Submission"
2. ZIP downloads containing the `.bookbuddy` file
3. Browser opens a pre-filled GitHub issue with `[Library]` prefix in the title
4. User attaches the ZIP manually

### GitHub Action: `library-submission.yml`

A new workflow that automates PR creation from library submission issues.

**Trigger:** `issues` event, `opened` activity type.

**Filter:** Issue title starts with `[Library]`.

**Steps:**

1. **Download attachment** — Use GitHub API to list attachments on the issue. Find the first `.zip` file URL and download it.

2. **Extract** — Unzip the archive. Locate the `.bookbuddy` file inside.

3. **Validate** — Parse the `.bookbuddy` file as JSON and verify:
   - Valid JSON
   - Has required top-level fields: `version`, `title`, `author`, `state`
   - `state` contains `result` with `characters`, `locations`, and `arcs` arrays
   - `title` and `author` are non-empty strings

4. **Determine file path** — Read `title` and `author` from the parsed JSON. Target path: `books/{author}/{title} — {author}.bookbuddy`

5. **Check for duplicates** — If the target file already exists, add a comment on the issue noting this is an update to an existing book. Proceed with PR creation regardless so the reviewer can decide.

6. **Create branch and PR:**
   - Create branch: `library/{sanitized-title-and-author}` (lowercase, spaces to hyphens, special chars removed)
   - Commit the `.bookbuddy` file to the target path
   - Open a PR with title: `[Library] Add {title} by {author}`
   - PR body references the issue: `Closes #{issue_number}`

7. **Comment on issue** — Post a comment linking to the created PR.

### Error Handling

Three failure modes, all handled by commenting on the issue:

| Failure | Action |
|---------|--------|
| No `.zip` attachment found | Comment: "No .zip attachment found. Please attach your .bookbuddy ZIP and re-open this issue." |
| Validation fails | Comment with specific error (e.g., "Missing required field: `author`"). Add `invalid` label. |
| Duplicate book exists | Comment noting it's an update. Create PR anyway for reviewer to decide. |

### Permissions

The workflow needs:
- `issues: write` — to comment on issues and add labels
- `contents: write` — to create branches and commit files
- `pull-requests: write` — to create PRs

These are available via the default `GITHUB_TOKEN` in GitHub Actions.

## What This Does NOT Change

- The user-facing submission UI in `LibrarySubmitModal.tsx`
- The `books/` folder structure or naming convention
- The `GithubLibrary.tsx` component that reads from the library
- The deploy workflow in `.github/workflows/deploy.yml`
- Map data handling — full `.bookbuddy` payload including `mapState` is preserved as submitted
