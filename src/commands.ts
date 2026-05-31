import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { PinStorage } from './PinStorage';
import { PinTreeProvider, PinTreeItem } from './PinTreeProvider';
import { Pin } from './types';

interface GroupQuickPickItem extends vscode.QuickPickItem {
  groupId: string | null;
}

function activeRelativePath(workspaceRoot: string): string {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.uri.scheme !== 'file') return '';
  return path.relative(workspaceRoot, editor.document.uri.fsPath).replace(/\\/g, '/');
}

export function registerCommands(
  context: vscode.ExtensionContext,
  storage: PinStorage,
  provider: PinTreeProvider,
  workspaceRoot: string,
): void {
  const refresh = () => provider.refresh(activeRelativePath(workspaceRoot));

  context.subscriptions.push(

    // ── Open pin ──────────────────────────────────────────────────────────────
    vscode.commands.registerCommand('pin-panel.openPin', (pin: Pin) => {
      const fullPath = path.join(workspaceRoot, pin.relativePath);
      if (!fs.existsSync(fullPath)) {
        vscode.window.showWarningMessage(`File not found: ${pin.relativePath}`);
        return;
      }
      vscode.window.showTextDocument(vscode.Uri.file(fullPath), { preview: false });
    }),

    // ── Pin current file (from toolbar) ───────────────────────────────────────
    vscode.commands.registerCommand('pin-panel.pinCurrentFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active file to pin.');
        return;
      }
      await pinFileUri(editor.document.uri, storage, provider, workspaceRoot);
    }),

    // ── Pin file from Explorer context menu ───────────────────────────────────
    vscode.commands.registerCommand('pin-panel.pinFile', async (uri?: vscode.Uri) => {
      if (!uri) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        uri = editor.document.uri;
      }
      await pinFileUri(uri, storage, provider, workspaceRoot);
    }),

    // ── New group ─────────────────────────────────────────────────────────────
    vscode.commands.registerCommand('pin-panel.newGroup', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Group name',
        placeHolder: 'e.g. Routes',
        validateInput: v => v.trim() ? undefined : 'Name cannot be empty',
      });
      if (!name) return;
      storage.addGroup({ id: randomUUID(), name: name.trim() });
      refresh();
    }),

    // ── Jump to pinned file (Quick Pick) ──────────────────────────────────────
    vscode.commands.registerCommand('pin-panel.openQuickPick', async () => {
      const pins = storage.getPins();
      if (pins.length === 0) {
        vscode.window.showInformationMessage('No pinned files yet.');
        return;
      }
      const groups = storage.getGroups();
      const groupMap = new Map(groups.map(g => [g.id, g.name]));

      interface PinQuickPickItem extends vscode.QuickPickItem { pin: Pin; }

      const items: PinQuickPickItem[] = pins.map(p => ({
        label: `$(pin) ${p.alias}`,
        description: p.relativePath,
        detail: p.groupId ? `pin · ${groupMap.get(p.groupId) ?? p.groupId}` : 'pin',
        alwaysShow: true,
        pin: p,
      }));

      const picked = await vscode.window.showQuickPick<PinQuickPickItem>(items, {
        placeHolder: 'Jump to pinned file…',
        matchOnDescription: true,
      });

      if (picked) {
        vscode.commands.executeCommand('pin-panel.openPin', picked.pin);
      }
    }),

    // ── Rename alias ──────────────────────────────────────────────────────────
    vscode.commands.registerCommand('pin-panel.renameAlias', async (item: PinTreeItem) => {
      if (!item?.pin) return;
      const alias = await vscode.window.showInputBox({
        prompt: 'New alias',
        value: item.pin.alias,
        validateInput: v => v.trim() ? undefined : 'Alias cannot be empty',
      });
      if (!alias) return;
      storage.updatePin(item.pin.id, { alias: alias.trim() });
      refresh();
    }),

    // ── Move to group ─────────────────────────────────────────────────────────
    vscode.commands.registerCommand('pin-panel.moveToGroup', async (item: PinTreeItem) => {
      if (!item?.pin) return;
      const groups = storage.getGroups();
      const picks: GroupQuickPickItem[] = [
        { label: '$(circle-slash) Ungrouped', description: 'Remove from any group', groupId: null },
        ...groups.map(g => ({ label: g.name, groupId: g.id })),
      ];
      const picked = await vscode.window.showQuickPick<GroupQuickPickItem>(picks, {
        placeHolder: 'Move pin to group',
      });
      if (picked === undefined) return;
      storage.updatePin(item.pin.id, { groupId: picked.groupId });
      refresh();
    }),

    // ── Copy path ─────────────────────────────────────────────────────────────
    vscode.commands.registerCommand('pin-panel.copyPath', (item: PinTreeItem) => {
      if (!item?.pin) return;
      vscode.env.clipboard.writeText(item.pin.relativePath);
      vscode.window.setStatusBarMessage(`Copied: ${item.pin.relativePath}`, 3000);
    }),

    // ── Unpin ─────────────────────────────────────────────────────────────────
    vscode.commands.registerCommand('pin-panel.unpin', async (item: PinTreeItem) => {
      if (!item?.pin) return;
      const confirm = await vscode.window.showWarningMessage(
        `Unpin "${item.pin.alias}"?`,
        { modal: true },
        'Unpin',
      );
      if (confirm !== 'Unpin') return;
      storage.removePin(item.pin.id);
      refresh();
    }),

    // ── Unpin from Explorer ───────────────────────────────────────────────────
    vscode.commands.registerCommand('pin-panel.unpinFileFromExplorer', (uri: vscode.Uri) => {
      if (!uri || uri.scheme !== 'file') return;
      const relativePath = path.relative(workspaceRoot, uri.fsPath).replace(/\\/g, '/');
      const pin = storage.getPins().find(p => p.relativePath === relativePath);
      if (!pin) return;
      storage.removePin(pin.id);
      refresh();
      vscode.window.setStatusBarMessage(`Unpinned: ${pin.alias}`, 3000);
    }),

    // ── Rename group ──────────────────────────────────────────────────────────
    vscode.commands.registerCommand('pin-panel.renameGroup', async (item: PinTreeItem) => {
      if (!item?.group) return;
      const name = await vscode.window.showInputBox({
        prompt: 'Group name',
        value: item.group.name,
        validateInput: v => v.trim() ? undefined : 'Name cannot be empty',
      });
      if (!name) return;
      storage.updateGroup(item.group.id, { name: name.trim() });
      refresh();
    }),

    // ── Delete group ──────────────────────────────────────────────────────────
    vscode.commands.registerCommand('pin-panel.deleteGroup', async (item: PinTreeItem) => {
      if (!item?.group) return;
      const pinCount = storage.getPinsForGroup(item.group.id).length;
      const detail = pinCount > 0
        ? `${pinCount} pinned file${pinCount > 1 ? 's' : ''} will become ungrouped.`
        : undefined;
      const confirm = await vscode.window.showWarningMessage(
        `Delete group "${item.group.name}"?`,
        { modal: true, detail },
        'Delete',
      );
      if (confirm !== 'Delete') return;
      storage.removeGroup(item.group.id);
      refresh();
    }),

  );
}

