import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useChatHistory } from "../useChatHistory.js";
import { QueryClient } from "@tanstack/react-query";
import * as api from "../../lib/api.js";

vi.mock("../../lib/api.js");

describe("useChatHistory", () => {
	let queryClient: QueryClient;

	beforeEach(() => {
		vi.clearAllMocks();
		queryClient = new QueryClient();
	});

	it("loads and parses messages correctly", async () => {
		vi.mocked(api.fetchMessages).mockResolvedValue([
			{ 
				id: "m1", 
				role: "user", 
				content: "Hello <tool_call>{\"name\":\"test\",\"arguments\":{}}</tool_call>", 
				toolCalls: JSON.stringify([{
					toolCallId: "t1", toolName: "search", args: { q: "test" }, phase: "search"
				}]),
				createdAt: new Date().toISOString()
			}
		]);

		const { result } = renderHook(() => useChatHistory("c1", queryClient));
		
		const adapter = result.current;
		const adapterData = await adapter.load();

		expect(adapterData.messages).toBeDefined();
		expect(adapterData.messages.length).toBe(1);
		
		const msg = adapterData.messages[0].message;
		expect(msg.role).toBe("user");
		// Check that search results are in metadata, not content
		const custom = msg.metadata.custom as Record<string, any>;
		expect(custom.searchResults).toBeDefined();
		expect(custom.searchResults.type).toBe("search-results");
		expect(msg.content.some((c: any) => c.type === "tool-call")).toBe(true);
		expect(msg.content.some((c: any) => c.type === "text" && c.text === "Hello")).toBe(true);
	});
});
