import * as vscode from 'vscode';
import * as path from 'path';
import { PinStorage } from './PinStorage';
import { PinTreeProvider } from './PinTreeProvider';
import { registerCommands } from './commands';

export function activate(context: vscode.ExtensionContext): void {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  const storage = new PinStorage(workspaceRoot);
  storage.load();
  storage.startWatching(context);

  const provider = new PinTreeProvider(storage, workspaceRoot);

  const syncActiveFileContext = (editor: vscode.TextEditor | undefined) => {
    const relativePath = editor?.document.uri.scheme === 'file'
      ? path.relative(workspaceRoot, editor.document.uri.fsPath).replace(/\\/g, '/')
      : '';
    provider.refresh(relativePath);
  };

  // Refresh tree whenever storage changes externally (file watcher)
  context.subscriptions.push(storage.onDidChange(() => syncActiveFileContext(vscode.window.activeTextEditor)));

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(syncActiveFileContext));

  // Set initial context
  syncActiveFileContext(vscode.window.activeTextEditor);

  const treeView = vscode.window.createTreeView('pin-panel.view', {
    treeDataProvider: provider,
    dragAndDropController: provider,
    showCollapseAll: true,
    canSelectMany: false,
  });

  context.subscriptions.push(treeView);

  registerCommands(context, storage, provider, workspaceRoot);
}

export function deactivate(): void {}
