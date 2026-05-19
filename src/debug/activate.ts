import * as vscode from "vscode";
import { MidenDebugAdapterFactory } from "./debugAdapter";
import { MidenDebugConfigProvider } from "./debugConfigProvider";
import { MidenStateProvider } from "./midenStateProvider";

/**
 * Register the Miden debug adapter, configuration provider, and the
 * Miden Inspector tree view. Safe to call before the LSP client starts —
 * debugging must remain functional even when `miden-lsp` is unavailable.
 */
export function activateDebug(context: vscode.ExtensionContext): void {
  const configProvider = new MidenDebugConfigProvider();
  const stateProvider = new MidenStateProvider();

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory(
      "miden",
      new MidenDebugAdapterFactory(),
    ),
    vscode.debug.registerDebugConfigurationProvider("miden", configProvider),
    vscode.window.registerTreeDataProvider("midenState", stateProvider),
    vscode.commands.registerCommand("miden-debug.nextLine", async () => {
      await vscode.commands.executeCommand("workbench.action.debug.stepOver");
    }),
    vscode.debug.onDidTerminateDebugSession((session) => {
      if (session.configuration.type === "miden") {
        configProvider.killServerProcess();
      }
    }),
    configProvider,
    stateProvider,
  );
}
