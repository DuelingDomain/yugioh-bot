import { describe, expect, it } from "vitest";
import type { ClerkUserJson } from "../../src/clerk/backend.js";
import { profileFromClerkUser } from "../../src/clerk/profile.js";

const user: ClerkUserJson = {
  id: "user_yugi", username: "yugi", first_name: " Yugi ", last_name: " Muto ",
  image_url: "https://example.com/avatar", external_id: "42", primary_email_address_id: "primary",
  email_addresses: [
    { id: "other", email_address: "other@example.com", verification: { status: "verified" } },
    { id: "primary", email_address: " YUGI@EXAMPLE.COM ", verification: { status: "verified" } },
  ],
  external_accounts: [{ provider: "oauth_discord", provider_user_id: "900000000000000101", verification: { status: "verified" } }],
};

describe("profileFromClerkUser", () => {
  it("uses the normalized primary email and verified Discord account", () => {
    expect(profileFromClerkUser(user)).toEqual({
      clerkUserId: "user_yugi", username: "yugi", displayName: "Yugi Muto", email: "yugi@example.com",
      emailVerified: true, discordUserId: "900000000000000101", imageUrl: "https://example.com/avatar",
    });
  });
  it.each([null, { status: "unverified" }])("does not accept unverified primary email (%j)", verification => {
    expect(profileFromClerkUser({ ...user, email_addresses: [{ ...user.email_addresses[1], verification }] }))
      .toMatchObject({ email: "yugi@example.com", emailVerified: false });
  });
  it("does not fall back to a secondary email when the primary is absent", () => {
    expect(profileFromClerkUser({ ...user, primary_email_address_id: "missing" }))
      .toMatchObject({ email: null, emailVerified: false });
  });
  it.each([
    { provider: "oauth_discord", provider_user_id: "123", verification: null },
    { provider: "oauth_discord", provider_user_id: "123", verification: { status: "unverified" } },
    { provider: "oauth_google", provider_user_id: "123", verification: { status: "verified" } },
    ...["", "abc", " 123", "-123", "1e3", "12345678901234567890123456"].map(provider_user_id =>
      ({ provider: "oauth_discord", provider_user_id, verification: { status: "verified" } })),
  ])("rejects unsafe Discord external account %j", account => {
    expect(profileFromClerkUser({ ...user, external_accounts: [account] }).discordUserId).toBeNull();
  });
  it.each([
    { first_name: "Yugi", last_name: null, username: "yugi", want: "Yugi" },
    { first_name: null, last_name: " Muto ", username: "yugi", want: "Muto" },
    { first_name: " ", last_name: null, username: "yugi", want: "yugi" },
    { first_name: null, last_name: null, username: null, want: "yugi" },
  ])("falls back to $want", ({ want, ...names }) => {
    expect(profileFromClerkUser({ ...user, ...names }).displayName).toBe(want);
  });
  it("uses Duelist when no name, username or primary email is available", () => {
    expect(profileFromClerkUser({ ...user, first_name: null, last_name: null, username: null, email_addresses: [] }).displayName).toBe("Duelist");
  });
});
