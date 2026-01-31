import * as vscode from 'vscode';
import { RepositoryManager } from './repoManager';
import { GitService } from './git/gitService';

/**
 * Handles operations that affect multiple repositories simultaneously.
 */
export class MultiRepoService {
    constructor(
        private repoManager: RepositoryManager,
        private gitService: GitService
    ) {}

    /**
     * Executes a coordinated checkout across ALL repositories.
     */
    public async performMultiCheckout() {
        const repos = this.repoManager.repositories;
        if (repos.length === 0) {
            vscode.window.showWarningMessage('No active Git repositories found.');
            return;
        }

        const allBranches = await this.getAllBranches(repos);
        const selectedBranch = await vscode.window.showQuickPick(Array.from(allBranches), {
            placeHolder: 'Select a branch to checkout in ALL repositories'
        });

        if (!selectedBranch) return;

        await this.executeBatchOperation(repos, `Checking out '${selectedBranch}'...`, async (repo) => {
            const branches = await this.gitService.getBranches(repo.rootPath);
            
            // Try exact match
            if (branches.some(b => b.name === selectedBranch)) {
                await this.smartCheckout(repo, selectedBranch);
                return;
            }

            // If not found exactly, try to find a remote branch that matches this name
            // (e.g. selected branch is 'feature-x', repo has 'origin/feature-x')
            const remoteMatch = branches.find(b => b.isRemote && b.name.endsWith('/' + selectedBranch));
            if (remoteMatch) {
                await this.smartCheckout(repo, remoteMatch.name);
            }
        });
    }

    /**
     * Executes a coordinated checkout across SELECTED repositories.
     */
    public async performSelectiveMultiCheckout() {
        const selectedRepos = await this.selectRepositories('Select repositories for checkout');
        if (!selectedRepos || selectedRepos.length === 0) return;

        const allBranches = await this.getAllBranches(selectedRepos);

        const selectedBranch = await vscode.window.showQuickPick(Array.from(allBranches), {
            placeHolder: `Select target branch for ${selectedRepos.length} repositories`
        });

        if (!selectedBranch) return;

        await this.executeBatchOperation(selectedRepos, `Checking out '${selectedBranch}'...`, async (repo) => {
            const branches = await this.gitService.getBranches(repo.rootPath);
            
            // Try exact match
            if (branches.some(b => b.name === selectedBranch)) {
                await this.smartCheckout(repo, selectedBranch);
                return;
            }

            // Try remote match
            const remoteMatch = branches.find(b => b.isRemote && b.name.endsWith('/' + selectedBranch));
            if (remoteMatch) {
                await this.smartCheckout(repo, remoteMatch.name);
            }
        });
    }

