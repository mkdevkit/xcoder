export interface WorkspaceSearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
  matchStart: number;
  matchEnd: number;
}

export interface WorkspaceSearchResult {
  matches: WorkspaceSearchMatch[];
  fileCount: number;
  matchCount: number;
  truncated: boolean;
}

export interface WorkspaceReplaceResult {
  filesChanged: number;
  replacements: number;
}
