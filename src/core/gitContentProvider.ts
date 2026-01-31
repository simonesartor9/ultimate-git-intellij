import * as vscode from 'vscode';
import { GitService } from './git/gitService';

/**
 * Provides virtual documents for viewing specific Git revisions of a file.
 * URI format: git-intellij-revision:/path/to/file?revision=<hash>
 */
export class GitContentProvider implements vscode.TextDocumentContentProvider {
    static scheme = 'git-intellij-revision';

    constructor(private gitService: GitService) {}

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
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
