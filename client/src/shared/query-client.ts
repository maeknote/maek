import { QueryClient } from "@tanstack/react-query";

/**
 * Disk snapshots are server state. QueryClient owns request de-duplication and
 * invalidation; Zustand remains responsible for UI and editable drafts only.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 0,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  },
});
