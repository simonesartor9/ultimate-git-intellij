"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitContentProvider = void 0;
/**
 * Provides virtual documents for viewing specific Git revisions of a file.
 * URI format: git-intellij-revision:/path/to/file?revision=<hash>
 */
class GitContentProvider {
    constructor(gitService) {
        this.gitService = gitService;
    }
    async provideTextDocumentContent(uri) {
        const query = new URLSearchParams(uri.query);
        const revision = query.get('revision');
        const rootPath = query.get('rootPath');
        const originalPath = query.get('originalPath');
        if (!revision || !rootPath) {
            throw new Error('Invalid URI parameters for GitContentProvider');
        }
        // Use originalPath if provided (for custom display names), otherwise fallback to uri.path
        const filePath = originalPath || uri.path;
        return this.gitService.getFileContent(rootPath, filePath, revision);
    }
}
exports.GitContentProvider = GitContentProvider;
GitContentProvider.scheme = 'git-intellij-revision';
//# sourceMappingURL=gitContentProvider.js.map