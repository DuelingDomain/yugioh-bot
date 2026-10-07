// What the bot actually posts, and where each post lands, from how the bot behaves today.
// "setting" posts follow the announcement channel; the rest ignore it.

export type PostDestination =
  | { kind: "channel"; name: string }
  | { kind: "default"; text: string }
  | { kind: "none" }
  | { kind: "off" };

export type BotPost = {
  key: string;
  title: string;
  when: string;
  to: PostDestination;
};

/** `channelName` is the saved channel's name (without #), or null when none is set. */
export function botPosts(channelName: string | null): BotPost[] {
  const chosen: PostDestination = channelName ? { kind: "channel", name: channelName } : { kind: "none" };
  return [
    {
      key: "announced",
      title: "Tournament announced",
      when: "When the organizer presses Announce on the tournament page",
      to: channelName
        ? { kind: "channel", name: channelName }
        : { kind: "default", text: "the bot's default channel" },
    },
    {
      key: "approval",
      title: "Result waiting for approval",
      when: "Mentions the opponent. The post goes once they approve or deny.",
      to: chosen,
    },
    {
      key: "finished",
      title: "Tournament finished",
      when: "With a link to the final standings",
      to: chosen,
    },
    {
      key: "started",
      title: "Tournament started",
      when: "Always the bot's default channel. It doesn't follow the setting above.",
      to: { kind: "default", text: "the bot's default channel" },
    },
    {
      key: "draft",
      title: "Draft created and draft finished",
      when: "In the channel the draft was made in",
      to: { kind: "default", text: "the draft's channel" },
    },
    {
      key: "draft-started",
      title: "Draft started",
      when: "In the channel the draft was made in",
      to: { kind: "default", text: "the draft's channel" },
    },
  ];
}
