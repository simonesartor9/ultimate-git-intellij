import * as vscode from 'vscode';
import { RepositoryManager, RepositoryState } from './repoManager';
import { GitService } from './git/gitService';
import { GitBranch } from './git/types';

export interface UnifiedBranch {
    name: string;
    repositories: RepositoryState[];
    isCurrentIn: RepositoryState[];
    isRemote: boolean;
    totalAhead: number;
    totalBehind: number;
    isStarred: boolean;
}

export class UnifiedBranchManager {
    private _unifiedBranches: UnifiedBranch[] = [];
    private _selectedRepoPaths: Set<string> = new Set();
    private _searchFilter: string = '';
    private _starredBranches: Set<string>;
    
    // Event to notify when unified branches change
    private _onDidChangeUnifiedBranches = new vscode.EventEmitter<UnifiedBranch[]>();
    public readonly onDidChangeUnifiedBranches = this._onDidChangeUnifiedBranches.event;

    constructor(
        private repoManager: RepositoryManager,
        private gitService: GitService,
        private globalState: vscode.Memento
    ) {
        // Load starred branches
        const savedStars = this.globalState.get<string[]>('unifiedBranches.starred', []);
        this._starredBranches = new Set(savedStars);

        // Initially, all repos are "filtered in"
        this.updateFilter([]);
        
        // Listen for repo changes
        this.repoManager.onDidUpdateRepos(() => this.refresh());
        this.repoManager.onDidChangeRepoState(() => this.refresh());
    }

    public toggleStar(branchName: string) {
        if (this._starredBranches.has(branchName)) {
            this._starredBranches.delete(branchName);
        } else {
            this._starredBranches.add(branchName);
        }
        this.globalState.update('unifiedBranches.starred', Array.from(this._starredBranches));
        this.refresh();
    }

    public updateFilter(repoPaths: string[]) {
        const currentRepos = this.repoManager.repositories;
        if (repoPaths.length === 0) {
            this._selectedRepoPaths = new Set(currentRepos.map(r => r.rootPath));
        } else {
            this._selectedRepoPaths = new Set(repoPaths);
        }
        this.refresh();
    }

    public async refresh() {
        let repos = this.repoManager.repositories;
        
        // If we have a filter but no repos selected yet (e.g. initial load), 
        // try to initialize filter with all available repos
        if (this._selectedRepoPaths.size === 0 && repos.length > 0) {
            this._selectedRepoPaths = new Set(repos.map(r => r.rootPath));
        }

        const targetRepos = repos.filter(r => this._selectedRepoPaths.has(r.rootPath));
        const branchMap = new Map<string, { 
            name: string,
            isRemote: boolean,
            repos: RepositoryState[], 
            currentIn: RepositoryState[],
            ahead: number,
            behind: number
        }>();

        const results = await Promise.all(targetRepos.map(async repo => {
            try {
                const branches = await this.gitService.getBranches(repo.rootPath);
                return { repo, branches };
            } catch (e) {
                console.error(`Failed to get branches for ${repo.rootPath}`, e);
                return null;
            }
        }));

        for (const result of results) {
            if (!result) continue;
            const { repo, branches } = result;

            for (const branch of branches) {
                const key = `${branch.isRemote ? 'remote' : 'local'}:${branch.name}`;
                if (!branchMap.has(key)) {
                    branchMap.set(key, { 
                        name: branch.name,
                        isRemote: branch.isRemote,
                        repos: [], 
                        currentIn: [], 
                        ahead: 0, 
                        behind: 0 
                    });
                }
                const entry = branchMap.get(key)!;
                entry.repos.push(repo);
                entry.ahead += branch.ahead || 0;
                entry.behind += branch.behind || 0;
                
                if (branch.isCurrent) {
                    entry.currentIn.push(repo);
                }
            }
        }

        this._unifiedBranches = Array.from(branchMap.values()).map(data => ({
            name: data.name,
            isRemote: data.isRemote,
            repositories: data.repos,
            isCurrentIn: data.currentIn,
            totalAhead: data.ahead,
            totalBehind: data.behind,
            isStarred: this._starredBranches.has(data.name)
        })).sort((a, b) => {
            // Priority 1: Current branches (Active) - User Request: "metti per primo il branch in cui mi trovo"
            const aCurrent = a.isCurrentIn.length > 0;
            const bCurrent = b.isCurrentIn.length > 0;
            if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;

            // Priority 2: Starred branches (Favorites)
            if (a.isStarred !== b.isStarred) return a.isStarred ? -1 : 1;

            // Priority 3: Remote/Local grouping
            if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;

            // Priority 4: Name
            return a.name.localeCompare(b.name);
        });

        this._onDidChangeUnifiedBranches.fire(this._unifiedBranches);
    }

    public setSearchFilter(filter: string) {
        this._searchFilter = filter.trim().toLowerCase();
        this._onDidChangeUnifiedBranches.fire(this.unifiedBranches);
    }

    public get unifiedBranches(): UnifiedBranch[] {
        if (!this._searchFilter) {
            return this._unifiedBranches;
        }
        return this._unifiedBranches.filter(b => b.name.toLowerCase().includes(this._searchFilter));
    }

    public get currentSearchFilter(): string {
        return this._searchFilter;
    }

    public get selectedRepoPaths(): Set<string> {
        return this._selectedRepoPaths;
    }
}
