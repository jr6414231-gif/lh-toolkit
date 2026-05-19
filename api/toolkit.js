const DB = process.env.FIREBASE_DB_URL;

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
  } catch(e) {}
}
async function fbDel(path) {
  try { await fetch(`${DB}/${path}.json`, { method:"DELETE" }); } catch(e) {}
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  if (!DB) return res.status(500).json({ ok: false, msg: "Server config error" });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ ok: false }); }

  const { action, payload = {} } = body || {};
  if (!action) return res.status(400).json({ ok: false });

  try {
    if (action === "verifyKey") {
      const k = (payload.key || "").trim().toUpperCase();
      if (!k || k.length < 2) return res.json({ ok: false, msg: "Invalid key!" });
      const allKeys = await fbGet("keys");
      if (!allKeys) return res.json({ ok: false, msg: "Invalid key! Buy from admin." });
      let foundId = null, foundKd = null;
      for (const kid in allKeys) {
        const obj = allKeys[kid];
        if (obj && obj.key && String(obj.key).toUpperCase() === k) {
          foundId = kid; foundKd = obj; break;
        }
      }
      if (!foundId || !foundKd) return res.json({ ok: false, msg: "Invalid key! Buy from admin." });
      if (!foundKd.expiry || foundKd.expiry < Date.now()) return res.json({ ok: false, msg: "Key expired!" });
      if (foundKd.deviceId && foundKd.deviceId !== (payload.deviceId || ""))
        return res.json({ ok: false, msg: "Key locked to another device!" });
      if (!foundKd.deviceId && payload.deviceId) {
        await fbSet(`keys/${foundId}/deviceId`, payload.deviceId);
        await fbSet(`keys/${foundId}/used`, true);
      }
      return res.json({ ok: true, expiry: foundKd.expiry, keyId: foundId, created: foundKd.created || null, days: foundKd.days || 1 });
    }

    if (action === "getTools") {
      const tools = await fbGet("tools");
      if (!tools) return res.json({ ok: true, tools: [] });
      const arr = [];
      for (const id in tools) {
        if (tools[id] && tools[id].active !== false && tools[id].name) arr.push(tools[id]);
      }
      return res.json({ ok: true, tools: arr });
    }

    if (action === "getSettings") {
      const s = await fbGet("settings");
      return res.json({ ok: true, settings: s || {} });
    }

    if (action === "getPhone") {
      const ph = await fbGet("admin/phone");
      const phoneStr = ph ? (typeof ph === "object" ? String(Object.values(ph)[0] || "") : String(ph)) : "";
      return res.json({ ok: true, phone: phoneStr });
    }

    if (action === "getScreenshots") {
      const shots = await fbGet("screenshots");
      if (!shots) return res.json({ ok: true, screenshots: [] });
      const arr = [];
      for (const id in shots) { if (shots[id] && shots[id].url) arr.push(shots[id]); }
      arr.sort((a, b) => (a.order || 0) - (b.order || 0));
      return res.json({ ok: true, screenshots: arr });
    }

    if (action === "trackOnline") {
      if (!payload.sessionId) return res.json({ ok: true, online: 0 });
      const sid = String(payload.sessionId).replace(/[^a-z0-9]/gi, "").slice(0, 30);
      await fbSet(`online/${sid}`, { t: Date.now() });
      const online = await fbGet("online");
      let count = 0;
      const now = Date.now();
      if (online) {
        for (const k in online) {
          if (online[k] && online[k].t && (now - online[k].t) < 180000) count++;
          else await fbDel(`online/${k}`);
        }
      }
      return res.json({ ok: true, online: count });
    }

    if (action === "countView") {
      const v = await fbGet("stats/views");
      const nv = (parseInt(v) || 0) + 1;
      await fbSet("stats/views", nv);
      return res.json({ ok: true, views: nv });
    }

    if (action === "getViews") {
      const v = await fbGet("stats/views");
      return res.json({ ok: true, views: parseInt(v) || 0 });
    }

    if (action === "toolClick") {
      if (!payload.toolName) return res.json({ ok: true });
      const tools = await fbGet("tools");
      if (tools) {
        for (const id in tools) {
          if (tools[id] && tools[id].name === payload.toolName) {
            await fbSet(`tools/${id}/views`, (parseInt(tools[id].views) || 0) + 1);
            break;
          }
        }
      }
      return res.json({ ok: true });
    }

    if (action === "goOffline") {
      if (payload.sessionId) {
        const sid = String(payload.sessionId).replace(/[^a-z0-9]/gi, "").slice(0, 30);
        await fbDel(`online/${sid}`);
      }
      return res.json({ ok: true });
    }

    return res.json({ ok: false, msg: "Unknown action" });
  } catch(e) {
    return res.status(500).json({ ok: false });
  }
}
