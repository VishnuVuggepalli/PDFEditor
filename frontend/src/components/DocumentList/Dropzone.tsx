import { useRef, useState } from 'react';
import { Icon } from '../shared/Icon';

interface Props {
  onFiles: (files: FileList) => void;
}

export function Dropzone({ onFiles }: Props) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`dropzone ${over ? 'over' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles(e.dataTransfer.files);
      }}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div className="dz-icon">
        <Icon name="upload" size={24} />
      </div>
      <div className="dz-title">
        Drop PDFs here or <span className="lnk">click to browse</span>
      </div>
      <div className="dz-sub">PDF only · up to 50 MB · multiple files supported</div>
    </div>
  );
}
