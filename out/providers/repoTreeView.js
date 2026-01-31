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
exports.RepoTreeViewProvider = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Provides data for the "Repositories" tree view in the Side Bar.
 */
class RepoTreeViewProvider {
    constructor(repoManager) {
        this.repoManager = repoManager;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        // Refresh view when repos are updated (added/removed)
        this.repoManager.onDidUpdateRepos(() => this.refresh());
        // Refresh view when a specific repo state changes (branch checkout, dirty state)
        this.repoManager.onDidChangeRepoState(() => this.refresh());
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element) {
            return Promise.resolve([]); // No nested items yet
        }
        else {
            // Root level: show list of repositories
            return Promise.resolve(this.repoManager.repositories.map(state => new RepoItem(state)));
        }
    }
}
exports.RepoTreeViewProvider = RepoTreeViewProvider;
class RepoItem extends vscode.TreeItem {
    constructor(state) {
        const path = state.rootPath;
        const label = path.split(/[\\/]/).pop() || path;
        super(label, vscode.TreeItemCollapsibleState.None);
        this.state = state;
        this.tooltip = `Path: ${path}\nBranch: ${state.branch}\nStatus: ${state.isDirty ? 'Dirty' : 'Clean'}`;
        this.description = `${state.branch}${state.isDirty ? '*' : ''}`;
        // Dynamic icons based on status
        this.iconPath = state.isDirty
            ? new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'))
            : new vscode.ThemeIcon('source-control');
        // Context value for menu targeting
        this.contextValue = 'repository';
        // Default command when clicking the item
        this.command = {
            command: 'git-intellij.repo.checkout',
            title: 'Checkout...',
            arguments: [state]
        };
    }
}
//# sourceMappingURL=repoTreeView.js.map