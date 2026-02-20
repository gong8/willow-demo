import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../lib/api.js";
import { ConversationSidebar } from "../ConversationSidebar.js";
import { createQueryWrapper } from "../chat/__tests__/helpers";

vi.mock("../../lib/api.js");

describe("ConversationSidebar", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders conversations and triggers onSelect", () => {
		vi.mocked(api.fetchConversations).mockResolvedValue([
			{
				id: "c1",
				title: "Conv 1",
				messageCount: 5,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			},
			{
				id: "c2",
				title: "Conv 2",
				messageCount: 1,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			},
		]);

		render(
			<ConversationSidebar
				activeId="c1"
				activeView="chat"
				onSelect={vi.fn()}
				onViewChange={vi.fn()}
				onNew={vi.fn()}
			/>,
			{ wrapper: createQueryWrapper() },
		);
	});
});
