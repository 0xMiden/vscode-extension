# Miden Extension for VS Code

Language support for Miden Assembly through `miden-lsp`, and DAP debugging for
compiled Rust/MASM packages through `miden-debug` or `miden-client`.

## Local development

1. Run `npm ci` and `npm run compile`.
2. Open this folder in VS Code and start an Extension Development Host.

## Language server settings

The language server must be on `PATH`, or configured through
`miden-lsp.binary.path`. Other settings are `miden-lsp.binary.args`,
`miden-lsp.binary.env`, `miden-lsp.initializationOptions`, and
`miden-lsp.trace.server` (`off`, `messages`, or `verbose`).

Semantic tokens provide rich syntax coloring; the bundled TextMate grammar is a
fallback before the server starts. Debugging works even without `miden-lsp`.

## Debugger prerequisites

Checked against [miden-debug 0.18.0](https://github.com/0xMiden/miden-debug/releases/tag/v0.18.0)
and [miden-client 0.17.3](https://github.com/0xMiden/rust-sdk/releases/tag/v0.17.3).
No companion feature branches or dependency patches are required.

Both backends load **compiled `.masp` packages**, not source files. Build first
with `miden build`, or use `midenc --debug full` for MASM. The package format must
match the backend's VM version; old compiler artifacts may need rebuilding with
a matching toolchain. The extension does not compile programs. You can use VS
Code's `preLaunchTask` to run your own build task.

The client needs its optional `dap` feature. The published 0.17.3 CLI binary
does not include `--start-debug-adapter`. Build it from the release checkout:

```bash
cargo build --locked -p miden-client-cli --features dap
```

Run that command in your `miden-client` checkout. Set `midenClientPath` to the
resulting `target/debug/miden-client` binary (or the executable under your
configured Cargo target directory). The `testing` feature is separate and is only
needed for test helpers such as offline wallet creation. A transaction session
needs an initialized client directory and an account.

## Launch a transaction package

Add this to `.vscode/launch.json` under `configurations`:

```json
{
  "type": "miden",
  "request": "launch",
  "name": "Debug Transaction",
  "runtime": "client",
  "packagePath": "${workspaceFolder}/target/miden/dev/my-package.masp",
  "midenClientPath": "/path/to/dap-enabled/miden-client",
  "cwd": "${workspaceFolder}",
  "host": "127.0.0.1",
  "port": 4711
}
```

The extension runs `miden-client exec --package ... --start-debug-adapter ...`.
The package must be a library exporting exactly one transaction script, not a
standalone executable. `packagePath` can also be a bare name from the client's
configured packages directory. `accountId` selects an account; otherwise the
client uses its default account.

`scriptPath` is a deprecated alias for `packagePath`; it no longer accepts
`.masm` sources. Restart reloads the package without compiling it. Rebuild after
editing sources before restarting.

In the 0.17.3 client / 0.18.0 debugger smoke test, a source breakpoint in the
transaction package was rejected at program entry with "No executable Miden
operation is mapped to this source file." The backend validates against the
currently active kernel debug info before loading the transaction script's
debug info. Launch, instruction stepping, execution, and recording are supported.
A local debugger fix now retains these breakpoints as pending, verifies them when
the package loads, and reads local source files when the host cannot supply them.
That fix was tested with this client, but is not included in the stock 0.18.0
debugger dependency; changing the extension's source path alone does not solve it.

## Launch a standalone package

```json
{
  "type": "miden",
  "request": "launch",
  "name": "Debug Program",
  "runtime": "debugger",
  "programPath": "${workspaceFolder}/target/miden/dev/my-package.masp",
  "midenDebugPath": "miden-debug",
  "programArgs": ["10"],
  "cwd": "${workspaceFolder}",
  "host": "127.0.0.1",
  "port": 4711
}
```

This launches `miden-debug --start-debug-adapter ... <programPath> -- <programArgs>`.
Use an explicit `midenDebugPath` if it is not on `PATH`. The package is already
built; `programPath` is not the Rust or MASM file currently open in the editor.

`programArgs` use canonical ABI encoding for typed entrypoints, or raw felts
otherwise. Use `entrypoint` to select an exported procedure in a library package.
`sysroot`, `searchPath`, and `linkLibraries` supply the corresponding linker
options if needed. Inherit `MIDEN_SYSROOT` or select a sysroot matching the package.

## Attach to an existing server

Start either backend yourself:

```bash
# Transaction: requires a DAP-enabled client and an initialized client directory
miden-client exec --package test_debug.masp --start-debug-adapter 127.0.0.1:4711

# Standalone: midenup users can invoke the debugger as miden debug
miden debug --start-debug-adapter 127.0.0.1:4711 program.masp
```

Then use:

```json
{
  "type": "miden",
  "request": "attach",
  "name": "Attach to Miden DAP",
  "host": "127.0.0.1",
  "port": 4711
}
```

## Inputs and source paths

- `inputsPath` passes `--inputs` to the debugger, or `--inputs-path` to the client.
  These are different TOML formats: standalone execution inputs versus client
  advice-map entries.
- `recordPath` passes `--record` to the client. Replay snapshots may contain
  private account state, note data, and transaction witnesses; do not commit or
  share them publicly.
- `sourcePathPrefixes` forwards explicit path prefixes to the standalone
  debugger. Use it when package debug info contains trimmed source paths.
- `trimPathPrefixes` and legacy `compilerArgs` containing `-Ztrim-path-prefix`
  are also supported. Compiler arguments are only inspected, never executed.
- For packages below `target/miden/`, the extension also infers the project root
  as a source path prefix. Nonstandard output locations may need explicit prefixes.

Both MASM and Rust source breakpoints are supported. Keep source files matching
the package available, or use the backend's embedded-source support.

The **Miden Inspector** displays cycle, operand stack, and call stack from
`miden/uiState`, including inline-frame markers. Standard VS Code panes show
variables and stack traces. The extension enables the backend's DAP readiness
log and waits without opening a probe connection (the server accepts a single
debug client). If the requested launch port is occupied, it chooses a free port.
