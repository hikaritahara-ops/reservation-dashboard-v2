import { getSupabase, sendJson, readJsonBody, checkAppPassword } from "./_lib/supabase.js";

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

function toNumber(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toTimeOrNull(value) {
  const text = String(value || "").trim();
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(text) ? text : null;
}

function toDateOrNull(value) {
  const text = String(value || "").trim();
  const match = text.match(/(20\d{2})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  if (!checkAppPassword(req)) return sendJson(res, 401, { ok: false, error: "unauthorized" });

  const supabase = getSupabase();

  try {
    const body = await readJsonBody(req);
    const storeId = body.storeId;
    const sourceFile = String(body.sourceFile || "");
    const sourceMonth = String(body.sourceMonth || "");
    const rows = Array.isArray(body.rows) ? body.rows : [];

    if (!storeId) return sendJson(res, 400, { ok: false, error: "storeId_required" });
    if (!rows.length) return sendJson(res, 400, { ok: false, error: "rows_required" });

    // 1) 経路の名寄せ ---------------------------------------------------
    const rawRoutes = [...new Set(rows.map((r) => String(r.route || "").trim()).filter(Boolean))];

    const [{ data: aliasRows, error: aliasErr }, { data: routeRows, error: routeErr }] = await Promise.all([
      supabase.from("route_aliases").select("alias, route_id").in("alias", rawRoutes.length ? rawRoutes : [""]),
      supabase.from("routes").select("id, name"),
    ]);
    if (aliasErr) throw aliasErr;
    if (routeErr) throw routeErr;

    const routeByName = new Map((routeRows || []).map((r) => [r.name, r.id]));
    const routeIdByAlias = new Map((aliasRows || []).map((r) => [r.alias, r.route_id]));
    const unclassifiedRouteId = routeByName.get("未分類");

    const newAliases = [];
    for (const raw of rawRoutes) {
      if (routeIdByAlias.has(raw)) continue;
      if (routeByName.has(raw)) {
        routeIdByAlias.set(raw, routeByName.get(raw));
        continue;
      }
      routeIdByAlias.set(raw, unclassifiedRouteId);
      newAliases.push({ alias: raw, route_id: unclassifiedRouteId });
    }

    if (newAliases.length) {
      const { error: insertAliasErr } = await supabase
        .from("route_aliases")
        .upsert(newAliases, { onConflict: "alias", ignoreDuplicates: true });
      if (insertAliasErr) throw insertAliasErr;
    }

    // 2) 予約データの整形 -------------------------------------------------
    const prepared = rows.map((r) => {
      const raw = String(r.route || "").trim();
      const reservationNo = String(r.reservationNo || "").trim() || null;
      const reservedDate = toDateOrNull(r.reservedDate);
      const reservedTime = toTimeOrNull(r.reservedTime);
      return {
        store_id: storeId,
        route_id: routeIdByAlias.get(raw) || unclassifiedRouteId,
        raw_route_text: raw || null,
        reservation_no: reservationNo,
        customer_name: r.customerName || null,
        reserved_at: reservedDate ? `${reservedDate}T${reservedTime || "00:00:00"}` : null,
        visit_date: toDateOrNull(r.visitDate) || (sourceMonth ? `${sourceMonth}-01` : null),
        visit_time: toTimeOrNull(r.visitTime),
        treatment_start: toTimeOrNull(r.treatmentStart),
        treatment_end: toTimeOrNull(r.treatmentEnd),
        fee: toNumber(r.fee),
        staff_name: r.staffName || null,
        nominated: String(r.nominated || "").includes("あり"),
        gender: r.gender || null,
        menu_text: r.menuText || null,
        source_file: sourceFile || null,
        source_month: sourceMonth || null,
      };
    }).filter((r) => r.visit_date);

    const skipped = rows.length - prepared.length;

    // 3) 書き込み（チャンク分割） ------------------------------------------
    let inserted = 0;
    for (const part of chunk(prepared, 500)) {
      const { data, error } = await supabase
        .from("reservations")
        .upsert(part, { onConflict: "store_id,reservation_no" })
        .select("id");
      if (error) throw error;
      inserted += data?.length || part.length;
    }

    return sendJson(res, 200, {
      ok: true,
      inserted,
      skipped,
      newUnmappedRoutes: newAliases.map((a) => a.alias),
    });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { ok: false, error: "server_error", message: String(error.message || error) });
  }
}
