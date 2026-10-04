import { createDatabaseClient, reportDatabaseError } from "./database";

async function check() {
  const client = createDatabaseClient();
  try {
    await client.connect();
    const extension = await client.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
    if (!extension.rowCount) throw new Error("pgvector is missing.");
    const tables = ["approved_sources", "source_references", "analysis_reports", "claims", "evidence", "evidence_relations", "yaqeen_patches", "patch_evidence", "schema_migrations"];
    for (const table of tables) {
      const result = await client.query("SELECT to_regclass($1) AS table_name", [`public.${table}`]);
      if (!result.rows[0].table_name) throw new Error("A required table is missing.");
    }
    const vector = await client.query("SELECT '[1,2,3]'::vector <-> '[1,2,3]'::vector AS distance");
    if (Number(vector.rows[0].distance) !== 0) throw new Error("Vector operation failed.");
    console.log("Database reachable; pgvector, all foundation tables and vector operations verified. No records written.");
  } finally {
    await client.end();
  }
}

check().catch(reportDatabaseError);
