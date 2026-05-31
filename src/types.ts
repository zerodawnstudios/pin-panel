export interface Pin {
  id: string;
  alias: string;
  relativePath: string;
  groupId: string | null;
}

export interface Group {
  id: string;
  name: string;
}

export interface PinnedFilesData {
  groups: Group[];
  pins: Pin[];
}
