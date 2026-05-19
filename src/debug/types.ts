/** A single frame within the bundled UI-state snapshot. */
export interface DapUiFrame {
  name: string;
  source_path: string | null;
  line: number;
  column: number;
}

/**
 * Bundled snapshot pushed by the Miden DAP server via the custom
 * `miden/uiState` event immediately before every `stopped` event.
 */
export interface DapUiState {
  cycle: number;
  current_stack: number[];
  callstack: DapUiFrame[];
}
