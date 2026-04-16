// Boston 311 CKAN data client

const CKAN_SQL = "https://data.boston.gov/api/3/action/datastore_search_sql";
const RESOURCE_2026 = "1a0b420d-99f1-4887-9851-990b2a5a6e17";

export async function queryCKAN(sql: string): Promise<Record<string, unknown>[]> {
  console.log(`[CKAN] Query: ${sql.slice(0, 120)}...`);
  // Use POST to avoid URL length limits that trigger Cloudflare blocks
  const res = await fetch(CKAN_SQL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `sql=${encodeURIComponent(sql)}`,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[CKAN] Error ${res.status}: ${body.slice(0, 200)}`);
    throw new Error(`CKAN error ${res.status}: ${body.slice(0, 100)}`);
  }
  const data = await res.json();
  if (!data.success) throw new Error(`CKAN query failed: ${JSON.stringify(data.error)}`);
  return data.result.records;
}

export async function searchCases(params: {
  status?: string;
  neighborhood?: string;
  type?: string;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  let where = "1=1";
  if (params.status) where += ` AND "case_status" = '${params.status}'`;
  if (params.neighborhood) where += ` AND UPPER("neighborhood") LIKE UPPER('%${params.neighborhood}%')`;
  if (params.type) where += ` AND UPPER("case_title") LIKE UPPER('%${params.type}%')`;
  const limit = params.limit || 10;

  return queryCKAN(
    `SELECT "case_enquiry_id", "open_dt", "case_status", "case_title", "subject", "reason", "type", "location_street_name", "neighborhood", "department" FROM "${RESOURCE_2026}" WHERE ${where} ORDER BY "open_dt" DESC LIMIT ${limit}`
  );
}

export async function lookupCase(caseId: string): Promise<Record<string, unknown> | null> {
  const rows = await queryCKAN(
    `SELECT * FROM "${RESOURCE_2026}" WHERE "case_enquiry_id" = '${caseId}' LIMIT 1`
  );
  return rows[0] || null;
}

export async function getStats(params: {
  neighborhood?: string;
  days?: number;
}): Promise<Record<string, unknown>[]> {
  const days = params.days || 7;
  let where = `"open_dt"::timestamp >= (SELECT MAX("open_dt"::timestamp) FROM "${RESOURCE_2026}") - INTERVAL '${days} days'`;
  if (params.neighborhood) where += ` AND UPPER("neighborhood") LIKE UPPER('%${params.neighborhood}%')`;

  return queryCKAN(
    `SELECT "case_title", COUNT(*) as count FROM "${RESOURCE_2026}" WHERE ${where} GROUP BY "case_title" ORDER BY count DESC LIMIT 15`
  );
}

export async function getNeighborhoodSummary(neighborhood: string): Promise<{
  total: number;
  open: number;
  topIssues: { type: string; count: number }[];
}> {
  const [totalRows, openRows, issueRows] = await Promise.all([
    queryCKAN(`SELECT COUNT(*) as total FROM "${RESOURCE_2026}" WHERE UPPER("neighborhood") LIKE UPPER('%${neighborhood}%') AND "open_dt"::timestamp >= (SELECT MAX("open_dt"::timestamp) FROM "${RESOURCE_2026}") - INTERVAL '30 days'`),
    queryCKAN(`SELECT COUNT(*) as open FROM "${RESOURCE_2026}" WHERE UPPER("neighborhood") LIKE UPPER('%${neighborhood}%') AND "case_status" = 'Open'`),
    queryCKAN(`SELECT "case_title", COUNT(*) as count FROM "${RESOURCE_2026}" WHERE UPPER("neighborhood") LIKE UPPER('%${neighborhood}%') AND "open_dt"::timestamp >= (SELECT MAX("open_dt"::timestamp) FROM "${RESOURCE_2026}") - INTERVAL '30 days' GROUP BY "case_title" ORDER BY count DESC LIMIT 5`),
  ]);

  return {
    total: Number(totalRows[0]?.total) || 0,
    open: Number(openRows[0]?.open) || 0,
    topIssues: issueRows.map((r) => ({
      type: String(r.case_title),
      count: Number(r.count),
    })),
  };
}
