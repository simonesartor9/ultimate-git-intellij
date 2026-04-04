import * as cp from 'child_process';
import { GitStatus, GitCommit, GitBranch, GitError, GitOptions, WorkingTreeFile, WorkingTreeDisplayKind } from './types';

/**
 * High-level service to interact with the Git CLI.
 */
export class GitService {
    private async sleep(ms: number): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, ms));
    }
    
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
     * Parses one porcelain v1 line (not ##, not !!).
     * @see https://git-scm.com/docs/git-status#_short_format
     */
    private parsePorcelainLine(line: string): WorkingTreeFile | null {
        if (line.length < 3) {
            return null;
        }
        const xy = line.substring(0, 2);
        const rest = line.substring(3);

        if (xy === '!!') {
            return null;
        }

        if (xy === '??') {
            return {
                path: rest,
                displayKind: 'untracked',
                staged: false,
                hasUnstaged: true
            };
        }

        const x = xy[0];
        const y = xy[1];

        let path = rest.trim();
        if (path.includes(' -> ')) {
            const parts = path.split(' -> ');
            path = parts[parts.length - 1].trim();
        }

        const staged = x !== ' ' && x !== '?';
        const hasUnstaged = y !== ' ' && y !== '?';

        if (x === 'U' || y === 'U') {
            return { path, displayKind: 'conflict', staged, hasUnstaged };
        }

        if (x === 'R' || y === 'R' || x === 'C' || y === 'C') {
            return { path, displayKind: 'renamed', staged, hasUnstaged };
        }

        if (y === 'D' && x === ' ') {
            return { path, displayKind: 'deleted', staged: false, hasUnstaged: true };
        }

        if (x === 'D') {
            return {
                path,
                displayKind: 'deleted',
                staged: true,
                hasUnstaged: y !== ' ' && y !== 'D'
            };
        }

        if (x === 'A') {
            return { path, displayKind: 'added', staged, hasUnstaged };
        }

        return { path, displayKind: 'modified' as WorkingTreeDisplayKind, staged, hasUnstaged };
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
            files: [],
            hasConflicts: false
        };

        let startIdx = 0;
        const branchLine = lines[0];
        if (branchLine?.startsWith('##')) {
            const branchInfo = branchLine.substring(3).trim();
            if (branchInfo.includes('HEAD (no branch)') || branchInfo.includes('detached at')) {
                status.detached = true;
                status.branch = branchInfo;
            } else {
                status.branch = branchInfo.split('...')[0];
                if (status.branch.includes('initial commit')) {
                    status.branch = 'master';
                }
            }
            startIdx = 1;
        }

        const seen = new Set<string>();
        for (let i = startIdx; i < lines.length; i++) {
            const line = lines[i];
            if (!line || line.startsWith('##')) {
                continue;
            }
            const file = this.parsePorcelainLine(line);
            if (!file) {
                continue;
            }
            if (seen.has(file.path)) {
                continue;
            }
            seen.add(file.path);
            status.files.push(file);
            if (file.displayKind === 'conflict') {
                status.hasConflicts = true;
            }
        }

        return status;
    }

    /**
     * Stages paths (add to index).
     */
    public async stagePaths(cwd: string, paths: string[]): Promise<void> {
        if (paths.length === 0) {
            return;
        }
        await this.exec(['add', '--', ...paths], { cwd });
    }

    /**
     * Unstages paths (remove from index, keep working tree).
     */
    public async unstagePaths(cwd: string, paths: string[]): Promise<void> {
        if (paths.length === 0) {
            return;
        }
        try {
            await this.exec(['restore', '--staged', '--', ...paths], { cwd });
        } catch {
            await this.exec(['reset', 'HEAD', '--', ...paths], { cwd });
        }
    }

    /**
     * Creates a commit with the given message (index must already match intent).
     */
    public async commit(cwd: string, message: string): Promise<void> {
        const trimmed = message.trim();
        if (!trimmed) {
            throw new Error('Commit message is empty');
        }
        await this.exec(['commit', '-m', trimmed], { cwd });
    }

    /**
     * Returns true if there is anything staged to commit.
     */
    public async hasStagedChanges(cwd: string): Promise<boolean> {
        const names = await this.exec(['diff', '--cached', '--name-only'], { cwd });
        return names.trim().length > 0;
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
    public async pull(cwd: string, remote?: string, branch?: string): Promise<void> {
        const args = ['pull'];
        if (remote) args.push(remote);
        if (branch) args.push(branch);
        await this.exec(args, { cwd });
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
     * Stashes local changes. Returns true if a stash was created.
     */
    public async stashPush(cwd: string, message?: string): Promise<boolean> {
        const args = ['stash', 'push', '-u'];
        if (message) {
            args.push('-m', message);
        }
        const maxAttempts = 3;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const output = await this.exec(args, { cwd });
                return output.includes('Saved working directory') || output.includes('Saved working tree');
            } catch (error: any) {
                const stderr = (error?.stderr ?? '').toString();
                const stdout = (error?.stdout ?? '').toString();
                const combinedOutput = `${stderr}\n${stdout}`.toLowerCase();
                const isLockError = combinedOutput.includes('index.lock') || combinedOutput.includes('unable to create') || combinedOutput.includes('another git process');
                const isNoChanges = combinedOutput.includes('no local changes to save');

                if (isNoChanges) {
                    return false;
                }

                if (isLockError && attempt < maxAttempts) {
                    await this.sleep(250 * attempt);
                    continue;
                }

                throw error;
            }
        }

        return false;
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

    /**
     * Lists files currently in an unmerged/conflict state.
     */
    public async getUnmergedFiles(cwd: string): Promise<string[]> {
        const output = await this.exec(['diff', '--name-only', '--diff-filter=U'], { cwd });
        return output
            .split('\n')
            .map(line => line.trim())
            .filter(line => !!line);
    }

    /**
     * Discards all local changes in the repository (reset --hard and clean -fd).
     */
    public async discardAllChanges(cwd: string): Promise<void> {
        await this.exec(['reset', '--hard', 'HEAD'], { cwd });
        await this.exec(['clean', '-fd'], { cwd });
    }

    /**
     * Discards changes for a specific file.
     */
    public async discardFileChanges(cwd: string, filePath: string): Promise<void> {
        const relativePath = filePath.replace(cwd + '/', '').replace(cwd + '\\', '');
        // Discard tracked changes
        try {
            await this.exec(['checkout', 'HEAD', '--', relativePath], { cwd });
        } catch (e) {
            // Might fail if file is untracked, that's expected
        }
        
        // Also try to clean if it was untracked/new
        try {
            await this.exec(['clean', '-f', relativePath], { cwd });
        } catch (e) {
            // Ignore if clean fails
        }
    }

    /**
     * Updates a local branch from a remote without checking it out.
     * effective command: git fetch <remote> <remoteBranch>:<localBranch>
     */
    public async fetchLocalBranch(cwd: string, remote: string, remoteBranch: string, localBranch: string): Promise<void> {
        await this.exec(['fetch', remote, `${remoteBranch}:${localBranch}`], { cwd });
    }
}
