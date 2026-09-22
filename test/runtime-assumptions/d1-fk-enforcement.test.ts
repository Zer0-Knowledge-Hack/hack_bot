import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

describe("D1 foreign key enforcement", () => {
  beforeEach(async () => {
    await env.DB.exec("DROP TABLE IF EXISTS fk_child");
    await env.DB.exec("DROP TABLE IF EXISTS fk_parent");
    await env.DB.exec(
      "CREATE TABLE fk_parent (id TEXT PRIMARY KEY)",
    );
    await env.DB.exec(
      "CREATE TABLE fk_child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL, FOREIGN KEY (parent_id) REFERENCES fk_parent(id))",
    );
  });

  it("rejects an insert whose foreign key has no matching parent row", async () => {
    await expect(
      env.DB.prepare("INSERT INTO fk_child (id, parent_id) VALUES (?, ?)")
        .bind("child-1", "missing-parent")
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("accepts an insert whose foreign key matches an existing parent row", async () => {
    await env.DB.prepare("INSERT INTO fk_parent (id) VALUES (?)")
      .bind("parent-1")
      .run();

    await env.DB.prepare("INSERT INTO fk_child (id, parent_id) VALUES (?, ?)")
      .bind("child-1", "parent-1")
      .run();

    const row = await env.DB.prepare(
      "SELECT parent_id FROM fk_child WHERE id = ?",
    )
      .bind("child-1")
      .first<{ parent_id: string }>();

    expect(row?.parent_id).toBe("parent-1");
  });
});
