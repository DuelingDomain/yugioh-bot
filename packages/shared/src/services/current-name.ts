export class CurrentNameTakenError extends Error {
  constructor(kind: "draft" | "tournament") {
    super(`You already have a ${kind} called this that hasn't finished.`);
    this.name = "CurrentNameTakenError";
  }
}
