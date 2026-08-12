# Miden Extension for VSCode

VS Code extension for Miden Assembly. Bundles:

- **Language support** via `miden-lsp` (semantic tokens, completions, diagnostics).
- **Debugger** (DAP client) that connects to the Miden VM debug adapter served
  by `miden-client exec --start-debug-adapter` or standalone `miden-debug`.

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

The extension contributes a `miden` debug type that speaks DAP to a TCP server.
It can attach to an existing server, launch `miden-client` for transaction
scripts, or launch `miden-debug` directly for standalone `.masm` / `.masp`
programs.

### Backend prerequisites

Until the upstream crates release the fixes this extension depends on,
transaction debug sessions need `miden-client` built from the companion feature
branch. Standalone sessions need a released `miden-debug` with VS Code DAP
attach support.

| Repo | Branch | Fix |
| ---- | ------ | --- |
| [walnuthq/miden-client](https://github.com/walnuthq/miden-client/tree/feature/vscode-dap-plugin) | `feature/vscode-dap-plugin` | `compile_tx_script` takes the script path so DAP clients receive real `Source.path` + line numbers for user code. |
| [0xMiden/miden-debug](https://github.com/0xMiden/miden-debug/releases) | `miden-debug` v0.8.0 or newer | DAP server handles `Command::Attach` instead of rejecting it with "Unsupported command". |

When building the `miden-client` backend from the companion branch, follow that
branch's Cargo configuration for its debugger dependency. Once the client-side
fix ships upstream, this section can be simplified.

### Attach mode

Start a DAP server yourself, then attach from VS Code. For a transaction:

```bash
miden-client exec \
  --script-path examples/test_debug.masm \
  --start-debug-adapter 127.0.0.1:4711
```

For a standalone program:

```bash
miden-debug --start-debug-adapter 127.0.0.1:4711 examples/simple.masm
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

### Transaction Launch

VS Code spawns `miden-client` and waits for its DAP server to announce
readiness:

```json
{
  "type": "miden",
  "request": "launch",
  "name": "Debug Miden Script",
  "runtime": "client",
  "scriptPath": "${file}",
  "midenClientPath": "miden-client",
  "cwd": "${workspaceFolder}",
  "host": "127.0.0.1",
  "port": 4711
}
```

`cwd` must point at an initialized `miden-client` working directory.

### Standalone Launch

Standalone launch means VS Code bypasses `miden-client` completely. It starts
`miden-debug` directly and debugs a plain Miden VM program: either a `.masm`
source file or a compiled `.masp` package.

Use this mode for:

- simple MASM scripts that do not need a transaction context
- compiled Rust/Miden compiler examples such as `target/miden/debug/*.masp`
- quick source-level debugger checks where accounts, notes, transaction
  kernels, and the client store are not involved

Do not use standalone launch when you want to debug real transaction execution.
For that, use `runtime: "client"` so VS Code starts `miden-client exec`.

VS Code starts roughly this command and then attaches to the DAP server:

```bash
miden-debug --start-debug-adapter 127.0.0.1:4711 <programPath> -- <programArgs>
```

```json
{
  "type": "miden",
  "request": "launch",
  "name": "Debug Miden Program",
  "runtime": "debugger",
  "programPath": "${file}",
  "midenDebugPath": "miden-debug",
  "cwd": "${workspaceFolder}",
  "host": "127.0.0.1",
  "port": 4711
}
```

`programPath` can point to a standalone `.masm` source file or compiled `.masp`
package. `programArgs` become the operand stack arguments after `--`.

For compiler-generated packages, especially Rust examples, the configuration
usually needs the same values you would pass to `miden-debug` on the command
line:

```json
{
  "type": "miden",
  "request": "launch",
  "name": "Debug Fibonacci Package",
  "runtime": "debugger",
  "programPath": "${workspaceFolder}/target/miden/debug/fibonacci.masp",
  "midenDebugPath": "miden-debug",
  "sysroot": "${workspaceFolder}/path/to/miden-core-lib/assets",
  "programArgs": ["10"],
  "cwd": "${workspaceFolder}"
}
```

Use `inputsPath`, `entrypoint`, `sysroot`, `searchPath`, and `linkLibraries`
for the corresponding `miden-debug` CLI options. For compiled packages built
with `midenc -Ztrim-path-prefix=...`, set `trimPathPrefixes` or
`compilerArgs`; packages under `target/miden/{debug,release}` infer the package
root automatically.

### Launch configuration reference

| Property          | Type     | Default        | Mode       | Description                                      |
| ----------------- | -------- | -------------- | ---------- | ------------------------------------------------ |
| `runtime`         | string   | `client`       | launch     | `client` for transaction debugging, `debugger` for standalone `miden-debug` |
| `host`            | string   | `127.0.0.1`    | all        | DAP server host                                  |
| `port`            | number   | `4711`         | all        | DAP server port                                  |
| `scriptPath`      | string   | —              | client     | Transaction `.masm` script                       |
| `programPath`     | string   | —              | debugger   | Standalone `.masm` source or `.masp` package     |
| `midenClientPath` | string   | `miden-client` | client     | Path to the `miden-client` binary                |
| `midenDebugPath`  | string   | `miden-debug`  | debugger   | Path to the `miden-debug` binary                 |
| `accountId`       | string   | —              | client     | Account ID for transaction execution             |
| `inputsPath`      | string   | —              | debugger   | Path to a miden-debug inputs TOML file           |
| `programArgs`     | string[] | `[]`           | debugger   | Operand stack arguments                          |
| `entrypoint`      | string   | —              | debugger   | Entrypoint for library packages                  |
| `sysroot`         | string   | —              | debugger   | Miden sysroot                                    |
| `searchPath`      | string[] | `[]`           | debugger   | Extra library search paths                       |
| `linkLibraries`   | string[] | `[]`           | debugger   | Libraries passed with `--link-library`           |
| `trimPathPrefixes` | string[] | `[]`          | debugger   | `-Ztrim-path-prefix` values for source mapping   |
| `compilerArgs`    | string[] | `[]`           | debugger   | Args scanned for `-Ztrim-path-prefix=...`        |
| `cwd`             | string   | workspace      | launch     | Working directory for the launched backend       |

### Miden Inspector

While a debug session is active, the **Miden Inspector** view in the activity
bar renders cycle, operand stack, and call stack from the server's custom
`miden/uiState` DAP event.
