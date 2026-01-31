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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const repoManager_1 = require("./core/repoManager");
const repoTreeView_1 = require("./providers/repoTreeView");
const gitService_1 = require("./core/git/gitService");
const multiRepoService_1 = require("./core/multiRepoService");
const gitContentProvider_1 = require("./core/gitContentProvider");
const unifiedBranchManager_1 = require("./core/unifiedBranchManager");
const unifiedBranchesView_1 = require("./views/unifiedBranchesView");
const historyWebview_1 = require("./views/historyWebview");
const autoFetchService_1 = require("./core/autoFetchService");
/**
 * Entry point for the extension.
 */
function activate(context) {
    // 1. Initialize Core Services
    const gitService = new gitService_1.GitService();
    const repoManager = new repoManager_1.RepositoryManager();
    const multiRepoService = new multiRepoService_1.MultiRepoService(repoManager, gitService);
    const unifiedBranchManager = new unifiedBranchManager_1.UnifiedBranchManager(repoManager, gitService, context.globalState);
    const autoFetchService = new autoFetchService_1.AutoFetchService(repoManager, gitService);
    // 2. Initialize UI Providers
    const repoTreeViewProvider = new repoTreeView_1.RepoTreeViewProvider(repoManager);
    const unifiedBranchesProvider = new unifiedBranchesView_1.UnifiedBranchesViewProvider(unifiedBranchManager);
    const historyViewProvider = new historyWebview_1.HistoryViewProvider(context.extensionUri, gitService);
    // 3. Register TreeViews and WebviewView
    vscode.window.registerTreeDataProvider('git-intellij.repositories', repoTreeViewProvider);
    vscode.window.registerTreeDataProvider('git-intellij.unifiedBranches', unifiedBranchesProvider);
    vscode.window.registerWebviewViewProvider(historyWebview_1.HistoryViewProvider.viewId, historyViewProvider);
    // 4. Register Commands
    const refreshCmd = vscode.commands.registerCommand('git-intellij.refresh', () => {
        repoManager.scanWorkspace();
        unifiedBranchManager.refresh();
    });
    // Single Repo Commands
    const openTerminalCmd = vscode.commands.registerCommand('git-intellij.openInTerminal', (item) => {
        const path = item.rootPath || item.state?.rootPath;
        if (path) {
            const terminal = vscode.window.createTerminal({
                cwd: path,
                name: path.split(/[\\/]/).pop()
            });
            terminal.show();
        }
    });
    const repoCheckoutCmd = vscode.commands.registerCommand('git-intellij.repo.checkout', async (state) => {
        if (!state || !state.rootPath)
            return;
        try {
            const branches = await gitService.getBranches(state.rootPath);
            const items = branches.map(b => ({
                label: b.name,
                description: b.isCurrent ? '(current)' : '',
                detail: b.isRemote ? `Remote: ${b.remote}` : ''
            }));
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Checkout branch in ${state.rootPath.split(/[\\/]/).pop()}`
            });
            if (selected) {
                await multiRepoService.smartCheckout(state, selected.label);
            }
        }
        catch (e) {
            vscode.window.showErrorMessage(`Failed to checkout: ${e.message}`);
        }
    });
    const multiCheckoutCmd = vscode.commands.registerCommand('git-intellij.multiCheckout', () => {
        multiRepoService.performMultiCheckout();
    });
    const selectiveMultiCheckoutCmd = vscode.commands.registerCommand('git-intellij.selectiveMultiCheckout', () => {
        multiRepoService.performSelectiveMultiCheckout();
    });
    // Unified Branch Commands
    const unifiedToggleStarCmd = vscode.commands.registerCommand('git-intellij.unified.toggleStar', (item) => {
        if (item?.branch) {
            unifiedBranchManager.toggleStar(item.branch.name);
        }
    });
    const unifiedCheckoutCmd = vscode.commands.registerCommand('git-intellij.unified.checkout', (item) => {
        if (item?.branch) {
            multiRepoService.performCheckout(item.branch.repositories, item.branch.name);
        }
    });
    const unifiedFetchCmd = vscode.commands.registerCommand('git-intellij.unified.fetch', (item) => {
        if (item?.branch) {
            multiRepoService.performFetch(item.branch.repositories);
        }
    });
    const unifiedPullCmd = vscode.commands.registerCommand('git-intellij.unified.pull', (item) => {
        if (item?.branch) {
            multiRepoService.performPull(item.branch.repositories);
        }
    });
    const unifiedPushCmd = vscode.commands.registerCommand('git-intellij.unified.push', (item) => {
        if (item?.branch) {
            multiRepoService.performPush(item.branch.repositories);
        }
    });
    const unifiedCopyNameCmd = vscode.commands.registerCommand('git-intellij.unified.copyName', (item) => {
        if (item?.branch) {
            vscode.env.clipboard.writeText(item.branch.name);
            vscode.window.showInformationMessage(`Copied branch name: ${item.branch.name}`);
        }
    });
    const unifiedMergeCmd = vscode.commands.registerCommand('git-intellij.unified.merge', (item) => {
        if (item?.branch) {
            multiRepoService.performMerge(item.branch.repositories, item.branch.name);
        }
    });
    const unifiedRebaseCmd = vscode.commands.registerCommand('git-intellij.unified.rebase', (item) => {
        if (item?.branch) {
            multiRepoService.performRebase(item.branch.repositories, item.branch.name);
        }
    });
    const unifiedCreateBranchCmd = vscode.commands.registerCommand('git-intellij.unified.createBranch', (item) => {
        if (item?.branch) {
            multiRepoService.performCreateBranch(item.branch.repositories, item.branch.name);
        }
    });
    const unifiedDeleteBranchCmd = vscode.commands.registerCommand('git-intellij.unified.deleteBranch', (item) => {
        if (item?.branch) {
            multiRepoService.performDeleteBranch(item.branch.repositories, item.branch.name);
        }
    });
    const unifiedFilterCmd = vscode.commands.registerCommand('git-intellij.unified.filter', async () => {
        const repos = repoManager.repositories;
        const items = repos.map(r => ({
            label: r.rootPath.split(/[\\/]/).pop() || 'Unknown',
            description: r.rootPath,
            picked: unifiedBranchManager.selectedRepoPaths.has(r.rootPath),
            path: r.rootPath
        }));
        const selected = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: 'Select repositories to show branches for'
        });
        if (selected) {
            unifiedBranchManager.updateFilter(selected.map(s => s.path));
        }
    });
    const unifiedFetchFilteredCmd = vscode.commands.registerCommand('git-intellij.unified.fetchFiltered', () => {
        const selectedPaths = unifiedBranchManager.selectedRepoPaths;
        const reposToFetch = repoManager.repositories.filter(r => selectedPaths.has(r.rootPath));
        if (reposToFetch.length > 0) {
            multiRepoService.performFetch(reposToFetch);
        }
        else {
            vscode.window.showWarningMessage('No repositories selected to fetch.');
        }
    });
    const unifiedSearchCmd = vscode.commands.registerCommand('git-intellij.unified.search', async () => {
        const value = await vscode.window.showInputBox({
            prompt: 'Filter branches by name',
            placeHolder: 'e.g. feature/',
            value: unifiedBranchManager.currentSearchFilter
        });
        if (value !== undefined) {
            unifiedBranchManager.setSearchFilter(value);
        }
    });
    const unifiedClearSearchCmd = vscode.commands.registerCommand('git-intellij.unified.clearSearch', () => {
        unifiedBranchManager.setSearchFilter('');
    });
    const historyPrevCmd = vscode.commands.registerCommand('git-intellij.history.prev', () => {
        historyViewProvider.navigate('prev');
    });
    const historyNextCmd = vscode.commands.registerCommand('git-intellij.history.next', () => {
        historyViewProvider.navigate('next');
    });
    const historyForSelectionCmd = vscode.commands.registerCommand('git-intellij.showHistoryForSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const selection = editor.selection;
        const filePath = editor.document.uri.fsPath;
        const startLine = selection.start.line + 1;
        const endLine = selection.end.line + 1;
        // Find the repo for this file
        const repo = repoManager.repositories.find(r => filePath.startsWith(r.rootPath));
        if (!repo) {
            vscode.window.showErrorMessage('File is not part of a tracked Git repository.');
            return;
        }
        try {
            vscode.window.setStatusBarMessage(`Fetching history for lines ${startLine}-${endLine}...`, 3000);
            const commits = await gitService.getLogForRange(repo.rootPath, filePath, startLine, endLine);
            if (commits.length === 0) {
                vscode.window.showInformationMessage('No history found for this selection.');
                return;
            }
            // Update the persistent view in the panel
            historyViewProvider.showHistory(commits, repo.rootPath, filePath, startLine, endLine);
        }
        catch (e) {
            vscode.window.showErrorMessage(`Failed to fetch history: ${e.stderr || e.message}`);
        }
    });
    const openLogCmd = vscode.commands.registerCommand('git-intellij.openAdvancedLog', () => {
        vscode.window.showInformationMessage('Opening Advanced Git Log...');
    });
    // 5. Register Content Provider
    const contentProvider = new gitContentProvider_1.GitContentProvider(gitService);
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(gitContentProvider_1.GitContentProvider.scheme, contentProvider));
    // 6. Helper for Diff
    const openDiff = async (title, filePath, revision, rootPath) => {
        const leftUri = vscode.Uri.parse(`${gitContentProvider_1.GitContentProvider.scheme}:${filePath}?revision=${revision}&rootPath=${rootPath}`);
        const rightUri = vscode.Uri.file(filePath);
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${title}: ${revision} ↔ Current`);
    };
    const compareWithBranchCmd = vscode.commands.registerCommand('git-intellij.compareWithBranch', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const filePath = editor.document.uri.fsPath;
        const repo = repoManager.repositories.find(r => filePath.startsWith(r.rootPath));
        if (!repo)
            return;
        const branches = await gitService.getBranches(repo.rootPath);
        const selected = await vscode.window.showQuickPick(branches.map(b => b.name), {
            placeHolder: 'Select branch to compare with'
        });
        if (selected) {
            await openDiff('Compare with Branch', filePath, selected, repo.rootPath);
        }
    });
    const compareWithRevisionCmd = vscode.commands.registerCommand('git-intellij.compareWithRevision', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const filePath = editor.document.uri.fsPath;
        const repo = repoManager.repositories.find(r => filePath.startsWith(r.rootPath));
        if (!repo)
            return;
        const commits = await gitService.getLog(repo.rootPath, 50);
        const items = commits.map(c => ({
            label: `${c.hash.substring(0, 7)} - ${c.message}`,
            description: `${c.author} (${c.date})`,
            hash: c.hash
        }));
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select revision to compare with'
        });
        if (selected) {
            await openDiff('Compare with Revision', filePath, selected.hash, repo.rootPath);
        }
    });
    context.subscriptions.push(repoManager, autoFetchService, refreshCmd, openTerminalCmd, repoCheckoutCmd, unifiedToggleStarCmd, multiCheckoutCmd, selectiveMultiCheckoutCmd, historyForSelectionCmd, historyPrevCmd, historyNextCmd, compareWithBranchCmd, compareWithRevisionCmd, openLogCmd, unifiedCheckoutCmd, unifiedFetchCmd, unifiedPullCmd, unifiedPushCmd, unifiedCopyNameCmd, unifiedMergeCmd, unifiedRebaseCmd, unifiedCreateBranchCmd, unifiedDeleteBranchCmd, unifiedFilterCmd, unifiedFetchFilteredCmd, unifiedSearchCmd, unifiedClearSearchCmd);
    repoManager.scanWorkspace();
}
/**
 * Called when the extension is deactivated.
 */
function deactivate() { }
//# sourceMappingURL=extension.js.map