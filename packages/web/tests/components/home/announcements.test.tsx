// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnouncementToggles } from "@/components/settings/announcement-toggles";
import { botPosts } from "@/components/settings/announcement-posts";

const stored = {
  guildId: "g1",
  announceDraftCreated: false,
  announceDraftStarted: true,
  announceDraftCompleted: false,
  announceTournamentCreated: true,
  announceTournamentCompleted: false,
  announceChannelId: "c1",
};
const channels = [{ id: "c1", name: "tournament-results" }, { id: "c2", name: "duel-results" }];

function stub(putResponse: () => Response | Promise<Response> = () => Response.json({ ...stored, announceChannelId: "c2" })) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/settings" && init?.method === "PUT") return putResponse();
    if (url === "/api/settings") return Response.json(stored);
    if (url === "/api/discord/channels") return Response.json({ channels });
    return Response.json({}, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("AnnouncementToggles", () => {
  it("lists the six posts and has no switches", async () => {
    stub();
    render(<AnnouncementToggles />);
    await screen.findByText("What the bot posts");
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText("Not posted")).toBeInTheDocument();
  });

  it("keeps Save off until the channel changes, then PUTs the whole object with only the channel changed", async () => {
    const fetchMock = stub();
    render(<AnnouncementToggles />);
    const select = await screen.findByLabelText("Post to");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(select, { target: { value: "c2" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await screen.findByRole("status");
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({ ...stored, announceChannelId: "c2" });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("None saves null and warns that two kinds of post are skipped", async () => {
    const fetchMock = stub(() => Response.json({ ...stored, announceChannelId: null }));
    render(<AnnouncementToggles />);
    const select = await screen.findByLabelText("Post to");
    fireEvent.change(select, { target: { value: "" } });
    screen.getByText("Two kinds of post are skipped.");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === "PUT")).toBe(true));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body)).announceChannelId).toBeNull();
    expect(JSON.parse(String(put[1]!.body)).announceDraftStarted).toBe(true);
  });

  it("says what is still in effect when saving fails", async () => {
    stub(() => Response.json({}, { status: 403 }));
    render(<AnnouncementToggles />);
    fireEvent.change(await screen.findByLabelText("Post to"), { target: { value: "c2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Posts still go to #tournament-results/);
  });

  it("offers Retry when settings fail to load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 500 })));
    render(<AnnouncementToggles />);
    await screen.findByText("Couldn't load announcement settings.");
    screen.getByRole("button", { name: "Retry" });
  });
});

describe("botPosts", () => {
  it("sends approval and finished posts nowhere without a channel", () => {
    const posts = botPosts(null);
    expect(posts.find((p) => p.key === "approval")?.to).toEqual({ kind: "none" });
    expect(posts.find((p) => p.key === "finished")?.to).toEqual({ kind: "none" });
    expect(posts.find((p) => p.key === "announced")?.to.kind).toBe("default");
    expect(posts.find((p) => p.key === "started")?.to.kind).toBe("default");
  });
});
