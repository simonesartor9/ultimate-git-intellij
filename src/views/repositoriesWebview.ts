import * as vscode from 'vscode';
import * as path from 'path';
import { RepositoryManager, RepositoryState } from '../core/repoManager';
import { GitService } from '../core/git/gitService';
import { WorkingTreeFile, WorkingTreeDisplayKind } from '../core/git/types';
import { GitContentProvider } from '../core/gitContentProvider';

const EXPANDED_STATE_KEY = 'git-intellij.repositories.expanded';

export interface RepoRowPayload {
    rootPath: string;
    folderName: string;
    branch: string;
    expanded: boolean;
    files: { path: string; kind: WorkingTreeDisplayKind; checked: boolean }[];
}

export class RepositoriesWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'git-intellij.repositories';

    private _view?: vscode.WebviewView;
    /** rootPath -> path -> user override for checkbox (otherwise Git staged state). */
    private readonly _checkOverride = new Map<string, Map<string, boolean>>();

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _repoManager: RepositoryManager,
        private readonly _gitService: GitService,
        private readonly _workspaceState: vscode.Memento
    ) {
        this._repoManager.onDidUpdateRepos(() => this.refresh());
        this._repoManager.onDidChangeRepoState(() => this.refresh());
    }

    public refresh(): void {
        void this.pushState();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(msg => {
            void this._onMessage(msg);
        });

        void this.pushState();
    }

    private _getExpandedRecord(): Record<string, boolean> {
        return this._workspaceState.get<Record<string, boolean>>(EXPANDED_STATE_KEY) ?? {};
    }

    private _setExpanded(rootPath: string, expanded: boolean): void {
        const next = { ...this._getExpandedRecord(), [rootPath]: expanded };
        void this._workspaceState.update(EXPANDED_STATE_KEY, next);
    }

    private _pruneOverrides(rootPath: string, paths: Set<string>): void {
        const inner = this._checkOverride.get(rootPath);
        if (!inner) {
            return;
        }
        for (const p of [...inner.keys()]) {
            if (!paths.has(p)) {
                inner.delete(p);
            }
        }
        if (inner.size === 0) {
            this._checkOverride.delete(rootPath);
        }
    }

    private _buildPayload(states: RepositoryState[]): { repos: RepoRowPayload[] } {
        const expandedRec = this._getExpandedRecord();
        const repos: RepoRowPayload[] = states
            .slice()
            .sort((a, b) => {
                const na = path.basename(a.rootPath).toLowerCase();
                const nb = path.basename(b.rootPath).toLowerCase();
                return na.localeCompare(nb);
            })
            .map(state => {
                const folderName = path.basename(state.rootPath);
                const pathSet = new Set(state.files.map(f => f.path));
                this._pruneOverrides(state.rootPath, pathSet);

                let inner = this._checkOverride.get(state.rootPath);
                const files = state.files.map((f: WorkingTreeFile) => {
                    const o = inner?.get(f.path);
                    const checked = o !== undefined ? o : f.staged;
                    return { path: f.path, kind: f.displayKind, checked };
                });

                const hasFiles = files.length > 0;
                const expanded =
                    expandedRec[state.rootPath] !== undefined
                        ? expandedRec[state.rootPath]!
                        : hasFiles;

                return {
                    rootPath: state.rootPath,
                    folderName,
                    branch: state.branch,
                    expanded,
                    files
                };
            });

        return { repos };
    }

    private async pushState(): Promise<void> {
        if (!this._view) {
            return;
        }
        const payload = this._buildPayload(this._repoManager.repositories);
        void this._view.webview.postMessage({ command: 'setState', ...payload });
    }

    private async _onMessage(msg: { command: string; [key: string]: unknown }): Promise<void> {
        switch (msg.command) {
            case 'ready':
                void this.pushState();
                break;
            case 'toggleExpand': {
                const rootPath = msg.rootPath as string;
                const expanded = msg.expanded as boolean;
                this._setExpanded(rootPath, expanded);
                void this.pushState();
                break;
            }
            case 'toggleFile': {
                const rootPath = msg.rootPath as string;
                const filePath = msg.path as string;
                const checked = msg.checked as boolean;
                let inner = this._checkOverride.get(rootPath);
                if (!inner) {
                    inner = new Map();
                    this._checkOverride.set(rootPath, inner);
                }
                inner.set(filePath, checked);
                break;
            }
            case 'selectAllRepo': {
                const rootPath = msg.rootPath as string;
                const checked = msg.checked as boolean;
                const paths = msg.paths as string[];
                let inner = this._checkOverride.get(rootPath);
                if (!inner) {
                    inner = new Map();
                    this._checkOverride.set(rootPath, inner);
                }
                for (const p of paths) {
                    inner.set(p, checked);
                }
                void this.pushState();
                break;
            }
            case 'openDiff':
                await this._openDiff(msg.rootPath as string, msg.path as string);
                break;
            case 'openTerminal':
                this._openTerminal(msg.rootPath as string);
                break;
            case 'copyRepoPath': {
                const rootPath = msg.rootPath as string;
                await vscode.env.clipboard.writeText(rootPath);
                void vscode.window.showInformationMessage('Copied repository path');
                break;
            }
            case 'discardFile':
                await this._discardFile(msg.rootPath as string, msg.path as string);
                break;
            case 'discardAllRepo':
                await this._discardAllRepo(msg.rootPath as string);
                break;
            case 'commit':
                await this._commitOrPush(msg.message as string, msg.push === true, msg.selections as FileSelection[]);
                break;
            default:
                break;
        }
    }

    private async _openDiff(rootPath: string, relPath: string): Promise<void> {
        const leftUri = vscode.Uri.parse(
            `${GitContentProvider.scheme}:${relPath}?revision=HEAD&rootPath=${encodeURIComponent(rootPath)}`
        );
        const rightUri = vscode.Uri.file(path.join(rootPath, ...relPath.split('/')));
        await vscode.commands.executeCommand(
            'vscode.diff',
            leftUri,
            rightUri,
            `${relPath} (HEAD ↔ Working tree)`
        );
    }

    private _openTerminal(rootPath: string): void {
        const terminal = vscode.window.createTerminal({
            cwd: rootPath,
            name: path.basename(rootPath)
        });
        terminal.show();
    }

    private async _discardFile(rootPath: string, relPath: string): Promise<void> {
        const abs = path.join(rootPath, ...relPath.split('/'));
        const pick = await vscode.window.showWarningMessage(
            `Discard changes in ${relPath}?`,
            { modal: true },
            'Discard'
        );
        if (pick !== 'Discard') {
            return;
        }
        try {
            await this._gitService.discardFileChanges(rootPath, abs);
        } catch (e: any) {
            void vscode.window.showErrorMessage(`Failed to discard: ${e.message ?? e}`);
        }
        void this.pushState();
    }

    private async _discardAllRepo(rootPath: string): Promise<void> {
        const name = path.basename(rootPath);
        const pick = await vscode.window.showWarningMessage(
            `Discard ALL changes in ${name}? This cannot be undone.`,
            { modal: true },
            'Discard all'
        );
        if (pick !== 'Discard all') {
            return;
        }
        try {
            await this._gitService.discardAllChanges(rootPath);
        } catch (e: any) {
            void vscode.window.showErrorMessage(`Failed to discard: ${e.message ?? e}`);
        }
        this._checkOverride.delete(rootPath);
        void this.pushState();
    }

    private async _commitOrPush(message: string, doPush: boolean, selections: FileSelection[]): Promise<void> {
        const trimmed = (message ?? '').trim();
        if (!trimmed) {
            void vscode.window.showWarningMessage('Enter a commit message.');
            return;
        }
        if (!selections?.length) {
            void vscode.window.showWarningMessage('No file rows to process.');
            return;
        }

        const rootsTouched = new Set(selections.map(s => s.rootPath));
        const errors: string[] = [];
        let anyCommit = false;

        for (const rootPath of rootsTouched) {
            try {
                const status = await this._gitService.getStatus(rootPath);
                const P = new Set(status.files.map(f => f.path));
                const forRepo = selections.filter(s => s.rootPath === rootPath && P.has(s.path));
                if (forRepo.length === 0) {
                    continue;
                }

                const S = new Set(forRepo.filter(s => s.checked).map(s => s.path));
                const toUnstage: string[] = [];
                for (const f of status.files) {
                    if (f.staged && !S.has(f.path)) {
                        toUnstage.push(f.path);
                    }
                }
                const toStage = [...S];

                await this._gitService.unstagePaths(rootPath, toUnstage);
                await this._gitService.stagePaths(rootPath, toStage);

                if (!(await this._gitService.hasStagedChanges(rootPath))) {
                    continue;
                }

                await this._gitService.commit(rootPath, trimmed);
                anyCommit = true;
                if (doPush) {
                    await this._gitService.push(rootPath);
                }
            } catch (e: any) {
                const detail = (e?.stderr ?? e?.stdout ?? e?.message ?? String(e)).toString().trim();
                errors.push(`${path.basename(rootPath)}: ${detail}`);
            }
        }

        if (errors.length > 0) {
            void vscode.window.showErrorMessage(errors.join('\n'));
        } else if (!anyCommit) {
            void vscode.window.showInformationMessage('Nothing to commit (no staged changes after selection).');
        } else {
            void vscode.window.showInformationMessage(doPush ? 'Commit and push completed.' : 'Commit completed.');
        }

        this._checkOverride.clear();
        await this._repoManager.refreshAllStates();
        void this.pushState();
    }

    private _getHtml(webview: vscode.Webview): string {
        const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'codicon.css'));
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${codiconUri}" rel="stylesheet" />
  <style>
    :root { box-sizing: border-box; }
    *, *::before, *::after { box-sizing: inherit; }
    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
      font-family: var(--vscode-font-family);
      font-size: 13px;
      color: var(--vscode-sideBar-foreground);
      background: var(--vscode-sideBar-background);
    }
    #root {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    #scroll {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 4px 0;
    }
    #footer {
      flex-shrink: 0;
      border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
      padding: 8px;
      background: var(--vscode-sideBar-background);
    }
    #msg {
      width: 100%;
      min-height: 56px;
      resize: vertical;
      margin-bottom: 8px;
      font-family: var(--vscode-font-family);
      font-size: 12px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      padding: 6px;
    }
    .btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
    button {
      flex: 1;
      min-width: 100px;
      padding: 6px 10px;
      cursor: pointer;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: none;
      border-radius: 2px;
      font-size: 12px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .repo {
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
    }
    .repo-header {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 8px;
      user-select: none;
    }
    .repo-header:hover { background: var(--vscode-list-hoverBackground); }
    .repo-title { font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .repo-meta { font-size: 11px; color: var(--vscode-descriptionForeground); margin-left: 4px; }
    .repo-header .repo-select-all {
      flex-shrink: 0;
      margin: 0 2px 0 0;
      cursor: pointer;
    }
    .icon-btn {
      background: transparent;
      color: var(--vscode-icon-foreground);
      border: none;
      padding: 2px 4px;
      min-width: 0;
      flex: 0 0 auto;
    }
    .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
    .repo-expand-toggle {
      font-size: 11px;
      line-height: 1;
      min-width: 22px;
      height: 22px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--vscode-icon-foreground);
      font-family: var(--vscode-font-family);
    }
    .file-list { padding: 0 0 4px 0; }
    .file-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px 3px 28px;
      cursor: pointer;
    }
    .file-row:hover { background: var(--vscode-list-hoverBackground); }
    .file-row input { flex-shrink: 0; }
    .file-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .kind-tag {
      font-size: 10px;
      text-transform: uppercase;
      flex-shrink: 0;
      opacity: 0.85;
    }
    .kind-modified { color: var(--vscode-gitDecoration-modifiedResourceForeground); }
    .kind-added { color: var(--vscode-gitDecoration-addedResourceForeground); }
    .kind-deleted { color: var(--vscode-gitDecoration-deletedResourceForeground); }
    .kind-untracked { color: var(--vscode-gitDecoration-untrackedResourceForeground); }
    .kind-renamed { color: var(--vscode-gitDecoration-renamedResourceForeground, var(--vscode-gitDecoration-modifiedResourceForeground)); }
    .kind-conflict { color: var(--vscode-gitDecoration-conflictingResourceForeground); }
    .empty { padding: 16px; text-align: center; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div id="root">
    <div id="scroll"><div id="repos" class="empty">Loading…</div></div>
    <div id="footer">
      <textarea id="msg" placeholder="Commit message"></textarea>
      <div class="btn-row">
        <button type="button" id="btn-commit">Commit</button>
        <button type="button" id="btn-commit-push" class="secondary">Commit and Push</button>
      </div>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();

    const kindLabels = {
      modified: 'M',
      added: 'A',
      deleted: 'D',
      untracked: '?',
      renamed: 'R',
      conflict: '!'
    };

    function el(tag, props, children) {
      const n = document.createElement(tag);
      if (props) {
        Object.entries(props).forEach(([k, v]) => {
          if (k === 'class') n.className = v;
          else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
          else if (k === 'title') n.title = v;
          else n.setAttribute(k, v);
        });
      }
      (children || []).forEach(c => {
        if (typeof c === 'string') n.appendChild(document.createTextNode(c));
        else if (c) n.appendChild(c);
      });
      return n;
    }

    function syncRepoHeaderCheckbox(section, repo) {
      const headerCb = section.querySelector('.repo-select-all');
      if (!headerCb || !repo.files.length) return;
      const all = repo.files.every(f => f.checked);
      const some = repo.files.some(f => f.checked);
      headerCb.checked = all;
      headerCb.indeterminate = some && !all;
    }

    function renderRepos(repos) {
      const root = document.getElementById('repos');
      root.replaceChildren();
      root.classList.remove('empty');
      if (!repos.length) {
        root.classList.add('empty');
        root.textContent = 'No Git repositories in this workspace.';
        return;
      }
      repos.forEach(repo => {
        const section = el('div', { class: 'repo' });
        const expanded = repo.expanded !== false;
        const expandGlyph = expanded ? '\u25BC' : '\u25B6';
        const header = el('div', { class: 'repo-header' });
        const toggle = el('button', {
          class: 'icon-btn repo-expand-toggle',
          title: expanded ? 'Collapse' : 'Expand',
          type: 'button',
          onclick: (e) => {
            e.stopPropagation();
            vscode.postMessage({ command: 'toggleExpand', rootPath: repo.rootPath, expanded: !expanded });
          }
        }, [expandGlyph]);
        header.appendChild(toggle);
        if (repo.files.length) {
          const paths = repo.files.map(f => f.path);
          const headerCb = el('input', {
            type: 'checkbox',
            class: 'repo-select-all',
            title: 'Select all files in this repository'
          });
          const allSel = repo.files.every(f => f.checked);
          const someSel = repo.files.some(f => f.checked);
          headerCb.checked = allSel;
          headerCb.indeterminate = someSel && !allSel;
          headerCb.addEventListener('click', (e) => e.stopPropagation());
          headerCb.addEventListener('change', (e) => {
            e.stopPropagation();
            const v = headerCb.checked;
            headerCb.indeterminate = false;
            vscode.postMessage({ command: 'selectAllRepo', rootPath: repo.rootPath, checked: v, paths });
            (window.__repos || []).forEach(r => {
              if (r.rootPath !== repo.rootPath) return;
              r.files.forEach(x => { x.checked = v; });
            });
            const sec = headerCb.closest('.repo');
            if (sec) {
              sec.querySelectorAll('.file-list .file-row input[type=checkbox]').forEach(inp => { inp.checked = v; });
            }
          });
          header.appendChild(headerCb);
        }
        const titleSpan = el('span', { class: 'repo-title' }, [repo.folderName]);
        header.appendChild(titleSpan);
        header.appendChild(el('span', { class: 'repo-meta' }, [repo.branch + (repo.files.length ? ' · ' + repo.files.length : '')]));
        const termBtn = el('button', {
          class: 'icon-btn codicon codicon-terminal',
          title: 'Open terminal',
          type: 'button',
          onclick: (e) => { e.stopPropagation(); vscode.postMessage({ command: 'openTerminal', rootPath: repo.rootPath }); }
        });
        header.appendChild(termBtn);
        const copyBtn = el('button', {
          class: 'icon-btn codicon codicon-copy',
          title: 'Copy path',
          type: 'button',
          onclick: (e) => { e.stopPropagation(); vscode.postMessage({ command: 'copyRepoPath', rootPath: repo.rootPath }); }
        });
        header.appendChild(copyBtn);
        const discardBtn = el('button', {
          class: 'icon-btn codicon codicon-discard',
          title: 'Discard all',
          type: 'button',
          onclick: (e) => { e.stopPropagation(); vscode.postMessage({ command: 'discardAllRepo', rootPath: repo.rootPath }); }
        });
        header.appendChild(discardBtn);
        section.appendChild(header);

        const listWrap = el('div', { class: 'file-list' });
        listWrap.style.display = expanded ? 'block' : 'none';
        repo.files.forEach(f => {
          const row = el('div', { class: 'file-row' });
          const cb = el('input', { type: 'checkbox' });
          cb.checked = !!f.checked;
          cb.addEventListener('change', () => {
            vscode.postMessage({ command: 'toggleFile', rootPath: repo.rootPath, path: f.path, checked: cb.checked });
            const rp = repo.rootPath;
            const fp = f.path;
            const v = cb.checked;
            let updatedRepo = null;
            (window.__repos || []).forEach(r => {
              if (r.rootPath !== rp) return;
              r.files.forEach(x => { if (x.path === fp) x.checked = v; });
              updatedRepo = r;
            });
            const sec = row.closest('.repo');
            if (sec && updatedRepo) syncRepoHeaderCheckbox(sec, updatedRepo);
          });
          row.appendChild(cb);
          const lbl = el('span', { class: 'file-label' }, [f.path]);
          lbl.addEventListener('click', () => {
            vscode.postMessage({ command: 'openDiff', rootPath: repo.rootPath, path: f.path });
          });
          row.appendChild(lbl);
          row.appendChild(el('span', { class: 'kind-tag kind-' + f.kind, title: f.kind }, [kindLabels[f.kind] || f.kind]));
          const dBtn = el('button', {
            class: 'icon-btn codicon codicon-discard',
            title: 'Discard file',
            type: 'button',
            onclick: (e) => {
              e.stopPropagation();
              vscode.postMessage({ command: 'discardFile', rootPath: repo.rootPath, path: f.path });
            }
          });
          row.appendChild(dBtn);
          listWrap.appendChild(row);
        });
        section.appendChild(listWrap);
        root.appendChild(section);
      });
    }

    function collectSelections() {
      const out = [];
      (window.__repos || []).forEach(repo => {
        repo.files.forEach(f => {
          out.push({ rootPath: repo.rootPath, path: f.path, checked: !!f.checked });
        });
      });
      return out;
    }

    window.addEventListener('message', event => {
      const m = event.data;
      if (m.command === 'setState') {
        window.__repos = m.repos || [];
        renderRepos(window.__repos);
      }
    });

    document.getElementById('btn-commit').addEventListener('click', () => {
      const message = document.getElementById('msg').value;
      vscode.postMessage({ command: 'commit', message, push: false, selections: collectSelections() });
    });
    document.getElementById('btn-commit-push').addEventListener('click', () => {
      const message = document.getElementById('msg').value;
      vscode.postMessage({ command: 'commit', message, push: true, selections: collectSelections() });
    });

    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
    }
}

interface FileSelection {
    rootPath: string;
    path: string;
    checked: boolean;
}
