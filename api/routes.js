import { getSupabase, sendJson, readJsonBody, checkAppPassword } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (!checkAppPassword(req)) return sendJson(res, 401, { ok: false, error: "unauthorized" });
  const supabase = getSupabase();

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("routes")
        .select("id, name, sort_order, excluded_by_default")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return sendJson(res, 200, { ok: true, routes: data });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const name = String(body.name || "").trim();
      if (!name) return sendJson(res, 400, { ok: false, error: "name_required" });
      const { data, error } = await supabase
        .from("routes")
        .insert({
          name,
          sort_order: Number.isFinite(body.sortOrder) ? body.sortOrder : 100,
          excluded_by_default: Boolean(body.excludedByDefault),
        })
        .select()
        .single();
      if (error) throw error;
      return sendJson(res, 200, { ok: true, route: data });
    }

    if (req.method === "PUT") {
      const body = await readJsonBody(req);
      if (!body.id) return sendJson(res, 400, { ok: false, error: "id_required" });
      const update = {};
      if (body.name !== undefined) update.name = String(body.name).trim();
      if (body.sortOrder !== undefined) update.sort_order = body.sortOrder;
      if (body.excludedByDefault !== undefined) update.excluded_by_default = Boolean(body.excludedByDefault);
      const { data, error } = await supabase.from("routes").update(update).eq("id", body.id).select().single();
      if (error) throw error;
      return sendJson(res, 200, { ok: true, route: data });
    }

    if (req.method === "DELETE") {
      const id = req.query?.id || new URL(req.url, "http://localhost").searchParams.get("id");
      if (!id) return sendJson(res, 400, { ok: false, error: "id_required" });
      const { error } = await supabase.from("routes").delete().eq("id", id);
      if (error) {
        if (String(error.code) === "23503") {
          return sendJson(res, 409, {
            ok: false,
            error: "route_in_use",
            message: "この経路には予約データが紐づいているため削除できません。",
          });
        }
        throw error;
      }
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { ok: false, error: "server_error", message: String(error.message || error) });
  }
}
