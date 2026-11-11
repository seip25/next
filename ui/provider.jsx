"use client";
import { ToastProvider } from "./toast";
import { ConfirmProvider } from "./modal";

/**
 * Mount once in app/layout.js: enables useToast(), useSnackbar() and useConfirm().
 *   <body><UIProvider>{children}</UIProvider></body>
 */
export function UIProvider({ toastPosition = "bottom-right", toastDuration = 4000, children }) {
  return (
    <ToastProvider position={toastPosition} duration={toastDuration}>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  );
}

export default UIProvider;
