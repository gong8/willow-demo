import { describe, it, expect, vi, beforeEach } from "vitest";
import { chatRoutes } from "../routes/chat.js";

const { mockDb } = vi.hoisted(() => ({
	mockDb: {
		conversation: {
			findMany: vi.fn(() => Promise.resolve([
				{ id: "c1", title: "C1", createdAt: new Date(), updatedAt: new Date(), _count: { messages: 5 } }
			])),
			create: vi.fn(() => Promise.resolve({ id: "new_c", title: "New", createdAt: new Date(), updatedAt: new Date() })),
			update: vi.fn(),
			delete: vi.fn(() => Promise.resolve()),
			findUnique: vi.fn(() => Promise.resolve({ id: "c1" })),
		},
		message: {
			findMany: vi.fn(() => Promise.resolve([{ id: "m1", role: "user", content: "hello", attachments: [] }])),
			count: vi.fn(() => Promise.resolve(0)),
			create: vi.fn(() => Promise.resolve({ id: "m2" })),
		},
	}
}));

vi.mock("@prisma/client", () => ({
	PrismaClient: vi.fn(() => mockDb)
}));

vi.mock("../services/stream-manager.js", () => ({
	getStream: vi.fn(() => null),
	startStream: vi.fn(),
	subscribe: vi.fn(),
}));

vi.mock("../services/maintenance.js", () => ({
	getMaintenanceStatus: vi.fn(() => ({ running: false })),
	runMaintenance: vi.fn(() => ({ id: "job1" })),
	notifyConversationComplete: vi.fn(),
}));

describe("chatRoutes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("GET /conversations returns conversations", async () => {
		const res = await chatRoutes.request("/conversations");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(Array.isArray(data)).toBe(true);
		expect(data[0].id).toBe("c1");
	});

	it("POST /conversations creates a conversation", async () => {
		const res = await chatRoutes.request("/conversations", { method: "POST" });
		expect(res.status).toBe(201);
		const data = await res.json();
		expect(data.id).toBe("new_c");
	});

	it("GET /conversations/:id/messages returns messages", async () => {
		const res = await chatRoutes.request("/conversations/c1/messages");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data[0].id).toBe("m1");
	});

	it("DELETE /conversations/:id deletes conversation", async () => {
		const res = await chatRoutes.request("/conversations/c1", { method: "DELETE" });
		expect(res.status).toBe(200);
		expect(mockDb.conversation.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
	});

	it("GET /maintenance/status works", async () => {
		const res = await chatRoutes.request("/maintenance/status");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.running).toBe(false);
	});

	it("POST /maintenance/run works", async () => {
		const res = await chatRoutes.request("/maintenance/run", { method: "POST" });
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.jobId).toBe("job1");
	});
});
