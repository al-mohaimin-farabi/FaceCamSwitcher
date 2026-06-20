import type { ObserverStatus } from "../lib/debugger/types";
import { STATUS_LABELS } from "../lib/debugger/types";

export default function StatusBadge({ status }: { status: ObserverStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      <span className="dot" />
      {STATUS_LABELS[status]}
    </span>
  );
}
