import * as vscode from 'vscode';
import { RepositoryManager } from '../core/repoManager';

/**
 * Provides data for the "Repositories" tree view in the Side Bar.
 */
export class RepoTreeViewProvider implements vscode.TreeDataProvider<RepoItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<RepoItem | undefined | void> = new vscode.EventEmitter<RepoItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<RepoItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor(private repoManager: RepositoryManager) {
        // Refresh view when repos are updated (added/removed)
        this.repoManager.onDidUpdateRepos(() => this.refresh());
        
        // Refresh view when a specific repo state changes (branch checkout, dirty state)
        this.repoManager.onDidChangeRepoState(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: RepoItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: RepoItem): Thenable<RepoItem[]> {
        if (element) {
            return Promise.resolve([]); // No nested items yet
        } else {
            // Root level: show list of repositories
            return Promise.resolve(
                this.repoManager.repositories.map(state => new RepoItem(state))
            );
        }
    }
}

class RepoItem extends vscode.TreeItem {
    constructor(public readonly state: any) {
        const path = state.rootPath;
        const label = path.split(/[\\/]/).pop() || path;
        super(label, vscode.TreeItemCollapsibleState.None);
        
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
