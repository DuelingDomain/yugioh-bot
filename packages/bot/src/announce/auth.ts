import { readSignedRequest } from "@yugidraft/shared/internal-auth";

export function readAnnounceRequest(request: Request, secret: string) {
  return readSignedRequest(request, { secret, purpose: "bot-announce" });
}
