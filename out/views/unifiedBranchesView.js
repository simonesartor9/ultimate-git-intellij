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
exports.RepoItem = exports.UnifiedBranchItem = exports.BranchCategoryItem = exports.UnifiedBranchesViewProvider = void 0;
const vscode = __importStar(require("vscode"));
class UnifiedBranchesViewProvider {
    constructor(manager) {
        this.manager = manager;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.manager.onDidChangeUnifiedBranches(() => {
            this._onDidChangeTreeData.fire();
        });
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
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
    refresh() {
        this.manager.refresh();
    }
}
exports.UnifiedBranchesViewProvider = UnifiedBranchesViewProvider;
class BranchCategoryItem extends vscode.TreeItem {
    constructor(label, isRemote) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.label = label;
        this.isRemote = isRemote;
        this.contextValue = 'branchCategory';
        this.iconPath = new vscode.ThemeIcon(isRemote ? 'cloud' : 'device-desktop');
    }
}
exports.BranchCategoryItem = BranchCategoryItem;
class UnifiedBranchItem extends vscode.TreeItem {
    constructor(branch) {
        // Add star to label if starred using Unicode which renders correctly in tree views
        const label = branch.isStarred ? `★ ${branch.name}` : branch.name;
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.branch = branch;
        const repoNames = branch.repositories.map(r => r.rootPath.split(/[\\/]/).pop() || 'Unknown').join(', ');
        let status = '';
        if (branch.totalAhead > 0)
            status += ` ↑${branch.totalAhead}`;
        if (branch.totalBehind > 0)
            status += ` ↓${branch.totalBehind}`;
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
        }
        else if (branch.isStarred) {
            this.iconPath = new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'));
        }
        else {
            this.iconPath = new vscode.ThemeIcon('git-branch');
        }
        this.contextValue = 'unifiedBranch';
    }
}
exports.UnifiedBranchItem = UnifiedBranchItem;
class RepoItem extends vscode.TreeItem {
    constructor(repo, branch) {
        const repoName = repo.rootPath.split(/[\\/]/).pop() || 'Unknown';
        super(repoName, vscode.TreeItemCollapsibleState.None);
        this.repo = repo;
        this.branch = branch;
        const isCurrent = branch.isCurrentIn.some(r => r.rootPath === repo.rootPath);
        this.description = isCurrent ? '(current)' : '';
        this.iconPath = new vscode.ThemeIcon('repo');
        this.tooltip = repo.rootPath;
        this.contextValue = 'repoInBranch';
    }
}
exports.RepoItem = RepoItem;
//# sourceMappingURL=unifiedBranchesView.js.map