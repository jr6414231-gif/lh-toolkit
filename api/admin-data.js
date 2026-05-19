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
    await fetch(`${DB}/${path}.json`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    return true;
  } catch(e) { return false; }
}
async function fbPush(path, data) {
  try {
    const r = await fetch(`${DB}/${path}.json`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const j = await r.json();
    return j.name || null;
  } catch(e) { return null; }
}
async function fbDel(path) {
  try {
    await fetch(`${DB}/${path}.json`, { method: "DELETE" });
    return true;
  } catch(e) { return false; }
}

export default async function handler(req, res) {
  // Allow file:// (phone), localhost, and vercel domains
  const origin = req.headers.origin || req.headers.referer || "";
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  if (!DB) return res.status(500).json({ ok: false, msg: "Server config error" });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ ok: false }); }

  const { action, payload = {}, adminKey } = body || {};
  if (!action) return res.status(400).json({ ok: false });

  // getKey action - no auth needed, returns the key for login
  if (action === "getKey") {
    const creds = await fbGet("admin/credentials");
    const validU = (creds && creds.username) ? creds.username : "admin";
    const validP = (creds && creds.password) ? creds.password : "lhToolkit2024";
    if (payload.username === validU && payload.password === validP) {
      return res.json({ ok: true, key: ADMIN_KEY });
    }
    return res.json({ ok: false, msg: "Invalid credentials" });
  }

  // verifyLogin - no auth needed
  if (action === "verifyLogin") {
    const creds = await fbGet("admin/credentials");
    const validU = (creds && creds.username) ? creds.username : "admin";
    const validP = (creds && creds.password) ? creds.password : "lhToolkit2024";
    const ok = payload.username === validU && payload.password === validP;
    return res.json({ ok, msg: ok ? "OK" : "Invalid credentials" });
  }

  // All other actions need adminKey
  if (!adminKey || adminKey !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, msg: "Unauthorized" });
  }

  try {
    if (action === "getData") {
      const tools = await fbGet("tools");
      const keysRaw = await fbGet("keys");
      const phone = await fbGet("admin/phone");
      const settings = await fbGet("settings");
      const views = await fbGet("stats/views");
      
      // Keys ko validate karo — invalid entries ignore karo
      let keys = null;
      if (keysRaw) {
        keys = {};
        for (const id in keysRaw) {
          const k = keysRaw[id];
          if (k && k.key && k.expiry) {
            keys[id] = {
              key: String(k.key),
              days: parseInt(k.days) || 1,
              expiry: parseInt(k.expiry),
              created: parseInt(k.created) || Date.now(),
              used: k.used === true,
              deviceId: k.deviceId || null
            };
          }
        }
        if (!Object.keys(keys).length) keys = null;
      }
      
      // Phone ko string banao
      const phoneStr = phone ? (typeof phone === "object" ? (phone.number || phone.phone || "") : String(phone)) : "";
      
      return res.json({ ok: true, tools, keys, phone: phoneStr, settings, views: parseInt(views)||0 });
    }

    // TOOLS
    if (action === "addTool") {
      const { name, link, desc, iconClass, iconUrl, iconBase64 } = payload;
      if (!name || !link) return res.json({ ok: false, msg: "Name & Link required" });
      const id = await fbPush("tools", {
        name, link, desc: desc||"", iconClass: iconClass||"fas fa-star",
        iconUrl: iconUrl||null, iconBase64: iconBase64||null,
        active: true, created: Date.now(), views: 0
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
      await fbDel(`tools/${payload.id}`);
      return res.json({ ok: true });
    }
    if (action === "toggleTool") {
      await fbSet(`tools/${payload.id}/active`, payload.active);
      return res.json({ ok: true });
    }

    // KEYS
    if (action === "generateKey") {
      const days = parseInt(payload.days) || 1;
      const custom = payload.custom;
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      let kv = custom ? custom.toUpperCase().replace(/\s+/g,"-") : "LH-";
      if (!custom) {
        for (let i = 0; i < 4; i++) {
          let s = "";
          for (let j = 0; j < 4; j++) s += chars[Math.floor(Math.random()*chars.length)];
          kv += s + (i < 3 ? "-" : "");
        }
      }
      const id = await fbPush("keys", {
        key: kv, days, expiry: Date.now() + days*86400000,
        created: Date.now(), used: false, usedBy: null, deviceId: null
      });
      return res.json({ ok: !!id, key: kv, id });
    }
    if (action === "deleteKey") {
      await fbDel(`keys/${payload.id}`);
      return res.json({ ok: true });
    }
    if (action === "resetDevice") {
      await fbSet(`keys/${payload.id}/deviceId`, null);
      await fbSet(`keys/${payload.id}/used`, false);
      return res.json({ ok: true });
    }

    // SCREENSHOTS
    if (action === "addScreenshot") {
      const existing = await fbGet("screenshots");
      const order = existing ? Object.keys(existing).length : 0;
      const id = await fbPush("screenshots", {
        url: payload.url, caption: payload.caption||"",
        order, created: Date.now()
      });
      return res.json({ ok: !!id, id });
    }
    if (action === "getScreenshots") {
      const shots = await fbGet("screenshots");
      if (!shots) return res.json({ ok: true, screenshots: [] });
      const arr = [];
      for (const id in shots) { if (shots[id]) arr.push({ id, ...shots[id] }); }
      arr.sort((a,b) => (a.order||0)-(b.order||0));
      return res.json({ ok: true, screenshots: arr });
    }
    if (action === "deleteScreenshot") {
      await fbDel(`screenshots/${payload.id}`);
      return res.json({ ok: true });
    }

    // SETTINGS
    if (action === "saveSettings") {
      await fbSet("settings", payload.settings);
      return res.json({ ok: true });
    }
    if (action === "savePhone") {
      const clean = String(payload.phone||"").replace(/[^0-9]/g,"");
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
    return res.status(500).json({ ok: false });
  }
}
