import { getSupabase, sendJson, readJsonBody, checkAppPassword } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (!checkAppPassword(req)) return sendJson(res, 401, { ok: false, error: "unauthorized" });
  const supabase = getSupabase();

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("route_aliases")
        .select("id, alias, route_id, routes(name)")
        .order("alias", { ascending: true });
      if (error) throw error;
      return sendJson(res, 200, {
        ok: true,
        aliases: (data || []).map((row) => ({
          id: row.id,
          alias: row.alias,
          routeId: row.route_id,
          routeName: row.routes?.name || "",
        })),
      });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const alias = String(body.alias || "").trim();
      if (!alias || !body.routeId) return sendJson(res, 400, { ok: false, error: "alias_and_routeId_required" });
      const { data, error } = await supabase
        .from("route_aliases")
        .upsert({ alias, route_id: body.routeId }, { onConflict: "alias" })
        .select()
        .single();
      if (error) throw error;
      return sendJson(res, 200, { ok: true, aliasRow: data });
    }

    if (req.method === "PUT") {
      const body = await readJsonBody(req);
      if (!body.id || !body.routeId) return sendJson(res, 400, { ok: false, error: "id_and_routeId_required" });
      const { data, error } = await supabase
        .from("route_aliases")
        .update({ route_id: body.routeId })
        .eq("id", body.id)
        .select()
        .single();
      if (error) throw error;
      return sendJson(res, 200, { ok: true, aliasRow: data });
    }

    if (req.method === "DELETE") {
      const id = req.query?.id || new URL(req.url, "http://localhost").searchParams.get("id");
      if (!id) return sendJson(res, 400, { ok: false, error: "id_required" });
      const { error } = await supabase.from("route_aliases").delete().eq("id", id);
      if (error) throw error;
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { ok: false, error: "server_error", message: String(error.message || error) });
  }
}
