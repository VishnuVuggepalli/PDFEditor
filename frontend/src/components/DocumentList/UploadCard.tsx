import { Icon } from '../shared/Icon';

export interface UploadTask {
  id: string;
  name: string;
  pct: number;
  status: 'uploading' | 'error';
  error?: string;
}

interface Props {
  task: UploadTask;
  onCancel: (id: string) => void;
}

export function UploadCard({ task, onCancel }: Props) {
  if (task.status === 'error') {
    return (
      <div className="up-card error">
        <span className="up-ico">
          <Icon name="alert" size={18} />
        </span>
        <div className="up-body">
          <div className="up-name">{task.name}</div>
          <div className="up-msg">{task.error}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="up-card">
      <span className="up-ico">
        <Icon name="fileText" size={18} />
      </span>
      <div className="up-body">
        <div className="up-top">
          <span className="up-name">{task.name}</span>
          <span className="up-pct tnum">{task.pct}%</span>
        </div>
        <div className="up-bar">
          <i style={{ width: `${task.pct}%` }}></i>
        </div>
      </div>
      <button className="iconbtn up-x" onClick={() => onCancel(task.id)} aria-label="Cancel">
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}
