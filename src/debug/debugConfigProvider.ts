import * as vscode from "vscode";
import { ChildProcess, spawn } from "child_process";
import * as net from "net";
import * as path from "path";

/**
 * Resolves and validates Miden debug configurations.
 *
 * - **attach**: validates host/port, user must start the DAP server manually.
 * - **launch**: spawns either `miden-client exec --start-debug-adapter`
 *   for transaction scripts or `miden-debug --start-debug-adapter` for
 *   standalone programs, then waits for the adapter readiness message.
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
    if (!(await this.prepareLaunchPort(config))) {
      return undefined;
    }

    const runtime = this.resolveRuntime(config);
    if (runtime === "debugger") {
      return this.handleDebuggerLaunch(config, folder);
    }

    return this.handleClientLaunch(config, folder);
  }

  private async prepareLaunchPort(config: vscode.DebugConfiguration): Promise<boolean> {
    const host = config.host || "127.0.0.1";
    const requestedPort = Number(config.port || 4711);
    const preferred = await this.tryListen(host, requestedPort);
    if (preferred.ok) {
      config.port = requestedPort;
      return true;
    }

    const fallback = await this.tryListen(host, 0);
    if (!fallback.ok || !fallback.port) {
      vscode.window.showErrorMessage(
        `Miden Debug: could not allocate a local DAP port on ${host}. ` +
          `Port ${requestedPort} failed: ${preferred.error?.message ?? "unknown error"}`,
      );
      return false;
    }

    this.outputChannel.appendLine(
      `Port ${requestedPort} is unavailable for launch; using ${fallback.port}.`,
    );
    config.port = fallback.port;
    return true;
  }

  private tryListen(
    host: string,
    port: number,
  ): Promise<{ ok: true; port: number } | { ok: false; error: Error }> {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once("error", (error: Error) => {
        resolve({ ok: false, error });
      });

      server.listen({ host, port, exclusive: true }, () => {
        const address = server.address();
        const actualPort =
          typeof address === "object" && address ? address.port : port;
        server.close(() => resolve({ ok: true, port: actualPort }));
      });
    });
  }

  private resolveRuntime(config: vscode.DebugConfiguration): "client" | "debugger" {
    if (config.runtime === "debugger" || config.runtime === "miden-debug") {
      return "debugger";
    }
    if (config.programPath) {
      return "debugger";
    }
    if (config.runtime === "client" || config.runtime === "miden-client") {
      return "client";
    }
    return "client";
  }

  private async handleClientLaunch(
    config: vscode.DebugConfiguration,
    folder: vscode.WorkspaceFolder | undefined,
  ): Promise<vscode.DebugConfiguration | undefined> {
    const scriptPath = this.resolveString(config.scriptPath, folder);
    if (!scriptPath) {
      vscode.window.showErrorMessage(
        "Miden Debug: 'scriptPath' is required for launch mode.",
      );
      return undefined;
    }

    const midenClient = this.resolveString(config.midenClientPath, folder) || "miden-client";
    const addr = `${config.host}:${config.port}`;
    const cwd = this.resolveString(config.cwd, folder) || folder?.uri.fsPath || process.cwd();

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

    return this.startAdapterProcess(
      config,
      "miden-client",
      midenClient,
      args,
      cwd,
      `Make sure the working directory is an initialized miden-client directory.`,
    );
  }

  private async handleDebuggerLaunch(
    config: vscode.DebugConfiguration,
    folder: vscode.WorkspaceFolder | undefined,
  ): Promise<vscode.DebugConfiguration | undefined> {
    const programPath = this.resolveString(config.programPath || config.scriptPath, folder);
    if (!programPath) {
      vscode.window.showErrorMessage(
        "Miden Debug: 'programPath' is required for debugger launch mode.",
      );
      return undefined;
    }

    const midenDebug = this.resolveString(config.midenDebugPath, folder) || "miden-debug";
    const addr = `${config.host}:${config.port}`;
    const cwd = this.resolveString(config.cwd, folder) || folder?.uri.fsPath || process.cwd();
    const sourcePathPrefixes = this.resolveSourcePathPrefixes(
      config,
      folder,
      programPath,
      cwd,
    );

    const args = ["--start-debug-adapter", addr];
    this.pushOptionalArg(args, "--working-dir", cwd);
    this.pushOptionalArg(args, "--inputs", this.resolveString(config.inputsPath, folder));
    this.pushOptionalArg(args, "--entrypoint", config.entrypoint);
    this.pushOptionalArg(args, "--sysroot", this.resolveString(config.sysroot, folder));

    for (const searchPath of this.stringArray(config.searchPath, folder)) {
      args.push("--search-path", searchPath);
    }
    for (const linkLibrary of this.stringArray(config.linkLibraries, folder)) {
      args.push("--link-library", linkLibrary);
    }
    for (const prefix of sourcePathPrefixes) {
      args.push("--source-path-prefix", prefix);
    }

    args.push(programPath);

    const programArgs = this.stringArray(config.programArgs, folder);
    if (programArgs.length > 0) {
      args.push("--", ...programArgs);
    }

    return this.startAdapterProcess(
      config,
      "miden-debug",
      midenDebug,
      args,
      cwd,
      `Make sure 'programPath' points at a .masm source file or compiled .masp package.`,
    );
  }

  private async startAdapterProcess(
    config: vscode.DebugConfiguration,
    processName: string,
    command: string,
    args: string[],
    cwd: string,
    notReadyHint: string,
  ): Promise<vscode.DebugConfiguration | undefined> {
    const addr = `${config.host}:${config.port}`;
    this.outputChannel.appendLine(
      `Launching: ${command} ${args.join(" ")}`,
    );
    this.outputChannel.appendLine(`Working directory: ${cwd}`);

    // Kill any previous server process.
    this.killServerProcess();

    let readyOutputSeen = false;
    let startError: Error | undefined;
    this.serverProcess = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.serverProcess.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      readyOutputSeen ||= this.isReadyOutput(text);
      this.outputChannel.append(text);
    });

    this.serverProcess.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      readyOutputSeen ||= this.isReadyOutput(text);
      this.outputChannel.append(text);
    });

    this.serverProcess.on("exit", (code) => {
      this.outputChannel.appendLine(`${processName} exited with code ${code}`);
      this.serverProcess = undefined;
    });

    this.serverProcess.on("error", (err: Error) => {
      startError = err;
      this.outputChannel.appendLine(`${processName} failed to start: ${err.message}`);
    });

    // Wait for the DAP server to announce readiness. Opening a probe TCP
    // connection would consume the single DAP connection accepted by the server.
    try {
      await this.waitForServerReady(processName, () => readyOutputSeen, () => startError);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Miden Debug: failed to start DAP server at ${addr}. ` +
          `${notReadyHint} ` +
          `Error: ${err}`,
      );
      this.killServerProcess();
      return undefined;
    }

    return config;
  }

  private isReadyOutput(text: string): boolean {
    return text.includes("DAP server listening");
  }

  private waitForServerReady(
    processName: string,
    isAlreadyReady: () => boolean,
    getStartError: () => Error | undefined,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = this.serverProcess;
      if (!process) {
        reject(new Error(`${processName} did not start`));
        return;
      }

      const startError = getStartError();
      if (startError) {
        reject(new Error(`${processName} failed to start: ${startError.message}`));
        return;
      }

      if (process.exitCode !== null) {
        reject(
          new Error(
            `${processName} exited before DAP server was ready (code ${process.exitCode})`,
          ),
        );
        return;
      }

      if (isAlreadyReady()) {
        resolve();
        return;
      }

      const timeout = 15_000;
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;

      const cleanup = () => {
        clearTimeout(timer);
        process.stdout?.removeListener("data", onData);
        process.stderr?.removeListener("data", onData);
        process.removeListener("exit", onExit);
        process.removeListener("error", onError);
      };

      const finish = (err?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      };

      const onData = (data: Buffer) => {
        if (this.isReadyOutput(data.toString())) {
          finish();
        }
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        finish(
          new Error(
            `${processName} exited before DAP server was ready (code ${code}, signal ${signal})`,
          ),
        );
      };

      const onError = (err: Error) => {
        finish(new Error(`${processName} failed to start: ${err.message}`));
      };

      process.stdout?.on("data", onData);
      process.stderr?.on("data", onData);
      process.once("exit", onExit);
      process.once("error", onError);

      timer = setTimeout(() => {
        finish(new Error(`timed out after ${timeout / 1000}s`));
      }, timeout);
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

  private pushOptionalArg(args: string[], flag: string, value: unknown): void {
    if (typeof value === "string" && value.length > 0) {
      args.push(flag, value);
    }
  }

  private resolveString(
    value: unknown,
    folder: vscode.WorkspaceFolder | undefined,
  ): string | undefined {
    if (typeof value !== "string" || value.length === 0) {
      return undefined;
    }

    const workspaceFolder = folder?.uri.fsPath;
    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;

    return value.replace(/\$\{workspaceFolder\}/g, workspaceFolder || "")
      .replace(/\$\{file\}/g, activeFile || "");
  }

  private stringArray(
    value: unknown,
    folder: vscode.WorkspaceFolder | undefined,
  ): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((item): item is string | number | boolean =>
        ["string", "number", "boolean"].includes(typeof item),
      )
      .map((item) => this.resolveString(String(item), folder) || String(item));
  }

  private resolveSourcePathPrefixes(
    config: vscode.DebugConfiguration,
    folder: vscode.WorkspaceFolder | undefined,
    programPath: string,
    cwd: string,
  ): string[] {
    const prefixes = new Set<string>();
    const addPrefix = (value: unknown) => {
      if (typeof value !== "string" || value.length === 0) {
        return;
      }

      const resolved = this.resolveString(value, folder) || value;
      const absolute = path.isAbsolute(resolved)
        ? resolved
        : path.resolve(cwd, resolved);
      prefixes.add(path.normalize(absolute));
    };

    addPrefix(config.sourcePathPrefix);
    addPrefix(config.trimPathPrefix);
    for (const prefix of this.stringArray(config.sourcePathPrefixes, folder)) {
      addPrefix(prefix);
    }
    for (const prefix of this.stringArray(config.trimPathPrefixes, folder)) {
      addPrefix(prefix);
    }

    for (const prefix of this.extractTrimPathPrefixes(config, folder)) {
      addPrefix(prefix);
    }

    const inferredPackageRoot = this.inferCargoMidenPackageRoot(programPath);
    if (inferredPackageRoot) {
      addPrefix(inferredPackageRoot);
    }

    return [...prefixes];
  }

  private extractTrimPathPrefixes(
    config: vscode.DebugConfiguration,
    folder: vscode.WorkspaceFolder | undefined,
  ): string[] {
    const rawArgs = [
      ...this.argList(config.compilerArgs, folder),
      ...this.argList(config.midencArgs, folder),
      ...this.argList(config.buildArgs, folder),
      ...this.argList(config.cargoMidenArgs, folder),
    ];
    const prefixes: string[] = [];

    for (let i = 0; i < rawArgs.length; i++) {
      const arg = rawArgs[i];
      if (arg === "-Z") {
        const next = rawArgs[i + 1];
        const value = next?.startsWith("trim-path-prefix=")
          ? next.slice("trim-path-prefix=".length)
          : undefined;
        if (value) {
          prefixes.push(value);
          i++;
        }
        continue;
      }

      const zPrefix = "-Ztrim-path-prefix=";
      if (arg.startsWith(zPrefix)) {
        prefixes.push(arg.slice(zPrefix.length));
        continue;
      }

      for (const flag of ["--trim-path-prefix", "--source-path-prefix"]) {
        if (arg === flag && rawArgs[i + 1]) {
          prefixes.push(rawArgs[i + 1]);
          i++;
          break;
        }
        if (arg.startsWith(`${flag}=`)) {
          prefixes.push(arg.slice(flag.length + 1));
          break;
        }
      }
    }

    return prefixes;
  }

  private argList(
    value: unknown,
    folder: vscode.WorkspaceFolder | undefined,
  ): string[] {
    if (Array.isArray(value)) {
      return this.stringArray(value, folder);
    }
    if (typeof value === "string") {
      const resolved = this.resolveString(value, folder) || value;
      return this.splitArg(resolved);
    }
    return [];
  }

  private splitArg(value: string): string[] {
    return value.split(/\s+/).filter((part) => part.length > 0);
  }

  private inferCargoMidenPackageRoot(programPath: string): string | undefined {
    const normalized = path.normalize(programPath);
    const marker = `${path.sep}target${path.sep}miden${path.sep}`;
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex <= 0) {
      return undefined;
    }
    return normalized.slice(0, markerIndex);
  }
}
