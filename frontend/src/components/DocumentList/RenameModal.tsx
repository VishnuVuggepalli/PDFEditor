import { useEffect, useRef, useState } from 'react';
import { Modal } from '../shared/Modal';

interface Props {
  initialName: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}

export function RenameModal({ initialName, onSave, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const save = () => {
    if (name.trim()) onSave(name.trim());
  };
  return (
    <Modal title="Rename document" confirmLabel="Save" onConfirm={save} onCancel={onCancel}>
      <input
        ref={ref}
        className="rename-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
        }}
      />
    </Modal>
  );
}
