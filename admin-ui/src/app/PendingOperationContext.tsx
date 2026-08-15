import type { PropsWithChildren } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

interface PendingOperationValue {
  pending: boolean;
  hold: () => () => void;
}

const PendingOperationContext = createContext<PendingOperationValue | null>(
  null,
);

/**
 * Tracks operations that must not be abandoned. Some mutations answer with a
 * secret the server keeps no readable copy of, so leaving the page while one is
 * in flight destroys the only copy the user will ever be offered.
 */
export function PendingOperationProvider({ children }: PropsWithChildren) {
  const [holds, setHolds] = useState(0);
  const hold = useCallback(() => {
    setHolds((count) => count + 1);
    return () => setHolds((count) => count - 1);
  }, []);
  const pending = holds > 0;

  useEffect(() => {
    if (!pending) {
      return;
    }
    const confirmLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", confirmLeaving);
    return () => window.removeEventListener("beforeunload", confirmLeaving);
  }, [pending]);

  const value = useMemo(() => ({ pending, hold }), [pending, hold]);

  return (
    <PendingOperationContext.Provider value={value}>
      {children}
    </PendingOperationContext.Provider>
  );
}

export function usePendingOperations(): PendingOperationValue {
  const value = useContext(PendingOperationContext);
  if (value === null) {
    throw new Error("PendingOperationProvider is missing");
  }
  return value;
}

export function useHoldNavigation(active: boolean): void {
  const { hold } = usePendingOperations();
  useEffect(() => {
    if (!active) {
      return;
    }
    return hold();
  }, [active, hold]);
}
