# Contributing to Afterlife Lease

Thanks for wanting to help. This page covers how a change gets from your computer into the game. Players, developers,
artists, world builders and the AI agents they work with are all welcome.

## How it works

1. **Fork** this repository and make your change on a branch in your fork.
2. **Open a pull request** against `main` and fill in the template. Tests run automatically; for a first-time
   contributor they start once a maintainer clicks **Approve and run**.
3. **The maintainer reviews it.** Today that is the project owner ([@rblake2320](https://github.com/rblake2320)). They
   may ask for changes. Nothing merges without their approval, and the owner keeps the game's direction.
4. **It ships in the next playtest drop.** A drop is a tagged, playable build whose release notes credit everyone
   whose work is in it. Merging into `main` does not put a change in players' hands by itself.

Every change, from anyone, goes through a reviewed pull request.

## Before you start

- **Small fixes** (a bug, a typo, a performance win): just open a pull request.
- **Bigger ideas** (new objects, careers, pets, areas of the world, balance changes, new dependencies): open an issue
  first and describe the idea, so you find out whether it fits before you spend a weekend on it.
  [docs/community/STARTER_TASKS.md](docs/community/STARTER_TASKS.md) lists good first tasks, and
  [docs/WORKBOARD.md](docs/WORKBOARD.md) shows what is planned.

## Before you open the pull request

```sh
npm ci
npm run typecheck
npm test
npm run build
```

You need [Node.js](https://nodejs.org) 22.12 or newer. All checks must pass; the same ones run on your pull request.
Then play your change: `npm run dev` and open the address it prints.

## What gets accepted

- **One thing per pull request.** It is much easier to review.
- **Show it working.** A screenshot or a short clip for anything you can see.
- **The simulation stays deterministic.** It never reads the clock, randomness or the device directly; everything
  enters as a recorded command. The same save and the same actions must always give the same world.
- **Tests come with the change,** including the unfriendly cases: bad input, a crash halfway through, reload and
  replay. State the commands you ran and the counts in the pull request.
- **Saves stay safe.** A change to the save format needs a migration and a test against the old-save fixtures.
- **Docs and code must agree.** A doc that claims something the code does not do is treated as a bug.
- **Add a changelog line.** Anything a player or another contributor would notice gets one line under
  **Unreleased** in [CHANGELOG.md](CHANGELOG.md).
- **Art, models, sound and fonts must be yours or clearly free to use** (CC0, or CC-BY with credit). Say where each
  one came from in the pull request. Nothing taken from other games, and no lookalikes of other games' characters,
  names or logos. See [docs/community/ASSETS.md](docs/community/ASSETS.md).
- **Keep it E10+.** Comic, not graphic. Children play this game: nothing that collects or sends player data.
- **AI-assisted work is welcome.** Afterlife Lease was largely built with AI agents. You are responsible for every
  line: read it, run it, and be ready to explain it. Point your agent at [AGENTS.md](AGENTS.md).

By opening a pull request you agree that your contribution is released under this project's [MIT licence](LICENSE).

## Questions and bugs

Ask in [Discussions](https://github.com/rblake2320/ALL/discussions). For a bug, open an issue with what you did, what happened, what you expected, and
your browser and computer. A screenshot helps.

**Security problems are different:** report them privately, as described in [SECURITY.md](SECURITY.md).

## Be decent

Everyone here follows the [code of conduct](CODE_OF_CONDUCT.md).
