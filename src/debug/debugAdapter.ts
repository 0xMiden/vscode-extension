import * as vscode from "vscode";

/**
 * Factory that tells VS Code to connect to the Miden DAP server over TCP.
 *
 * The server already speaks standard DAP with Content-Length framing, so
 * VS Code's built-in DAP client handles everything — no intermediate
 * adapter process is needed.
 */
export class MidenDebugAdapterFactory
  implements vscode.DebugAdapterDescriptorFactory
{
  createDebugAdapterDescriptor(
    session: vscode.DebugSession,
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    const host: string = session.configuration.host || "127.0.0.1";
    const port: number = session.configuration.port || 4711;
    return new vscode.DebugAdapterServer(port, host);
  }
}
