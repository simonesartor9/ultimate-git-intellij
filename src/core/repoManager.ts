import * as vscode from 'vscode';
import { Disposable, EventEmitter, Event } from 'vscode';
import { GitService } from './git/gitService';
import { GitStatus } from './git/types';

export interface RepositoryState {
    rootPath: string;
    branch: string;
    isDirty: boolean;
    lastUpdate: number;
}

/**
 * Advanced manager for Git repositories.
 * Tracks multiple repos, monitors changes, and emits events.
 */
export class RepositoryManager implements Disposable {
    private _repositories = new Map<string, RepositoryState>();
    private _watchers = new Map<string, vscode.FileSystemWatcher>();
    private _disposables: Disposable[] = [];
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
            // 1. Check if the folder root itself is a git repo (most common case)
            const rootGit = vscode.Uri.joinPath(folder.uri, '.git');
            try {
                await vscode.workspace.fs.stat(rootGit);
                foundPaths.add(folder.uri.fsPath);
            } catch (e) {
                // Not a repo at root
            }

            // 2. Search for nested repositories (e.g. in a monorepo)
            // Note: findFiles often ignores .git due to default IDE excludes.
            // We use a manual directory walk or a broader search if needed.
            try {
                const entries = await vscode.workspace.fs.readDirectory(folder.uri);
                for (const [name, type] of entries) {
                    if (type === vscode.FileType.Directory && name !== '.git' && name !== 'node_modules') {
                        const subFolderGit = vscode.Uri.joinPath(folder.uri, name, '.git');
                        try {
                            await vscode.workspace.fs.stat(subFolderGit);
                            foundPaths.add(vscode.Uri.joinPath(folder.uri, name).fsPath);
                        } catch (e) {}
                    }
                }
            } catch (e) {
                console.error('Error scanning for nested repos', e);
            }
        }

        this.syncRepositories(Array.from(foundPaths));
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

        // Setup watcher for this repo (.git/HEAD and .git/index)
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(path, '.git/{HEAD,index,refs/heads/**}')
        );

        watcher.onDidChange(() => this.onRepoFileChanged(path));
        watcher.onDidCreate(() => this.onRepoFileChanged(path));
        watcher.onDidDelete(() => this.onRepoFileChanged(path));

        this._watchers.set(path, watcher);
        this._disposables.push(watcher);
    }

    private removeRepository(path: string) {
        const watcher = this._watchers.get(path);
        watcher?.dispose();
        this._watchers.delete(path);
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

    private async fetchRepositoryState(path: string): Promise<RepositoryState> {
        try {
            const status = await this._gitService.getStatus(path);
            return {
                rootPath: path,
                branch: status.branch,
                isDirty: status.modified.length > 0 || status.untracked.length > 0 || status.staged.length > 0,
                lastUpdate: Date.now()
            };
        } catch (e) {
            return {
                rootPath: path,
                branch: 'unknown',
                isDirty: false,
                lastUpdate: Date.now()
            };
        }
    }

    private hasStateChanged(oldState: RepositoryState | undefined, newState: RepositoryState): boolean {
        if (!oldState) return true;
        return oldState.branch !== newState.branch || oldState.isDirty !== newState.isDirty;
    }

    private updateRepos(states: RepositoryState[]) {
        this._onDidUpdateRepos.fire(states);
    }

    public get repositories(): RepositoryState[] {
        return Array.from(this._repositories.values());
    }

    public dispose() {
        this._disposables.forEach(d => d.dispose());
        this._watchers.forEach(w => w.dispose());
        this._onDidUpdateRepos.dispose();
        this._onDidChangeRepoState.dispose();
    }
}
