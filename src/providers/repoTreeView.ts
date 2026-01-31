import * as vscode from 'vscode';
import { RepositoryManager } from '../core/repoManager';

/**
 * Provides data for the "Repositories" tree view in the Side Bar.
 */
export class RepoTreeViewProvider implements vscode.TreeDataProvider<RepoItem | FileChangeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<RepoItem | FileChangeItem | undefined | void> = new vscode.EventEmitter<RepoItem | FileChangeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<RepoItem | FileChangeItem | undefined | void> = this._onDidChangeTreeData.event;

    constructor(private repoManager: RepositoryManager) {
        // Refresh view when repos are updated (added/removed)
        this.repoManager.onDidUpdateRepos(() => this.refresh());
        
        // Refresh view when a specific repo state changes (branch checkout, dirty state)
        this.repoManager.onDidChangeRepoState(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: RepoItem | FileChangeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: RepoItem | FileChangeItem): Thenable<(RepoItem | FileChangeItem)[]> {
        if (element instanceof RepoItem) {
            // If repo has changes, show them as children
            if (element.state.localChanges && element.state.localChanges.length > 0) {
                return Promise.resolve(
                    element.state.localChanges.map((file: string) => new FileChangeItem(file, element.state.rootPath))
                );
            }
            return Promise.resolve([]);
        } else if (element instanceof FileChangeItem) {
            return Promise.resolve([]);
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
        const hasChanges = state.localChanges && state.localChanges.length > 0;
        
        // Collapsible if has changes
        super(label, hasChanges ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        
        this.tooltip = `Path: ${path}\nBranch: ${state.branch}\nChanges: ${state.localChanges?.length || 0}`;
        this.description = `${state.branch} ${hasChanges ? `(${state.localChanges.length})` : ''}`;
        
        // Dynamic icons based on status
        this.iconPath = state.isDirty 
            ? new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'))
            : new vscode.ThemeIcon('source-control');

        // Context value for menu targeting
        this.contextValue = 'repository';
    }
}

export class FileChangeItem extends vscode.TreeItem {
    constructor(public readonly fileName: string, public readonly rootPath: string) {
        super(fileName, vscode.TreeItemCollapsibleState.None);
        
        this.description = 'Modified';
        this.tooltip = fileName;
        this.contextValue = 'fileChange';
        this.resourceUri = vscode.Uri.file(`${rootPath}/${fileName}`); // Use proper URI for file icon
        
        // Command to diff file on click
        this.command = {
            command: 'vscode.diff',
            title: 'Open Diff',
            arguments: [
                vscode.Uri.parse(`git-intellij-revision:${fileName}?revision=HEAD&rootPath=${rootPath}`),
                vscode.Uri.file(`${rootPath}/${fileName}`),
                `${fileName} (HEAD ↔ Local)`
            ]
        };
    }
}
