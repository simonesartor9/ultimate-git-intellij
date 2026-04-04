export type WorkingTreeDisplayKind =
    | 'modified'
    | 'added'
    | 'deleted'
    | 'untracked'
    | 'renamed'
    | 'conflict';

export interface WorkingTreeFile {
    /** Path relative to repository root (as reported by Git). */
    path: string;
    displayKind: WorkingTreeDisplayKind;
    staged: boolean;
    hasUnstaged: boolean;
}

export interface GitStatus {
    branch: string;
    detached: boolean;
    files: WorkingTreeFile[];
    hasConflicts: boolean;
}

export interface GitCommit {
    hash: string;
    author: string;
    date: string;
    message: string;
    parentHashes: string[];
}

export interface GitBranch {
    name: string;
    isCurrent: boolean;
    isRemote: boolean;
    remote?: string;
    ahead?: number;
    behind?: number;
}

export interface GitError {
    message: string;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
}

export interface GitOptions {
    cwd: string;
    env?: NodeJS.ProcessEnv;
}
