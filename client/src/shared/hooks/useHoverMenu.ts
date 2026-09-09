/**
 * useHoverMenu Hook
 *
 * Handles showing a menu on hover with a delay before closing to allow
 * smooth mouse movement from trigger to menu content.
 */

import { useState, useRef, useCallback, useEffect } from "react";

export interface UseHoverMenuOptions {
  /** Delay in milliseconds before closing when mouse leaves (default: 200) */
  closeDelay?: number;
}

export function useHoverMenu({ closeDelay = 200 }: UseHoverMenuOptions = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const open = useCallback(
    (pos: { x: number; y: number }) => {
      clearTimer();
      setPosition(pos);
      setIsOpen(true);
    },
    [clearTimer],
  );

  const close = useCallback(() => {
    clearTimer();
    setIsOpen(false);
  }, [clearTimer]);

  const startCloseTimer = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      setIsOpen(false);
    }, closeDelay);
  }, [clearTimer, closeDelay]);

  const cancelCloseTimer = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  return {
    isOpen,
    position,
    open,
    close,
    startCloseTimer,
    cancelCloseTimer,
  };
}
