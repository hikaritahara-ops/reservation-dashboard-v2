import { getSupabase, sendJson, checkAppPassword } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  if (!checkAppPassword(req)) return sendJson(res, 401, { ok: false, error: "unauthorized" });

  const supabase = getSupabase();
  const url = new URL(req.url, "http://localhost");
  const storeIdsParam = url.searchParams.get("storeIds"); // カンマ区切り。省略時は全店舗
  const dateFrom = url.searchParams.get("dateFrom") || null;
  const dateTo = url.searchParams.get("dateTo") || null;
  const storeIds = storeIdsParam ? storeIdsParam.split(",").filter(Boolean) : null;

  try {
    const { data, error } = await supabase.rpc("monthly_summary", {
      p_store_ids: storeIds,
      p_date_from: dateFrom,
      p_date_to: dateTo,
    });
    if (error) throw error;

    return sendJson(res, 200, {
      ok: true,
      rows: (data || []).map((row) => ({
        storeId: row.store_id,
        storeName: row.store_name,
        routeId: row.route_id,
        routeName: row.route_name,
        month: row.month,
        count: Number(row.cnt),
        sales: Number(row.sales),
      })),
    });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { ok: false, error: "server_error", message: String(error.message || error) });
  }
}
