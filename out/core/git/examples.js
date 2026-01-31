"use strict";
/*
Example Usage of GitService:

import { GitService } from './core/git/gitService';

const git = new GitService();
const repoPath = '/path/to/your/repo';

async function main() {
    try {
        // 1. Get Status
        const status = await git.getStatus(repoPath);
        console.log(`Current branch: ${status.branch}`);

        // 2. Get Log (with simple caching logic in the caller if needed)
        const commits = await git.getLog(repoPath, 10);
        console.log(`Last commit: ${commits[0].message}`);

        // 3. Checkout
        // await git.checkout(repoPath, 'develop');

    } catch (error) {
        console.error('Git Error:', error.message);
    }
}
*/
//# sourceMappingURL=examples.js.map