import {
  sortConversations, formatMessageTime, getMessagePreview,
  getConversationTitle, getConversationAvatar, countUnread,
  filterConversations, dedupeMessages, isSameDay,
  type ConversationListItem, type MessageView,
} from "../src/hooks/chatPure";

/**
 * Pure chat helpers (Prompt 19).
 */

const baseConv = (overrides: Partial<ConversationListItem> = {}): ConversationListItem => ({
  id: 1,
  type: "private",
  title: "",
  lastMessageAt: "2026-10-31T10:00:00Z",
  muted: false,
  pinned: false,
  lastReadAt: null,
  unread: 0,
  participants: [
    { userId: 1, displayName: "Me", avatarUrl: "", vipLevel: 0, nobleLevel: 0 },
    { userId: 2, displayName: "Alice", avatarUrl: "https://x/a.png", vipLevel: 1, nobleLevel: 0 },
  ],
  lastMessage: { id: 1, body: "Hello there", senderId: 2, createdAt: "2026-10-31T10:00:00Z" },
  ...overrides,
});

describe("sortConversations", () => {
  it("sorts pinned first, then by lastMessageAt desc", () => {
    const convs = [
      baseConv({ id: 1, pinned: false, lastMessageAt: "2026-10-30T10:00:00Z" }),
      baseConv({ id: 2, pinned: true, lastMessageAt: "2026-10-29T10:00:00Z" }),
      baseConv({ id: 3, pinned: false, lastMessageAt: "2026-10-31T10:00:00Z" }),
    ];
    const sorted = sortConversations(convs);
    expect(sorted[0]!.id).toBe(2); // pinned
    expect(sorted[1]!.id).toBe(3); // newer
    expect(sorted[2]!.id).toBe(1); // older
  });
  it("null lastMessageAt sorts to bottom", () => {
    const convs = [
      baseConv({ id: 1, lastMessageAt: null }),
      baseConv({ id: 2, lastMessageAt: "2026-10-31T10:00:00Z" }),
    ];
    const sorted = sortConversations(convs);
    expect(sorted[0]!.id).toBe(2);
    expect(sorted[1]!.id).toBe(1);
  });
  it("does not mutate input", () => {
    const convs = [baseConv({ id: 1 }), baseConv({ id: 2 })];
    const original = [...convs];
    sortConversations(convs);
    expect(convs).toEqual(original);
  });
});

describe("formatMessageTime", () => {
  const now = new Date("2026-10-31T15:30:00Z");
  it("returns time for today", () => {
    const out = formatMessageTime("2026-10-31T10:00:00Z", now);
    expect(out).toMatch(/\d/); // some time format
  });
  it("returns weekday for < 7 days ago", () => {
    const out = formatMessageTime("2026-10-28T10:00:00Z", now);
    expect(out).toMatch(/^[A-Z][a-z]{2}$/); // e.g. "Wed"
  });
  it("returns date for > 7 days ago", () => {
    const out = formatMessageTime("2026-10-01T10:00:00Z", now);
    expect(out).toContain("Oct");
  });
});

describe("getMessagePreview", () => {
  it("returns body when short enough", () => {
    expect(getMessagePreview({ body: "Hi" })).toBe("Hi");
  });
  it("truncates long messages", () => {
    const long = "a".repeat(50);
    expect(getMessagePreview({ body: long }, 10)).toBe("aaaaaaaaa…");
  });
  it("returns fallback for null", () => {
    expect(getMessagePreview(null)).toBe("No messages yet");
  });
});

describe("getConversationTitle", () => {
  it("returns other participant name for 1:1", () => {
    const conv = baseConv({ participants: [
      { userId: 1, displayName: "Me", avatarUrl: "", vipLevel: 0, nobleLevel: 0 },
      { userId: 2, displayName: "Alice", avatarUrl: "", vipLevel: 0, nobleLevel: 0 },
    ]});
    expect(getConversationTitle(conv, 1)).toBe("Alice");
  });
  it("returns conversation title for group", () => {
    const conv = baseConv({ type: "group", title: "My Group" });
    expect(getConversationTitle(conv, 1)).toBe("My Group");
  });
  it("returns 'Group Chat' when group title is empty", () => {
    const conv = baseConv({ type: "group", title: "", participants: [
      { userId: 1, displayName: "Me", avatarUrl: "", vipLevel: 0, nobleLevel: 0 },
      { userId: 2, displayName: "A", avatarUrl: "", vipLevel: 0, nobleLevel: 0 },
      { userId: 3, displayName: "B", avatarUrl: "", vipLevel: 0, nobleLevel: 0 },
    ]});
    expect(getConversationTitle(conv, 1)).toBe("Group Chat");
  });
});

