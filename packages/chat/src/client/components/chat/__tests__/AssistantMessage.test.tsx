import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssistantMessage } from "../AssistantMessage.js";

vi.mock("../ToolCallDisplay.js", () => ({
	ToolCallDisplay: () => <div data-testid="tool-display" />,
}));
vi.mock("../WillowToolCallDisplay.js", () => ({
	WillowToolCallDisplay: () => <div data-testid="willow-tool-display" />,
}));
vi.mock("../SearchIndicator.js", () => ({
	SearchIndicator: () => <div data-testid="search-ind" />,
}));
vi.mock("../IndexerIndicator.js", () => ({
	IndexerIndicator: () => <div data-testid="indexer-ind" />,
}));
vi.mock("../ReasoningDisplay.js", () => ({
	ReasoningDisplay: ({ text }: any) => (
		<div data-testid="reasoning">{text}</div>
	),
}));

vi.mock("@assistant-ui/react", () => ({
	MessagePrimitive: {
		Root: ({ children }: any) => <div>{children}</div>,
		Content: () => <div>I can help with that.</div>,
	},
	ActionBarPrimitive: {
		Root: ({ children }: any) => <div>{children}</div>,
		Copy: ({ children }: any) => <button>{children}</button>,
		Reload: ({ children }: any) => <button>{children}</button>,
	},
	BranchPickerPrimitive: {
		Root: ({ children }: any) => <div>{children}</div>,
		Previous: () => null,
		Number: () => null,
		Next: () => null,
	},
	useMessage: (selector: any) => {
		const msg = { createdAt: new Date(), content: [] };
		return typeof selector === "function" ? selector(msg) : msg;
	},
}));

describe("AssistantMessage", () => {
	it("renders text content", () => {
		render(<AssistantMessage />);
		expect(screen.getByText("I can help with that.")).toBeDefined();
	});

	it("renders without crashing", () => {
		const { container } = render(<AssistantMessage />);
		expect(container).toBeDefined();
	});
});
