import { createClient } from "@supabase/supabase-js";

let client = null;

export function getSupabase() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が設定されていません");
  }
  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return client;
}

export function sendJson(res, status, payload) {
  res.status(status).setHeader("Cache-Control", "no-store").json(payload);
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

// 管理画面用の簡易パスワードゲート。全APIで共通利用。
export function checkAppPassword(req) {
  const required = process.env.APP_PASSWORD;
  if (!required) return true; // パスワード未設定なら制限しない
  const provided = req.headers["x-app-password"];
  return provided === required;
}
