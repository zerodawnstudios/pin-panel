import * as vscode from 'vscode';
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

  // Refresh tree whenever storage changes externally (file watcher)
  context.subscriptions.push(storage.onDidChange(() => provider.refresh()));

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
