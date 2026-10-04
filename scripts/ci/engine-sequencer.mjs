import { BaseSequencer } from "vitest/node";

// Table rows have their own TABLE_SHARD split. Collect the file on every CI shard
// so Vitest can run those rows alongside regular files instead of after them.
export default class EngineSequencer extends BaseSequencer {
  async shard(files) {
    const isTable = (file) => file.moduleId.endsWith("/tests/multi-scripts-table.test.ts");
    return [...await super.shard(files.filter((file) => !isTable(file))), ...files.filter(isTable)];
  }
}
