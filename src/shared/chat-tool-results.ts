export interface ToolResult {
  tool: string;
  fact?: string;
  quality?: string;
  success?: boolean;
  preview?: string;
  detail?: string;
  args?: Record<string, unknown>;
  status?: 'running' | 'done';
}
