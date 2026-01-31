import * as cp from 'child_process';
import { GitStatus, GitCommit, GitBranch, GitError, GitOptions } from './types';

/**
 * High-level service to interact with the Git CLI.
 */
export class GitService {
    
    /**
     * Executes a git command and returns the output.
     */
    private async exec(args: string[], options: GitOptions): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = cp.spawn('git', args, { cwd: options.cwd, env: options.env });
            let stdout = '';
            let stderr = '';

            child.stdout.on('data', data => stdout += data.toString());
            child.stderr.on('data', data => stderr += data.toString());

            child.on('close', code => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    const error: GitError = {
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
    public async getStatus(cwd: string): Promise<GitStatus> {
        const output = await this.exec(['status', '--porcelain', '-b'], { cwd });
        const lines = output.split('\n');
        
        const status: GitStatus = {
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
            } else {
                status.branch = branchInfo.split('...')[0];
                if (status.branch.includes('initial commit')) status.branch = 'master';
            }
        }

        // Parse file statuses
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;

            const code = line.substring(0, 2);
            const file = line.substring(3);

            if (code === '??') status.untracked.push(file);
            else if (code === ' M' || code === 'M ') status.modified.push(file);
            else if (code === 'A ' || code === 'M ') status.staged.push(file); // Simplification
            else if (code === 'UU') status.hasConflicts = true;
        }

        return status;
    }

    /**
     * Gets the commit log.
     */
    public async getLog(cwd: string, maxCount = 50): Promise<GitCommit[]> {
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
    public async getBranches(cwd: string): Promise<GitBranch[]> {
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
                
                if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
                if (behindMatch) behind = parseInt(behindMatch[1], 10);
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
    public async checkout(cwd: string, target: string): Promise<void> {
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
            } else {
                // Otherwise, create tracking branch
                await this.exec(['checkout', '--track', target], { cwd });
            }
        } else {
            // Normal checkout (local branch or hash)
            await this.exec(['checkout', target], { cwd });
        }
    }

    /**
     * Fetches from remote.
     */
    public async fetch(cwd: string): Promise<void> {
        await this.exec(['fetch'], { cwd });
    }

    /**
     * Pulls from remote.
     */
    public async pull(cwd: string): Promise<void> {
        await this.exec(['pull'], { cwd });
    }

    /**
     * Pushes to remote.
     */
    public async push(cwd: string): Promise<void> {
        await this.exec(['push'], { cwd });
    }

    /**
     * Merges a branch into the current one.
     */
    public async merge(cwd: string, branch: string): Promise<void> {
        await this.exec(['merge', branch], { cwd });
    }

    /**
     * Rebases current branch onto another.
     */
    public async rebase(cwd: string, branch: string): Promise<void> {
        await this.exec(['rebase', branch], { cwd });
    }

    /**
     * Creates a new branch.
     */
    /**
     * Creates a new branch.
     */
    public async createBranch(cwd: string, name: string, startPoint?: string, force: boolean = false): Promise<void> {
        const flag = force ? '-B' : '-b';
        const args = ['checkout', flag, name];
        if (startPoint) args.push(startPoint);
        await this.exec(args, { cwd });
    }

    /**
     * Deletes a local branch.
     */
    public async deleteBranch(cwd: string, branchName: string, force: boolean = false): Promise<void> {
        const flag = force ? '-D' : '-d';
        await this.exec(['branch', flag, branchName], { cwd });
    }

    /**
     * Deletes a remote branch.
     */
    public async deleteRemoteBranch(cwd: string, remote: string, branchName: string): Promise<void> {
        await this.exec(['push', remote, '--delete', branchName], { cwd });
    }

    /**
     * Gets the diff of a file or the whole repo.
     */
    public async getDiff(cwd: string, cached = false): Promise<string> {
        const args = ['diff'];
        if (cached) args.push('--cached');
        return this.exec(args, { cwd });
    }

    /**
     * Gets the commit log for a specific line range in a file.
     * Uses git log -L <start>,<end>:<file>
     */
    public async getLogForRange(cwd: string, filePath: string, startLine: number, endLine: number): Promise<GitCommit[]> {
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
                if (parts.length < 5) return null;
                const [hash, author, date, message, parents] = parts;
                return {
                    hash,
                    author,
                    date,
                    message,
                    parentHashes: parents ? parents.split(' ') : []
                };
            })
            .filter((c): c is GitCommit => c !== null);
    }

    /**
     * Shows a file's content at a specific revision.
     */
    public async getFileContent(cwd: string, filePath: string, revision: string): Promise<string> {
        const relativePath = filePath.replace(cwd + '/', '').replace(cwd + '\\', '');
        return this.exec(['show', `${revision}:${relativePath}`], { cwd });
    }

    /**
     * Stashes local changes.
     */
    public async stashPush(cwd: string, message?: string): Promise<void> {
        const args = ['stash', 'push', '-u'];
        if (message) {
            args.push('-m', message);
        }
        await this.exec(args, { cwd });
    }

    /**
     * Pops the top stash entry.
     */
    public async stashPop(cwd: string): Promise<void> {
        await this.exec(['stash', 'pop'], { cwd });
    }

    /**
     * Resets the working tree to HEAD.
     */
    public async resetHard(cwd: string): Promise<void> {
        await this.exec(['reset', '--hard', 'HEAD'], { cwd });
    }

    /**
     * Checks if there are any local changes (including untracked).
     */
    public async hasLocalChanges(cwd: string): Promise<boolean> {
        const output = await this.exec(['status', '--porcelain'], { cwd });
        return output.trim().length > 0;
    }
}
