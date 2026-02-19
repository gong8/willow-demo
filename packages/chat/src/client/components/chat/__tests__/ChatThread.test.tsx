import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ChatThread } from "../ChatThread.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@assistant-ui/react", () => ({
	ThreadPrimitive: {
		Root: ({ children }: any) => <div data-testid="thread-root">{children}</div>,
		Viewport: (props: any) => <div data-testid="viewport">{props.children}</div>,
		Messages: (props: any) => <div data-testid="messages" {...props} />,
		ScrollToBottom: () => null,
		Empty: ({ children }: any) => <div data-testid="empty">{children}</div>,
	},
	useThreadRuntime: () => ({}),
	useLocalRuntime: () => ({}),
	AssistantRuntimeProvider: ({ children }: any) => <div data-testid="assistant-runtime">{children}</div>,
}));

vi.mock("../ChatComposer.js", () => ({ 
	ChatComposer: () => <div data-testid="composer" />,
	DraftPersistence: () => null
}));
vi.mock("../UserMessage.js", () => ({ UserMessage: () => <div data-testid="user-msg" /> }));
vi.mock("../AssistantMessage.js", () => ({ AssistantMessage: () => <div data-testid="assistant-msg" /> }));
vi.mock("../EditComposer.js", () => ({ EditComposer: () => <div data-testid="edit-composer" /> }));
vi.mock("../ReconnectStreamView.js", () => ({ ReconnectStreamView: () => <div data-testid="reconnect-stream" /> }));

describe("ChatThread", () => {
	it("renders thread structure", () => {
		const queryClient = new QueryClient();
		const { getByTestId } = render(
			<QueryClientProvider client={queryClient}>
				<ChatThread
					conversationId="c1"
				/>
			</QueryClientProvider>
		);
		expect(getByTestId("thread-root")).toBeDefined();
		expect(getByTestId("viewport")).toBeDefined();
		expect(getByTestId("messages")).toBeDefined();
		expect(getByTestId("composer")).toBeDefined();
	});
});
