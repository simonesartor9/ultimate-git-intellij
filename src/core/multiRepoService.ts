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

        const { allBranchNames, repoBranches } = await this.getAllBranches(repos);
        const selectedBranch = await vscode.window.showQuickPick(Array.from(allBranchNames), {
            placeHolder: 'Select a branch to checkout in ALL repositories'
        });

        if (!selectedBranch) return;

        // Filter repos that actually have this branch (local or remote match)
        // Optimization: Pre-calculate the operations in memory to avoid slow checks during execution
        const validRepos = repos.filter(repo => {
            const branches = repoBranches.get(repo.rootPath);
            if (!branches) return false;
            // Check exact match or remote match (e.g. origin/branchName)
            // We stored simple names in the Set. 
            // Wait, getAllBranches implementation below needs to be updated to store full info?
            // Let's just check if the set contains the selected branch.
            // But checking for "origin/selectedBranch" is harder if we only have names.
            // Actually, getBranches returns branch names like "master", "origin/master".
            // So if selectedBranch is "master", and we have "origin/master", we need to match that.
            
            if (branches.has(selectedBranch)) return true;
            for (const b of branches) {
                if (b.endsWith('/' + selectedBranch)) return true;
            }
            return false;
        });

        if (validRepos.length === 0) {
            vscode.window.showInformationMessage(`Branch '${selectedBranch}' not found in any repository.`);
            return;
        }

        await this.executeBatchOperation(validRepos, `Checking out '${selectedBranch}'...`, async (repo) => {
            // We already validated the repo has the branch, just checkout.
            // We pass the simple name. gitService.checkout handles the rest (including tracking).
            await this.smartCheckout(repo, selectedBranch);
        }, true); // Parallel execution
    }

    /**
     * Executes a coordinated checkout across SELECTED repositories.
     */
    public async performSelectiveMultiCheckout() {
        const selectedRepos = await this.selectRepositories('Select repositories for checkout');
        if (!selectedRepos || selectedRepos.length === 0) return;

        const { allBranchNames, repoBranches } = await this.getAllBranches(selectedRepos);

        const selectedBranch = await vscode.window.showQuickPick(Array.from(allBranchNames), {
            placeHolder: `Select target branch for ${selectedRepos.length} repositories`
        });

        if (!selectedBranch) return;

        // Filter valid repos logic (same as performMultiCheckout to ensure we don't try on repos that don't have it)
        const validRepos = selectedRepos.filter(repo => {
            const branches = repoBranches.get(repo.rootPath);
            if (!branches) return false;
            if (branches.has(selectedBranch)) return true;
            for (const b of branches) {
                if (b.endsWith('/' + selectedBranch)) return true;
            }
            return false;
        });

         if (validRepos.length === 0) {
            vscode.window.showInformationMessage(`Branch '${selectedBranch}' not found in any selected repository.`);
            return;
        }

        await this.executeBatchOperation(validRepos, `Checking out '${selectedBranch}'...`, async (repo) => {
             await this.smartCheckout(repo, selectedBranch);
        }, true);
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

    public async performPull(repos: any[], branchName?: string) {
        await this.executeBatchOperation(repos, 'Pulling...', async (repo) => {
            if (!branchName) {
                await this.gitService.pull(repo.rootPath);
                return;
            }

            const branches = await this.gitService.getBranches(repo.rootPath);
            const current = branches.find(b => b.isCurrent);

            if (current && current.name === branchName) {
                // We are on the branch we want to pull
                if (current.remote) {
                    // Upstream exists, use standard pull
                    await this.gitService.pull(repo.rootPath);
                } else {
                    // No upstream. Find a matching remote branch.
                    const remoteBranch = branches.find(b => b.isRemote && b.name.endsWith('/' + branchName));
                    if (remoteBranch) {
                        const parts = remoteBranch.name.split('/');
                        const remote = parts[0];
                        const rBranch = parts.slice(1).join('/');
                        // git pull <remote> <branch>
                        await this.gitService.pull(repo.rootPath, remote, rBranch);
                    } else {
                        // Fallback to fetch if we can't merge
                        await this.gitService.fetch(repo.rootPath);
                    }
                }
            } else {
                const target = branches.find(b => b.name === branchName);
                if (target && target.remote) {
                    const parts = target.remote.split('/');
                    const remoteName = parts[0];
                    const remoteBranch = parts.slice(1).join('/');
                    await this.gitService.fetchLocalBranch(repo.rootPath, remoteName, remoteBranch, branchName);
                } else {
                    await this.gitService.fetch(repo.rootPath);
                }
            }
        }, true);
    }

    public async performPush(repos: any[]) {
        await this.executeBatchOperation(repos, 'Pushing...', repo => this.gitService.push(repo.rootPath));
    }

    public async performMerge(repos: any[], branchName: string) {
        await this.executeBatchOperation(repos, `Merging '${branchName}'...`, async (repo) => {
            try {
                await this.gitService.merge(repo.rootPath, branchName);
            } catch (e: any) {
                // Check for merge conflicts in stdout
                if (e.stdout?.includes('CONFLICT')) {
                    const repoName = repo.rootPath.split(/[\\/]/).pop();
                    
                    const choice = await vscode.window.showWarningMessage(
                        `Merge conflict detected in '${repoName}'.`,
                        'Show Conflicts'
                    );

                    if (choice === 'Show Conflicts') {
                        await vscode.commands.executeCommand('workbench.view.scm');
                    }
                    return; // Suppress error as we've handled the UI notification
                }
                throw e;
            }
        });
    }

    public async performRebase(repos: any[], branchName: string) {
        await this.executeBatchOperation(repos, `Rebasing onto '${branchName}'...`, repo => this.gitService.rebase(repo.rootPath, branchName));
    }

    public async performCreateBranch(repos: any[], startPoint: string) {
        // Pre-fetch all branches to perform validation and conditional logic
        const localBranches = new Set<string>();
        const remoteBranchNames = new Set<string>();

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Preparing branch creation...' }, async () => {
            for (const repo of repos) {
                try {
                    const branches = await this.gitService.getBranches(repo.rootPath);
                    for (const b of branches) {
                        if (b.isRemote) {
                            // Remote branches usually come as 'origin/feature'. We want to check against 'feature'.
                            const parts = b.name.split('/');
                            if (parts.length > 1) {
                                remoteBranchNames.add(parts.slice(1).join('/'));
                            }
                        } else {
                            localBranches.add(b.name);
                        }
                    }
                } catch (e) {
                    console.error('Error fetching branches', e);
                }
            }
        });

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
                alwaysShow: true
            };

            // Initially empty if no name is typed, or logic will handle it on change
            quickpick.items = [];

            quickpick.onDidChangeValue((value) => {
                const name = value.trim();
                
                // 1. Show checkbox only if local branch exists
                const existsLocally = localBranches.has(name);
                if (existsLocally) {
                    if (!quickpick.items.includes(overrideItem)) {
                        quickpick.items = [overrideItem];
                    }
                } else {
                    // Remove checkbox if it doesn't exist locally
                    if (quickpick.items.length > 0) {
                        quickpick.items = [];
                    }
                }
            });

            // Handle Enter key or "OK" button
            quickpick.onDidAccept(() => {
                const name = quickpick.value.trim();
                
                if (!name) return;

                if (remoteBranchNames.has(name)) {
                    vscode.window.showErrorMessage(`Remote branch '${name}' already exists. Please choose a different name.`);
                    return;
                }

                const override = quickpick.selectedItems.includes(overrideItem);
                resolve({ name, override });
                quickpick.hide();
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
        
        let shouldStash = false;

        if (hasChanges) {
             const choice = await vscode.window.showWarningMessage(
                `Repository '${repoName}' has local changes.`,
                { modal: true, detail: 'How would you like to proceed with the checkout?' },
                'Smart Checkout (Stash & Apply)',
                'Force Checkout (Discard Changes)'
             );

             if (!choice) throw new Error('Checkout cancelled');

             if (choice === 'Force Checkout (Discard Changes)') {
                 await this.gitService.discardAllChanges(repo.rootPath);
                 await this.gitService.checkout(repo.rootPath, branchName);
                 return;
             }
             
             shouldStash = true;
        }
        
        // We still need the current branch name in case we need to abort
        const status = await this.gitService.getStatus(repo.rootPath);
        const previousBranch = status.branch;

        let stashed = false;
        if (shouldStash) {
            if (status.hasConflicts) {
                const choice = await vscode.window.showErrorMessage(
                    `Cannot stash changes in '${repoName}' because there are merge conflicts.`,
                    { modal: true, detail: 'Resolve conflicts first or discard all local changes before checkout.' },
                    'Force Checkout (Discard Changes)'
                );

                if (choice === 'Force Checkout (Discard Changes)') {
                    await this.gitService.discardAllChanges(repo.rootPath);
                    await this.gitService.checkout(repo.rootPath, branchName);
                    return;
                }

                throw new Error('Checkout cancelled due to unresolved conflicts.');
            }

            try {
                stashed = await this.gitService.stashPush(repo.rootPath, `Auto stash before checkout to ${branchName}`);
            } catch (e: any) {
                const details = (e?.stderr || e?.stdout || e?.message || 'Unknown git error').toString().trim();
                throw new Error(`Could not stash local changes before checkout. ${details}`);
            }
        }

        try {
            await this.gitService.checkout(repo.rootPath, branchName);
        } catch (e: any) {
            if (stashed) {
                try {
                    await this.gitService.stashPop(repo.rootPath);
                } catch (popError) {
                    console.error(`Failed to restore stash after failed checkout in ${repoName}`, popError);
                }
            }
            throw e;
        }

        if (stashed) {
            try {
                await this.gitService.stashPop(repo.rootPath);
            } catch (e: any) {
                // Conflict during stash pop
                const choice = await vscode.window.showErrorMessage(
                    `Conflict while reapplying stash in repository ${repoName}.`,
                    { modal: true },
                    'Resolve Manually',
                    'Abort (Restore Previous)',
                    'Discard Stash Changes'
                );

                if (choice === 'Abort (Restore Previous)') {
                    await this.gitService.resetHard(repo.rootPath);
                    await this.gitService.checkout(repo.rootPath, previousBranch);
                    try {
                        await this.gitService.stashPop(repo.rootPath);
                    } catch (err: any) {
                         vscode.window.showErrorMessage(`Could not fully restore previous state: ${err.message}`);
                    }
                } else if (choice === 'Discard Stash Changes') {
                     await this.gitService.discardAllChanges(repo.rootPath);
                } else if (choice === 'Resolve Manually') {
                    // Guide the user to the native conflict resolution workflow.
                    await vscode.commands.executeCommand('workbench.view.scm');
                    const conflicts = await this.gitService.getUnmergedFiles(repo.rootPath);
                    if (conflicts.length > 0) {
                        const repoUri = vscode.Uri.file(repo.rootPath);
                        for (const relativePath of conflicts) {
                            const fullPath = vscode.Uri.joinPath(repoUri, relativePath);
                            try {
                                const doc = await vscode.workspace.openTextDocument(fullPath);
                                await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
                            } catch (openError) {
                                console.error(`Failed to open conflicted file '${relativePath}' in ${repoName}`, openError);
                            }
                        }
                    }
                    vscode.window.showWarningMessage(
                        `Resolve conflicts in '${repoName}', then stage files and complete the operation manually.`,
                        { modal: false }
                    );
                }
            }
        }
    }

    private async getAllBranches(repos: any[]): Promise<{ allBranchNames: Set<string>, repoBranches: Map<string, Set<string>> }> {
        const allBranchNames = new Set<string>();
        const repoBranches = new Map<string, Set<string>>();
        
        // Parallelize branch fetching
        await Promise.all(repos.map(async (repo) => {
            try {
                const branches = await this.gitService.getBranches(repo.rootPath);
                const branchSet = new Set<string>();
                
                branches.forEach(b => {
                    allBranchNames.add(b.name);
                    branchSet.add(b.name);
                });
                
                repoBranches.set(repo.rootPath, branchSet);
            } catch (e) {
                console.error(`Failed to fetch branches for ${repo.rootPath}`, e);
            }
        }));

        return { allBranchNames, repoBranches };
    }

    /**
     * Internal execution logic for batch operations.
     */
    private async executeBatchOperation(repos: any[], title: string, operation: (repo: any) => Promise<void>, parallel: boolean = false) {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: title,
            cancellable: false
        }, async (progress) => {
            let completed = 0;
            const errors: string[] = [];

            if (parallel) {
                const promises = repos.map(async (repo) => {
                    try {
                        await operation(repo);
                    } catch (e: any) {
                        const name = repo.rootPath.split(/[\\/]/).pop();
                        errors.push(`${name}: ${e.stderr || e.message}`);
                    } finally {
                        completed++;
                        progress.report({ increment: (100 / repos.length), message: `${completed}/${repos.length}` });
                    }
                });
                await Promise.all(promises);
            } else {
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
