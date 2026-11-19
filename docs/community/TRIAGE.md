# From an idea or a bug to a playable update

Anyone can start this without code. The issue is the single place where the person who sent it follows progress.

## 1. The flow

| Step | What happens | Label |
|---|---|---|
| 1. Sent | A bug, idea, asset or content proposal arrives through a form | `needs-triage` + its kind |
| 2. Triaged | A maintainer reproduces the bug or checks the idea against the pillars, and asks questions if needed | `needs-info` while waiting |
| 3. Decided | Accepted → `ready`, given a work item (`W-nnn`) and added to the [workboard](../WORKBOARD.md). Declined → closed with the reason | `ready` / `declined` |
| 4. Claimed | A person or an agent claims it ("claim" comment or the **Claim work** form); one owner per item | `claimed` |
| 5. Built | Work happens on its own branch; the draft PR links the issue (`Closes #n`) | `in-progress` |
| 6. Reviewed | CODEOWNERS review, CI green, art review for assets | `in-review` |
| 7. Merged | Merged into `main` by a maintainer | `merged` |
| 8. Shipped | Included in a playtest drop; the drop's notes link the issue and credit the people involved | `shipped` |

Every label change shows in the issue's timeline, so the sender can see where their report is without asking.

## 2. Turning a report into an agent's assignment

A triaged issue becomes an assignment when it has:

1. **Goal**: one sentence, player-facing.
2. **Acceptance**: what must be true when it's done, written as checks a test can make.
3. **Scope**: which files/folders the work may touch (agents get no others).
4. **Evidence**: the reporter's steps, screenshots and `.alreport` file, if any.

The assigned agent works from [AGENTS.md](../../AGENTS.md), posts one status when it opens the PR and one when it is
ready for review. No running commentary.

## 3. Bugs

- **Reproduce first.** No reproduction, no fix. The fix PR includes a test that failed before it.
- **Root cause, not a patch.** The PR names the cause.
- **Security problems and cheats** never go in a public issue: see [SECURITY.md](../../SECURITY.md).

## 4. Labels

The full set, with colours and meanings, is in [labels.json](labels.json). The issue forms apply the kind labels
(`bug`, `enhancement`, `asset`, `world`, `playtest`, `claim`) and `needs-triage`; maintainers set the rest.
