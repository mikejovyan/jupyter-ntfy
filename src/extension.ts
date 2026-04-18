import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('Jupyter ntfy is now active');

    const enabledCells = new Set<string>();
    const lastNotifiedEndTime = new Map<string, number>();
    const statusBarEmitter = new vscode.EventEmitter<vscode.NotebookCell | undefined>();
    context.subscriptions.push(statusBarEmitter);

    // Toggle notification for a cell
    const toggleCommand = vscode.commands.registerCommand(
        'jupyter-ntfy.toggleNotification',
        (cell?: vscode.NotebookCell) => {
            if (!cell) {
                const editor = vscode.window.activeNotebookEditor;
                if (!editor) {
                    vscode.window.showErrorMessage('No active notebook cell found');
                    return;
                }
                const selection = editor.selections[0];
                if (!selection) {
                    vscode.window.showErrorMessage('No cell selected');
                    return;
                }
                cell = editor.notebook.cellAt(selection.start);
            }

            const id = getCellId(cell);
            if (enabledCells.has(id)) {
                enabledCells.delete(id);
                setCellMetadata(cell, false);
            } else {
                enabledCells.add(id);
                setCellMetadata(cell, true);
            }
            statusBarEmitter.fire(cell);
        }
    );

    // Listen for cell execution completion
    const executionListener = vscode.workspace.onDidChangeNotebookDocument((e) => {
        for (const change of e.cellChanges) {
            const cell = change.cell;
            const id = getCellId(cell);
            const endTime = change.executionSummary?.timing?.endTime;

            if (typeof endTime !== 'number') { continue; }
            if (!enabledCells.has(id)) { continue; }
            if (lastNotifiedEndTime.get(id) === endTime) { continue; }

            lastNotifiedEndTime.set(id, endTime);
            sendNotification(cell, change.executionSummary!.success);
        }
    });

    // Restore bell toggles from cell metadata
    function restoreFromMetadata(notebook: vscode.NotebookDocument) {
        for (const cell of notebook.getCells()) {
            if (cell.metadata?.['jupyter-ntfy']?.enabled) {
                enabledCells.add(getCellId(cell));
            }
        }
        statusBarEmitter.fire(undefined);
    }

    const notebookOpenListener = vscode.window.onDidChangeActiveNotebookEditor((editor) => {
        if (editor) { restoreFromMetadata(editor.notebook); }
    });
    if (vscode.window.activeNotebookEditor) {
        restoreFromMetadata(vscode.window.activeNotebookEditor.notebook);
    }

    const setPasswordCommand = vscode.commands.registerCommand(
        'jupyter-ntfy.setPassword',
        async () => {
            const password = await vscode.window.showInputBox({
                prompt: 'Enter ntfy password',
                password: true,
                ignoreFocusOut: true
            });
            if (password === undefined) { return; }
            if (password === '') {
                await context.secrets.delete('jupyter-ntfy.password');
                vscode.window.showInformationMessage('ntfy password cleared.');
            } else {
                await context.secrets.store('jupyter-ntfy.password', password);
                vscode.window.showInformationMessage('ntfy password saved.');
            }
        }
    );

    context.subscriptions.push(toggleCommand, setPasswordCommand, executionListener, notebookOpenListener);

    // Per-cell bell icon in status bar
    const notebooksApi: any = (vscode as any).notebooks;
    if (notebooksApi?.registerNotebookCellStatusBarItemProvider && (vscode as any).NotebookCellStatusBarItem) {
        const provider: any = {
            onDidChangeStatusBarItems: statusBarEmitter.event,
            provideCellStatusBarItems: (cell: vscode.NotebookCell) => {
                const enabled = enabledCells.has(getCellId(cell));
                const item = new (vscode as any).NotebookCellStatusBarItem(
                    enabled ? '$(bell) On' : '$(bell-slash) Off',
                    (vscode as any).NotebookCellStatusBarAlignment.Right
                );
                item.tooltip = enabled ? 'Click to disable cell notifications' : 'Click to enable cell notifications';
                item.command = {
                    command: 'jupyter-ntfy.toggleNotification',
                    title: 'Toggle Cell Notification',
                    arguments: [cell]
                };
                return [item];
            }
        };
        context.subscriptions.push(
            notebooksApi.registerNotebookCellStatusBarItemProvider('jupyter-notebook', provider),
            vscode.window.onDidChangeNotebookEditorSelection(() => statusBarEmitter.fire(undefined))
        );
    }

    // Send both VS Code popup and ntfy push notification
    async function sendNotification(cell: vscode.NotebookCell, success: boolean | undefined) {
        const cellIndex = cell.index + 1;
        const fileName = cell.notebook.uri.path.split('/').pop() || 'Untitled';
        const status = success === false ? 'failed' : 'finished';
        const emoji = success === false ? '\u274C' : '\u2705';
        const cellSource = cell.document.getText().substring(0, 100);
        const truncated = cellSource.length === 100 ? cellSource + '...' : cellSource;

        // VS Code popup
        vscode.window.showInformationMessage(
            `${emoji} ${fileName} - Cell ${cellIndex} ${status}`,
            'Go to Cell',
            'Disable Notifications'
        ).then((selection) => {
            if (selection === 'Go to Cell') {
                const editor = vscode.window.activeNotebookEditor;
                if (editor && editor.notebook.uri.toString() === cell.notebook.uri.toString()) {
                    const range = new vscode.NotebookRange(cell.index, cell.index + 1);
                    editor.selections = [range];
                    editor.revealRange(range);
                }
            } else if (selection === 'Disable Notifications') {
                enabledCells.delete(getCellId(cell));
                setCellMetadata(cell, false);
            }
        });

        // ntfy push
        const config = vscode.workspace.getConfiguration('jupyter-ntfy');
        const topic = config.get<string>('topic', '');
        if (!topic) { return; }

        const server = (config.get<string>('server', 'ntfy.sh') || 'ntfy.sh').replace(/^https?:\/\//, '').replace(/\/$/, '');
        const username = config.get<string>('username', '');
        const password = await context.secrets.get('jupyter-ntfy.password');

        const title = `${fileName} - Cell ${cellIndex} ${status}`;
        const output = extractCellOutput(cell, 2000);
        const inputBlock = `**Input**\n\`\`\`python\n${truncated || '(empty cell)'}\n\`\`\``;
        const outputBlock = output ? `\n**Output**\n\`\`\`\n${output}\n\`\`\`` : '';
        const body = inputBlock + outputBlock;

        const headers: Record<string, string> = {
            'Title': title,
            'Tags': success === false ? 'x' : 'white_check_mark',
            'Markdown': 'true'
        };
        if (username && password) {
            headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
        }

        const url = `https://${server}/${encodeURIComponent(topic)}`;
        try {
            const res = await fetch(url, { method: 'POST', headers, body });
            if (!res.ok) { console.error('ntfy post failed:', res.status); }
        } catch (err) {
            console.error('ntfy post failed:', err);
        }
    }
}

