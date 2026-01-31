import * as vscode from 'vscode';
import { UnifiedBranchManager, UnifiedBranch } from '../core/unifiedBranchManager';
import { RepositoryState } from '../core/repoManager';

export class UnifiedBranchesViewProvider implements vscode.TreeDataProvider<UnifiedBranchItem | RepoItem | BranchCategoryItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<UnifiedBranchItem | RepoItem | BranchCategoryItem | undefined | null | void> = new vscode.EventEmitter<UnifiedBranchItem | RepoItem | BranchCategoryItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<UnifiedBranchItem | RepoItem | BranchCategoryItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private manager: UnifiedBranchManager) {
        this.manager.onDidChangeUnifiedBranches(() => {
            this._onDidChangeTreeData.fire();
        });
    }

    getTreeItem(element: UnifiedBranchItem | RepoItem | BranchCategoryItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: UnifiedBranchItem | RepoItem | BranchCategoryItem): Promise<(UnifiedBranchItem | RepoItem | BranchCategoryItem)[]> {
        if (!element) {
            return [
                new BranchCategoryItem('Local', false),
                new BranchCategoryItem('Remote', true)
            ];
        }
        if (element instanceof BranchCategoryItem) {
            return this.manager.unifiedBranches
                .filter(ub => ub.isRemote === element.isRemote)
                .map(ub => new UnifiedBranchItem(ub));
        }
        if (element instanceof UnifiedBranchItem) {
            return element.branch.repositories.map(r => new RepoItem(r, element.branch));
        }
        return [];
    }

    refresh(): void {
        this.manager.refresh();
    }
}

export class BranchCategoryItem extends vscode.TreeItem {
    constructor(public readonly label: string, public readonly isRemote: boolean) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'branchCategory';
        this.iconPath = new vscode.ThemeIcon(isRemote ? 'cloud' : 'device-desktop');
    }
}

export class UnifiedBranchItem extends vscode.TreeItem {
    constructor(public readonly branch: UnifiedBranch) {
        // Add star to label if starred using Unicode which renders correctly in tree views
        const label = branch.isStarred ? `★ ${branch.name}` : branch.name;
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        
        const repoNames = branch.repositories.map(r => r.rootPath.split(/[\\/]/).pop() || 'Unknown').join(', ');
        
        let status = '';
        if (branch.totalAhead > 0) status += ` ↑${branch.totalAhead}`;
        if (branch.totalBehind > 0) status += ` ↓${branch.totalBehind}`;
        
        this.description = `${status} (${repoNames})`;
        
        const tooltip = new vscode.MarkdownString('', true);
        tooltip.supportHtml = true;
        tooltip.isTrusted = true;
        
        tooltip.appendMarkdown(`### Branch: **${branch.name}**\n\n`);
        if (branch.totalAhead > 0) {
            tooltip.appendMarkdown(`- **Ahead**: <span style="color:#73c991;">${branch.totalAhead} commits to push</span>\n`);
        }
        if (branch.totalBehind > 0) {
            tooltip.appendMarkdown(`- **Behind**: <span style="color:#f14c4c;">${branch.totalBehind} commits to pull</span>\n`);
        }
        tooltip.appendMarkdown(`\n**Repositories:** ${repoNames}`);
        this.tooltip = tooltip;
        
        if (branch.isCurrentIn.length > 0) {
            this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
        } else if (branch.isStarred) {
            this.iconPath = new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'));
        } else {
            this.iconPath = new vscode.ThemeIcon('git-branch');
        }

        this.contextValue = 'unifiedBranch';
    }
}

export class RepoItem extends vscode.TreeItem {
    constructor(public readonly repo: RepositoryState, public readonly branch: UnifiedBranch) {
        const repoName = repo.rootPath.split(/[\\/]/).pop() || 'Unknown';
        super(repoName, vscode.TreeItemCollapsibleState.None);
        
        const isCurrent = branch.isCurrentIn.some(r => r.rootPath === repo.rootPath);
        this.description = isCurrent ? '(current)' : '';
        this.iconPath = new vscode.ThemeIcon('repo');
        this.tooltip = repo.rootPath;
        
        this.contextValue = 'repoInBranch';
    }
}
