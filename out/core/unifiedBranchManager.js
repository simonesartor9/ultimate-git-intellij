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
exports.UnifiedBranchManager = void 0;
const vscode = __importStar(require("vscode"));
class UnifiedBranchManager {
    constructor(repoManager, gitService, globalState) {
        this.repoManager = repoManager;
        this.gitService = gitService;
        this.globalState = globalState;
        this._unifiedBranches = [];
        this._selectedRepoPaths = new Set();
        this._searchFilter = '';
        // Event to notify when unified branches change
        this._onDidChangeUnifiedBranches = new vscode.EventEmitter();
        this.onDidChangeUnifiedBranches = this._onDidChangeUnifiedBranches.event;
        // Load starred branches
        const savedStars = this.globalState.get('unifiedBranches.starred', []);
        this._starredBranches = new Set(savedStars);
        // Initially, all repos are "filtered in"
        this.updateFilter([]);
        // Listen for repo changes
        this.repoManager.onDidUpdateRepos(() => this.refresh());
        this.repoManager.onDidChangeRepoState(() => this.refresh());
    }
    toggleStar(branchName) {
        if (this._starredBranches.has(branchName)) {
            this._starredBranches.delete(branchName);
        }
        else {
            this._starredBranches.add(branchName);
        }
        this.globalState.update('unifiedBranches.starred', Array.from(this._starredBranches));
        this.refresh();
    }
    updateFilter(repoPaths) {
        const currentRepos = this.repoManager.repositories;
        if (repoPaths.length === 0) {
            this._selectedRepoPaths = new Set(currentRepos.map(r => r.rootPath));
        }
        else {
            this._selectedRepoPaths = new Set(repoPaths);
        }
        this.refresh();
    }
    async refresh() {
        let repos = this.repoManager.repositories;
        // If we have a filter but no repos selected yet (e.g. initial load), 
        // try to initialize filter with all available repos
        if (this._selectedRepoPaths.size === 0 && repos.length > 0) {
            this._selectedRepoPaths = new Set(repos.map(r => r.rootPath));
        }
        const targetRepos = repos.filter(r => this._selectedRepoPaths.has(r.rootPath));
        const branchMap = new Map();
        const results = await Promise.all(targetRepos.map(async (repo) => {
            try {
                const branches = await this.gitService.getBranches(repo.rootPath);
                return { repo, branches };
            }
            catch (e) {
                console.error(`Failed to get branches for ${repo.rootPath}`, e);
                return null;
            }
        }));
        for (const result of results) {
            if (!result)
                continue;
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
                const entry = branchMap.get(key);
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
            // Priority 1: Starred branches
            if (a.isStarred !== b.isStarred)
                return a.isStarred ? -1 : 1;
            // Priority 2: Remote/Local grouping
            if (a.isRemote !== b.isRemote)
                return a.isRemote ? 1 : -1;
            // Priority 3: Name
            return a.name.localeCompare(b.name);
        });
        this._onDidChangeUnifiedBranches.fire(this._unifiedBranches);
    }
    setSearchFilter(filter) {
        this._searchFilter = filter.trim().toLowerCase();
        this._onDidChangeUnifiedBranches.fire(this.unifiedBranches);
    }
    get unifiedBranches() {
        if (!this._searchFilter) {
            return this._unifiedBranches;
        }
        return this._unifiedBranches.filter(b => b.name.toLowerCase().includes(this._searchFilter));
    }
    get currentSearchFilter() {
        return this._searchFilter;
    }
    get selectedRepoPaths() {
        return this._selectedRepoPaths;
    }
}
exports.UnifiedBranchManager = UnifiedBranchManager;
//# sourceMappingURL=unifiedBranchManager.js.map