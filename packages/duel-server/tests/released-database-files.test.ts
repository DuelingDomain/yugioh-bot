import { expect, it } from "vitest";
import { releasedDatabaseFiles } from "../src/released-database-files.js";

const tree = (paths: string[]) => ({ truncated: false, tree: paths.map(path => ({ path, type: "blob" })) });

it("selects only root released database blobs in EDOPro order", () => {
  const input = tree([
    "release-z.cdb", "release-a.cdb", "cards.cdb", "prerelease-test.cdb", "cards-rush.cdb",
    "nested/release-x.cdb", "release-nested/x.cdb", "release-nested\\x.cdb", "Cards.cdb",
    "Release-x.cdb", "release-x.CDB",
  ]);
  input.tree.push({ path: "release-folder.cdb", type: "tree" }, { path: "release-submodule.cdb", type: "commit" });
  expect(releasedDatabaseFiles(input)).toEqual(["cards.cdb", "release-a.cdb", "release-z.cdb"]);
});

it("sorts filenames case-insensitively with a case-sensitive tie breaker", () => {
  expect(releasedDatabaseFiles(tree(["release-Z.cdb", "release-a.cdb", "cards.cdb", "release-A.cdb", "release-a_extra.cdb"])))
    .toEqual(["cards.cdb", "release-A.cdb", "release-a.cdb", "release-a_extra.cdb", "release-Z.cdb"]);
});

it("refuses truncated trees even when the base database is present", () => {
  expect(() => releasedDatabaseFiles({ ...tree(["cards.cdb"]), truncated: true })).toThrow(/truncated/i);
});

it("requires a root base database blob", () => {
  expect(() => releasedDatabaseFiles(tree(["release-z.cdb", "nested/cards.cdb", "Cards.cdb"]))).toThrow(/cards.cdb/);
  expect(() => releasedDatabaseFiles({ truncated: false, tree: [{ path: "cards.cdb", type: "tree" }] })).toThrow(/cards.cdb/);
});
