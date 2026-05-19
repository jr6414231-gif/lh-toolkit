const DB = process.env.FIREBASE_DB_URL;
const ADMIN_KEY = process.env.ADMIN_KEY || "LH-ADMIN-2024";

async function fbGet(path) {
  try {
    const r = await fetch(`${DB}/${path}.json`);
    const t = await r.text();
    return (t && t !== "null") ? JSON.parse(t) : null;
  } catch(e) { return null; }
}
async function fbSet(path, data) {
  try {
    await fetch(`${DB}/${path}.json`, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data) });
    return true;
  } catch(e) { return false; }
}
async function fbPush(path, data) {
  try {
    const r = await fetch(`${DB}/${path}.json`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data) });
    const j = await r.json();
    return j.name || null;
  } catch(e) { return null; }
}
async function fbDel(path) {
  try { await fetch(`${DB}/${path}.json`, { method:"DELETE" }); return true; }
  catch(e) { return false; }
}

// Clean phone helper
function cleanPhone(ph) {
  if (!ph) return "";
  if (typeof ph === "object") return String(ph.number || ph.phone || ph.value || Object.values(ph)[0] || "");
  return String(ph);
}

// Clean key helper
function cleanKey(k, id) {
  if (!k || typeof k !== "object") return null;
  if (!k.key || !k.expiry) return null;
  return {
    key: String(k.key),
    days: parseInt(k.days) || 1,
    expiry: parseInt(k.expiry),
    created: parseInt(k.created) || 0,
    used: k.used === true,
    deviceId: k.deviceId || null
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  if (!DB) return res.status(500).json({ ok: false, msg: "FIREBASE_DB_URL not set in Vercel env vars" });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ ok: false }); }

  const { action, payload = {}, adminKey } = body || {};
  if (!action) return res.status(400).json({ ok: false });

  // ── GET KEY (login step 1 - no auth needed) ──
  if (action === "getKey") {
    const creds = await fbGet("admin/credentials");
    const validU = (creds && creds.username) ? creds.username : "admin";
    const validP = (creds && creds.password) ? creds.password : "lhToolkit2024";
    if (payload.username === validU && payload.password === validP) {
      return res.json({ ok: true, key: ADMIN_KEY });
    }
    return res.json({ ok: false, msg: "Invalid credentials" });
  }

  // ── All other actions need adminKey ──
  if (!adminKey || adminKey !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, msg: "Unauthorized" });
  }

  try {
    // ── GET ALL DATA ──
    if (action === "getData") {
      const tools = await fbGet("tools");
      const keysRaw = await fbGet("keys");
      const phone = await fbGet("admin/phone");
      const settings = await fbGet("settings");
      const views = await fbGet("stats/views");

      // Clean keys
      let keys = null;
      if (keysRaw && typeof keysRaw === "object") {
        keys = {};
        for (const id in keysRaw) {
          const cleaned = cleanKey(keysRaw[id], id);
          if (cleaned) keys[id] = cleaned;
        }
        if (!Object.keys(keys).length) keys = null;
      }

      return res.json({
        ok: true,
        tools: tools || null,
        keys,
        phone: cleanPhone(phone),
        settings: settings || {},
        views: parseInt(views) || 0
      });
    }

    // ── TOOLS ──
    if (action === "addTool") {
      const { name, link, desc, iconClass, iconUrl, iconBase64 } = payload;
      if (!name || !link) return res.json({ ok: false, msg: "Name & Link required" });
      const id = await fbPush("tools", {
        name, link,
        desc: desc || "",
        iconClass: iconClass || "fas fa-star",
        iconUrl: iconUrl || null,
        iconBase64: iconBase64 || null,
        active: true,
        created: Date.now(),
        views: 0
      });
      return res.json({ ok: !!id, id });
    }
    if (action === "editTool") {
      const { id, ...data } = payload;
      if (!id) return res.json({ ok: false });
      const ex = await fbGet(`tools/${id}`) || {};
      await fbSet(`tools/${id}`, { ...ex, ...data });
      return res.json({ ok: true });
    }
    if (action === "deleteTool") {
      if (!payload.id) return res.json({ ok: false });
      await fbDel(`tools/${payload.id}`);
      return res.json({ ok: true });
    }
    if (action === "toggleTool") {
      if (!payload.id) return res.json({ ok: false });
      await fbSet(`tools/${payload.id}/active`, payload.active);
      return res.json({ ok: true });
    }

    // ── KEYS ──
    if (action === "generateKey") {
      const days = parseInt(payload.days) || 1;
      const custom = (payload.custom || "").trim();
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let kv;
      if (custom) {
        kv = custom.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
        if (!kv) kv = "LH-CUSTOM";
      } else {
        kv = "LH-";
        for (let i = 0; i < 4; i++) {
          let s = "";
          for (let j = 0; j < 4; j++) s += chars[Math.floor(Math.random() * chars.length)];
          kv += s + (i < 3 ? "-" : "");
        }
      }
      const id = await fbPush("keys", {
        key: kv,
        days,
        expiry: Date.now() + days * 86400000,
        created: Date.now(),
        used: false,
        usedBy: null,
        deviceId: null
      });
      return res.json({ ok: !!id, key: kv, id });
    }
    if (action === "deleteKey") {
      if (!payload.id) return res.json({ ok: false });
      await fbDel(`keys/${payload.id}`);
      return res.json({ ok: true });
    }
    if (action === "resetDevice") {
      if (!payload.id) return res.json({ ok: false });
      await fbSet(`keys/${payload.id}/deviceId`, null);
      await fbSet(`keys/${payload.id}/used`, false);
      return res.json({ ok: true });
    }

    // ── SCREENSHOTS ──
    if (action === "addScreenshot") {
      if (!payload.url) return res.json({ ok: false, msg: "URL required" });
      const existing = await fbGet("screenshots");
      const order = existing ? Object.keys(existing).length : 0;
      const id = await fbPush("screenshots", {
        url: payload.url,
        caption: payload.caption || "",
        order,
        created: Date.now()
      });
      return res.json({ ok: !!id, id });
    }
    if (action === "getScreenshots") {
      const shots = await fbGet("screenshots");
      if (!shots) return res.json({ ok: true, screenshots: [] });
      const arr = [];
      for (const id in shots) {
        if (shots[id] && shots[id].url) arr.push({ id, ...shots[id] });
      }
      arr.sort((a, b) => (a.order || 0) - (b.order || 0));
      return res.json({ ok: true, screenshots: arr });
    }
    if (action === "deleteScreenshot") {
      if (!payload.id) return res.json({ ok: false });
      await fbDel(`screenshots/${payload.id}`);
      return res.json({ ok: true });
    }

    // ── SETTINGS ──
    if (action === "saveSettings") {
      if (!payload.settings) return res.json({ ok: false });
      await fbSet("settings", payload.settings);
      return res.json({ ok: true });
    }
    if (action === "savePhone") {
      const clean = String(payload.phone || "").replace(/[^0-9]/g, "");
      if (!clean) return res.json({ ok: false, msg: "Invalid phone" });
      await fbSet("admin/phone", clean);
      return res.json({ ok: true, phone: clean });
    }
    if (action === "saveCredentials") {
      if (!payload.username || !payload.password) return res.json({ ok: false });
      await fbSet("admin/credentials", { username: payload.username, password: payload.password });
      return res.json({ ok: true });
    }

    return res.json({ ok: false, msg: "Unknown action" });
  } catch(e) {
    console.error("Admin API error:", e.message);
    return res.status(500).json({ ok: false, msg: "Server error" });
  }
}
