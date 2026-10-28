import { startWorker } from "../lib/imports/worker";
if (!process.env.DATABASE_URL)
  throw new Error(
    "A separate worker requires DATABASE_URL. Local PGlite uses the in-app worker only.",
  );
startWorker();
console.log("Catalog synchronization worker started.");
setInterval(() => {}, 60000);
