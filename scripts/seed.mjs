import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
const file=path.join(process.cwd(),"data","verity.db");
if(fs.existsSync(file)) fs.unlinkSync(file);
for (const suffix of ["-wal","-shm"]) {
  const sidecar = `${file}${suffix}`;
  if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
}
const db = new Database(file);
db.close();
console.log("Database reset. Start with an empty workspace and ingest a loan tape to begin the workflow.");