describe("getConversationAvatar", () => {
  it("returns other participant avatar for 1:1", () => {
    const conv = baseConv({ participants: [
      { userId: 1, displayName: "Me", avatarUrl: "", vipLevel: 0, nobleLevel: 0 },
      { userId: 2, displayName: "Alice", avatarUrl: "https://x/a.png", vipLevel: 0, nobleLevel: 0 },
    ]});
    expect(getConversationAvatar(conv, 1)).toBe("https://x/a.png");
  });
  it("returns empty string for group", () => {
    const conv = baseConv({ type: "group" });
    expect(getConversationAvatar(conv, 1)).toBe("");
  });
});

describe("countUnread", () => {
  it("counts conversations with unread > 0", () => {
    const convs = [
      baseConv({ id: 1, unread: 0 }),
      baseConv({ id: 2, unread: 3 }),
      baseConv({ id: 3, unread: 1 }),
    ];
    expect(countUnread(convs)).toBe(2);
  });
  it("returns 0 when all read", () => {
    expect(countUnread([baseConv({ unread: 0 })])).toBe(0);
  });
});

describe("filterConversations", () => {
  const convs = [
    baseConv({ id: 1, type: "private", participants: [
      { userId: 1, displayName: "Me", avatarUrl: "", vipLevel: 0, nobleLevel: 0 },
      { userId: 2, displayName: "Alice", avatarUrl: "", vipLevel: 0, nobleLevel: 0 },
    ]}),
    baseConv({ id: 2, type: "group", title: "Group", participants: [
      { userId: 1, displayName: "Me", avatarUrl: "", vipLevel: 0, nobleLevel: 0 },
      { userId: 2, displayName: "Alice", avatarUrl: "", vipLevel: 0, nobleLevel: 0 },
      { userId: 3, displayName: "Bob", avatarUrl: "", vipLevel: 0, nobleLevel: 0 },
    ]}),
    baseConv({ id: 3, type: "private", unread: 5, participants: [
      { userId: 1, displayName: "Me", avatarUrl: "", vipLevel: 0, nobleLevel: 0 },
      { userId: 4, displayName: "Carol", avatarUrl: "", vipLevel: 0, nobleLevel: 0 },
    ]}),
  ];
  it("filters by private category", () => {
    const out = filterConversations(convs, "", "private");
    expect(out.length).toBe(2);
    expect(out.every((c) => c.type === "private")).toBe(true);
  });
  it("filters by group category", () => {
    const out = filterConversations(convs, "", "group");
    expect(out.length).toBe(1);
    expect(out[0]!.type).toBe("group");
  });
  it("filters by unread category", () => {
    const out = filterConversations(convs, "", "unread");
    expect(out.length).toBe(1);
    expect(out[0]!.id).toBe(3);
  });
  it("filters by search query on participant name", () => {
    const out = filterConversations(convs, "Alice", "all");
    expect(out.length).toBe(2); // Alice appears in conv 1 and conv 2
  });
  it("filters by search query on group title", () => {
    const out = filterConversations(convs, "Group", "all");
    expect(out.length).toBe(1);
    expect(out[0]!.id).toBe(2);
  });
});

describe("dedupeMessages", () => {
  it("removes duplicate IDs", () => {
    const msgs: MessageView[] = [
      { id: 1, conversationId: 1, senderId: 1, body: "a", createdAt: "2026-10-31T10:00:00Z", sender: { id: 1, displayName: "A", avatarUrl: "", vipLevel: 0, nobleLevel: 0 } },
      { id: 2, conversationId: 1, senderId: 2, body: "b", createdAt: "2026-10-31T10:01:00Z", sender: { id: 2, displayName: "B", avatarUrl: "", vipLevel: 0, nobleLevel: 0 } },
      { id: 1, conversationId: 1, senderId: 1, body: "a", createdAt: "2026-10-31T10:00:00Z", sender: { id: 1, displayName: "A", avatarUrl: "", vipLevel: 0, nobleLevel: 0 } },
    ];
    const out = dedupeMessages(msgs);
    expect(out.length).toBe(2);
    expect(out.map((m) => m.id)).toEqual([1, 2]);
  });
});

describe("isSameDay", () => {
  it("true for same day", () => {
    expect(isSameDay(new Date("2026-10-31T10:00:00Z"), new Date("2026-10-31T22:00:00Z"))).toBe(true);
  });
  it("false for different days", () => {
    expect(isSameDay(new Date("2026-10-31T10:00:00Z"), new Date("2026-10-30T10:00:00Z"))).toBe(false);
  });
});
