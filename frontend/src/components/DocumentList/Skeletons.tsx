export function CardSkeleton() {
  return (
    <div className="card-skel">
      <div className="cs-thumb skel"></div>
      <div className="cs-meta">
        <div className="skel" style={{ height: 13, width: '80%' }}></div>
        <div className="skel" style={{ height: 11, width: '50%' }}></div>
        <div className="skel" style={{ height: 11, width: '64%', marginTop: 6 }}></div>
      </div>
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="row-skel">
      <div className="skel" style={{ width: 40, height: 52, borderRadius: 4 }}></div>
      <div className="skel" style={{ height: 13, width: '40%' }}></div>
    </div>
  );
}
