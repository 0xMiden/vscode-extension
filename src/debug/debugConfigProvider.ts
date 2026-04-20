import * as vscode from "vscode";
import { ChildProcess, spawn } from "child_process";
import * as net from "net";

/**
 * Resolves and validates Miden debug configurations.
 *
 * - **attach**: validates host/port, user must start the DAP server manually.
 * - **launch**: spawns `miden-client exec --start-debug-adapter` and waits
 *   for the TCP server to accept connections before handing off to VS Code.
 */
export class MidenDebugConfigProvider
  implements vscode.DebugConfigurationProvider, vscode.Disposable
{
  private serverProcess: ChildProcess | undefined;
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("Miden Debug");
  }

  async resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    config: vscode.DebugConfiguration,
    _token?: vscode.CancellationToken,
  ): Promise<vscode.DebugConfiguration | undefined> {
    // If the user hit F5 with no launch.json, provide a default attach config.
    if (!config.type && !config.request) {
      config.type = "miden";
      config.request = "attach";
      config.name = "Attach to Miden DAP";
    }

    config.host = config.host || "127.0.0.1";
    config.port = config.port || 4711;

    if (config.request === "launch") {
      return this.handleLaunch(config, folder);
    }

    return config;
  }

  private async handleLaunch(
    config: vscode.DebugConfiguration,
    folder: vscode.WorkspaceFolder | undefined,
  ): Promise<vscode.DebugConfiguration | undefined> {
    const scriptPath: string | undefined = config.scriptPath;
    if (!scriptPath) {
      vscode.window.showErrorMessage(
        "Miden Debug: 'scriptPath' is required for launch mode.",
      );
      return undefined;
    }

    const midenClient: string = config.midenClientPath || "miden-client";
    const addr = `${config.host}:${config.port}`;
    const cwd: string = config.cwd || folder?.uri.fsPath || process.cwd();

    const args = [
      "exec",
      "--script-path",
      scriptPath,
      "--start-debug-adapter",
      addr,
    ];

    if (config.accountId) {
      args.push("--account", config.accountId);
    }

    this.outputChannel.appendLine(
      `Launching: ${midenClient} ${args.join(" ")}`,
    );
    this.outputChannel.appendLine(`Working directory: ${cwd}`);

    // Kill any previous server process.
    this.killServerProcess();

    this.serverProcess = spawn(midenClient, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.serverProcess.stdout?.on("data", (data: Buffer) => {
      this.outputChannel.append(data.toString());
    });

    this.serverProcess.stderr?.on("data", (data: Buffer) => {
      this.outputChannel.append(data.toString());
    });

    this.serverProcess.on("exit", (code) => {
      this.outputChannel.appendLine(`miden-client exited with code ${code}`);
      this.serverProcess = undefined;
    });

    // Wait for the DAP server to start accepting connections.
    try {
      await this.waitForServer(config.host, config.port);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Miden Debug: failed to connect to DAP server at ${addr}. ` +
          `Make sure the working directory is an initialized miden-client directory. ` +
          `Error: ${err}`,
      );
      this.killServerProcess();
      return undefined;
    }

    return config;
  }

  /**
   * Poll TCP until the DAP server accepts a connection.
   * Exponential backoff: 100ms, 200ms, 400ms, ... up to 15s total.
   */
  private waitForServer(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const timeout = 15_000;
      let delay = 100;

      const tryConnect = () => {
        // If the server process died, stop trying.
        if (this.serverProcess && this.serverProcess.exitCode !== null) {
          reject(
            new Error(
              `miden-client exited with code ${this.serverProcess.exitCode} before DAP server was ready`,
            ),
          );
          return;
        }

        const socket = new net.Socket();
        socket.setTimeout(1000);

        socket.on("connect", () => {
          socket.destroy();
          resolve();
        });

        socket.on("error", () => {
          socket.destroy();
          if (Date.now() - startTime > timeout) {
            reject(new Error(`timed out after ${timeout / 1000}s`));
          } else {
            delay = Math.min(delay * 2, 2000);
            setTimeout(tryConnect, delay);
          }
        });

        socket.on("timeout", () => {
          socket.destroy();
          if (Date.now() - startTime > timeout) {
            reject(new Error(`timed out after ${timeout / 1000}s`));
          } else {
            delay = Math.min(delay * 2, 2000);
            setTimeout(tryConnect, delay);
          }
        });

        socket.connect(port, host);
      };

      tryConnect();
    });
  }

  killServerProcess(): void {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = undefined;
    }
  }

  dispose(): void {
    this.killServerProcess();
    this.outputChannel.dispose();
  }
}
