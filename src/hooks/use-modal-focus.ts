"use client";

import { useEffect, useRef } from "react";

const focusableSelector = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "details > summary:first-of-type",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

let bodyLockCount = 0;
let previousBodyOverflow = "";

function lockBodyScroll() {
  if (bodyLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyLockCount += 1;
}

function unlockBodyScroll() {
  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount === 0) document.body.style.overflow = previousBodyOverflow;
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => element.getClientRects().length > 0 && !element.closest("[aria-hidden='true'], [inert]"),
  );
}

export function useModalFocus<
  TriggerElement extends HTMLElement = HTMLButtonElement,
  DialogElement extends HTMLElement = HTMLElement,
>({
  onClose,
  open,
}: {
  onClose: () => void;
  open: boolean;
}) {
  const dialogRef = useRef<DialogElement>(null);
  const triggerRef = useRef<TriggerElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const currentDialog = dialogRef.current;
    if (!currentDialog) return;
    const dialog: HTMLElement = currentDialog;

    const restoreTarget = triggerRef.current
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    lockBodyScroll();

    const focusFrame = window.requestAnimationFrame(() => {
      const initialFocus = dialog.querySelector<HTMLElement>("[data-modal-initial-focus]")
        ?? getFocusableElements(dialog)[0]
        ?? dialog;
      initialFocus.focus({ preventScroll: true });
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements(dialog);
      if (!focusableElements.length) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);
      const activeElement = document.activeElement;

      if (!firstElement || !lastElement) return;

      if (event.shiftKey && (activeElement === firstElement || activeElement === dialog || !dialog.contains(activeElement))) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && (activeElement === lastElement || activeElement === dialog || !dialog.contains(activeElement))) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      unlockBodyScroll();
      if (restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true });
    };
  }, [open]);

  return { dialogRef, triggerRef };
}
