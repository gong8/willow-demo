import { useCallback, useEffect, useRef, useState } from "react";
import type { ReconnectStream } from "../components/chat/ReconnectStreamView.js";

const BASE_URL = "/api";

function scrollIfNearBottom(el: HTMLElement | null) {
	if (!el) return;
	if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
		el.scrollTo({ top: el.scrollHeight });
	}
}

function applySseEvent(
	state: ReconnectStream,
	eventType: string,
	parsed: Record<string, unknown>,
): boolean {
	switch (eventType) {
		case "content":
			if (parsed.content) {
				state.content += parsed.content as string;
				return true;
			}
			return false;
		case "tool_call_start":
			state.toolCalls.set(parsed.toolCallId as string, {
				toolCallId: parsed.toolCallId as string,
				toolName: parsed.toolName as string,
			});
			return true;
		case "tool_call_args": {
			const tc = state.toolCalls.get(parsed.toolCallId as string);
			if (tc) tc.args = parsed.args as Record<string, unknown>;
			return true;
		}
		case "tool_result": {
			const tc = state.toolCalls.get(parsed.toolCallId as string);
			if (tc) {
				tc.result = parsed.result as string;
				tc.isError = parsed.isError as boolean;
			}
			return true;
		}
		case "thinking_delta":
			if (parsed.text) {
				state.thinkingText += parsed.text as string;
				return true;
			}
			return false;
		default:
			return false;
	}
}

export function useStreamReconnect(
	conversationId: string,
	adapterStreamingRef: React.RefObject<boolean>,
	onStreamReconnected?: () => void,
) {
	const [reconnectStream, setReconnectStream] =
		useState<ReconnectStream | null>(null);
	const reconnectViewportRef = useRef<HTMLDivElement>(null);
	const reconnectAbortRef = useRef<AbortController | null>(null);
	const wasStreamingRef = useRef(false);

	const doReconnect = useCallback(async () => {
		if (adapterStreamingRef.current) return;

		reconnectAbortRef.current?.abort();
		const abort = new AbortController();
		reconnectAbortRef.current = abort;

		try {
			const statusRes = await fetch(
				`${BASE_URL}/chat/conversations/${conversationId}/stream-status`,
			);
			const status = await statusRes.json();
			if (abort.signal.aborted || adapterStreamingRef.current) return;

			if (!status.active || status.status !== "streaming") {
				if (wasStreamingRef.current) {
					wasStreamingRef.current = false;
					setReconnectStream(null);
					onStreamReconnected?.();
				}
				return;
			}

			const response = await fetch(
				`${BASE_URL}/chat/conversations/${conversationId}/stream-reconnect`,
				{ method: "POST", signal: abort.signal },
			);

			if (!response.ok || abort.signal.aborted) return;

			const reader = response.body?.getReader();
			if (!reader) return;

			const state: ReconnectStream = {
				content: "",
				toolCalls: new Map(),
				thinkingText: "",
				done: false,
			};
			wasStreamingRef.current = true;
			setReconnectStream({ ...state });

			const decoder = new TextDecoder();
			let buffer = "";
			let currentEventType = "content";

			while (!abort.signal.aborted) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				let updated = false;

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) continue;

					if (trimmed.startsWith("event: ")) {
						currentEventType = trimmed.slice(7);
						continue;
					}

					if (trimmed.startsWith("data: ")) {
						const data = trimmed.slice(6);
						if (data === "[DONE]") {
							state.done = true;
							break;
						}

						try {
							const parsed = JSON.parse(data);
							if (applySseEvent(state, currentEventType, parsed)) {
								updated = true;
							}
						} catch {
							// skip unparseable
						}
						currentEventType = "content";
					}
				}

				if (updated && !abort.signal.aborted) {
					setReconnectStream({
						...state,
						toolCalls: new Map(state.toolCalls),
					});
					scrollIfNearBottom(reconnectViewportRef.current);
				}

				if (state.done) break;
			}

			if (!abort.signal.aborted) {
				wasStreamingRef.current = false;
				setReconnectStream(null);
				onStreamReconnected?.();
			}
		} catch {
			if (!reconnectAbortRef.current?.signal.aborted) {
				wasStreamingRef.current = false;
				setReconnectStream(null);
			}
		}
	}, [conversationId, adapterStreamingRef, onStreamReconnected]);

	useEffect(() => {
		doReconnect();
		return () => {
			reconnectAbortRef.current?.abort();
		};
	}, [doReconnect]);

	useEffect(() => {
		function handleVisibilityChange() {
			if (document.visibilityState === "visible") {
				doReconnect();
			}
		}
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () =>
			document.removeEventListener("visibilitychange", handleVisibilityChange);
	}, [doReconnect]);

	return { reconnectStream, reconnectViewportRef };
}