async function pinFileUri(
  uri: vscode.Uri,
  storage: PinStorage,
  provider: PinTreeProvider,
  workspaceRoot: string,
): Promise<void> {
  if (uri.scheme !== 'file') return;

  const relativePath = path.relative(workspaceRoot, uri.fsPath).replace(/\\/g, '/');

  if (storage.isAlreadyPinned(relativePath)) return;

  const defaultAlias = path.basename(uri.fsPath, path.extname(uri.fsPath));

  const alias = await vscode.window.showInputBox({
    prompt: 'Pin alias (shown in sidebar)',
    value: defaultAlias,
    placeHolder: 'e.g. Root Layout',
    validateInput: v => v.trim() ? undefined : 'Alias cannot be empty',
  });
  if (!alias) return;

  const groups = storage.getGroups();
  let groupId: string | null = null;

  if (groups.length > 0) {
    interface GroupQuickPickItem extends vscode.QuickPickItem { groupId: string | null; }
    const picks: GroupQuickPickItem[] = [
      { label: '$(circle-slash) No group', description: 'Leave ungrouped', groupId: null },
      ...groups.map(g => ({ label: g.name, groupId: g.id })),
    ];
    const picked = await vscode.window.showQuickPick<GroupQuickPickItem>(picks, {
      placeHolder: 'Assign to group (optional)',
    });
    if (picked !== undefined) {
      groupId = picked.groupId;
    }
  }

  storage.addPin({ id: randomUUID(), alias: alias.trim(), relativePath, groupId });
  provider.refresh(activeRelativePath(workspaceRoot));
  vscode.window.setStatusBarMessage(`Pinned: ${alias.trim()}`, 3000);
}
