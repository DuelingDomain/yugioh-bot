import { ExpectedError } from "../observability/index.js";

export class CurrentNameTakenError extends ExpectedError {
  constructor(kind: "draft" | "tournament") {
    super(`You already have a ${kind} called this that hasn't finished.`, 400);
    this.name = "CurrentNameTakenError";
  }
}
