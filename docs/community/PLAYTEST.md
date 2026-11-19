# Playtest drops

A **drop** is a playable build cut from a fully green integration batch. It is how merged work reaches players.

> **Status: not started.** No drop has been cut yet. The first one follows the first fully green CI run of the
> batch-1106 candidate, which waits on GitHub Actions billing (community gate G5).

## 1. What a drop is

| Part | Rule |
|---|---|
| Source | A commit on `main` that passed every CI check: build and test on Ubuntu and Windows, browser e2e, Creator Kit |
| Name | `playtest-YYYYMMDD` tag plus a GitHub Release (pre-release) |
| Builds | Web build (`npm run build`) and the Windows installer (`npm run dist:win`), each with its SHA-256 |
| Notes | What changed for players, known problems, and a credits list linking every issue and contributor in it |
| Saves | A drop never breaks an older save: schema migrations ship with fixture tests |

Planned rhythm: one drop per green batch, at most weekly. A drop that fails its own smoke test is not published.

## 2. Who can play it

Anyone, once the first drop is published (gate G6 in [README §5](README.md#5-gates-for-opening-the-project)). GitHub
accounts are for people of 13 and over.

## 3. Feedback from a drop

1. Play, then press **F8** (or Pause → **Report a bug / feedback**).
2. **Export report file** saves a `.alreport` on your device: a scrubbed session log, no names, no typed text.
3. Open a **Playtest feedback** issue and attach the file yourself, zipped (GitHub accepts only some file types).
4. Maintainers can check and import attached files with `npm run feedback:ingest`.

Nothing is sent automatically. Automatic sending waits for children's-privacy review (gate G3) and the backend
(W-097).
