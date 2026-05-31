import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PinStorage } from './PinStorage';
import { Pin, Group } from './types';

const DRAG_MIME = 'application/vnd.pin-panel';

interface DragPayload {
  id: string;
  type: 'pin' | 'group';
}

export class PinTreeItem extends vscode.TreeItem {
  constructor(
    public readonly itemType: 'pin' | 'group',
    public readonly itemId: string,
    label: string,
    description: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly pin?: Pin,
    public readonly group?: Group,
  ) {
    super(label, collapsibleState);
    this.id = itemId;
    this.description = description;
    this.contextValue = itemType;
  }
}

export class PinTreeProvider
  implements vscode.TreeDataProvider<PinTreeItem>, vscode.TreeDragAndDropController<PinTreeItem>
{
  readonly dragMimeTypes = [DRAG_MIME];
  readonly dropMimeTypes = [DRAG_MIME];

  private _onDidChangeTreeData = new vscode.EventEmitter<PinTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly storage: PinStorage,
    private readonly workspaceRoot: string,
  ) {}

  refresh(activeRelativePath?: string): void {
    vscode.commands.executeCommand('setContext', 'pin-panel.hasGroups', this.storage.getGroups().length > 0);
    if (activeRelativePath !== undefined) {
      vscode.commands.executeCommand('setContext', 'pin-panel.activeFileIsPinned', this.storage.isAlreadyPinned(activeRelativePath));
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PinTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: PinTreeItem): PinTreeItem[] {
    if (!element) {
      const ungrouped = this.storage.getUngroupedPins().map(p => this.makePinItem(p));
      const groups = this.storage.getGroups().map(g => this.makeGroupItem(g));
      return [...ungrouped, ...groups];
    }
    if (element.itemType === 'group' && element.group) {
      return this.storage.getPinsForGroup(element.group.id).map(p => this.makePinItem(p));
    }
    return [];
  }

  private makePinItem(pin: Pin): PinTreeItem {
    const fullPath = path.join(this.workspaceRoot, pin.relativePath);
    const exists = fs.existsSync(fullPath);

    const item = new PinTreeItem(
      'pin',
      pin.id,
      pin.alias,
      pin.relativePath,
      vscode.TreeItemCollapsibleState.None,
      pin,
    );

    item.command = {
      command: 'pin-panel.openPin',
      title: 'Open File',
      arguments: [pin],
    };

    if (exists) {
      item.resourceUri = vscode.Uri.file(fullPath);
      item.tooltip = pin.relativePath;
    } else {
      item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
      item.tooltip = `File not found: ${pin.relativePath}`;
    }

    return item;
  }

  private makeGroupItem(group: Group): PinTreeItem {
    const item = new PinTreeItem(
      'group',
      group.id,
      group.name,
      '',
      vscode.TreeItemCollapsibleState.Expanded,
      undefined,
      group,
    );
    item.iconPath = new vscode.ThemeIcon('folder');
    return item;
  }

  // ── Drag & Drop ────────────────────────────────────────────────────────────

  handleDrag(
    source: readonly PinTreeItem[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken,
  ): void {
    const payload: DragPayload[] = source.map(item => ({
      id: item.itemId,
      type: item.itemType,
    }));
    dataTransfer.set(DRAG_MIME, new vscode.DataTransferItem(JSON.stringify(payload)));
  }

  handleDrop(
    target: PinTreeItem | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken,
  ): void {
    const raw = dataTransfer.get(DRAG_MIME);
    if (!raw) return;

    let payload: DragPayload[];
    try {
      payload = JSON.parse(raw.value as string) as DragPayload[];
    } catch {
      return;
    }

    for (const item of payload) {
      if (item.type === 'pin') {
        this.dropPin(item.id, target);
      } else if (item.type === 'group') {
        this.dropGroup(item.id, target);
      }
    }

    this.refresh();
  }

  private dropPin(pinId: string, target: PinTreeItem | undefined): void {
    const allPins = this.storage.getPins();
    const draggedIdx = allPins.findIndex(p => p.id === pinId);
    if (draggedIdx === -1) return;
    const dragged = allPins[draggedIdx];

    let newGroupId: string | null = null;
    let insertBeforeId: string | null = null;

    if (!target) {
      // Dropped on empty space → end of ungrouped
      newGroupId = null;
    } else if (target.itemType === 'group' && target.group) {
      // Dropped on a group node → append to that group
      newGroupId = target.group.id;
    } else if (target.itemType === 'pin' && target.pin) {
      // Dropped on a sibling pin → insert before it, inherit its group
      newGroupId = target.pin.groupId;
      insertBeforeId = target.pin.id;
    }

    const newPins = allPins.filter(p => p.id !== pinId);
    const updated: Pin = { ...dragged, groupId: newGroupId };

    if (insertBeforeId) {
      const idx = newPins.findIndex(p => p.id === insertBeforeId);
      newPins.splice(idx !== -1 ? idx : newPins.length, 0, updated);
    } else if (newGroupId === null) {
      // Append after last ungrouped pin
      let lastUngrouped = -1;
      for (let i = newPins.length - 1; i >= 0; i--) {
        if (newPins[i].groupId === null) { lastUngrouped = i; break; }
      }
      newPins.splice(lastUngrouped + 1, 0, updated);
    } else {
      // Append after last pin in target group
      let lastInGroup = -1;
      for (let i = newPins.length - 1; i >= 0; i--) {
        if (newPins[i].groupId === newGroupId) { lastInGroup = i; break; }
      }
      newPins.splice(lastInGroup + 1, 0, updated);
    }

    this.storage.setPins(newPins);
  }

  private dropGroup(groupId: string, target: PinTreeItem | undefined): void {
    const allGroups = this.storage.getGroups();
    const draggedIdx = allGroups.findIndex(g => g.id === groupId);
    if (draggedIdx === -1) return;
    const dragged = allGroups[draggedIdx];

    const newGroups = allGroups.filter(g => g.id !== groupId);

    if (target?.itemType === 'group' && target.group) {
      const targetIdx = newGroups.findIndex(g => g.id === target.group!.id);
      newGroups.splice(targetIdx !== -1 ? targetIdx : newGroups.length, 0, dragged);
    } else {
      newGroups.push(dragged);
    }

    this.storage.setGroups(newGroups);
  }
}
