import * as vscode from 'vscode';
import { RepositoryManager } from './core/repoManager';
import { GitService } from './core/git/gitService';
import { MultiRepoService } from './core/multiRepoService';
import { GitContentProvider } from './core/gitContentProvider';
import { UnifiedBranchManager } from './core/unifiedBranchManager';
import { UnifiedBranchesViewProvider, UnifiedBranchItem } from './views/unifiedBranchesView';
import { HistoryViewProvider } from './views/historyWebview';
import { RepositoriesWebviewProvider } from './views/repositoriesWebview';
import { AutoFetchService } from './core/autoFetchService';

/**
 * Entry point for the extension.
 */
export function activate(context: vscode.ExtensionContext) {
    // 1. Initialize Core Services
    const gitService = new GitService();
    const repoManager = new RepositoryManager();
    const multiRepoService = new MultiRepoService(repoManager, gitService);
    const unifiedBranchManager = new UnifiedBranchManager(repoManager, gitService, context.globalState);
    const autoFetchService = new AutoFetchService(repoManager, gitService);
    
    // 2. Initialize UI Providers
    const repositoriesProvider = new RepositoriesWebviewProvider(
        context.extensionUri,
        repoManager,
        gitService,
        context.workspaceState
    );
    const unifiedBranchesProvider = new UnifiedBranchesViewProvider(unifiedBranchManager);
    const historyViewProvider = new HistoryViewProvider(context.extensionUri, gitService);

    // 3. Register TreeViews and WebviewViews
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(RepositoriesWebviewProvider.viewId, repositoriesProvider),
        vscode.window.registerWebviewViewProvider(HistoryViewProvider.viewId, historyViewProvider)
    );
    vscode.window.registerTreeDataProvider('git-intellij.unifiedBranches', unifiedBranchesProvider);

    // 4. Register Commands
    const refreshCmd = vscode.commands.registerCommand('git-intellij.refresh', () => {
        repoManager.scanWorkspace();
        unifiedBranchManager.refresh();
        repositoriesProvider.refresh();
    });

    // Single Repo Commands
    const openTerminalCmd = vscode.commands.registerCommand('git-intellij.openInTerminal', (item: any) => {
        const path = item.rootPath || item.state?.rootPath;
        if (path) {
            const terminal = vscode.window.createTerminal({
                cwd: path,
                name: path.split(/[\\/]/).pop()
            });
            terminal.show();
        }
    });

    const repoCheckoutCmd = vscode.commands.registerCommand('git-intellij.repo.checkout', async (state: any) => {
        if (!state || !state.rootPath) return;

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
        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to checkout: ${e.message}`);
        }
    });

    const discardAllRepoChangesCmd = vscode.commands.registerCommand('git-intellij.repo.discardAll', async (item: any) => {
        const state = item.state || item;
        const choice = await vscode.window.showWarningMessage(
            `Discard ALL changes in ${state.rootPath.split(/[\\/]/).pop()}? This cannot be undone.`,
            { modal: true },
            'Discard All'
        );
        if (choice === 'Discard All') {
            try {
                await gitService.discardAllChanges(state.rootPath);
            } catch (e: any) {
                vscode.window.showErrorMessage(`Failed to discard changes: ${e.message}`);
            }
        }
    });

    const discardFileChangesCmd = vscode.commands.registerCommand('git-intellij.repo.discardFile', async (item: any) => {
        const filePath = `${item.rootPath}/${item.fileName}`;
         const choice = await vscode.window.showWarningMessage(
            `Discard changes in ${item.fileName}?`,
            { modal: true },
            'Discard File'
        );
        if (choice === 'Discard File') {
            try {
                await gitService.discardFileChanges(item.rootPath, filePath);
            } catch (e: any) {
                vscode.window.showErrorMessage(`Failed to discard file: ${e.message}`);
            }
        }
    });

    const multiCheckoutCmd = vscode.commands.registerCommand('git-intellij.multiCheckout', () => {
        multiRepoService.performMultiCheckout();
    });

    const selectiveMultiCheckoutCmd = vscode.commands.registerCommand('git-intellij.selectiveMultiCheckout', () => {
        multiRepoService.performSelectiveMultiCheckout();
    });

    const multiDiscardAllCmd = vscode.commands.registerCommand('git-intellij.multiRepo.discardAll', () => {
        multiRepoService.performMultiDiscard();
    });

    const multiUpdateProjectCmd = vscode.commands.registerCommand('git-intellij.multiRepo.updateProject', () => {
        multiRepoService.performMultiPull();
    });

    // Unified Branch Commands
    const unifiedToggleStarCmd = vscode.commands.registerCommand('git-intellij.unified.toggleStar', (item: UnifiedBranchItem) => {
        if (item?.branch) {
            unifiedBranchManager.toggleStar(item.branch.name);
        }
    });

    const unifiedCheckoutCmd = vscode.commands.registerCommand('git-intellij.unified.checkout', (item: UnifiedBranchItem) => {
        if (item?.branch) {
            multiRepoService.performCheckout(item.branch.repositories, item.branch.name);
        }
    });

    const unifiedFetchCmd = vscode.commands.registerCommand('git-intellij.unified.fetch', (item: UnifiedBranchItem) => {
        if (item?.branch) {
            multiRepoService.performFetch(item.branch.repositories);
        }
    });

    const unifiedPullCmd = vscode.commands.registerCommand('git-intellij.unified.pull', (item: UnifiedBranchItem) => {
        if (item?.branch) {
            multiRepoService.performPull(item.branch.repositories, item.branch.name);
        }
    });

    const unifiedPushCmd = vscode.commands.registerCommand('git-intellij.unified.push', (item: UnifiedBranchItem) => {
        if (item?.branch) {
            multiRepoService.performPush(item.branch.repositories);
        }
    });

    const unifiedCopyNameCmd = vscode.commands.registerCommand('git-intellij.unified.copyName', (item: UnifiedBranchItem) => {
        if (item?.branch) {
            vscode.env.clipboard.writeText(item.branch.name);
            vscode.window.showInformationMessage(`Copied branch name: ${item.branch.name}`);
        }
    });

    const unifiedMergeCmd = vscode.commands.registerCommand('git-intellij.unified.merge', (item: UnifiedBranchItem) => {
        if (item?.branch) {
            multiRepoService.performMerge(item.branch.repositories, item.branch.name);
        }
    });

    const unifiedRebaseCmd = vscode.commands.registerCommand('git-intellij.unified.rebase', (item: UnifiedBranchItem) => {
        if (item?.branch) {
            multiRepoService.performRebase(item.branch.repositories, item.branch.name);
        }
    });

    const unifiedCreateBranchCmd = vscode.commands.registerCommand('git-intellij.unified.createBranch', (item: UnifiedBranchItem) => {
        if (item?.branch) {
            multiRepoService.performCreateBranch(item.branch.repositories, item.branch.name);
        }
    });

    const unifiedDeleteBranchCmd = vscode.commands.registerCommand('git-intellij.unified.deleteBranch', (item: UnifiedBranchItem) => {
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
        } else {
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
        if (!editor) return;

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
            historyViewProvider.showHistory(
                commits,
                repo.rootPath,
                filePath,
                startLine,
                endLine
            );

        } catch (e: any) {
            vscode.window.showErrorMessage(`Failed to fetch history: ${e.stderr || e.message}`);
        }
    });

    const openLogCmd = vscode.commands.registerCommand('git-intellij.openAdvancedLog', () => {
        vscode.window.showInformationMessage('Opening Advanced Git Log...');
    });

    // 5. Register Content Provider
    const contentProvider = new GitContentProvider(gitService);
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, contentProvider)
    );

    // 6. Helper for Diff
    const openDiff = async (title: string, filePath: string, revision: string, rootPath: string) => {
        const leftUri = vscode.Uri.parse(`${GitContentProvider.scheme}:${filePath}?revision=${revision}&rootPath=${rootPath}`);
        const rightUri = vscode.Uri.file(filePath);
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${title}: ${revision} ↔ Current`);
    };

    const compareWithBranchCmd = vscode.commands.registerCommand('git-intellij.compareWithBranch', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const filePath = editor.document.uri.fsPath;
        const repo = repoManager.repositories.find(r => filePath.startsWith(r.rootPath));
        if (!repo) return;

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
        if (!editor) return;

        const filePath = editor.document.uri.fsPath;
        const repo = repoManager.repositories.find(r => filePath.startsWith(r.rootPath));
        if (!repo) return;

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

    context.subscriptions.push(
        repoManager,
        autoFetchService,
        refreshCmd,
        openTerminalCmd,
        repoCheckoutCmd,
        discardAllRepoChangesCmd,
        discardFileChangesCmd,
        unifiedToggleStarCmd,
        multiCheckoutCmd,
        selectiveMultiCheckoutCmd,
        multiDiscardAllCmd,
        multiUpdateProjectCmd,
        historyForSelectionCmd,
        historyPrevCmd,
        historyNextCmd,
        compareWithBranchCmd,
        compareWithRevisionCmd,
        openLogCmd,
        unifiedCheckoutCmd,
        unifiedFetchCmd,
        unifiedPullCmd,
        unifiedPushCmd,
        unifiedCopyNameCmd,
        unifiedMergeCmd,
        unifiedRebaseCmd,
        unifiedCreateBranchCmd,
        unifiedDeleteBranchCmd,
        unifiedFilterCmd,
        unifiedFetchFilteredCmd,
        unifiedSearchCmd,
        unifiedClearSearchCmd
    );

    repoManager.scanWorkspace();
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate() {}
