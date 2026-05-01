const DB = "https://toolkit-73b2a-default-rtdb.firebaseio.com";
const ADMIN_SECRET = "LH_ADMIN_2024_SECRET";

// Simple Firebase REST - no auth needed with rules set to auth!=null
// We use the public read for admin credentials check
async function dbGet(path) {
  try {
    const r = await fetch(`${DB}/${path}.json`);
    const text = await r.text();
    if (!text || text === "null") return null;
    return JSON.parse(text);
  } catch(e) {
    console.error("dbGet error:", e.message);
    return null;
  }
}

async function dbSet(path, data) {
  try {
    await fetch(`${DB}/${path}.json`, {
      method: "PUT",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(data)
    });
  } catch(e) { console.error("dbSet error:", e.message); }
}

async function dbPush(path, data) {
  try {
    const r = await fetch(`${DB}/${path}.json`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(data)
    });
    const j = await r.json();
    return j.name || null;
  } catch(e) { return null; }
}

async function dbDelete(path) {
  try {
    await fetch(`${DB}/${path}.json`, { method: "DELETE" });
  } catch(e) {}
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ok:false});

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  
  const { action, payload = {} } = body || {};
  if (!action) return res.status(400).json({ok:false});

  try {
    // PUBLIC
    if (action === "verifyKey") {
      const { key, deviceId } = payload;
      const keys = await dbGet("keys");
      if (!keys) return res.json({ok:false, msg:"❌ Connection failed"});
      let fid=null, fk=null;
      for (const [id,k] of Object.entries(keys)) {
        if (k.key === key) { fid=id; fk=k; break; }
      }
      if (!fk) return res.json({ok:false, msg:"❌ Invalid key!"});
      if (fk.expiry < Date.now()) return res.json({ok:false, msg:"⌛ Key expired!"});
      if (fk.deviceId && fk.deviceId !== deviceId) return res.json({ok:false, msg:"🔒 Key in use on another device!"});
      await dbSet(`keys/${fid}/used`, true);
      await dbSet(`keys/${fid}/deviceId`, deviceId);
      await dbSet(`keys/${fid}/usedBy`, key);
      return res.json({ok:true, expiry:fk.expiry, days:fk.days});
    }

    if (action === "getTools") {
      const tools = await dbGet("tools");
      if (!tools) return res.json({ok:true, tools:[]});
      const active = Object.entries(tools)
        .filter(([,t]) => t.active !== false)
        .map(([id,t]) => ({id, name:t.name, link:t.link, desc:t.desc, iconClass:t.iconClass, iconBase64:t.iconBase64||null}));
      return res.json({ok:true, tools:active});
    }

    if (action === "getSettings") {
      const s = await dbGet("settings");
      return res.json({ok:true, settings:s||{}});
    }

    if (action === "getPhone") {
      const p = await dbGet("admin/phone");
      return res.json({ok:true, phone:p||"+923277796795"});
    }

    // ADMIN LOGIN
    if (action === "adminLogin") {
      const { username, password } = payload;
      let creds = await dbGet("admin/credentials");
      if (!creds) {
        creds = {username:"admin", password:"lhToolkit2024"};
        await dbSet("admin/credentials", creds);
      }
      const validU = creds.username || "admin";
      const validP = creds.password || "lhToolkit2024";
      if (username === validU && password === validP) {
        return res.json({ok:true, token:ADMIN_SECRET});
      }
      return res.json({ok:false, msg:"❌ Invalid credentials"});
    }

    // ADMIN PROTECTED
    const { adminToken } = payload;
    if (!adminToken || adminToken !== ADMIN_SECRET) {
      return res.status(403).json({ok:false, msg:"Unauthorized"});
    }

    if (action === "getAdminData") {
      const [tools, keys, phone, settings] = await Promise.all([
        dbGet("tools"), dbGet("keys"), dbGet("admin/phone"), dbGet("settings")
      ]);
      return res.json({ok:true, tools, keys, phone, settings});
    }

    if (action === "addTool") {
      await dbPush("tools", {...payload.tool, active:true, created:Date.now()});
      return res.json({ok:true});
    }

    if (action === "editTool") {
      const existing = await dbGet(`tools/${payload.id}`);
      await dbSet(`tools/${payload.id}`, {...existing, ...payload.tool});
      return res.json({ok:true});
    }

    if (action === "deleteTool") {
      await dbDelete(`tools/${payload.id}`);
      return res.json({ok:true});
    }

    if (action === "toggleTool") {
      await dbSet(`tools/${payload.id}/active`, payload.active);
      return res.json({ok:true});
    }

    if (action === "generateKey") {
      const {days, customKey} = payload;
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      let kv = customKey ? customKey.toUpperCase().replace(/\s+/g,"-") : "LH-";
      if (!customKey) {
        for (let i=0;i<4;i++){let s="";for(let j=0;j<4;j++)s+=chars[Math.floor(Math.random()*chars.length)];kv+=s+(i<3?"-":"");}
      }
      await dbPush("keys", {key:kv, days, expiry:Date.now()+days*86400000, created:Date.now(), used:false, usedBy:null, deviceId:null});
      return res.json({ok:true, key:kv});
    }

    if (action === "deleteKey") {
      await dbDelete(`keys/${payload.id}`);
      return res.json({ok:true});
    }

    if (action === "saveSettings") {
      await dbSet("settings", payload.settings);
      return res.json({ok:true});
    }

    if (action === "savePhone") {
      await dbSet("admin/phone", payload.phone);
      return res.json({ok:true});
    }

    if (action === "saveCreds") {
      await dbSet("admin/credentials", {username:payload.username, password:payload.password});
      return res.json({ok:true});
    }

    return res.status(400).json({ok:false, msg:"Unknown action"});

  } catch(e) {
    console.error("Handler error:", e);
    return res.status(500).json({ok:false, msg:"Server error: "+e.message});
  }
}
