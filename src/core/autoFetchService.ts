import * as vscode from 'vscode';
import { RepositoryManager } from './repoManager';
import { GitService } from './git/gitService';

export class AutoFetchService implements vscode.Disposable {
    private _intervalId: NodeJS.Timeout | undefined;
    private _intervalMs = 300000; // 5 minutes default
    private _isFetching = false;

    constructor(
        private repoManager: RepositoryManager,
        private gitService: GitService
    ) {
        // Start auto-fetch
        this.start();
    }

    public start() {
        if (this._intervalId) return;
        
        console.log(`[AutoFetch] Starting auto-fetch every ${this._intervalMs}ms`);
        this._intervalId = setInterval(() => this.fetchAll(), this._intervalMs);
    }

    public stop() {
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = undefined;
        }
    }

    private async fetchAll() {
        if (this._isFetching) return;
        
        const repos = this.repoManager.repositories;
        if (repos.length === 0) return;

        this._isFetching = true;
        
        // Fetch in batches to avoid overwhelming the system/network
        const batchSize = 5;
        
        try {
            for (let i = 0; i < repos.length; i += batchSize) {
                const batch = repos.slice(i, i + batchSize);
                await Promise.all(batch.map(async repo => {
                    try {
                        await this.gitService.fetch(repo.rootPath);
                    } catch (e) {
                        // Silent failure for auto-fetch
                        console.warn(`[AutoFetch] Failed to fetch ${repo.rootPath}`, e);
                    }
                }));
            }
            
            // Refresh states after fetch to show new commits/branches
            // We do this silently to not disturb the user if not needed, 
            // but RepositoryManager.refreshAllStates() typically fires events
            // which updates the UI.
            this.repoManager.refreshAllStates();
            
        } catch (e) {
            console.error('[AutoFetch] Global error', e);
        } finally {
            this._isFetching = false;
        }
    }

    dispose() {
        this.stop();
    }
}
