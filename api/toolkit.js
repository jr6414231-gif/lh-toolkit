// ============================================================
// /api/toolkit.js — Toolkit API Route (Vercel Serverless)
// Firebase URL kabhi browser tak nahi aata
// Vercel Environment Variables mein set karo:
//   FIREBASE_DB_URL = https://your-project-default-rtdb.firebaseio.com
// ============================================================

const DB = process.env.FIREBASE_DB_URL;

// ── CORS Headers ──
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://lh-toolkit.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ── Firebase helpers (server-side only) ──
async function fbGet(path) {
  const r = await fetch(`${DB}/${path}.json`);
  const t = await r.text();
  return (t && t !== "null") ? JSON.parse(t) : null;
}
async function fbSet(path, data) {
  await fetch(`${DB}/${path}.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
}
async function fbPush(path, data) {
  const r = await fetch(`${DB}/${path}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  const j = await r.json();
  return j.name || null;
}
async function fbDel(path) {
  await fetch(`${DB}/${path}.json`, { method: "DELETE" });
}

// ── Main Handler ──
export default async function handler(req, res) {
  cors(res);

  // OPTIONS preflight
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, msg: "Method not allowed" });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, msg: "Invalid JSON" });
  }

  const { action, payload = {} } = body;

  try {

    // ── VERIFY KEY ──
    if (action === "verifyKey") {
      const k = (payload.key || "").trim().toUpperCase();
      if (!k || k.length < 4) return res.json({ ok: false, msg: "Invalid key!" });

      const allKeys = await fbGet("keys");
      if (!allKeys) return res.json({ ok: false, msg: "Invalid key! Buy from admin." });

      let foundId = null, foundKd = null;
      for (const kid in allKeys) {
        const obj = allKeys[kid];
        if (obj && obj.key && obj.key.toUpperCase() === k) {
          foundId = kid; foundKd = obj; break;
        }
      }
      if (!foundId || !foundKd) return res.json({ ok: false, msg: "Invalid key! Buy from admin." });
      if (foundKd.expiry < Date.now()) return res.json({ ok: false, msg: "Key expired!" });
      if (foundKd.deviceId && foundKd.deviceId !== (payload.deviceId || ""))
        return res.json({ ok: false, msg: "Key locked to another device!" });
      if (!foundKd.deviceId && payload.deviceId) {
        await fbSet(`keys/${foundId}/deviceId`, payload.deviceId);
        await fbSet(`keys/${foundId}/used`, true);
      }
      return res.json({ ok: true, expiry: foundKd.expiry, keyId: foundId, created: foundKd.created || null, days: foundKd.days || null });
    }

    // ── GET TOOLS ──
    if (action === "getTools") {
      const tools = await fbGet("tools");
      if (!tools) return res.json({ ok: true, tools: [] });
      const arr = [];
      for (const id in tools) {
        if (tools[id] && tools[id].active !== false) arr.push(tools[id]);
      }
      return res.json({ ok: true, tools: arr });
    }

    // ── GET SETTINGS (name, logo, announcement etc) ──
    if (action === "getSettings") {
      const settings = await fbGet("settings");
      return res.json({ ok: true, settings: settings || {} });
    }

    // ── GET SCREENSHOTS (login page slider) ──
    if (action === "getScreenshots") {
      const shots = await fbGet("screenshots");
      if (!shots) return res.json({ ok: true, screenshots: [] });
      const arr = [];
      for (const id in shots) {
        if (shots[id] && shots[id].url) arr.push(shots[id]);
      }
      arr.sort((a, b) => (a.order || 0) - (b.order || 0));
      return res.json({ ok: true, screenshots: arr });
    }

    // ── GET WHATSAPP PHONE ──
    if (action === "getPhone") {
      const phone = await fbGet("admin/phone");
      return res.json({ ok: true, phone: phone || "" });
    }

    // ── TRACK ONLINE ──
    if (action === "trackOnline") {
      if (!payload.sessionId) return res.json({ ok: false });
      await fbSet(`online/${payload.sessionId}`, { t: Date.now() });
      // Clean stale (>3 min)
      const online = await fbGet("online");
      let count = 0;
      if (online) {
        const now = Date.now();
        for (const k in online) {
          if (online[k] && online[k].t && (now - online[k].t) < 180000) count++;
          else await fbDel(`online/${k}`);
        }
      }
      return res.json({ ok: true, online: count });
    }

    // ── COUNT VIEW (once per session) ──
    if (action === "countView") {
      const views = await fbGet("stats/views");
      const newViews = (parseInt(views) || 0) + 1;
      await fbSet("stats/views", newViews);
      return res.json({ ok: true, views: newViews });
    }

    // ── GET VIEWS ──
    if (action === "getViews") {
      const views = await fbGet("stats/views");
      return res.json({ ok: true, views: parseInt(views) || 0 });
    }

    // ── TOOL CLICK VIEW ──
    if (action === "toolClick") {
      const { toolName } = payload;
      if (!toolName) return res.json({ ok: false });
      const tools = await fbGet("tools");
      if (tools) {
        for (const id in tools) {
          if (tools[id] && tools[id].name === toolName) {
            const v = (parseInt(tools[id].views) || 0) + 1;
            await fbSet(`tools/${id}/views`, v);
            break;
          }
        }
      }
      return res.json({ ok: true });
    }

    // ── OFFLINE (remove session) ──
    if (action === "goOffline") {
      if (payload.sessionId) await fbDel(`online/${payload.sessionId}`);
      return res.json({ ok: true });
    }

    return res.json({ ok: false, msg: "Unknown action" });

  } catch (e) {
    console.error("Toolkit API error:", e);
    return res.status(500).json({ ok: false, msg: "Server error" });
  }
}
