// ═══════════════════════════════════════
// L♥H TOOLKIT - Vercel Serverless Function
// ALL database logic is HERE on server
// Browser never sees Firebase credentials
// ═══════════════════════════════════════

const FIREBASE_URL = "https://toolkit-73b2a-default-rtdb.firebaseio.com";
const FIREBASE_KEY = "AIzaSyDJ8nLUpk-LmCebvSuzOB0EJx5tJvVKsPw";
const ADMIN_SECRET = "LH_ADMIN_2024_SECRET"; // Server-side admin check

// Get Firebase token (server-side only)
async function getToken() {
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnSecureToken: true })
      }
    );
    const data = await res.json();
    return data.idToken || null;
  } catch { return null; }
}

// Firebase DB request
async function fbRequest(path, method = "GET", body = null) {
  const token = await getToken();
  const url = `${FIREBASE_URL}/${path}.json${token ? `?auth=${token}` : ""}`;
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  return res.json();
}

// CORS headers
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "https://lh-toolkit.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { action, payload } = req.body || {};
  if (!action) return res.status(400).json({ error: "No action" });

  try {
    // ── PUBLIC ACTIONS (no auth needed) ──

    // Verify license key
    if (action === "verifyKey") {
      const { key, deviceId } = payload;
      const keys = await fbRequest("keys");
      if (!keys) return res.json({ ok: false, msg: "Connection failed" });

      let foundId = null, foundKey = null;
      for (const [id, k] of Object.entries(keys)) {
        if (k.key === key) { foundId = id; foundKey = k; break; }
      }

      if (!foundKey) return res.json({ ok: false, msg: "❌ Invalid key!" });
      if (foundKey.expiry < Date.now()) return res.json({ ok: false, msg: "⌛ Key expired!" });
      if (foundKey.deviceId && foundKey.deviceId !== deviceId) {
        return res.json({ ok: false, msg: "🔒 Key already used on another device!" });
      }

      // Lock key to device
      await fbRequest(`keys/${foundId}/used`, "PUT", true);
      await fbRequest(`keys/${foundId}/deviceId`, "PUT", deviceId);
      await fbRequest(`keys/${foundId}/usedBy`, "PUT", key);

      return res.json({
        ok: true,
        expiry: foundKey.expiry,
        days: foundKey.days
      });
    }

    // Get tools (only active ones - no admin data)
    if (action === "getTools") {
      const tools = await fbRequest("tools");
      if (!tools) return res.json({ ok: true, tools: [] });
      const active = Object.entries(tools)
        .filter(([, t]) => t.active !== false)
        .map(([id, t]) => ({
          id, name: t.name, link: t.link,
          desc: t.desc, iconClass: t.iconClass,
          iconBase64: t.iconBase64 || null
        }));
      return res.json({ ok: true, tools: active });
    }

    // Get settings (colors, theme, toolkit name only)
    if (action === "getSettings") {
      const settings = await fbRequest("settings");
      return res.json({ ok: true, settings: settings || {} });
    }

    // Get admin phone (for WhatsApp buy button)
    if (action === "getPhone") {
      const phone = await fbRequest("admin/phone");
      return res.json({ ok: true, phone: phone || "+923277796795" });
    }

    // ── ADMIN ACTIONS (need admin token) ──
    const { adminToken } = payload || {};
    if (!adminToken || adminToken !== ADMIN_SECRET) {
      return res.status(403).json({ ok: false, msg: "Unauthorized" });
    }

    if (action === "adminLogin") {
      const { username, password } = payload;
      const creds = await fbRequest("admin/credentials");
      const au = (creds && creds.username) ? creds.username : "admin";
      const ap = (creds && creds.password) ? creds.password : "lhToolkit2024";
      if (username === au && password === ap) {
        return res.json({ ok: true, token: ADMIN_SECRET });
      }
      return res.json({ ok: false, msg: "Invalid credentials" });
    }

    if (action === "getAdminData") {
      const [tools, keys, phone, settings] = await Promise.all([
        fbRequest("tools"),
        fbRequest("keys"),
        fbRequest("admin/phone"),
        fbRequest("settings")
      ]);
      return res.json({ ok: true, tools, keys, phone, settings });
    }

    if (action === "addTool") {
      const { tool } = payload;
      await fbRequest("tools", "POST", { ...tool, active: true, created: Date.now() });
      return res.json({ ok: true });
    }

    if (action === "editTool") {
      const { id, tool } = payload;
      await fbRequest(`tools/${id}`, "PUT", tool);
      return res.json({ ok: true });
    }

    if (action === "deleteTool") {
      await fbRequest(`tools/${payload.id}`, "DELETE");
      return res.json({ ok: true });
    }

    if (action === "toggleTool") {
      await fbRequest(`tools/${payload.id}/active`, "PUT", payload.active);
      return res.json({ ok: true });
    }

    if (action === "generateKey") {
      const { days, customKey } = payload;
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      let kv = customKey ? customKey.toUpperCase() : "LH-";
      if (!customKey) {
        for (let i = 0; i < 4; i++) {
          let s = "";
          for (let j = 0; j < 4; j++) s += chars[Math.floor(Math.random() * chars.length)];
          kv += s + (i < 3 ? "-" : "");
        }
      }
      const keyData = { key: kv, days, expiry: Date.now() + days * 86400000, created: Date.now(), used: false };
      await fbRequest("keys", "POST", keyData);
      return res.json({ ok: true, key: kv });
    }

    if (action === "deleteKey") {
      await fbRequest(`keys/${payload.id}`, "DELETE");
      return res.json({ ok: true });
    }

    if (action === "saveSettings") {
      await fbRequest("settings", "PUT", payload.settings);
      return res.json({ ok: true });
    }

    if (action === "savePhone") {
      await fbRequest("admin/phone", "PUT", payload.phone);
      return res.json({ ok: true });
    }

    if (action === "saveCreds") {
      await fbRequest("admin/credentials", "PUT", { username: payload.username, password: payload.password });
      return res.json({ ok: true });
    }

    return res.status(400).json({ ok: false, msg: "Unknown action" });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, msg: "Server error" });
  }
}
