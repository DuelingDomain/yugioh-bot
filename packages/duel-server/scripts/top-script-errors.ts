import Database from "better-sqlite3";
import { topScriptErrors } from "../src/script-error-store.js";

// Read-only: no dotenv loading, migrations or engine resources needed.
const path = process.argv[2] ?? process.env.DATABASE_PATH ?? "./data/bot.sqlite";
const limit = process.argv[3] === undefined ? 20 : Number(process.argv[3]);
const db = new Database(path, { readonly: true, fileMustExist: true });
try { console.log(JSON.stringify(topScriptErrors(db, limit), null, 2)); }
finally { db.close(); }
