import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** Creates a fresh QueryClient wrapped in a provider, for use as a render wrapper. */
export function createQueryWrapper() {
	const queryClient = new QueryClient();
	return ({ children }: { children: React.ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
