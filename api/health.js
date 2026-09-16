import { getSupabase, sendJson } from "./_lib/supabase.js";

export default async function handler(req, res) {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("stores").select("id").limit(1);
    if (error) throw error;
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return sendJson(res, 503, { ok: false, error: "supabase_unavailable", message: String(error.message || error) });
  }
}
