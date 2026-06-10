import type { DocumentRecord } from '../../types/document';
import type { KebabItem } from '../shared/Kebab';

export interface DocActions {
  onOpen: (id: string) => void;
  onRename: (doc: DocumentRecord) => void;
  onDuplicate: (doc: DocumentRecord) => void;
  onDownload: (doc: DocumentRecord) => void;
  onDelete: (doc: DocumentRecord) => void;
}

/** Shared kebab item set for a document (design parity). */
export function docMenu(doc: DocumentRecord, a: DocActions): KebabItem[] {
  return [
    { label: 'Open', icon: 'fileText', onClick: () => a.onOpen(doc.id) },
    { label: 'Rename', icon: 'pen', onClick: () => a.onRename(doc) },
    { label: 'Duplicate', icon: 'copy', onClick: () => a.onDuplicate(doc) },
    { sep: true },
    { label: 'Download', icon: 'download', onClick: () => a.onDownload(doc) },
    { sep: true },
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => a.onDelete(doc) },
  ];
}
