# Security policy

The full security model, threat table and the code and tests behind each claim are in
[docs/SECURITY.md](docs/SECURITY.md). The first independent review is in [docs/security/](docs/security/).

## Reporting a vulnerability

Report suspected vulnerabilities **privately** to the repository owner: use GitHub's private vulnerability
reporting on this repository (Security tab → Report a vulnerability). Do not
open a public issue and do not post details anywhere public.

Please include the affected version or commit, the steps to reproduce, the impact, and any crafted file (for example
a hostile `.alsave`) attached privately.

## Scope

The desktop app (`electron/`), the web build, saves (`src/persistence/`), the local economy (`src/economy/`), the
content-pack verifier (`src/packs/`) and the Creator Kit. There are currently no servers, accounts or telemetry.
