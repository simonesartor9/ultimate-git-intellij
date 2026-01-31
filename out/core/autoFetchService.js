"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoFetchService = void 0;
class AutoFetchService {
    constructor(repoManager, gitService) {
        this.repoManager = repoManager;
        this.gitService = gitService;
        this._intervalMs = 300000; // 5 minutes default
        this._isFetching = false;
        // Start auto-fetch
        this.start();
    }
    start() {
        if (this._intervalId)
            return;
        console.log(`[AutoFetch] Starting auto-fetch every ${this._intervalMs}ms`);
        this._intervalId = setInterval(() => this.fetchAll(), this._intervalMs);
    }
    stop() {
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = undefined;
        }
    }
    async fetchAll() {
        if (this._isFetching)
            return;
        const repos = this.repoManager.repositories;
        if (repos.length === 0)
            return;
        this._isFetching = true;
        // Fetch in batches to avoid overwhelming the system/network
        const batchSize = 5;
        try {
            for (let i = 0; i < repos.length; i += batchSize) {
                const batch = repos.slice(i, i + batchSize);
                await Promise.all(batch.map(async (repo) => {
                    try {
                        await this.gitService.fetch(repo.rootPath);
                    }
                    catch (e) {
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
        }
        catch (e) {
            console.error('[AutoFetch] Global error', e);
        }
        finally {
            this._isFetching = false;
        }
    }
    dispose() {
        this.stop();
    }
}
exports.AutoFetchService = AutoFetchService;
//# sourceMappingURL=autoFetchService.js.map