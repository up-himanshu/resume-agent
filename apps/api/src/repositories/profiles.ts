import { pool } from "../db.js";

export async function insertProfile(input: {
  resumeId: string | null;
  formId: string;
  formVersion: number;
  data: Record<string, unknown>;
}) {
  const { rows } = await pool.query<{ id: string; created_at: Date }>(
    `INSERT INTO profiles (resume_id, form_id, form_version, data) VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [input.resumeId, input.formId, input.formVersion, JSON.stringify(input.data)],
  );
  return rows[0]!;
}

export async function resumeExists(id: string) {
  const { rowCount } = await pool.query("SELECT 1 FROM resumes WHERE id = $1", [id]);
  return Boolean(rowCount);
}
