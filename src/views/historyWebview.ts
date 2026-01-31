import * as vscode from 'vscode';
import * as path from 'path';
import { GitService } from '../core/git/gitService';
import { GitCommit } from '../core/git/types';
import { GitContentProvider } from '../core/gitContentProvider';

export class HistoryViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'git-intellij.historyView';

    private _view?: vscode.WebviewView;
    private _currentCommits: GitCommit[] = [];
    private _currentHash?: string;
    private _repoPath?: string;
    private _filePath?: string;
    private _startLine?: number;
    private _endLine?: number;
    private _currentRevisionUri: vscode.Uri | undefined;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _gitService: GitService
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.command) {
                case 'selectCommit':
                    await this._openRevision(data.hash);
                    break;
                case 'copyHash':
                    vscode.env.clipboard.writeText(data.hash);
                    vscode.window.showInformationMessage(`Copied commit hash: ${data.hash}`);
                    break;
                case 'navigate':
                    this.navigate(data.direction);
                    break;
            }
        });
        
        // Render current state if any
        this._updateHtml();
    }

    public showHistory(
        commits: GitCommit[],
        repoPath: string,
        filePath: string,
        startLine: number,
        endLine: number
    ) {
        this._currentCommits = commits;
        this._repoPath = repoPath;
        this._filePath = filePath;
        this._startLine = startLine;
        this._endLine = endLine;
        this._currentHash = undefined;

        if (this._view) {
            this._view.show(true); // Focus the view
            this._updateHtml();
        } else {
            // View will be resolved later, data is stored
            vscode.commands.executeCommand('git-intellij.historyView.focus');
        }
    }

    public navigate(direction: 'prev' | 'next') {
        if (!this._currentHash || this._currentCommits.length === 0) return;

        const currentIndex = this._currentCommits.findIndex(c => c.hash === this._currentHash);
        if (currentIndex === -1) return;

        let newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;

        if (newIndex < 0) newIndex = 0;
        if (newIndex >= this._currentCommits.length) newIndex = this._currentCommits.length - 1;

        if (newIndex !== currentIndex) {
            const newCommit = this._currentCommits[newIndex];
            this._openRevision(newCommit.hash);
            this._view?.webview.postMessage({
                command: 'selectCommitInList',
                hash: newCommit.hash
            });
        }
    }

    private async _openRevision(hash: string) {
        if (!this._repoPath || !this._filePath) return;
        
        try {
            // 1. Close previous revision if exists
            if (this._currentRevisionUri) {
                const targetUriStr = this._currentRevisionUri.toString();
                // Iterate over all tab groups to find and close the tab
                for (const group of vscode.window.tabGroups.all) {
                    for (const tab of group.tabs) {
                        // Check if the tab matches our URI
                        const input = tab.input as { uri?: vscode.Uri };
                        if (input && input.uri && input.uri.toString() === targetUriStr) {
                            await vscode.window.tabGroups.close(tab);
                            break; 
                        }
                    }
                }
            }

            this._currentHash = hash;

            // 2. Construct URI with custom display name
            // Goal: /path/to/file.ts -> /path/to/file (Revision 1a2b3c).ts
            const ext = path.extname(this._filePath);
            const base = path.basename(this._filePath, ext);
            const dir = path.dirname(this._filePath);
            const shortHash = hash.substring(0, 7);
            
            // New "virtual" path for display
            const displayPath = path.join(dir, `${base} (Revision ${shortHash})${ext}`);

            const uri = vscode.Uri.parse(
                `${GitContentProvider.scheme}:${displayPath}?revision=${hash}&rootPath=${this._repoPath}&originalPath=${this._filePath}`
            );
            
            this._currentRevisionUri = uri; // Track it

            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc, {
                preview: true,
                preserveFocus: true,
                viewColumn: vscode.ViewColumn.Active
            });

            if (this._startLine && this._endLine) {
                const range = new vscode.Range(
                    Math.max(0, this._startLine - 1), 
                    0, 
                    Math.max(0, this._endLine - 1), 
                    1000
                );
                
                editor.setDecorations(vscode.window.createTextEditorDecorationType({
                    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
                    isWholeLine: true
                }), [range]);
                
                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error opening revision: ${error}`);
        }
    }

    private _updateHtml() {
        if (!this._view) return;
        this._view.webview.html = this._getHtmlForWebview(this._view.webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const commitsRows = this._currentCommits.map(c => `
            <tr class="commit-row" onclick="selectCommit('${c.hash}')" id="row-${c.hash}">
                <td class="hash">
                    <span class="icon codicon codicon-git-commit"></span>
                    ${c.hash.substring(0, 7)}
                </td>
                <td class="author">
                    <span class="icon codicon codicon-account"></span>
                    ${c.author}
                </td>
                <td class="date">${c.date}</td>
            </tr>
            <tr class="message-row" onclick="selectCommit('${c.hash}')">
                <td colspan="3" class="message">${c.message}</td>
            </tr>
        `).join('');

        // Use a clearer and more compact layout for the panel
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'codicon.css'))}" rel="stylesheet" />
            <title>History</title>
            <style>
                body {
                    padding: 0;
                    margin: 0;
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-editor-foreground);
                    background-color: var(--vscode-editor-background);
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                }
                td {
                    padding: 4px 8px;
                    font-size: 13px;
                }
                .commit-row {
                    cursor: pointer;
                    border-top: 1px solid var(--vscode-panel-border);
                }
                .commit-row:hover, .message-row:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                .commit-row.selected, .message-row.selected {
                    background-color: var(--vscode-list-activeSelectionBackground);
                    color: var(--vscode-list-activeSelectionForeground);
                }
                .message-row {
                    cursor: pointer;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                .hash { font-family: monospace; color: var(--vscode-textLink-foreground); width: 100px; }
                .date { white-space: nowrap; color: var(--vscode-descriptionForeground); text-align: right; }
                .author { color: var(--vscode-descriptionForeground); }
                .message { padding-bottom: 8px; padding-left: 24px; color: var(--vscode-foreground); opacity: 0.9; }
                
                .icon { vertical-align: text-bottom; margin-right: 4px; }
            </style>
        </head>
        <body>
            <div id="history-container">
                <table>
                    <tbody>
                        ${this._currentCommits.length > 0 ? commitsRows : '<tr><td colspan="3" style="padding: 20px; text-align: center;">Select a range in code and run "Show History for Selection"</td></tr>'}
                    </tbody>
                </table>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                
                function selectCommit(hash) {
                    // Send directly to extension
                    vscode.postMessage({
                        command: 'selectCommit',
                        hash: hash
                    });
                    
                    highlightRow(hash);
                }
                
                function highlightRow(hash) {
                    document.querySelectorAll('.commit-row, .message-row').forEach(row => row.classList.remove('selected'));
                    const row = document.getElementById('row-' + hash);
                    if (row) {
                        row.classList.add('selected');
                        // Also select next sibling which is the message
                        if (row.nextElementSibling && row.nextElementSibling.classList.contains('message-row')) {
                            row.nextElementSibling.classList.add('selected');
                        }
                    }
                }

                document.addEventListener('keydown', (e) => {
                    if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        vscode.postMessage({ command: 'navigate', direction: 'prev' });
                    } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        vscode.postMessage({ command: 'navigate', direction: 'next' });
                    }
                });

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.command) {
                        case 'selectCommitInList':
                            highlightRow(message.hash);
                            const row = document.getElementById('row-' + message.hash);
                            if (row) row.scrollIntoView({ block: 'nearest' });
                            break;
                    }
                });
            </script>
        </body>
        </html>`;
    }
}
