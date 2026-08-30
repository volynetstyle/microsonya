import { applyMigrations } from "../../packages/db/src/migrateRunner.js";
import {
  printStagingTarget,
  requireStagingMutationApproval,
  stagingDatabaseTarget,
} from "./database.js";

const target = stagingDatabaseTarget();
requireStagingMutationApproval();
printStagingTarget(target);

await applyMigrations(target.connectionString);
console.info("Staging migrations applied successfully.");
