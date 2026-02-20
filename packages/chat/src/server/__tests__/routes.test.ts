import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatRoutes } from "../routes/chat.js";

const { mockDb } = vi.hoisted(() => ({
	mockDb: {
		conversation: {
			findMany: vi.fn(() =>
				Promise.resolve([
					{
						id: "c1",
						title: "C1",
						createdAt: new Date(),
						updatedAt: new Date(),
						_count: { messages: 5 },
					},
				]),
			),
			create: vi.fn(() =>
				Promise.resolve({
					id: "new_c",
					title: "New",
					createdAt: new Date(),
					updatedAt: new Date(),
				}),
			),
			update: vi.fn(),
			delete: vi.fn(() => Promise.resolve()),
			findUnique: vi.fn(() => Promise.resolve({ id: "c1" })),
		},
		message: {
			findMany: vi.fn(() =>
				Promise.resolve([
					{ id: "m1", role: "user", content: "hello", attachments: [] },
				]),
			),
			count: vi.fn(() => Promise.resolve(0)),
			create: vi.fn(() => Promise.resolve({ id: "m2" })),
		},
	},
}));

vi.mock("@prisma/client", () => ({
	PrismaClient: vi.fn(() => mockDb),
}));

vi.mock("../services/stream-manager.js", () => ({
	getStream: vi.fn(() => null),
	startStream: vi.fn(),
	subscribe: vi.fn(),
}));

vi.mock("../services/maintenance/index.js", () => ({
	getMaintenanceStatus: vi.fn(() => ({ running: false })),
	runMaintenance: vi.fn(() => ({ id: "job1" })),
	notifyConversationComplete: vi.fn(),
}));

async function requestJson(path: string, method = "GET") {
	const res = await chatRoutes.request(path, { method });
	return { status: res.status, data: await res.json() };
}

describe("chatRoutes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("GET /conversations returns conversations", async () => {
		const { status, data } = await requestJson("/conversations");
		expect(status).toBe(200);
		expect(Array.isArray(data)).toBe(true);
		expect(data[0].id).toBe("c1");
	});

	it("POST /conversations creates a conversation", async () => {
		const { status, data } = await requestJson("/conversations", "POST");
		expect(status).toBe(201);
		expect(data.id).toBe("new_c");
	});

	it("GET /conversations/:id/messages returns messages", async () => {
		const { status, data } = await requestJson("/conversations/c1/messages");
		expect(status).toBe(200);
		expect(data[0].id).toBe("m1");
	});

	it("DELETE /conversations/:id deletes conversation", async () => {
		const { status } = await requestJson("/conversations/c1", "DELETE");
		expect(status).toBe(200);
		expect(mockDb.conversation.delete).toHaveBeenCalledWith({
			where: { id: "c1" },
		});
	});

	it("GET /maintenance/status works", async () => {
		const { data } = await requestJson("/maintenance/status");
		expect(data.running).toBe(false);
	});

	it("POST /maintenance/run works", async () => {
		const { data } = await requestJson("/maintenance/run", "POST");
		expect(data.jobId).toBe("job1");
	});
});
