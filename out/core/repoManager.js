"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RepositoryManager = void 0;
const vscode = __importStar(require("vscode"));
const vscode_1 = require("vscode");
const gitService_1 = require("./git/gitService");
/**
 * Advanced manager for Git repositories.
 * Tracks multiple repos, monitors changes, and emits events.
 */
class RepositoryManager {
    constructor() {
        this._repositories = new Map();
        this._watchers = new Map();
        this._disposables = [];
        this._gitService = new gitService_1.GitService();
        // Events
        this._onDidUpdateRepos = new vscode_1.EventEmitter();
        this.onDidUpdateRepos = this._onDidUpdateRepos.event;
        this._onDidChangeRepoState = new vscode_1.EventEmitter();
        this.onDidChangeRepoState = this._onDidChangeRepoState.event;
        // Initial scan
        this.scanWorkspace();
        // Listen for workspace folder changes
        this._disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => this.scanWorkspace()));
    }
    /**
     * Scans the workspace for Git repositories, including nested ones.
     */
    async scanWorkspace() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) {
            this.syncRepositories([]);
            return;
        }
        const foundPaths = new Set();
        for (const folder of folders) {
            // 1. Check if the folder root itself is a git repo (most common case)
            const rootGit = vscode.Uri.joinPath(folder.uri, '.git');
            try {
                await vscode.workspace.fs.stat(rootGit);
                foundPaths.add(folder.uri.fsPath);
            }
            catch (e) {
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
                        }
                        catch (e) { }
                    }
                }
            }
            catch (e) {
                console.error('Error scanning for nested repos', e);
            }
        }
        this.syncRepositories(Array.from(foundPaths));
    }
    async syncRepositories(paths) {
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
    async addRepository(path) {
        // Setup state
        const state = await this.fetchRepositoryState(path);
        this._repositories.set(path, state);
        // Setup watcher for this repo (.git/HEAD and .git/index)
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path, '.git/{HEAD,index,refs/heads/**}'));
        watcher.onDidChange(() => this.onRepoFileChanged(path));
        watcher.onDidCreate(() => this.onRepoFileChanged(path));
        watcher.onDidDelete(() => this.onRepoFileChanged(path));
        this._watchers.set(path, watcher);
        this._disposables.push(watcher);
    }
    removeRepository(path) {
        const watcher = this._watchers.get(path);
        watcher?.dispose();
        this._watchers.delete(path);
        this._repositories.delete(path);
    }
    async refreshAllStates() {
        const promises = Array.from(this._repositories.keys()).map(path => this.onRepoFileChanged(path));
        await Promise.all(promises);
    }
    async onRepoFileChanged(path) {
        // Throttle or debounce could be added here
        const newState = await this.fetchRepositoryState(path);
        const oldState = this._repositories.get(path);
        if (this.hasStateChanged(oldState, newState)) {
            this._repositories.set(path, newState);
            this._onDidChangeRepoState.fire(newState);
        }
    }
    async fetchRepositoryState(path) {
        try {
            const status = await this._gitService.getStatus(path);
            return {
                rootPath: path,
                branch: status.branch,
                isDirty: status.modified.length > 0 || status.untracked.length > 0 || status.staged.length > 0,
                lastUpdate: Date.now()
            };
        }
        catch (e) {
            return {
                rootPath: path,
                branch: 'unknown',
                isDirty: false,
                lastUpdate: Date.now()
            };
        }
    }
    hasStateChanged(oldState, newState) {
        if (!oldState)
            return true;
        return oldState.branch !== newState.branch || oldState.isDirty !== newState.isDirty;
    }
    updateRepos(states) {
        this._onDidUpdateRepos.fire(states);
    }
    get repositories() {
        return Array.from(this._repositories.values());
    }
    dispose() {
        this._disposables.forEach(d => d.dispose());
        this._watchers.forEach(w => w.dispose());
        this._onDidUpdateRepos.dispose();
        this._onDidChangeRepoState.dispose();
    }
}
exports.RepositoryManager = RepositoryManager;
//# sourceMappingURL=repoManager.js.map