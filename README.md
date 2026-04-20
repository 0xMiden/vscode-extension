# Miden Extension for VSCode

VS Code extension for Miden Assembly. Bundles:

- **Language support** via `miden-lsp` (semantic tokens, completions, diagnostics).
- **Debugger** (DAP client) that connects to the Miden VM debug adapter served
  by `miden-client exec --start-debug-adapter`.

## Current Assumptions

- `miden-lsp` is already available via `PATH`, or configured with
  `miden-lsp.binary.path`
- rich syntax coloring comes from semantic tokens exposed by `miden-lsp`
- the bundled TextMate grammar is only a lightweight lexical fallback for the
  editor before the language server is active
- direct runtime integration of `tree-sitter-masm` is deferred; the recorded
  grammar lineage lives in `tree-sitter-masm.lock.json`

## Local Development

1. Run `npm install`.
2. Run `npm run compile`.
3. Open this folder in VS Code and start an Extension Development Host.

## Settings

- `miden-lsp.binary.path`: absolute or `PATH`-resolvable command for the server
- `miden-lsp.binary.args`: extra command-line arguments for the server
- `miden-lsp.binary.env`: extra environment variables for the server process
- `miden-lsp.initializationOptions`: JSON object forwarded during LSP
  initialization
- `miden-lsp.trace.server`: protocol trace level (`off`, `messages`, or
  `verbose`)

## Debugging

The extension contributes a `miden` debug type that speaks DAP to a TCP server
exposed by `miden-client`. Two launch modes are supported.

### Attach mode

Start the DAP server yourself, then attach from VS Code:

```bash
miden-client exec \
  --script-path examples/test_debug.masm \
  --start-debug-adapter 127.0.0.1:4711
```

`.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "miden",
      "request": "attach",
      "name": "Attach to Miden DAP",
      "host": "127.0.0.1",
      "port": 4711
    }
  ]
}
```

### Launch mode

VS Code spawns `miden-client` and waits for its DAP server to accept
connections:

```json
{
  "type": "miden",
  "request": "launch",
  "name": "Debug Miden Script",
  "scriptPath": "${file}",
  "midenClientPath": "miden-client",
  "cwd": "${workspaceFolder}",
  "host": "127.0.0.1",
  "port": 4711
}
```

`cwd` must point at an initialized `miden-client` working directory.

### Launch configuration reference

| Property          | Type   | Default         | Mode   | Description                                        |
| ----------------- | ------ | --------------- | ------ | -------------------------------------------------- |
| `host`            | string | `127.0.0.1`     | both   | DAP server host                                    |
| `port`            | number | `4711`          | both   | DAP server port                                    |
| `scriptPath`      | string | —               | launch | Path to the `.masm` script                         |
| `midenClientPath` | string | `miden-client`  | launch | Path to the `miden-client` binary                  |
| `accountId`       | string | —               | launch | Account ID for execution (optional)                |
| `cwd`             | string | workspace       | launch | Working directory (initialized miden-client dir)   |

### Miden Inspector

While a debug session is active, the **Miden Inspector** view in the activity
bar renders cycle, operand stack, and call stack from the server's custom
`miden/uiState` DAP event.
