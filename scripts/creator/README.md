# Creator Kit

See the [contributor guide](../../docs/contributors/CREATOR_KIT.md) for setup,
supported pack kinds, author/build/verify/gate commands, MCP configuration and
submission rules. This package is deliberately separate from the game bundle.

```sh
npm ci --ignore-scripts
npm run build
npm test
```

Do not add paid-generation, credential, signing or auto-publish endpoints here.
The game verifier/schema/registry are bundled from source, not copied. Dependency
versions and `package-lock.json` are pinned. SDK 2.4.0 uses the current split
`@modelcontextprotocol/server` and `@modelcontextprotocol/client` packages; see
[official v2 documentation](https://ts.sdk.modelcontextprotocol.io/v2/).
