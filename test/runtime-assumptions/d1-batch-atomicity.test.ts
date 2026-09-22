import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

describe("DB.batch() atomicity", () => {
  beforeEach(async () => {
    await env.DB.exec("DROP TABLE IF EXISTS batch_data");
    await env.DB.exec("DROP TABLE IF EXISTS batch_audit");
    await env.DB.exec(
      "CREATE TABLE batch_data (id TEXT PRIMARY KEY, value TEXT NOT NULL UNIQUE)",
    );
    await env.DB.exec(
      "CREATE TABLE batch_audit (id TEXT PRIMARY KEY, data_id TEXT NOT NULL)",
    );
  });

  it("commits every statement in the batch when all succeed", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO batch_data (id, value) VALUES (?, ?)").bind(
        "row-1",
        "value-1",
      ),
      env.DB.prepare("INSERT INTO batch_audit (id, data_id) VALUES (?, ?)").bind(
        "audit-1",
        "row-1",
      ),
    ]);

    const data = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM batch_data",
    ).first<{ n: number }>();
    const audit = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM batch_audit",
    ).first<{ n: number }>();

    expect(data?.n).toBe(1);
    expect(audit?.n).toBe(1);
  });

  it("rolls back every statement in the batch when one statement fails", async () => {
    await env.DB.prepare("INSERT INTO batch_data (id, value) VALUES (?, ?)")
      .bind("row-existing", "duplicate-value")
      .run();

    await expect(
      env.DB.batch([
        env.DB.prepare(
          "INSERT INTO batch_audit (id, data_id) VALUES (?, ?)",
        ).bind("audit-2", "row-2"),
        // Violates the UNIQUE constraint on `value` — the whole batch must fail.
        env.DB.prepare(
          "INSERT INTO batch_data (id, value) VALUES (?, ?)",
        ).bind("row-2", "duplicate-value"),
      ]),
    ).rejects.toThrow();

    const audit = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM batch_audit",
    ).first<{ n: number }>();

    // The audit insert must NOT have persisted, proving the batch is transactional.
    expect(audit?.n).toBe(0);
  });
});
