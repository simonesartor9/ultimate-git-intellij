export interface GitStatus {
    branch: string;
    detached: boolean;
    modified: string[];
    untracked: string[];
    staged: string[];
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
