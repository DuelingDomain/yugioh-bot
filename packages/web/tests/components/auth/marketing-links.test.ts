import { expect, it } from "vitest";
import { waitlistHref } from "@/components/auth/marketing-links";

it.each([
  [undefined, "https://duelingdomain.com/?home=1#join"],
  [null, "https://duelingdomain.com/?home=1#join"],
  ["", "https://duelingdomain.com/?home=1#join"],
  ["marketing.example", "https://duelingdomain.com/?home=1#join"],
  [" \t\n ", "https://duelingdomain.com/?home=1#join"],
  ["/marketing", "https://duelingdomain.com/?home=1#join"],
  ["ftp://marketing.example", "https://duelingdomain.com/?home=1#join"],
  ["  https://marketing.example/ \n", "https://marketing.example/?home=1#join"],
  ["https://marketing.example", "https://marketing.example/?home=1#join"],
  ["https://marketing.example/", "https://marketing.example/?home=1#join"],
  ["https://marketing.example/?from=app#intro", "https://marketing.example/?from=app&home=1#join"],
  ["https://marketing.example/?home=0&from=app&home=0#intro", "https://marketing.example/?home=1&from=app#join"],
])("links to the join form with home=1 for %s", (marketingUrl, expected) => {
  expect(waitlistHref(marketingUrl)).toBe(expected);
});
