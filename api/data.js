// ============================================================
//  L♥H TOOLKIT — Secure API (Vercel Serverless)
//  Firebase URL sirf yahan hai — client ko kabhi nahi milta
// ============================================================
// Vercel Environment Variables:
//   TOOLKIT_DB_URL   = https://toolkit-73b2a-default-rtdb.firebaseio.com
//   TOOLKIT_SECRET   = Firebase database secret
//   TOOLKIT_ADMIN_KEY = Admin panel ka password (strong string)
// ============================================================

const https = require("https");

const DB      = process.env.TOOLKIT_DB_URL;
const SECRET  = process.env.TOOLKIT_SECRET;
const ADM_KEY = process.env.TOOLKIT_ADMIN_KEY;

// CORS
function cors(req, res) {
  var origin = req.headers.origin || "";
  var allowed = ["https://lh-toolkit.vercel.app","http://localhost","http://127.0.0.1","null",""];
  var ok = allowed.some(function(a){ return origin === a || origin.startsWith(a); }) || origin === "";
  res.setHeader("Access-Control-Allow-Origin", ok ? (origin||"*") : "https://lh-toolkit.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-admin-key");
}

// Firebase REST
function fb(method, path, body) {
  return new Promise((resolve, reject) => {
    const sep  = path.includes("?") ? "&" : "?";
    const url  = new URL(`${DB}/${path}${sep}auth=${SECRET}`);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method,
      headers:  { "Content-Type": "application/json", ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) }
    };
    const req = https.request(opts, r => {
      let s = "";
      r.on("data", c => s += c);
      r.on("end",  () => { try { resolve(JSON.parse(s)); } catch { resolve(s); } });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function isAdmin(req) { return req.headers["x-admin-key"] === ADM_KEY; }

module.exports = async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action } = req.query;
  const body       = req.body || {};

  try {

    // ═══════════════════════════════════════════
    //  PUBLIC ROUTES
    // ═══════════════════════════════════════════

    // Verify key — 1 device pe 1 key
    if (action === "verify-key" && req.method === "POST") {
      const { key, deviceId } = body;
      if (!key) return res.status(400).json({ ok: false, msg: "Key missing!" });

      // Search key in Firebase
      const data = await fb("GET", `keys.json?orderBy="key"&equalTo="${encodeURIComponent(key.trim().toUpperCase())}"`);

      if (!data || typeof data !== "object" || !Object.keys(data).length) {
        return res.json({ ok: false, msg: "Invalid key! Admin se lein." });
      }

      const id = Object.keys(data)[0];
      const kd = data[id];

      // Check expiry
      const expMs = kd.expiry > 9999999999 ? kd.expiry : kd.expiry * 1000;
      if (expMs < Date.now()) return res.json({ ok: false, msg: "Key expire ho gayi! Nai key lein." });

      // Check device lock — 1 key 1 device
      if (kd.deviceId && kd.deviceId !== deviceId) {
        return res.json({ ok: false, msg: "Yeh key doosre device pe locked hai! Admin se contact karein." });
      }

      // First use — lock to device
      if (!kd.deviceId) {
        await fb("PATCH", `keys/${id}.json`, { deviceId, used: true, usedAt: Date.now() });
      }

      return res.json({
        ok: true,
        keyId: id,
        expiry: expMs,
        days: kd.days,
        created: kd.created || null
      });
    }

    // Get tools (public)
    if (action === "tools" && req.method === "GET") {
      const data = await fb("GET", "tools.json");
      if (!data || typeof data !== "object") return res.json({ tools: [] });
      const tools = Object.entries(data)
        .filter(([, v]) => v && v.active !== false)
        .map(([k, v]) => ({ id: k, ...v }));
      return res.json({ tools });
    }

    // Get settings (public)
    if (action === "settings" && req.method === "GET") {
      const s = await fb("GET", "settings.json");
      return res.json({ settings: s || {} });
    }

    // Get admin phone (public — for buy button)
    if (action === "admin-phone" && req.method === "GET") {
      const ph = await fb("GET", "admin/phone.json");
      return res.json({ phone: ph || "923277796795" });
    }

    // ═══════════════════════════════════════════
    //  ADMIN ROUTES — x-admin-key required
    // ═══════════════════════════════════════════
    if (!isAdmin(req)) return res.status(403).json({ ok: false, msg: "Unauthorized" });

    // Verify admin login
    if (action === "admin-login" && req.method === "POST") {
      const creds = await fb("GET", "admin/credentials.json");
      const { username, password } = body;
      if (!creds) {
        // Default creds
        if (username === "admin" && password === "admin123") return res.json({ ok: true });
        return res.json({ ok: false, msg: "Wrong credentials!" });
      }
      if (creds.username === username && creds.password === password) return res.json({ ok: true });
      return res.json({ ok: false, msg: "Wrong credentials!" });
    }

    // Get all admin data
    if (action === "admin-data" && req.method === "GET") {
      const [keys, tools, settings, admin] = await Promise.all([
        fb("GET", "keys.json"),
        fb("GET", "tools.json"),
        fb("GET", "settings.json"),
        fb("GET", "admin.json")
      ]);
      return res.json({ keys: keys||{}, tools: tools||{}, settings: settings||{}, admin: admin||{} });
    }

    // Generate key
    if (action === "gen-key" && req.method === "POST") {
      const { days, custom } = body;
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      let kv = custom ? custom.toUpperCase().replace(/\s+/g, "-") : "LH-";
      if (!custom) {
        for (let i = 0; i < 4; i++) {
          let s = "";
          for (let j = 0; j < 4; j++) s += chars[Math.floor(Math.random() * chars.length)];
          kv += s + (i < 3 ? "-" : "");
        }
      }
      const keyData = {
        key: kv, days: parseInt(days) || 30,
        expiry: Date.now() + (parseInt(days) || 30) * 86400000,
        created: Date.now(), used: false, usedBy: null, deviceId: null
      };
      const result = await fb("POST", "keys.json", keyData);
      return res.json({ ok: true, key: kv, id: result?.name });
    }

    // Delete key
    if (action === "del-key" && req.method === "DELETE") {
      await fb("DELETE", `keys/${body.id}.json`);
      return res.json({ ok: true });
    }

    // Reset key device
    if (action === "reset-key" && req.method === "POST") {
      await fb("PATCH", `keys/${body.id}.json`, { deviceId: null, used: false });
      return res.json({ ok: true });
    }

    // Add/update tool
    if (action === "save-tool" && req.method === "POST") {
      const { id, tool } = body;
      if (id) {
        await fb("PUT", `tools/${id}.json`, tool);
      } else {
        await fb("POST", "tools.json", tool);
      }
      return res.json({ ok: true });
    }

    // Delete tool
    if (action === "del-tool" && req.method === "DELETE") {
      await fb("DELETE", `tools/${body.id}.json`);
      return res.json({ ok: true });
    }

    // Save settings
    if (action === "save-settings" && req.method === "POST") {
      await fb("PUT", "settings.json", body.settings);
      return res.json({ ok: true });
    }

    // Save admin phone
    if (action === "save-phone" && req.method === "POST") {
      await fb("PUT", "admin/phone.json", body.phone);
      return res.json({ ok: true });
    }

    // Change credentials
    if (action === "change-creds" && req.method === "POST") {
      await fb("PUT", "admin/credentials.json", { username: body.username, password: body.password });
      return res.json({ ok: true });
    }

    // Track online users + views
    if (action === "track-online" && req.method === "POST") {
      const { sessionId, key, newSession } = body;
      if (sessionId) {
        const now = Date.now();
        await fb("PUT", `online/${sessionId}.json`, { t: now, key: key||"" });
        
        // Count online (last 3 min)
        const online = await fb("GET", "online.json");
        let count = 1;
        if (online && typeof online === "object") {
          const active = Object.entries(online).filter(([,v]) => v && v.t && (now - v.t) < 180000);
          count = Math.max(active.length, 1);
          for (const [sid, v] of Object.entries(online)) {
            if (v && v.t && now - v.t > 300000) await fb("DELETE", `online/${sid}.json`);
          }
        }

        // Increment views only on new session
        let views = await fb("GET", "stats/views.json");
        views = parseInt(views) || 0;
        if (newSession) {
          views += 1;
          await fb("PUT", "stats/views.json", views);
        }

        return res.json({ ok: true, count, views });
      }
      return res.json({ ok: true, count: 1, views: 0 });
    }

    return res.status(404).json({ ok: false, msg: "Unknown action" });

  } catch (err) {
    console.error("API Error:", err);
    return res.status(500).json({ ok: false, msg: "Server error" });
  }
};
