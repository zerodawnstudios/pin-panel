import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Pin, Group, PinnedFilesData } from './types';

export class PinStorage {
  private data: PinnedFilesData = { groups: [], pins: [] };
  private watcher?: vscode.FileSystemWatcher;
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly workspaceRoot: string) {}

  private get filePath(): string {
    return path.join(this.workspaceRoot, '.vscode', 'pinned-files.json');
  }

  load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<PinnedFilesData>;
        this.data = {
          groups: Array.isArray(parsed.groups) ? parsed.groups : [],
          pins: Array.isArray(parsed.pins) ? parsed.pins : [],
        };
      }
    } catch {
      this.data = { groups: [], pins: [] };
    }
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  startWatching(context: vscode.ExtensionContext): void {
    const pattern = new vscode.RelativePattern(this.workspaceRoot, '.vscode/pinned-files.json');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.watcher.onDidChange(() => { this.load(); this._onDidChange.fire(); });
    this.watcher.onDidCreate(() => { this.load(); this._onDidChange.fire(); });
    this.watcher.onDidDelete(() => { this.data = { groups: [], pins: [] }; this._onDidChange.fire(); });
    context.subscriptions.push(this.watcher);
  }

  getGroups(): Group[] {
    return this.data.groups;
  }

  getPins(): Pin[] {
    return this.data.pins;
  }

  getUngroupedPins(): Pin[] {
    return this.data.pins.filter(p => p.groupId === null);
  }

  getPinsForGroup(groupId: string): Pin[] {
    return this.data.pins.filter(p => p.groupId === groupId);
  }

  isAlreadyPinned(relativePath: string): boolean {
    return this.data.pins.some(p => p.relativePath === relativePath);
  }

  addPin(pin: Pin): void {
    this.data.pins.push(pin);
    this.save();
  }

  removePin(id: string): void {
    this.data.pins = this.data.pins.filter(p => p.id !== id);
    this.save();
  }

  updatePin(id: string, updates: Partial<Omit<Pin, 'id'>>): void {
    const idx = this.data.pins.findIndex(p => p.id === id);
    if (idx !== -1) {
      this.data.pins[idx] = { ...this.data.pins[idx], ...updates };
      this.save();
    }
  }

  addGroup(group: Group): void {
    this.data.groups.push(group);
    this.save();
  }

  removeGroup(id: string): void {
    this.data.groups = this.data.groups.filter(g => g.id !== id);
    // Orphaned pins fall back to ungrouped
    this.data.pins = this.data.pins.map(p => p.groupId === id ? { ...p, groupId: null } : p);
    this.save();
  }

  updateGroup(id: string, updates: Partial<Omit<Group, 'id'>>): void {
    const idx = this.data.groups.findIndex(g => g.id === id);
    if (idx !== -1) {
      this.data.groups[idx] = { ...this.data.groups[idx], ...updates };
      this.save();
    }
  }

  /** Replace entire pins array (used by drag-and-drop reorder). */
  setPins(pins: Pin[]): void {
    this.data.pins = pins;
    this.save();
  }

  /** Replace entire groups array (used by drag-and-drop reorder). */
  setGroups(groups: Group[]): void {
    this.data.groups = groups;
    this.save();
  }
}