    public async performMultiDiscard() {
        const selectedRepos = await this.selectRepositories('Select repositories to DISCARD changes');
        if (!selectedRepos || selectedRepos.length === 0) return;

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to DISCARD ALL changes in ${selectedRepos.length} repositories? This cannot be undone.`,
            { modal: true },
            'Discard All'
        );

        if (confirm === 'Discard All') {
            await this.executeBatchOperation(selectedRepos, 'Discarding all changes...', async (repo) => {
                await this.gitService.discardAllChanges(repo.rootPath);
            });
        }
    }

    public async performMultiPull() {
        const selectedRepos = await this.selectRepositories('Select repositories to Update (Pull)');
        if (!selectedRepos || selectedRepos.length === 0) return;

        await this.performPull(selectedRepos);
    }

    private async selectRepositories(placeholder: string): Promise<any[] | undefined> {
        const repos = this.repoManager.repositories;
        if (repos.length === 0) {
            vscode.window.showWarningMessage('No active Git repositories found.');
            return undefined;
        }

        const repoItems: (vscode.QuickPickItem & { repo: any })[] = repos.map(r => ({
            label: r.rootPath.split(/[\\/]/).pop() || 'Unknown',
            description: `[${r.branch}]`,
            detail: r.rootPath,
            picked: true,
            repo: r
        }));

        const selected = await vscode.window.showQuickPick(repoItems, {
            placeHolder: placeholder,
            canPickMany: true
        });

        return selected ? selected.map(item => item.repo) : undefined;
    }

    public async performFetch(repos: any[]) {
        await this.executeBatchOperation(repos, 'Fetching...', repo => this.gitService.fetch(repo.rootPath));
    }

    public async performPull(repos: any[]) {
        await this.executeBatchOperation(repos, 'Pulling...', repo => this.gitService.pull(repo.rootPath));
    }

    public async performPush(repos: any[]) {
        await this.executeBatchOperation(repos, 'Pushing...', repo => this.gitService.push(repo.rootPath));
    }

    public async performMerge(repos: any[], branchName: string) {
        await this.executeBatchOperation(repos, `Merging '${branchName}'...`, repo => this.gitService.merge(repo.rootPath, branchName));
    }

    public async performRebase(repos: any[], branchName: string) {
        await this.executeBatchOperation(repos, `Rebasing onto '${branchName}'...`, repo => this.gitService.rebase(repo.rootPath, branchName));
    }

    public async performCreateBranch(repos: any[], startPoint: string) {
        // Use a QuickPick to provide a visible "Checkbox" with a text Label
        const result = await new Promise<{ name: string; override: boolean } | undefined>((resolve) => {
            const quickpick = vscode.window.createQuickPick();
            quickpick.title = `Create New Branch from '${startPoint}'`;
            quickpick.placeholder = 'Enter new branch name (e.g. feature/my-feature)';
            quickpick.ignoreFocusOut = true;
            
            // Enabling multi-select allows us to have "checkboxes" for items
            quickpick.canSelectMany = true;

            const overrideItem: vscode.QuickPickItem = {
                label: 'Override local branch if exists',
                description: 'Deletes and recreates the local branch if it already exists',
                alwaysShow: true // Keeps the checkbox visible while typing the name
            };

            quickpick.items = [overrideItem];

            // Handle Enter key or "OK" button
            quickpick.onDidAccept(() => {
                const name = quickpick.value.trim();
                if (name) {
                    const override = quickpick.selectedItems.includes(overrideItem);
                    resolve({ name, override });
                    quickpick.hide();
                } else {
                    vscode.window.showErrorMessage('Branch name cannot be empty');
                }
            });

            quickpick.onDidHide(() => {
                resolve(undefined);
                quickpick.dispose();
            });

            quickpick.show();
        });

        if (!result) return;

        const { name, override } = result;

        await this.executeBatchOperation(repos, `Creating branch '${name}'...`, async (repo) => {
            // Uses -B if override is true (forces creation/reset), -b otherwise (fails if exists)
            await this.gitService.createBranch(repo.rootPath, name, startPoint, override);
        });
    }

    public async performDeleteBranch(repos: any[], branchName: string) {
        // 1. Confirm deletion
        const choice = await vscode.window.showWarningMessage(
            `Are you sure you want to delete branch '${branchName}'?`,
            { modal: true },
            'Delete Local Branch',
            'Delete Local & Remote'
        );

        if (!choice) return;

        const deleteRemote = choice === 'Delete Local & Remote';

        await this.executeBatchOperation(repos, `Deleting branch '${branchName}'...`, async (repo) => {
            // Delete local
            try {
                // Try safe delete first, if fails (unmerged), we might need to ask force?
                // For now, let's use force delete to match "Trash" icon expectation usually implies force or we can catch error
                // But Git standard behavior is -d usually. Let's try -D (force) to avoid getting stuck in UI loop, 
                // assuming user knows what they are doing with "Delete" action.
                // Or better: try -d, if fail -> error.
                await this.gitService.deleteBranch(repo.rootPath, branchName, true); // Force delete local
            } catch (e: any) {
                // If it fails, maybe it's current branch?
                throw e;
            }

            // Delete remote if requested
            if (deleteRemote) {
                // Find remote for this branch. Usually origin.
                // We'll try to find if there is a tracking branch to know the remote?
                // Or just assume 'origin'? 
                // Let's look up the branch info to find remote.
                const branches = await this.gitService.getBranches(repo.rootPath);
                const branchMap = branches.find(b => b.name === branchName);
                
                let remote = 'origin';
                if (branchMap && branchMap.remote) {
                    remote = branchMap.remote.split('/')[0];
                }

                try {
                    await this.gitService.deleteRemoteBranch(repo.rootPath, remote, branchName);
                } catch (e: any) {
                    // Ignore error if remote branch doesn't exist?
                    // console.warn('Failed to delete remote', e);
                    throw new Error(`Failed to delete remote branch: ${e.message}`);
                }
            }
        });
    }

    public async performCheckout(repos: any[], branchName: string) {
        await this.executeBatchOperation(repos, `Checking out '${branchName}'...`, repo => this.smartCheckout(repo, branchName));
    }

    /**
     * Helper to perform a smart checkout with automatic stashing and conflict handling.
     */
    public async smartCheckout(repo: any, branchName: string) {
        const repoName = repo.rootPath.split(/[\\/]/).pop() || 'Unknown';
        const hasChanges = await this.gitService.hasLocalChanges(repo.rootPath);
        
        // We still need the current branch name in case we need to abort
        const status = await this.gitService.getStatus(repo.rootPath);
        const previousBranch = status.branch;

        if (hasChanges) {
            await this.gitService.stashPush(repo.rootPath, `Auto stash before checkout to ${branchName}`);
        }

        try {
            await this.gitService.checkout(repo.rootPath, branchName);
        } catch (e: any) {
            if (hasChanges) {
                try {
                    await this.gitService.stashPop(repo.rootPath);
                } catch (popError) {
                    console.error(`Failed to restore stash after failed checkout in ${repoName}`, popError);
                }
            }
            throw e;
        }

        if (hasChanges) {
            try {
                await this.gitService.stashPop(repo.rootPath);
            } catch (e: any) {
                // Conflict during stash pop
                const choice = await vscode.window.showErrorMessage(
                    `Conflict while reapplying stash in repository ${repoName}.`,
                    { modal: true },
                    'Abort and Re-apply stash',
                    'Force Checkout (keep stash)'
                );

                if (choice === 'Abort and Re-apply stash') {
                    await this.gitService.resetHard(repo.rootPath);
                    await this.gitService.checkout(repo.rootPath, previousBranch);
                    await this.gitService.stashPop(repo.rootPath);
                } else if (choice === 'Force Checkout (keep stash)') {
                    await this.gitService.resetHard(repo.rootPath);
                }
            }
        }
    }

    private async getAllBranches(repos: any[]): Promise<Set<string>> {
        const allBranches = new Set<string>();
        for (const repo of repos) {
            try {
                const branches = await this.gitService.getBranches(repo.rootPath);
                branches.forEach(b => allBranches.add(b.name));
            } catch (e) {
                console.error(`Failed to fetch branches for ${repo.rootPath}`, e);
            }
        }
        return allBranches;
    }

    /**
     * Internal execution logic for batch operations.
     */
    private async executeBatchOperation(repos: any[], title: string, operation: (repo: any) => Promise<void>) {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: title,
            cancellable: false
        }, async (progress) => {
            let completed = 0;
            const errors: string[] = [];

            for (const repo of repos) {
                try {
                    await operation(repo);
                } catch (e: any) {
                    const name = repo.rootPath.split(/[\\/]/).pop();
                    errors.push(`${name}: ${e.stderr || e.message}`);
                }
                completed++;
                progress.report({ increment: (100 / repos.length), message: `${completed}/${repos.length}` });
            }

            if (errors.length > 0) {
                vscode.window.showErrorMessage(`Operation failed for some repositories:\n${errors.join('\n')}`, { modal: true });
            } else {
                vscode.window.showInformationMessage(`Successfully completed operation on ${repos.length} repositories.`);
            }

            await this.repoManager.refreshAllStates();
        });
    }
}
