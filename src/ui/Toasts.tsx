import { useMythos } from "../state/store";
import { Icon } from "./icons";

const TONE_ICON = {
  success: "check",
  error: "close",
  warning: "info",
  info: "info",
} as const;

export function Toasts() {
  const toasts = useMythos((s) => s.toasts);
  const dismiss = useMythos((s) => s.dismissToast);

  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          <span className="toast__icon" aria-hidden="true">
            <Icon name={TONE_ICON[toast.tone]} size={15} />
          </span>
          <div className="toast__body">
            <p className="toast__title">{toast.title}</p>
            {toast.message ? <p className="toast__message">{toast.message}</p> : null}
          </div>
          <button className="toast__close" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}