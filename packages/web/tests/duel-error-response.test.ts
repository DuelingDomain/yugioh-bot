import { expect, it } from "vitest";
import { ReplayAccessError } from "@yugidraft/shared/access/owner-access";
import { DuelServiceError } from "@yugidraft/shared/services";
import { duelErrorResponse } from "../src/lib/duel-host";

it("gives missing duels and hidden replay forks the same 404 response", async () => {
  const missing = duelErrorResponse(new DuelServiceError("Duel not found", 404));
  const hidden = duelErrorResponse(new ReplayAccessError(404));
  expect(missing.status).toBe(404);
  expect(hidden.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "Not found", code: "ACCESS_DENIED" });
  expect(await hidden.json()).toEqual({ error: "Not found", code: "ACCESS_DENIED" });
  expect(missing.headers.get("cache-control")).toBe("private, no-store");
  expect(hidden.headers.get("cache-control")).toBe("private, no-store");
});

it.each(["Duel series not found", "Tournament match not found", "Source duel not found"])(
  "preserves the 404 message %s", async message => {
    const response = duelErrorResponse(new DuelServiceError(message, 404));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: message });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  },
);

it("preserves a Duel not found error with a status other than 404", async () => {
  const response = duelErrorResponse(new DuelServiceError("Duel not found", 409));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "Duel not found" });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