function extractCellOutput(cell: vscode.NotebookCell, limit: number): string {
    const textMimes = new Set([
        'text/plain', 'application/vnd.code.notebook.stdout',
        'application/vnd.code.notebook.stderr', 'application/vnd.code.notebook.error'
    ]);
    const chunks: string[] = [];
    let length = 0;

    for (const output of cell.outputs ?? []) {
        for (const item of output.items ?? []) {
            if (!textMimes.has(item.mime)) { continue; }
            try {
                let text = Buffer.from(item.data as any).toString('utf8').trim();
                if (!text) { continue; }
                if (item.mime === 'application/vnd.code.notebook.error') {
                    try {
                        const parsed = JSON.parse(text);
                        if (parsed && (parsed.message || parsed.stack)) {
                            text = (parsed.stack || '').replace(/\x1b\[[0-9;]*m/g, '').split('\n').slice(0, 15).join('\n').trim();
                        }
                    } catch { /* not structured JSON, use raw */ }
                }
                chunks.push(text);
                length += text.length;
                if (length >= limit) {
                    const combined = chunks.join('\n');
                    return combined.substring(0, limit) + '\u2026';
                }
            } catch { /* skip */ }
        }
    }
    return chunks.join('\n');
}

function getCellId(cell: vscode.NotebookCell): string {
    return `${cell.document.uri.toString()}_${cell.index}`;
}

function setCellMetadata(cell: vscode.NotebookCell, enabled: boolean) {
    const metadata = { ...cell.metadata, 'jupyter-ntfy': { enabled } };
    const edit = new vscode.WorkspaceEdit();
    edit.set(cell.notebook.uri, [vscode.NotebookEdit.updateCellMetadata(cell.index, metadata)]);
    vscode.workspace.applyEdit(edit);
}

export function deactivate() {}
