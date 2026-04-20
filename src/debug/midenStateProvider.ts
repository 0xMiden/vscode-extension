import * as vscode from "vscode";
import { DapUiState } from "./types";

type TreeCategory =
  | "root"
  | "cycle"
  | "stack"
  | "stack-item"
  | "callstack"
  | "frame";

class MidenTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    value: string,
    public readonly category: TreeCategory,
    collapsible: boolean = false,
  ) {
    super(
      label,
      collapsible
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );

    if (value) {
      this.description = value;
    }

    // Allow clicking on frames to navigate to source.
    if (category === "frame") {
      this.contextValue = "midenFrame";
    }
  }
}

/**
 * TreeDataProvider that displays Miden VM state from the custom
 * `miden/uiState` DAP event.
 *
 * Tree structure:
 *   Cycle: 42
 *   > Operand Stack
 *       [0]  7
 *       [1]  3
 *       ...
 *   > Call Stack
 *       increment  script.masm:21
 *       main       script.masm:7
 */
export class MidenStateProvider
  implements vscode.TreeDataProvider<MidenTreeItem>, vscode.Disposable
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    MidenTreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private state: DapUiState | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    // Capture the custom miden/uiState event pushed before each stopped event.
    this.disposables.push(
      vscode.debug.onDidReceiveDebugSessionCustomEvent((e) => {
        if (
          e.session.configuration.type === "miden" &&
          e.event === "miden/uiState"
        ) {
          this.state = e.body as DapUiState;
          this._onDidChangeTreeData.fire();
        }
      }),
    );

    // Clear state when the debug session ends.
    this.disposables.push(
      vscode.debug.onDidTerminateDebugSession((session) => {
        if (session.configuration.type === "miden") {
          this.state = undefined;
          this._onDidChangeTreeData.fire();
        }
      }),
    );
  }

  getTreeItem(element: MidenTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: MidenTreeItem): MidenTreeItem[] {
    if (!this.state) {
      return [];
    }

    // Root level: Cycle, Operand Stack, Call Stack.
    if (!element) {
      return [
        new MidenTreeItem("Cycle", `${this.state.cycle}`, "cycle"),
        new MidenTreeItem(
          "Operand Stack",
          `(${this.state.current_stack.length})`,
          "stack",
          true,
        ),
        new MidenTreeItem(
          "Call Stack",
          `(${this.state.callstack.length})`,
          "callstack",
          true,
        ),
      ];
    }

    // Operand Stack children.
    if (element.category === "stack") {
      return this.state.current_stack.map(
        (val, i) => new MidenTreeItem(`[${i}]`, `${val}`, "stack-item"),
      );
    }

    // Call Stack children.
    if (element.category === "callstack") {
      return this.state.callstack.map((frame) => {
        const location = frame.source_path
          ? `${frame.source_path}:${frame.line}`
          : "";
        return new MidenTreeItem(frame.name, location, "frame");
      });
    }

    return [];
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
