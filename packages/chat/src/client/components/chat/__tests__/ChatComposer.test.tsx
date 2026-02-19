import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ChatComposer } from "../ChatComposer.js";

vi.mock("@assistant-ui/react", () => ({
	ComposerPrimitive: {
		Root: ({ children }: any) => <div data-testid="composer-root">{children}</div>,
		Attachments: () => null,
		AddAttachment: ({ children }: any) => <button>{children}</button>,
		Input: (props: any) => <input data-testid="composer-input" {...props} />,
		Send: ({ children }: any) => <button data-testid="composer-send">{children}</button>,
	},
	ThreadPrimitive: {
		If: ({ children, running }: any) => {
			// Mock logic for running state
			if (running === true) return <div data-testid="if-running">{children}</div>;
			if (running === false) return <div data-testid="if-not-running">{children}</div>;
			return children;
		}
	},
	useThreadRuntime: () => ({ cancelRun: vi.fn() }),
	useComposerRuntime: () => ({ getState: () => ({ text: "", attachments: [] }), setText: vi.fn() }),
	useAttachmentRuntime: () => ({ getState: () => ({ id: "1", name: "test.jpg", file: new File([], "test.jpg") }) }),
}));

describe("ChatComposer", () => {
	it("renders composer input and send button", () => {
		const { getByTestId } = render(<ChatComposer />);
		expect(getByTestId("composer-root")).toBeDefined();
		expect(getByTestId("composer-input")).toBeDefined();
	});
});
