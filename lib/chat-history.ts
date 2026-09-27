import type { ChatMessage } from "./backends/types";
import type { UiMessage } from "./chat-types";

/**
 * The messages to send for a new user turn: the whole visible conversation when history is on
 * (empty replies skipped), or only the new message when it's off.
 */
export function requestMessages(previous: UiMessage[], text: string, useHistory: boolean): ChatMessage[] {
  const prior = useHistory ? previous.filter((m) => m.content.trim()) : [];
  return [...prior.map(({ role, content }) => ({ role, content })), { role: "user", content: text }];
}
