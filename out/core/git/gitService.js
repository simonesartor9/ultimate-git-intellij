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
exports.GitService = void 0;
const cp = __importStar(require("child_process"));
/**
 * High-level service to interact with the Git CLI.
 */
class GitService {
    /**
     * Executes a git command and returns the output.
     */
    async exec(args, options) {
        return new Promise((resolve, reject) => {
            const child = cp.spawn('git', args, { cwd: options.cwd, env: options.env });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', data => stdout += data.toString());
            child.stderr.on('data', data => stderr += data.toString());
            child.on('close', code => {
                if (code === 0) {
                    resolve(stdout.trim());
                }
                else {
                    const error = {
                        message: `Git command failed: git ${args.join(' ')}`,
                        exitCode: code ?? undefined,
                        stdout,
                        stderr
                    };
                    reject(error);
                }
            });
            child.on('error', err => {
                reject({ message: err.message });
            });
        });
    }
    /**
     * Gets the status of the repository.
     */
    async getStatus(cwd) {
        const output = await this.exec(['status', '--porcelain', '-b'], { cwd });
        const lines = output.split('\n');
        const status = {
            branch: '',
            detached: false,
            modified: [],
            untracked: [],
            staged: [],
            hasConflicts: false
        };
        // Parse branch info (first line with ##)
        const branchLine = lines[0];
        if (branchLine && branchLine.startsWith('##')) {
            const branchInfo = branchLine.substring(3).trim();
            if (branchInfo.includes('HEAD (no branch)') || branchInfo.includes('detached at')) {
                status.detached = true;
                status.branch = branchInfo;
            }
            else {
                status.branch = branchInfo.split('...')[0];
                if (status.branch.includes('initial commit'))
                    status.branch = 'master';
            }
        }
        // Parse file statuses
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line)
                continue;
            const code = line.substring(0, 2);
            const file = line.substring(3);
            if (code === '??')
                status.untracked.push(file);
            else if (code === ' M' || code === 'M ')
                status.modified.push(file);
            else if (code === 'A ' || code === 'M ')
                status.staged.push(file); // Simplification
            else if (code === 'UU')
                status.hasConflicts = true;
        }
        return status;
    }
    /**
     * Gets the commit log.
     */
    async getLog(cwd, maxCount = 50) {
        const format = '%H|%an|%ai|%s|%P';
        const output = await this.exec(['log', `-${maxCount}`, `--format=${format}`], { cwd });
        return output.split('\n').filter(l => !!l).map(line => {
            const [hash, author, date, message, parents] = line.split('|');
            return {
                hash,
                author,
                date,
                message,
                parentHashes: parents ? parents.split(' ') : []
            };
        });
    }
    /**
     * Lists all local and remote branches with tracking information.
     */
    async getBranches(cwd) {
        const format = '%(HEAD)|%(refname:short)|%(refname)|%(upstream:short)|%(upstream:track)';
        const output = await this.exec(['for-each-ref', `--format=${format}`, 'refs/heads', 'refs/remotes'], { cwd });
        return output.split('\n').filter(l => !!l).map(line => {
            const [head, name, fullName, upstream, track] = line.split('|');
            const isCurrent = head === '*';
            const isRemote = fullName.startsWith('refs/remotes/');
            let ahead = 0;
            let behind = 0;
            if (track) {
                const aheadMatch = track.match(/ahead (\d+)/);
                const behindMatch = track.match(/behind (\d+)/);
                if (aheadMatch)
                    ahead = parseInt(aheadMatch[1], 10);
                if (behindMatch)
                    behind = parseInt(behindMatch[1], 10);
            }
            return {
                name,
                isCurrent,
                isRemote,
                remote: upstream,
                ahead,
                behind
            };
        });
    }
    /**
     * Checkouts a branch or commit.
     * Prevents detached HEAD when a remote branch is selected by creating/switching to a local tracking branch.
     */
    async checkout(cwd, target) {
        const branches = await this.getBranches(cwd);
        const branch = branches.find(b => b.name === target);
        if (branch && branch.isRemote) {
            // It's a remote branch. We want to avoid detached HEAD.
            // target is like 'origin/feature'
            const parts = target.split('/');
            const localName = parts.slice(1).join('/');
            // Check if local branch already exists
            const localExists = branches.find(b => !b.isRemote && b.name === localName);
            if (localExists) {
                // If local branch exists, just checkout that
                await this.exec(['checkout', localName], { cwd });
            }
            else {
                // Otherwise, create tracking branch
                await this.exec(['checkout', '--track', target], { cwd });
            }
        }
        else {
            // Normal checkout (local branch or hash)
            await this.exec(['checkout', target], { cwd });
        }
    }
    /**
     * Fetches from remote.
     */
    async fetch(cwd) {
        await this.exec(['fetch'], { cwd });
    }
    /**
     * Pulls from remote.
     */
    async pull(cwd) {
        await this.exec(['pull'], { cwd });
    }
    /**
     * Pushes to remote.
     */
    async push(cwd) {
        await this.exec(['push'], { cwd });
    }
    /**
     * Merges a branch into the current one.
     */
    async merge(cwd, branch) {
        await this.exec(['merge', branch], { cwd });
    }
    /**
     * Rebases current branch onto another.
     */
    async rebase(cwd, branch) {
        await this.exec(['rebase', branch], { cwd });
    }
    /**
     * Creates a new branch.
     */
    /**
     * Creates a new branch.
     */
    async createBranch(cwd, name, startPoint, force = false) {
        const flag = force ? '-B' : '-b';
        const args = ['checkout', flag, name];
        if (startPoint)
            args.push(startPoint);
        await this.exec(args, { cwd });
    }
    /**
     * Deletes a local branch.
     */
    async deleteBranch(cwd, branchName, force = false) {
        const flag = force ? '-D' : '-d';
        await this.exec(['branch', flag, branchName], { cwd });
    }
    /**
     * Deletes a remote branch.
     */
    async deleteRemoteBranch(cwd, remote, branchName) {
        await this.exec(['push', remote, '--delete', branchName], { cwd });
    }
    /**
     * Gets the diff of a file or the whole repo.
     */
    async getDiff(cwd, cached = false) {
        const args = ['diff'];
        if (cached)
            args.push('--cached');
        return this.exec(args, { cwd });
    }
    /**
     * Gets the commit log for a specific line range in a file.
     * Uses git log -L <start>,<end>:<file>
     */
    async getLogForRange(cwd, filePath, startLine, endLine) {
        // We use --no-patch to avoid getting the actual diff, just the metadata
        const format = '%H|%an|%ai|%s|%P';
        const relativePath = filePath.replace(cwd + '/', '').replace(cwd + '\\', '');
        const args = [
            'log',
            `-L ${startLine},${endLine}:${relativePath}`,
            `-n 50`, // Optimization: Limit to 50 commits to avoid slow history traversal
            `--format=${format}`
        ];
        const output = await this.exec(args, { cwd });
        return output.split('\n')
            .filter(l => !!l && !l.startsWith('diff --git')) // Filter out diff headers if they leak
            .map(line => {
            const parts = line.split('|');
            if (parts.length < 5)
                return null;
            const [hash, author, date, message, parents] = parts;
            return {
                hash,
                author,
                date,
                message,
                parentHashes: parents ? parents.split(' ') : []
            };
        })
            .filter((c) => c !== null);
    }
    /**
     * Shows a file's content at a specific revision.
     */
    async getFileContent(cwd, filePath, revision) {
        const relativePath = filePath.replace(cwd + '/', '').replace(cwd + '\\', '');
        return this.exec(['show', `${revision}:${relativePath}`], { cwd });
    }
    /**
     * Stashes local changes.
     */
    async stashPush(cwd, message) {
        const args = ['stash', 'push', '-u'];
        if (message) {
            args.push('-m', message);
        }
        await this.exec(args, { cwd });
    }
    /**
     * Pops the top stash entry.
     */
    async stashPop(cwd) {
        await this.exec(['stash', 'pop'], { cwd });
    }
    /**
     * Resets the working tree to HEAD.
     */
    async resetHard(cwd) {
        await this.exec(['reset', '--hard', 'HEAD'], { cwd });
    }
    /**
     * Checks if there are any local changes (including untracked).
     */
    async hasLocalChanges(cwd) {
        const output = await this.exec(['status', '--porcelain'], { cwd });
        return output.trim().length > 0;
    }
}
exports.GitService = GitService;
//# sourceMappingURL=gitService.js.map