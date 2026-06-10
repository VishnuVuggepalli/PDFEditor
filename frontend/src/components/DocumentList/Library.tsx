/** Screen 1: document library — real API (list, upload, rename, delete,
 * duplicate, download). */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteDocument,
  downloadToDisk,
  duplicateDocument,
  listDocuments,
  mergeDocuments,
  renameDocument,
  uploadDocument,
} from '../../api/documents';
import type { DocumentRecord } from '../../types/document';
import { toggleId } from '../../utils/mergeOrder';
import { Icon } from '../shared/Icon';
import { Modal } from '../shared/Modal';
import { useToast } from '../shared/toastContext';
import { DocCard } from './DocCard';
import { DocRow } from './DocRow';
import type { DocActions } from './docMenu';
import { Dropzone } from './Dropzone';
import { MergeModal } from './MergeModal';
import { RenameModal } from './RenameModal';
import { CardSkeleton, RowSkeleton } from './Skeletons';
import { UploadCard } from './UploadCard';
import type { UploadTask } from './UploadCard';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const uid = () => Math.random().toString(36).slice(2, 9);

interface Props {
  navigate: (id: string | null) => void;
  libView?: 'grid' | 'list';
  themeToggle: React.ReactNode;
}

export function Library({ navigate, libView = 'grid', themeToggle }: Props) {
  const push = useToast();
  const qc = useQueryClient();
  const [confirmDel, setConfirmDel] = useState<DocumentRecord | null>(null);
  const [renaming, setRenaming] = useState<DocumentRecord | null>(null);
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const aborts = useRef<Record<string, () => void>>({});
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [merging, setMerging] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const docsQuery = useQuery({ queryKey: ['documents'], queryFn: listDocuments });
  const docs = docsQuery.data ?? [];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['documents'] });

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameDocument(id, name),
    onSuccess: (doc) => {
      void invalidate();
      push({ type: 'success', title: 'Renamed', msg: doc.name });
      setRenaming(null);
    },
  });
  const deleteMut = useMutation({
    mutationFn: (doc: DocumentRecord) => deleteDocument(doc.id),
    onSuccess: (_, doc) => {
      void invalidate();
      push({ type: 'success', title: 'Document deleted', msg: doc.name });
    },
  });
  const duplicateMut = useMutation({
    mutationFn: (doc: DocumentRecord) => duplicateDocument(doc),
    onSuccess: (copy) => {
      void invalidate();
      push({ type: 'success', title: 'Duplicated', msg: copy.name });
    },
  });
  const mergeMut = useMutation({
    mutationFn: ({ ids, name }: { ids: string[]; name: string }) => mergeDocuments(ids, name),
    onSuccess: (doc, { ids }) => {
      void invalidate();
      push({
        type: 'success',
        title: `Merged ${ids.length} documents`,
        msg: doc.name,
      });
      setMerging(false);
      setSelectedIds([]);
      setSelectMode(false);
      setHighlightId(doc.id);
      setTimeout(() => setHighlightId((h) => (h === doc.id ? null : h)), 5000);
    },
  });

  /* ---- multi-select for merge ---- */
  // selection order = default merge order; drop ids of since-deleted docs
  const selectedDocs = selectedIds
    .map((id) => docs.find((d) => d.id === id))
    .filter((d): d is DocumentRecord => d !== undefined);

  function clearSelection() {
    setSelectedIds([]);
    setSelectMode(false);
  }
  const selectionFor = (doc: DocumentRecord) => ({
    selecting: selectMode,
    selected: selectedIds.includes(doc.id),
    onToggleSelect: (id: string) => setSelectedIds((ids) => toggleId(ids, id)),
    highlight: highlightId === doc.id,
  });

  function addError(name: string, error: string) {
    const id = uid();
    setUploads((u) => [...u, { id, name, pct: 0, status: 'error', error }]);
    setTimeout(() => setUploads((u) => u.filter((t) => t.id !== id)), 4000);
  }

  function startUpload(f: File) {
    const id = uid();
    setUploads((u) => [...u, { id, name: f.name, pct: 0, status: 'uploading' }]);
    const { promise, abort } = uploadDocument(f, (pct) =>
      setUploads((u) => u.map((t) => (t.id === id ? { ...t, pct } : t))),
    );
    aborts.current[id] = abort;
    promise
      .then(() => {
        setUploads((u) => u.filter((t) => t.id !== id));
        void invalidate();
        push({ type: 'success', title: 'Upload complete', msg: f.name });
      })
      .catch((e: unknown) => {
        setUploads((u) => u.filter((t) => t.id !== id));
        const msg = e instanceof Error ? e.message : 'upload failed';
        if (msg !== 'upload canceled') addError(f.name, msg);
      })
      .finally(() => {
        delete aborts.current[id];
      });
  }

  function onFiles(files: FileList) {
    for (const f of files) {
      const isPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
      if (!isPdf) {
        addError(f.name, 'Not a PDF — only .pdf files are supported.');
        continue;
      }
      if (f.size > MAX_UPLOAD_BYTES) {
        addError(f.name, 'Too large — 50 MB maximum.');
        continue;
      }
      startUpload(f);
    }
  }

  function cancelUpload(id: string) {
    aborts.current[id]?.();
    setUploads((u) => u.filter((t) => t.id !== id));
    push({ type: 'error', title: 'Upload canceled' });
  }

  const actions: DocActions = {
    onOpen: navigate,
    onRename: setRenaming,
    onDuplicate: (doc) => duplicateMut.mutate(doc),
    onDownload: (doc) => {
      void downloadToDisk(doc).then(() =>
        push({ type: 'success', title: 'Download started', msg: doc.name }),
      );
    },
    onDelete: setConfirmDel,
  };

  const loading = docsQuery.isLoading;

  return (
    <div className="lib">
      <div className="lib-top">
        <div className="brand">
          <span className="logo">
            <Icon name="file" size={16} />
          </span>
          PDFEditor
        </div>
        {themeToggle}
      </div>
      <div className="lib-scroll scroll">
        <div className="lib-inner">
          <Dropzone onFiles={onFiles} />

          {uploads.length > 0 && (
            <div className="upload-list">
              <div className="lib-sec" style={{ margin: '24px 0 12px' }}>
                <h2>Uploading</h2>
                <span className="cnt">
                  {uploads.filter((u) => u.status === 'uploading').length} in progress
                </span>
              </div>
              <div className="up-stack">
                {uploads.map((t) => (
                  <UploadCard key={t.id} task={t} onCancel={cancelUpload} />
                ))}
              </div>
            </div>
          )}

          <div className="lib-sec">
            <h2>Your documents</h2>
            <div className="lib-sec-right">
              {docs.length >= 2 && (
                <button
                  className={`btn sm ${selectMode ? 'active' : ''}`}
                  onClick={() => (selectMode ? clearSelection() : setSelectMode(true))}
                >
                  {selectMode ? 'Done' : 'Select'}
                </button>
              )}
              <span className="cnt">
                {loading ? '' : `${docs.length} ${docs.length === 1 ? 'file' : 'files'}`}
              </span>
            </div>
          </div>

          {loading ? (
            libView === 'list' ? (
              <div className="doc-list">
                {Array.from({ length: 5 }).map((_, i) => (
                  <RowSkeleton key={i} />
                ))}
              </div>
            ) : (
              <div className="doc-grid">
                {Array.from({ length: 6 }).map((_, i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            )
          ) : docs.length === 0 ? (
            <div className="empty">
              <div className="e-icon">
                <Icon name="fileText" size={26} />
              </div>
              <h3>No documents yet</h3>
              <p>Upload your first PDF to get started.</p>
            </div>
          ) : libView === 'list' ? (
            <div className="doc-list">
              <div className="doc-list-head">
                <span style={{ gridColumn: '1 / 3' }}>Name</span>
                <span>Pages</span>
                <span>Size</span>
                <span>Version</span>
                <span></span>
              </div>
              {docs.map((d) => (
                <DocRow key={d.id} doc={d} actions={actions} selection={selectionFor(d)} />
              ))}
            </div>
          ) : (
            <div className="doc-grid">
              {docs.map((d) => (
                <DocCard key={d.id} doc={d} actions={actions} selection={selectionFor(d)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedDocs.length > 0 && (
        <div className="select-bar">
          <span className="sb-count">
            {selectedDocs.length} selected
          </span>
          <button className="btn" onClick={clearSelection}>
            Clear
          </button>
          <button
            className="btn primary"
            disabled={selectedDocs.length < 2}
            title={selectedDocs.length < 2 ? 'Select at least 2 documents to merge' : undefined}
            onClick={() => setMerging(true)}
          >
            <Icon name="merge" size={15} />
            Merge {selectedDocs.length} {selectedDocs.length === 1 ? 'document' : 'documents'}
          </button>
        </div>
      )}

      {merging && selectedDocs.length >= 2 && (
        <MergeModal
          docs={selectedDocs}
          busy={mergeMut.isPending}
          onMerge={(ids, name) => mergeMut.mutate({ ids, name })}
          onCancel={() => setMerging(false)}
        />
      )}
      {renaming && (
        <RenameModal
          initialName={renaming.name}
          onSave={(name) => renameMut.mutate({ id: renaming.id, name })}
          onCancel={() => setRenaming(null)}
        />
      )}
      {confirmDel && (
        <Modal
          title="Delete document?"
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            deleteMut.mutate(confirmDel);
            setConfirmDel(null);
          }}
          onCancel={() => setConfirmDel(null)}
        >
          “{confirmDel.name}” and its version history will be permanently removed. This can’t be
          undone.
        </Modal>
      )}
    </div>
  );
}
