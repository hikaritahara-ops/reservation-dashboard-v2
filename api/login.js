import { sendJson, readJsonBody } from "./_lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  const required = process.env.APP_PASSWORD;
  if (!required) return sendJson(res, 200, { ok: true }); // パスワード未設定なら誰でも利用可
  const body = await readJsonBody(req);
  if (String(body.password || "") === required) return sendJson(res, 200, { ok: true });
  return sendJson(res, 401, { ok: false, error: "invalid_password" });
}
