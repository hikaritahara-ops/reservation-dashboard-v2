import { getSupabase, sendJson, readJsonBody, checkAppPassword } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (!checkAppPassword(req)) return sendJson(res, 401, { ok: false, error: "unauthorized" });
  const supabase = getSupabase();

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("store_aliases")
        .select("id, alias, store_id, stores(name)")
        .order("alias", { ascending: true });
      if (error) throw error;
      return sendJson(res, 200, {
        ok: true,
        aliases: (data || []).map((row) => ({
          id: row.id,
          alias: row.alias,
          storeId: row.store_id,
          storeName: row.stores?.name || "",
        })),
      });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const alias = String(body.alias || "").trim();
      if (!alias || !body.storeId) return sendJson(res, 400, { ok: false, error: "alias_and_storeId_required" });
      const { data, error } = await supabase
        .from("store_aliases")
        .upsert({ alias, store_id: body.storeId }, { onConflict: "alias" })
        .select()
        .single();
      if (error) throw error;
      return sendJson(res, 200, { ok: true, aliasRow: data });
    }

    if (req.method === "DELETE") {
      const id = req.query?.id || new URL(req.url, "http://localhost").searchParams.get("id");
      if (!id) return sendJson(res, 400, { ok: false, error: "id_required" });
      const { error } = await supabase.from("store_aliases").delete().eq("id", id);
      if (error) throw error;
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { ok: false, error: "server_error", message: String(error.message || error) });
  }
}
