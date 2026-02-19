import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { UserMessage } from "../UserMessage.js";

vi.mock("@assistant-ui/react", () => ({
	MessagePrimitive: {
		Root: ({ children }: any) => <div>{children}</div>,
		Attachments: () => null,
		Content: () => <div>Hello, AI!</div>,
	},
	ActionBarPrimitive: {
		Root: ({ children }: any) => <div>{children}</div>,
		Edit: ({ children }: any) => <button>{children}</button>,
		Copy: ({ children }: any) => <button>{children}</button>,
	},
	useMessage: (selector: any) => {
		const msg = { createdAt: new Date() };
		return typeof selector === "function" ? selector(msg) : msg;
	},
	useAttachmentRuntime: () => ({ getState: () => ({ type: "image", id: "1", name: "foo.jpg" }) }),
	useMessagePartImage: () => ({ image: "/foo.jpg" }),
}));

describe("UserMessage", () => {
	it("renders user message with text", () => {
		render(<UserMessage />);
		expect(screen.getByText("Hello, AI!")).toBeDefined();
	});

	it("renders without crashing", () => {
		const { container } = render(<UserMessage />);
		expect(container).toBeDefined();
	});
});
