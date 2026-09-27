import { describe, expect, it } from "vitest";
import { requestMessages } from "@/lib/chat-history";
import type { UiMessage } from "@/lib/chat-types";

const previous: UiMessage[] = [
  { id: "1", role: "user", content: "hi" },
  { id: "2", role: "assistant", content: "Hello!" },
  { id: "3", role: "user", content: "tell me a story" },
  { id: "4", role: "assistant", content: "", status: "stopped" },
];

describe("requestMessages", () => {
  it("sends the whole conversation when history is on, skipping empty replies", () => {
    expect(requestMessages(previous, "and another?", true)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "tell me a story" },
      { role: "user", content: "and another?" },
    ]);
  });

  it("sends only the new message when history is off", () => {
    expect(requestMessages(previous, "and another?", false)).toEqual([{ role: "user", content: "and another?" }]);
  });
});
