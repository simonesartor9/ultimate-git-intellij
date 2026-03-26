import * as vscode from 'vscode';
import { Disposable, EventEmitter, Event } from 'vscode';
import { GitService } from './git/gitService';
import { GitStatus } from './git/types';

export interface RepositoryState {
    rootPath: string;
    branch: string;
    isDirty: boolean;
    localChanges: string[]; // List of file paths
    lastUpdate: number;
}
/**
 * Advanced manager for Git repositories.
 * Tracks multiple repos, monitors changes, and emits events.
 */
export class RepositoryManager implements Disposable {
    private _repositories = new Map<string, RepositoryState>();
    private _watchers = new Map<string, vscode.FileSystemWatcher[]>();
    private _disposables: Disposable[] = [];
    private _refreshTimers = new Map<string, NodeJS.Timeout>();
    private _gitService = new GitService();

    // Events
    private _onDidUpdateRepos = new EventEmitter<RepositoryState[]>();
    public readonly onDidUpdateRepos: Event<RepositoryState[]> = this._onDidUpdateRepos.event;

    private _onDidChangeRepoState = new EventEmitter<RepositoryState>();
    public readonly onDidChangeRepoState: Event<RepositoryState> = this._onDidChangeRepoState.event;

    constructor() {
        // Initial scan
        this.scanWorkspace();

        // Listen for workspace folder changes
        this._disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.scanWorkspace())
        );
    }

    /**
     * Scans the workspace for Git repositories, including nested ones.
     */
    public async scanWorkspace() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) {
            this.syncRepositories([]);
            return;
        }

        const foundPaths = new Set<string>();

        for (const folder of folders) {
            const repoPaths = await this.collectGitReposInFolder(folder.uri);
            for (const repoPath of repoPaths) {
                foundPaths.add(repoPath);
            }
        }

        this.syncRepositories(Array.from(foundPaths));
    }

    private async collectGitReposInFolder(root: vscode.Uri): Promise<string[]> {
        const repos: string[] = [];
        const toVisit: vscode.Uri[] = [root];
        const ignoredDirs = new Set([
            '.git',
            'node_modules',
            '.next',
            '.nuxt',
            'dist',
            'build',
            'out',
            '.turbo'
        ]);

        while (toVisit.length > 0) {
            const current = toVisit.pop()!;

            const gitPath = vscode.Uri.joinPath(current, '.git');
            try {
                await vscode.workspace.fs.stat(gitPath);
                repos.push(current.fsPath);
                // Repository root found: keep scanning nested dirs as well to support
                // structures with multiple repos inside the same tree.
            } catch (e) {
                // Not a repository root, continue traversal.
            }

            let entries: [string, vscode.FileType][];
            try {
                entries = await vscode.workspace.fs.readDirectory(current);
            } catch (e) {
                continue;
            }

            for (const [name, type] of entries) {
                if (type !== vscode.FileType.Directory) {
                    continue;
                }
                if (ignoredDirs.has(name)) {
                    continue;
                }
                toVisit.push(vscode.Uri.joinPath(current, name));
            }
        }

        return repos;
    }

    private async syncRepositories(paths: string[]) {
        // Remove no longer existing repos
        for (const path of this._repositories.keys()) {
            if (!paths.includes(path)) {
                this.removeRepository(path);
            }
        }

        // Add new repos
        for (const path of paths) {
            if (!this._repositories.has(path)) {
                await this.addRepository(path);
            }
        }

        this._onDidUpdateRepos.fire(Array.from(this._repositories.values()));
    }

    private async addRepository(path: string) {
        // Setup state
        const state = await this.fetchRepositoryState(path);
        this._repositories.set(path, state);

        // Watch git internals (branch switches, staging, etc.)
        const gitWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(path, '.git/{HEAD,index,refs/heads/**}')
        );
        gitWatcher.onDidChange(() => this.scheduleRepoRefresh(path));
        gitWatcher.onDidCreate(() => this.scheduleRepoRefresh(path));
        gitWatcher.onDidDelete(() => this.scheduleRepoRefresh(path));

        // Watch working tree files so unsaved/staged/unstaged file-list updates are reflected.
        const worktreeWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(path, '**/*')
        );
        worktreeWatcher.onDidChange((uri) => this.onWorktreeFileChanged(path, uri));
        worktreeWatcher.onDidCreate((uri) => this.onWorktreeFileChanged(path, uri));
        worktreeWatcher.onDidDelete((uri) => this.onWorktreeFileChanged(path, uri));

        this._watchers.set(path, [gitWatcher, worktreeWatcher]);
        this._disposables.push(gitWatcher, worktreeWatcher);
    }

    private removeRepository(path: string) {
        const watchers = this._watchers.get(path);
        watchers?.forEach(w => w.dispose());
        this._watchers.delete(path);
        const timer = this._refreshTimers.get(path);
        if (timer) {
            clearTimeout(timer);
            this._refreshTimers.delete(path);
        }
        this._repositories.delete(path);
    }

    public async refreshAllStates() {
        const promises = Array.from(this._repositories.keys()).map(path => this.onRepoFileChanged(path));
        await Promise.all(promises);
    }

    private async onRepoFileChanged(path: string) {
        // Throttle or debounce could be added here
        const newState = await this.fetchRepositoryState(path);
        const oldState = this._repositories.get(path);

        if (this.hasStateChanged(oldState, newState)) {
            this._repositories.set(path, newState);
            this._onDidChangeRepoState.fire(newState);
        }
    }

    private onWorktreeFileChanged(repoPath: string, uri: vscode.Uri) {
        // Ignore internal git folder changes here (already covered by gitWatcher)
        if (uri.fsPath.includes(`${repoPath}/.git/`) || uri.fsPath.endsWith('/.git')) {
            return;
        }
        this.scheduleRepoRefresh(repoPath);
    }

    private scheduleRepoRefresh(path: string) {
        const existing = this._refreshTimers.get(path);
        if (existing) {
            clearTimeout(existing);
        }
        const timer = setTimeout(() => {
            this._refreshTimers.delete(path);
            void this.onRepoFileChanged(path);
        }, 250);
        this._refreshTimers.set(path, timer);
    }
    private async fetchRepositoryState(path: string): Promise<RepositoryState> {
        try {
            const status = await this._gitService.getStatus(path);
            const allChanges = [...status.modified, ...status.untracked, ...status.staged];
            return {
                rootPath: path,
                branch: status.branch,
                isDirty: allChanges.length > 0,
                localChanges: allChanges,
                lastUpdate: Date.now()
            };
        } catch (e) {
            return {
                rootPath: path,
                branch: 'unknown',
                isDirty: false,
                localChanges: [],
                lastUpdate: Date.now()
            };
        }
    }

    private hasStateChanged(oldState: RepositoryState | undefined, newState: RepositoryState): boolean {
        if (!oldState) return true;
        if (oldState.branch !== newState.branch || oldState.isDirty !== newState.isDirty) {
            return true;
        }

        if (oldState.localChanges.length !== newState.localChanges.length) {
            return true;
        }

        const oldChanges = [...oldState.localChanges].sort();
        const newChanges = [...newState.localChanges].sort();
        for (let i = 0; i < oldChanges.length; i++) {
            if (oldChanges[i] !== newChanges[i]) {
                return true;
            }
        }

        return false;
    }

    private updateRepos(states: RepositoryState[]) {
        this._onDidUpdateRepos.fire(states);
    }

    public get repositories(): RepositoryState[] {
        return Array.from(this._repositories.values());
    }

    public dispose() {
        this._disposables.forEach(d => d.dispose());
        this._watchers.forEach(watchers => watchers.forEach(w => w.dispose()));
        this._refreshTimers.forEach(timer => clearTimeout(timer));
        this._refreshTimers.clear();
        this._onDidUpdateRepos.dispose();
        this._onDidChangeRepoState.dispose();
    }
}
