

function _safeRequire() {
    for (let i = 0; i < arguments.length; i++) {
        try {
            const m = require(arguments[i]);
            if (m) return m;
        } catch (e) { }
    }
    return null;
}

const _app = _safeRequire("app");
const _minecraft = _safeRequire("minecraft");
const _player = _safeRequire("player");
const _camera = _safeRequire("camera");
const _world = _safeRequire("world");
const _gui = _safeRequire("gui");
const _input = _safeRequire("input");

const _menuRaw = _safeRequire("menu");
const _menu = {
    load: function (name, json) {
        try {
            let j = json;
            if (typeof j === "string") {
                try {
                    const o = JSON.parse(j);
                    if (o && typeof o === "object" && !Array.isArray(o)) {
                        if (o.hide === undefined) o.hide = true;
                        if (o.can_close === undefined) o.can_close = true;
                        j = JSON.stringify(o);
                    }
                } catch (e) { }
            }
            return _menuRaw.load(name, j);
        } catch (e) { return false; }
    },
    remove: function (name) { try { return _menuRaw.remove(name); } catch (e) { return false; } },
    show: function (name) { try { return _menuRaw.show(name); } catch (e) { return false; } },
    hide: function (name) { try { return _menuRaw.hide(name); } catch (e) { return false; } },
    regFun: function (name) { try { return _menuRaw.regFun(name); } catch (e) { return false; } }
};
const _fs = _safeRequire("fs");
const _https = _safeRequire("https", "network");
const _packet = _safeRequire("packet");
const _options = _safeRequire("options");
const _thread = _safeRequire("thread");
const _vm = _safeRequire("vm");
const _v8 = _safeRequire("v8");
const _crypto = _safeRequire("crypto");
const _i18n = _safeRequire("i18n");
const _media = _safeRequire("media");
const _sp = _safeRequire("sp");
const _nbt = _safeRequire("nbt");
const _block = _safeRequire("block");
const _item = _safeRequire("item");

const _Shape = (function () { try { return _world ? _world.Shape : null; } catch (e) { return null; } })();

function _level() {
    
    const s = _nxStamp();
    if (s >= 0 && _nxWorldStamp === s) return _nxWorld;
    try { _nxWorld = _world ? _world.getClientWorld() : null; } catch (e) { _nxWorld = null; }
    _nxWorldStamp = s;
    return _nxWorld;
}

var _nxLP = null;
var _nxLPStamp = -2;
var _nxWorld = null;
var _nxWorldStamp = -2;

function _localPlayer() {
    const s = _nxStamp();
    if (s >= 0 && _nxLPStamp === s) return _nxLP;
    try { _nxLP = _player ? _player.getLocalPlayer() : null; } catch (e) { _nxLP = null; }
    _nxLPStamp = s;
    return _nxLP;
}

function _actor(id) {
    const key = _idStr(id);
    if (!key) return null;
    const w = _level();
    if (!w) return null;
    
    const peek = _nxIdxPeek();
    if (peek && peek.miss[key]) {
        const hit0 = peek.byId[key];
        if (hit0 !== undefined) return hit0;
        return _actorFallback(w, key, peek);
    }
    
    let a = null;
    try { a = w.getEntity(id); } catch (e) { }
    if (!a) { try { a = w.getRuntimeEntity(id); } catch (e) { } }
    if (a) return a;
    
    const idx = _nxIdxGet();
    if (idx) {
        idx.miss[key] = 1;
        const hit = idx.byId[key];
        if (hit !== undefined) return hit;
    }
    return _actorFallback(w, key, idx);
}

function _actorFallback(w, key, idx) {
    let a = null;
    try {
        const ps = w.getPlayers() || [];
        for (let i = 0; i < ps.length; i++) {
            let uid = "", rid = "";
            try { uid = _idStr(ps[i].getUniqueID()); } catch (e) { }
            try { rid = _idStr(ps[i].getRuntimeID()); } catch (e) { }
            if ((uid && uid === key) || (rid && rid === key)) { a = ps[i]; break; }
        }
    } catch (e) { }
    if (!a) {
        try {
            const actors = w.getActors() || [];
            for (let i = 0; i < actors.length; i++) {
                let uid = "", rid = "";
                try { uid = _idStr(actors[i].getUniqueID()); } catch (e) { }
                try { rid = _idStr(actors[i].getRuntimeID()); } catch (e) { }
                if ((uid && uid === key) || (rid && rid === key)) { a = actors[i]; break; }
            }
        } catch (e) { }
    }
    
    if (!a) {
        try {
            const list = w.getPlayerList() || {};
            let wantName = null;
            for (const k in list) {
                if (_idStr(list[k].id) === key) { wantName = list[k].name; break; }
            }
            if (wantName) {
                const ps = w.getPlayers() || [];
                for (let i = 0; i < ps.length; i++) {
                    let nm = "";
                    try { nm = String(ps[i].getName()); } catch (e) { }
                    if (nm && nm === String(wantName)) { a = ps[i]; break; }
                }
                if (!a) {
                    const actors2 = w.getActors() || [];
                    for (let i = 0; i < actors2.length; i++) {
                        let nm = "";
                        try { nm = String(actors2[i].getName()); } catch (e) { }
                        if (nm && nm === String(wantName)) { a = actors2[i]; break; }
                    }
                }
            }
        } catch (e) { }
    }
    if (a && idx) idx.byId[key] = a;
    return a;
}

function _dimension() {
    
    try {
        const p = _localPlayer();
        if (p && typeof p.getDimension === "function") {
            const d = p.getDimension();
            if (d) return d;
        }
    } catch (e) { }
    const w = _level();
    if (!w) return null;
    let id = 0;
    try { const p = _localPlayer(); if (p) id = p.getDimensionId(); } catch (e) { }
    try { return w.getDimension(id); } catch (e) { }
    try { return w.getDimension("overworld"); } catch (e) { }
    return null;
}

function getScanDimension() {
    try { return _dimension(); } catch (e) { return null; }
}

function _blockNamespace(b, didHint) {
    try {
        const ns = b.getNamespace();
        if (ns && ns.indexOf(":") >= 0) return ns;
        let did = didHint;
        if (did === undefined) {
            try { did = b.getDescriptionId(); } catch (e) { did = null; }
        }
        if (did && did.indexOf(":") >= 0) return did;
        return ns || "";
    } catch (e) { return ""; }
}

const _AIR_BLOCK = { id: 0, namespace: "minecraft:air", aux: 0, solid: false, runtimeId: 0, descriptionId: "minecraft:air", descriptionName: "" };

function _blockIsAirName(n) {
    return n === "minecraft:air" || n === "air" || n === "tile.air" || n === "minecraft:air_block";
}

function getBlock(x, y, z, dim) {
    let d = dim;
    if (!d) d = _dimension();
    if (!d) return _AIR_BLOCK;
    try {
        const b = d.getBlock({ x: x, y: y, z: z });
        let did = null;
        try { did = b.getDescriptionId(); } catch (e) { }
        let ns = _blockNamespace(b, did);
        let itemId = 0, itemIdOk = false;
        
        try { itemId = b.getItemId(); itemIdOk = true; } catch (e) { }
        
        if (ns && ns.indexOf(":") >= 0) {
            if (_blockIsAirName(ns)) ns = "minecraft:air";
        } else if (itemIdOk && itemId === 0) {
            ns = "minecraft:air";
        }
        
        if (ns === "minecraft:air") return _AIR_BLOCK;
        let aux = 0, rid = 0, solid = false, dname = "";
        try { aux = b.getData(); } catch (e) { }
        try { rid = b.getRuntimeId(); } catch (e) { }
        try { solid = b.isSolid(); } catch (e) { }
        try { dname = b.getDescriptionName(); } catch (e) { }
        return {
            id: itemId,
            namespace: ns,
            aux: aux,
            solid: solid,
            runtimeId: rid,
            descriptionId: did || "",
            descriptionName: dname
        };
    } catch (e) {
        return _AIR_BLOCK;
    }
}

function setBlock(x, y, z, name, state) {
    const d = _dimension();
    if (!d) return false;
    try {
        let blk = null;
        try { blk = new _block.Block(name, state || 0); }
        catch (e) { blk = new _block(name, state || 0); }
        return !!d.setBlock({ x: x, y: y, z: z }, blk);
    } catch (e) { return false; }
}

function _idStr(v) {
    try { return (v === undefined || v === null) ? "" : String(v); } catch (e) { return ""; }
}

var _ACTOR_IDX_ON = 1;      
var _nxTickNo = 0;          
var _nxIdx = null;
var _nxIdxStamp = -2;
var _nxIdxUses = 0;
var _NX_IDX_MAX_USES = 400; 

function _nxTickMark() { _nxTickNo++; }

function _nxStamp() { return _ACTOR_IDX_ON ? _nxTickNo : -1; }

function _nxIdxBuild(stamp) {
    const idx = {
        stamp: stamp,
        byId: {},        
        miss: {},        
        byNameP: {},     
        byNameA: null,   
        actors: [],      
        listA: [],       
        listB: [],       
        listBRid: [],    
        listC: [],       
        listCRid: [],
        world: []        
    };
    const w = _level();
    if (!w) return idx;
    let ps = [], as = [];
    try { ps = w.getPlayers() || []; } catch (e) { ps = []; }
    try { as = w.getActors() || []; } catch (e) { as = []; }
    
    for (let i = 0; i < ps.length; i++) {
        const a = ps[i];
        let uid = "", rid = "", nm = "";
        try { uid = _idStr(a.getUniqueID()); } catch (e) { }
        try { rid = _idStr(a.getRuntimeID()); } catch (e) { }
        try { nm = String(a.getName()); } catch (e) { }
        if (uid) { if (idx.byId[uid] === undefined) idx.byId[uid] = a; idx.listB.push(uid); }
        if (rid && idx.byId[rid] === undefined) idx.byId[rid] = a;
        idx.listBRid.push(rid);
        if (nm && idx.byNameP[nm] === undefined) idx.byNameP[nm] = a;
    }
    
    for (let i = 0; i < as.length; i++) {
        const a = as[i];
        let uid = "", rid = "";
        try { uid = _idStr(a.getUniqueID()); } catch (e) { }
        try { rid = _idStr(a.getRuntimeID()); } catch (e) { }
        if (uid) { if (idx.byId[uid] === undefined) idx.byId[uid] = a; idx.actors.push(uid); }
        if (rid && idx.byId[rid] === undefined) idx.byId[rid] = a;
        try {
            if (a.getTypeId() === 319) { if (uid) idx.listC.push(uid); idx.listCRid.push(rid); }
        } catch (e) { }
    }
    
    try {
        const list = w.getPlayerList() || {};
        for (const k in list) {
            const p = list[k];
            if (!p || !p.id) continue;
            const sid = _idStr(p.id);
            idx.listA.push(sid);
            idx.world.push({ id: sid, name: p.name || sid, runtimeId: p.runtimeId });
            if (!sid || idx.byId[sid] !== undefined) continue;
            let a = idx.byNameP[String(p.name)];
            if (!a && p.runtimeId !== undefined) a = idx.byId[_idStr(p.runtimeId)];
            if (!a) a = _nxNameInActors(w, p.name, idx);
            if (a) idx.byId[sid] = a;
        }
    } catch (e) { }
    if (!idx.listA.length) {
        for (let i = 0; i < ps.length; i++) {
            try {
                idx.world.push({
                    id: _idStr(ps[i].getUniqueID()), name: ps[i].getName(),
                    runtimeId: ps[i].getRuntimeID()
                });
            } catch (e) { }
        }
    }
    return idx;
}

function _nxNameInActors(w, name, idx) {
    if (!name) return null;
    if (!idx.byNameA) {
        const m = {};
        try {
            const as = w.getActors() || [];
            for (let i = 0; i < as.length; i++) {
                let nm = "";
                try { nm = String(as[i].getName()); } catch (e) { }
                if (nm && m[nm] === undefined) m[nm] = as[i];
            }
        } catch (e) { }
        idx.byNameA = m;
    }
    return idx.byNameA[String(name)] || null;
}

function _nxIdxGet() {
    const s = _nxStamp();
    if (s < 0) return null;
    if (_nxIdxUsable()) { _nxIdxUses++; return _nxIdx; }
    _nxIdxStamp = s;
    _nxIdxUses = 1;
    _nxIdx = _nxIdxBuild(s);
    return _nxIdx;
}

function _nxIdxUsable() {
    if (!_nxIdx) return false;
    if (_nxIdxUses >= _NX_IDX_MAX_USES) return false;
    return _nxIdxStamp === _nxStamp();
}

function _nxIdxPeek() {
    if (_nxStamp() < 0 || !_nxIdxUsable()) return null;
    _nxIdxUses++;
    return _nxIdx;
}

function getEntityList() {
    const idx = _nxIdxPeek();
    if (idx) return idx.actors.slice();
    const w = _level();
    if (!w) return [];
    try { return w.getActors().map(function (a) { return _idStr(a.getUniqueID()); }); }
    catch (e) { return []; }
}

function getPlayerList(type) {
    const idx = _nxIdxPeek();
    if (idx) {
        if (type === "RuntimeId") {
            if (idx.listBRid.length) return idx.listBRid.slice();
            if (idx.listCRid.length) return idx.listCRid.slice();
            return [];
        }
        if (idx.listA.length) return idx.listA.slice();
        if (idx.listB.length) return idx.listB.slice();
        if (idx.listC.length) return idx.listC.slice();
        return [];
    }
    const w = _level();
    if (!w) return [];
    
    if (type !== "RuntimeId") {
        try {
            const list = w.getPlayerList() || {};
            const out = [];
            for (const k in list) {
                const p = list[k];
                if (p && p.id) out.push(_idStr(p.id));
            }
            if (out.length) return out;
        } catch (e) { }
    }
    
    try {
        const r = w.getPlayers().map(function (p) {
            return type === "RuntimeId" ? p.getRuntimeID() : _idStr(p.getUniqueID());
        });
        if (r.length) return r;
    } catch (e) { }
    
    try {
        const out = [];
        const actors = w.getActors() || [];
        for (let i = 0; i < actors.length; i++) {
            try {
                if (actors[i].getTypeId() === 319) {
                    out.push(type === "RuntimeId" ? actors[i].getRuntimeID() : _idStr(actors[i].getUniqueID()));
                }
            } catch (e) { }
        }
        if (out.length) return out;
    } catch (e) { }
    return [];
}

function getWorldPlayerList() {
    const idx = _nxIdxPeek();
    if (idx) {
        return idx.world.map(function (p) {
            return { id: p.id, name: p.name, runtimeId: p.runtimeId };
        });
    }
    const w = _level();
    if (!w) return [];
    try {
        const list = w.getPlayerList() || {};
        const out = [];
        for (const k in list) {
            const p = list[k];
            if (p && p.id) out.push({ id: _idStr(p.id), name: p.name || _idStr(p.id), runtimeId: p.runtimeId });
        }
        if (out.length) return out;
    } catch (e) { }
    try {
        return w.getPlayers().map(function (p) {
            return { id: _idStr(p.getUniqueID()), name: p.getName(), runtimeId: p.getRuntimeID() };
        });
    } catch (e) { return []; }
}

function getEntityPos(id) {
    const a = _localOrActor(id);
    if (!a) return { x: 0, y: 0, z: 0 };
    try { return a.getPos(); } catch (e) { return { x: 0, y: 0, z: 0 }; }
}

function getEntityPosPrev(id) {
    const a = _localOrActor(id);
    if (!a) return { x: 0, y: 0, z: 0 };
    try { return a.getPosPrev(); } catch (e) { return { x: 0, y: 0, z: 0 }; }
}

function getEntityName(id) {
    const a = _actor(id);
    if (!a) return "";
    try { return a.getName(); } catch (e) { return ""; }
}

function getEntityNamespace(id) {
    const a = _actor(id);
    if (!a) return "";
    try {
        const i = a.getIdentifier();
        if (!i) return "";
        if (typeof i === "string") return i.replace(/<[^>]*>/g, "");
        
        if (typeof i.canonicalName === "string" && i.canonicalName.indexOf(":") >= 0) {
            return i.canonicalName.replace(/<[^>]*>/g, "");
        }
        if (typeof i.namespace === "string" && typeof i.identifier === "string" && i.identifier) {
            return i.namespace + ":" + i.identifier;
        }
        const cands = [i.fullName, i.identifier, i.namespace];
        for (let n = 0; n < cands.length; n++) {
            if (typeof cands[n] === "string" && cands[n].indexOf(":") >= 0) {
                return cands[n].replace(/<[^>]*>/g, "");
            }
        }
        return "";
    } catch (e) { return ""; }
}

function getEntityTypeId(id) {
    const a = _actor(id);
    if (!a) return 0;
    try { return a.getTypeId(); } catch (e) { return 0; }
}

function getEntitySize(id) {
    const a = _actor(id);
    if (!a) return { x: 0, y: 0 };
    try { return a.getSize(); } catch (e) { return { x: 0, y: 0 }; }
}

function getEntityRot(id) {
    const a = _localOrActor(id);
    if (!a) return { pitch: 0, yaw: 0 };
    try { return a.getRotation(); } catch (e) { return { pitch: 0, yaw: 0 }; }
}

function getEntityRotPrev(id) {
    const a = _localOrActor(id);
    if (!a) return { pitch: 0, yaw: 0 };
    try { return a.getRotationPrev(); } catch (e) { return { pitch: 0, yaw: 0 }; }
}

function getEntityBodyRot(id) {
    const a = _localOrActor(id);
    if (!a) return 0;
    try { return a.getYBodyRotation(); } catch (e) { return 0; }
}

function getEntityBodyRotPrev(id) {
    const a = _localOrActor(id);
    if (!a) return 0;
    try { return a.getYBodyRotationPrev(); } catch (e) { return 0; }
}

function getEntityMotion(id) {
    const a = _localOrActor(id);
    if (!a) return { x: 0, y: 0, z: 0 };
    try { return a.getMotion(); } catch (e) { return { x: 0, y: 0, z: 0 }; }
}

function getEntityIsGround(id) {
    const a = _localOrActor(id);
    if (!a) return false;
    try { return a.isOnGround(); } catch (e) { return false; }
}

function getEntityFlag(id, flag) {
    const a = _localOrActor(id);
    if (!a) return false;
    try { return a.getStatusFlag(flag); } catch (e) { return false; }
}

function getEntityAttribute(id, name) {
    const a = _actor(id);
    if (!a) return { current: 0, max: 0, min: 0 };
    try { return a.getAttribute(name) || { current: 0, max: 0, min: 0 }; }
    catch (e) { return { current: 0, max: 0, min: 0 }; }
}

var _ITEM_V1_RE = /,\s*Name:"[^"]*"\s*,\s*WasPickedUp\s*:/;

/* 慢路径每件物品要跨 JNI 取 8 个字段，而背包扫描一 tick 就是 36 次 × 若干轮 ——
   以原文本为键缓存（NBT 文本变了说明物品本身变了，缓存自然失效）。 */
var _itemNbtCache = {};
var _itemNbtCacheN = 0;

function _itemPick(re, s) {
    if (typeof s !== "string" || !s.length) return null;
    try {
        const m = re.exec(s);
        if (!m) return null;
        /* 无捕获组时退回整个匹配（附魔段就是要整段搬） */
        const v = (m[1] !== undefined) ? m[1] : m[0];
        return (v === undefined || v === null || v === "") ? null : v;
    } catch (e) { return null; }
}

/* 命名空间回退链：Name -> id -> Block.name -> 方块对象 -> getName()。
   统一要求带命名空间（含 ":"），免得把 display 里的自定义中文名当成方块名。 */
function _itemNamespace(raw, item) {
    let ns = _itemPick(/,\s*Name:"([^"]*:[^"]*)"/, raw);
    if (!ns) ns = _itemPick(/(?:^|[,{])\s*id:"([^"]*:[^"]*)"/, raw);
    if (!ns) ns = _itemPick(/Block:\{\s*name:"([^"]*:[^"]*)"/, raw);
    if (!ns) {
        try {
            if (typeof item.isBlock === "function" && item.isBlock()) {
                const b = item.getBlock();
                if (b) {
                    try { ns = b.getDescriptionId() || ""; } catch (e) { }
                    if (!ns || ns.indexOf(":") < 0) {
                        try { ns = b.getNamespace() || ""; } catch (e) { }
                    }
                }
            }
        } catch (e) { }
    }
    if (!ns) {
        /* 实测（NXFuncDiag）：v2 的 getName() 返回的是**本地化显示名**
           （"喷溅型治疗药水" / "发射器"），不是命名空间 —— 只有当它确实带 "：" 时才采信 */
        try { ns = item.getName() || ""; } catch (e) { }
    }
    if (!ns || String(ns).indexOf(":") < 0) return "";
    ns = String(ns).toLowerCase();
    return ns;
}

function _itemNum(fn, item, dflt) {
    try {
        const v = fn(item);
        const n = Number(v);
        return isFinite(n) ? n : dflt;
    } catch (e) { return dflt; }
}

function _itemToV1Nbt(item) {
    if (item === null || item === undefined) return "";
    if (typeof item === "string") return item;
    try {
        if (typeof item.isNull === "function" && item.isNull()) return "";
    } catch (e) { }
    let raw = "";
    try {
        if (typeof item.getNBT === "function") {
            const s = item.getNBT();
            if (typeof s === "string" && s.length) raw = s;
        }
    } catch (e) { }
    if (!raw) {
        try {
            if (typeof item.toString === "function" && item.toString !== Object.prototype.toString) {
                const s = item.toString();
                if (typeof s === "string" && s.length && s.charCodeAt(0) === 123) raw = s;
            }
        } catch (e) { }
    }

    /* 快路径：原文本已经就是 v1 那套格式，直接用。
       判定要足够严：只要缺 ExtraData / attackDamage（脚本拿它算武器伤害、
       穿装判定）就不算 v1 完整文本，否则会拿一份「半个 v1」去响应解析器。 */
    if (raw && raw.charCodeAt(0) === 123 && raw.indexOf("b,D") > 0
        && raw.indexOf("ExtraData:{") > 0 && raw.indexOf("attackDamage:") > 0
        && _ITEM_V1_RE.test(raw)) {
        return raw;
    }

    /* 慢路径：用 getter 重新拼一份 v1 文本 */
    if (raw) {
        const hit = _itemNbtCache[raw];
        if (hit !== undefined) return hit;
    }
    const ns = _itemNamespace(raw, item);
    if (!ns) return raw || "";

    const cnt = _itemNum(function (o) { return o.getCount(); }, item, 1);
    const aux = _itemNum(function (o) { return o.getAux(); }, item, 0);
    const dmg = _itemNum(function (o) { return o.getDamage(); }, item, 0);
    const md = _itemNum(function (o) { return o.getMaxDamage(); }, item, 0);
    const ad = _itemNum(function (o) { return o.getAttackDamage(); }, item, 0);
    const nid = _itemNum(function (o) { return o.getNetId(); }, item, 0);
    let blk = false;
    try { blk = !!item.isBlock(); } catch (e) { }

    /* 附魔 / 自定义色 / 自定义名：v2 没有直接对应的 getter，原样从原文本里搬。
       ExtraData.name 在 v1 里是「不带命名空间的短名」（脚本拿它做物品白名单匹配
       与显示，例如 hs_item 里填的 "stone"），取不到就用命名空间的短名顶上。 */
    const ench = _itemPick(/ench:\s*\[[^\]]*\]/, raw);
    const color = _itemPick(/customColor:\s*([^,}]+)/, raw);
    const cname = _itemPick(/,\s*name:"([^"]+)"/, raw) || ns.replace("minecraft:", "");

    let s = (blk ? "{Block:1b," : "{")
        + "Count:" + cnt + "b,Damage:" + dmg + "s"
        + ",ExtraData:{attackDamage:" + ad + ",aux:" + aux + ",maxDamage:" + md
        + ",maxStackSize:255b,maxUseDuration:0,name:\"" + (cname || "") + "\",netId:" + nid + "}"
        + ",Name:\"" + ns + "\",WasPickedUp:0b";
    if (ench) s += "," + ench;
    if (color) s += ",customColor:" + color;
    s += "}";
    if (raw) {
        if (_itemNbtCacheN > 512) { _itemNbtCache = {}; _itemNbtCacheN = 0; }
        _itemNbtCache[raw] = s;
        _itemNbtCacheN++;
    }
    return s;
}

function getEntityCarriedItem(id) {
    const a = _localOrActor(id);
    if (!a) return "";
    try { return _itemToV1Nbt(a.getCarriedItem()); } catch (e) { return ""; }
}

function getEntityOffhandItem(id) {
    const a = _localOrActor(id);
    if (!a) return "";
    try { return _itemToV1Nbt(a.getOffhandItem()); } catch (e) { return ""; }
}

function isPlayer(id) {
    const w = _level();
    if (!w) return false;
    try { return !!w.getPlayer(id); } catch (e) { }
    try { return !!w.getRuntimePlayer(id); } catch (e) { }
    return false;
}

function removeEntity(id) {
    const a = _actor(id);
    if (!a) return false;
    try { a.remove(); return true; } catch (e) { return false; }
}

function setEntityPos(id, x, y, z) {
    const a = _localOrActor(id);
    if (!a) return false;
    try { a.setPos({ x: x, y: y, z: z }); return true; } catch (e) { return false; }
}

function setEntityMotion(id, x, y, z) {
    const a = _localOrActor(id);
    if (!a) return false;
    try { a.setMotion({ x: x, y: y, z: z }); return true; } catch (e) { return false; }
}

function setEntityRot(id, pitch, yaw) {
    const a = _localOrActor(id);
    if (!a) return false;
    try { a.setRotation({ pitch: pitch, yaw: yaw }); return true; } catch (e) { return false; }
}

function setEntityRotPrev(id, pitch, yaw) {
    const a = _localOrActor(id);
    if (!a) return false;
    try { a.setRotationPrev({ pitch: pitch, yaw: yaw }); return true; } catch (e) { return false; }
}

function setEntityBodyRot(id, yaw) {
    const a = _localOrActor(id);
    if (!a) return false;
    try { a.setYBodyRotation(yaw); return true; } catch (e) { return false; }
}

function setEntityBodyRotPrev(id, yaw) {
    const a = _localOrActor(id);
    if (!a) return false;
    try { a.setYBodyRotationPrev(yaw); return true; } catch (e) { return false; }
}

function _localOrActor(id) {
    try {
        const p = _localPlayer();
        if (p) {
            const pid = _nxLocalUid();
            if (pid !== undefined && pid !== null && String(pid) === String(id)) return p;
        }
    } catch (e) { }
    try {
        if (String(id) === String(self_id)) {
            const p = _localPlayer();
            if (p) return p;
        }
    } catch (e) { }
    return _actor(id);
}

var _nxLocalUidV = null;
var _nxLocalUidStamp = -2;
function _nxLocalUid() {
    const s = _nxStamp();
    if (s >= 0 && _nxLocalUidStamp === s) return _nxLocalUidV;
    let v = null;
    try { const p = _localPlayer(); if (p) v = p.getUniqueID(); } catch (e) { v = null; }
    _nxLocalUidV = v;
    _nxLocalUidStamp = s;
    return v;
}

function setEntityHeadRot(id, yaw) {
    const a = _localOrActor(id);
    if (!a) return false;
    try { a.setYHeadRotation(yaw); return true; } catch (e) { return false; }
}

function setEntityHeadRotPrev(id, yaw) {
    const a = _localOrActor(id);
    if (!a) return false;
    try { a.setYHeadRotationPrev(yaw); return true; } catch (e) { return false; }
}

function getEntityHeadRot(id) {
    const a = _localOrActor(id);
    if (!a) return 0;
    try { return a.getYHeadRotation(); } catch (e) { return 0; }
}

function getEntityHeadRotPrev(id) {
    const a = _localOrActor(id);
    if (!a) return 0;
    try { return a.getYHeadRotationPrev(); } catch (e) { return 0; }
}

function TU_IsStill() {
    try {
        const m = self_motion;
        if (!m) return true;
        return (Math.abs(Number(m.x) || 0) + Math.abs(Number(m.z) || 0)) <= 0.02;
    } catch (e) { return true; }
}

function TU_AllowFullRot(data, forceFull) {
    let moving = true;
    try {
        if (!data || typeof data.byteLength !== "number" || data.byteLength < 32) {
            moving = true;                     
        } else {
            const view = (data instanceof ArrayBuffer)
                ? new DataView(data)
                : new DataView(data.buffer, data.byteOffset || 0, data.byteLength);
            const vx = view.getFloat32(20, true);
            const vz = view.getFloat32(24, true);
            moving = !isFinite(vx) || !isFinite(vz) || (Math.abs(vx) + Math.abs(vz)) > 1e-4;
        }
    } catch (e) { moving = true; }
    TU_DiagRot(moving);
    if (moving) {
        
        const attacking = TU_AttackFullRot
            && (Number(globalThis.TU_AttackTickNo) || -99) >= (Number(globalThis.TU_TickNo) || 0) - 1;
        return TU_FullRotInMove || attacking || (!!forceFull && TU_ThrowFullOnMove);
    }
    return TU_IsStill();                       
}

function TU_CoverMovePlayerRot(data, rotData) {
    try {
        const u8 = (data instanceof Uint8Array) ? data
            : (data instanceof ArrayBuffer) ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength);
        if (u8.length < 32) return data;
        let k = 0;
        let rid = 0n;
        let shift = 0n;
        while (k < u8.length) {
            const b = u8[k++];
            rid |= BigInt(b & 0x7f) << shift;
            shift += 7n;
            if ((b & 0x80) === 0) break;
        }
        const lid = String(LocalRuntimeId || "");
        if (lid !== "" && String(rid) !== lid) return data;      
        const rotOff = k + 12;
        if (rotOff + 11 >= u8.length) return data;
        const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        
        if (TU_CoverMode === 0) view.setFloat32(rotOff + 8, rotData.yaw, true);
        
        
        const full = rotData.forceFull ? TU_ThrowFullOnMove : (TU_FullRotInMove && TU_Cover19Yaw);
        if (full) {
            view.setFloat32(rotOff, rotData.pitch, true);
            view.setFloat32(rotOff + 4, rotData.yaw, true);
        }
        
        if (TU_MoveProbe) TU_ProbeAfter19(view, rotOff, full);
        return data;
    } catch (e) { return data; }
}

const TU_FullRotInMove = false;

const TU_SwingMaxDeg = 30;

function TU_WrapDeg(d) {
    let x = Number(d) || 0;
    x = x % 360;
    if (x > 180) x -= 360;
    if (x <= -180) x += 360;
    return x;
}

const TU_Cover19Yaw = false;

const TU_CoverMode = 0;

const TU_HeadRotRenderOnly = false;

const TU_LocalRotOff = true;

const TU_LocalRotInMove = false;

const TU_AttackFullRot = false;

const TU_ThrowFullOnMove = true;

const TU_DIAG_ROT = false;

function TU_DiagRot(moving) {
    if (!TU_DIAG_ROT) return;
    try {
        globalThis.TU_DIAG_N = (globalThis.TU_DIAG_N || 0) + 1;
        if (moving) globalThis.TU_DIAG_M = (globalThis.TU_DIAG_M || 0) + 1;
        if (moving && TU_IsStill()) globalThis.TU_DIAG_BAD = (globalThis.TU_DIAG_BAD || 0) + 1;
        if (globalThis.TU_DIAG_N % 40 === 0) {
            _minecraft.clientMessage("§e[TU]包=" + globalThis.TU_DIAG_N + " 有移动输入=" + (globalThis.TU_DIAG_M || 0) + " 速度判误判=" + (globalThis.TU_DIAG_BAD || 0));
        }
    } catch (e) { }
}

const TU_FixMoveComp = true;

function TU_FixMove(view, dyawDeg) {
    try {
        const v20 = Number(view.getFloat32(20, true));
        const v24 = Number(view.getFloat32(24, true));
        if (!isFinite(v20) || !isFinite(v24)) return;
        if ((Math.abs(v20) + Math.abs(v24)) < 1e-4) return;      
        const d = Number(dyawDeg);
        if (!isFinite(d) || Math.abs(d) < 1e-6) return;          
        const r = d * Math.PI / 180;
        const c = Math.cos(r), sn = Math.sin(r);
        view.setFloat32(20, v20 * c + v24 * sn, true);
        view.setFloat32(24, v24 * c - v20 * sn, true);
    } catch (e) { }
}

const TU_MoveProbe = true;

function TU_ProbeWrite(line) {
    const p = _app.getResource() + "/TimeUnity/MoveProbe.txt";
    try {
        if (!globalThis.TU_ProbeInit) {                  
            globalThis.TU_ProbeInit = true;
            _fs.write(p, "TimeUnity 移动输入探针（BEFORE=覆盖前 / AFTER=覆盖后）\n");
        }
        _fs.write(p, (_fs.exists(p) ? _fs.read(p) : "") + line);
    } catch (e) {
        try { _minecraft.clientMessage("§e[TU探针] " + line.replace(/\n/g, " ")); } catch (e2) { }
    }
}

function TU_ProbeAfter(view, tag) {
    if (!TU_MoveProbe) return;
    try {
        const v20 = Number(view.getFloat32(20, true));
        const v24 = Number(view.getFloat32(24, true));
        const mag = Math.sqrt(v20 * v20 + v24 * v24);
        if (!isFinite(mag) || mag < 0.05) return;        
        const tick = Number(globalThis.TU_TickNo) || 0;
        if (tick === Number(globalThis.TU_ProbeAfterTick)) return;
        globalThis.TU_ProbeAfterTick = tick;
        let er = null;
        try { er = getEntityRot(self_id); } catch (e) { }
        const mvx = Number(self_motion && self_motion.x) || 0;
        const mvz = Number(self_motion && self_motion.z) || 0;
        TU_ProbeWrite("AFTER t=" + tick + " " + tag
            + " p0=" + Number(view.getFloat32(0, true)).toFixed(1)
            + " y4=" + Number(view.getFloat32(4, true)).toFixed(1)
            + " h28=" + Number(view.getFloat32(28, true)).toFixed(1)
            + " v20=" + v20.toFixed(3) + " v24=" + v24.toFixed(3)
            + " 实体=" + (er && isFinite(er.yaw) ? Number(er.yaw).toFixed(1) : "?")
            + " 世界=" + mvx.toFixed(2) + "," + mvz.toFixed(2) + "\n");
    } catch (e) { }
}

function TU_ProbeAfter19(view, rotOff, full) {
    if (!TU_MoveProbe) return;
    try {
        const tick = Number(globalThis.TU_TickNo) || 0;
        if (tick - (Number(globalThis.TU_Probe19Tick) || -999) < 5) return;
        globalThis.TU_Probe19Tick = tick;
        const mvx = Number(self_motion && self_motion.x) || 0;
        const mvz = Number(self_motion && self_motion.z) || 0;
        TU_ProbeWrite("AFTER19 t=" + tick
            + " p=" + Number(view.getFloat32(rotOff, true)).toFixed(1)
            + " y=" + Number(view.getFloat32(rotOff + 4, true)).toFixed(1)
            + " h=" + Number(view.getFloat32(rotOff + 8, true)).toFixed(1)
            + " 身体覆盖=" + (full ? "是" : "否")
            + " 世界=" + mvx.toFixed(2) + "," + mvz.toFixed(2) + "\n");
    } catch (e) { }
}

function TU_ProbeMove(data) {
    try {
        if (!data || typeof data.byteLength !== "number" || data.byteLength < 32) return;
        const view = (data instanceof ArrayBuffer)
            ? new DataView(data)
            : new DataView(data.buffer, data.byteOffset || 0, data.byteLength);
        const vx = Number(view.getFloat32(20, true));
        const vz = Number(view.getFloat32(24, true));
        const mag = Math.sqrt(vx * vx + vz * vz);
        if (!isFinite(mag) || mag < 0.05) return;          
        const tick = Number(globalThis.TU_TickNo) || 0;
        const yawReal = Number(view.getFloat32(4, true));
        if (!isFinite(yawReal)) return;
        const ang = Math.atan2(vx, vz) * 180 / Math.PI;
        
        const lastA = globalThis.TU_ProbeA;
        let need = (lastA === undefined);
        if (!need) {
            let da = Math.abs(ang - lastA); if (da > 180) da = 360 - da;
            need = (da >= 30);
        }
        if (!need && (tick - (Number(globalThis.TU_ProbeTick) || -999)) < 5) return;
        globalThis.TU_ProbeTick = tick;
        globalThis.TU_ProbeA = ang;
        let line = "";
        const prevY = globalThis.TU_ProbeLastY;
        if (prevY === undefined) {
            line += "== 起始视角 yaw=" + yawReal.toFixed(1) + " ==\n";
        } else {
            let dY = Math.abs(yawReal - prevY); if (dY > 180) dY = 360 - dY;
            if (dY > 5) line += "== 视角转为 yaw=" + yawReal.toFixed(1) + " ==\n";
        }
        globalThis.TU_ProbeLastY = yawReal;
        const mvx = Number(self_motion && self_motion.x) || 0;
        const mvz = Number(self_motion && self_motion.z) || 0;
        
        let er = null;
        try { er = getEntityRot(self_id); } catch (e) { }
        TU_ProbeWrite(line
            + "t=" + tick + " yaw=" + yawReal.toFixed(1)
            + " pitch=" + Number(view.getFloat32(0, true)).toFixed(1)
            + " 实体=" + (er && isFinite(er.yaw) ? Number(er.yaw).toFixed(1) : "?")
            + " v20=" + vx.toFixed(3) + " v24=" + vz.toFixed(3)
            + " |v|=" + mag.toFixed(3) + " atan2(v20,v24)=" + ang.toFixed(1)
            + " 世界=" + mvx.toFixed(2) + "," + mvz.toFixed(2) + "\n");
    } catch (e) { }
}

function TU_DepartCamera() {
    if (globalThis.TU_CamDeparted) return true;
    try { _camera.departCamera(); globalThis.TU_CamDeparted = true; return true; } catch (e) { return false; }
}

function TU_ResetCamera() {
    if (!globalThis.TU_CamDeparted) return false;
    try { _camera.resetCamera(); } catch (e) { }
    globalThis.TU_CamDeparted = false;
    return true;
}

try { _camera.resetCamera(); } catch (e) { }

function setLocalPlayerTurn(pitch, yaw) {
    try {
        const p = _localPlayer();
        if (!p) return false;
        if (typeof p.setTurn === "function") {
            p.setTurn({ pitch: pitch, yaw: yaw });
            return true;
        }
    } catch (e) { }
    return false;
}

function setEntityFlag(id, flag, value) {
    const a = _localOrActor(id);
    if (!a) return false;
    try { a.setStatusFlag(flag, value); return true; } catch (e) { return false; }
}

function setEntityAttribute(id, name, value) {
    const a = _localOrActor(id);
    if (!a) return false;
    try { a.setAttribute(name, value); return true; } catch (e) { return false; }
}

function setEntitySize(id, size) {
    const a = _localOrActor(id);
    if (!a) return false;
    try { a.setSize(size); return true; } catch (e) { return false; }
}

function setEntityEffect(id, effect) {
    const a = _localOrActor(id);
    if (!a) return false;
    try { a.addEffect(effect); return true; } catch (e) { return false; }
}

function removeEntityEffect(id, effectId) {
    const a = _actor(id);
    if (!a) return false;
    try { return !!a.removeEffect(effectId); } catch (e) { return false; }
}

function getLocalPlayerUniqueID() {
    const p = _localPlayer();
    try { return p ? _idStr(p.getUniqueID()) : ""; } catch (e) { return ""; }
}

function getLocalPlayerRuntimeID() {
    const p = _localPlayer();
    try { return p ? p.getRuntimeID() : ""; } catch (e) { return ""; }
}

function getPlayerInventoryItem(id, slot) {
    const p = _localPlayer();
    try { return p ? _itemToV1Nbt(p.getInventoryItem(slot)) : ""; } catch (e) { return ""; }
}

function getPlayerInventorySize(id) {
    const p = _localPlayer();
    try { return p ? p.getInventorySize() : 0; } catch (e) { return 0; }
}

function getPlayerSelectItemSlot(id) {
    const p = _localPlayer();
    try { return p ? p.getSelectItemSlot() : 0; } catch (e) { return 0; }
}

function getPlayerHotBarSize(id) {
    const p = _localPlayer();
    try { return p ? p.getHotBarSize() : 0; } catch (e) { return 0; }
}

function getPlayerArmorItem(id, slot) {
    const p = _localPlayer();
    try { return p ? _itemToV1Nbt(p.getArmorItem(slot)) : ""; } catch (e) { return ""; }
}

function getPlayerBlockDestroyTime(id, slot, blockName) {
    const p = _localPlayer();
    try { return p ? p.getBlockDestroyTime(slot, blockName) : 0; } catch (e) { return 0; }
}

function getPlayerAbilities(id) {
    const p = _localPlayer();
    try { return p ? p.getAbilities() : null; } catch (e) { return null; }
}

function setPlayerAbilities(id, abilities) {
    const p = _localPlayer();
    try { if (p) p.setAbilities(abilities); } catch (e) { }
}

function selectPlayerInventorySlot(id, slot) {
    const p = _localPlayer();
    if (!p) return false;
    try {
        p.setSelectItemSlot(slot);
        return Number(p.getSelectItemSlot()) === Number(slot);
    } catch (e) { return false; }
}

function dropPlayerInventorySlot(id, slot) {
    const p = _localPlayer();
    try { return p ? p.dropInventorySlot(slot) : false; } catch (e) { return false; }
}

function deleteContainer() {
    const p = _localPlayer();
    try { if (p) p.deleteContainerManager(); } catch (e) { }
}

function openInventory() {
    const p = _localPlayer();
    try { if (p) p.openInventory(); } catch (e) { }
}

function closeInventory() {
    const p = _localPlayer();
    try { if (p) p.closeInventory(); } catch (e) { }
}

function moveInventoryItem(fromSlot, toSlot) {
    const p = _localPlayer();
    try { if (p) p.moveInventoryItem(fromSlot, toSlot); } catch (e) { }
}

function moveContainerItem(items) {
    const p = _localPlayer();
    try { if (p) p.moveContainerItem(items); } catch (e) { }
}

function swapContainerItem(items) {
    const p = _localPlayer();
    try { if (p) p.swapContainerItem(items); } catch (e) { }
}

function attackEntity(id, action) {
    const p = _localPlayer();
    if (!p) return false;
    const t = _actor(id);
    if (!t) return false;
    try {
        p.attack(t);
        if (action) { try { p.swing(); } catch (e) { } }
        return true;
    } catch (e) { return false; }
}

function interactEntity(id) {
    const p = _localPlayer();
    if (!p) return false;
    const t = _actor(id);
    if (!t) return false;
    try { return p.interact(t); } catch (e) { return false; }
}

function _findPlaceSupport(x, y, z) {
    const offs = [[0, -1, 0, 1], [-1, 0, 0, 5], [1, 0, 0, 4], [0, 0, -1, 3], [0, 0, 1, 2], [0, 1, 0, 0]];
    for (let i = 0; i < offs.length; i++) {
        const o = offs[i];
        const nx = x + o[0], ny = y + o[1], nz = z + o[2];
        const nb = getBlock(nx, ny, nz);
        if (nb && nb.namespace && nb.namespace !== "minecraft:air" &&
            nb.namespace !== "minecraft:water" && nb.namespace !== "minecraft:flowing_water" && nb.id !== 0) {
            return { x: nx, y: ny, z: nz, face: o[3] };
        }
    }
    return null;
}

var _placeDiagLines = [];
var _PLACE_DIAG_MAX = 400;

function _placeDiagCtx() {
    let out = "";
    try {
        const p = _localPlayer();
        if (!p) { out = "玩家=<取不到>"; }
        else {
            const pos = p.getPos(), rot = p.getRotation();
            out = "玩家=(" + (Math.round(pos.x * 100) / 100) + "," + (Math.round(pos.y * 100) / 100)
                + "," + (Math.round(pos.z * 100) / 100) + ")"
                + " 朝向yaw=" + (rot && rot.yaw !== undefined ? Math.round(rot.yaw * 100) / 100 : "?");
        }
    } catch (e) { out = "玩家=<异常>"; }
    
    try {
        const sc = (typeof sca_current !== "undefined") ? sca_current : "?";
        out += " | sca_current=" + sc
            + " floor(y)-1=" + (function () { try { return Math.floor(_localPlayer().getPos().y) - 1; } catch (e) { return "?"; } })();
        out += " | sca_len=" + (typeof sca_len !== "undefined" ? sca_len : "?")
            + " keep=" + (typeof sca_keep !== "undefined" ? sca_keep : "?")
            + " auto=" + (typeof sca_auto !== "undefined" ? sca_auto : "?")
            + " move=" + (typeof sca_move !== "undefined" ? sca_move : "?")
            + " tower=" + (typeof sca_tower !== "undefined" ? sca_tower : "?")
            + " surface=" + (typeof sca_surface !== "undefined" ? sca_surface : "?")
            + " fake=" + (typeof sca_fake !== "undefined" ? sca_fake : "?");
    } catch (e) { }
    return out;
}
function _placeDiag(s) {
    try {
        if (_placeDiagLines.length >= _PLACE_DIAG_MAX) return;
        _placeDiagLines.push(s);
        
        if (_placeDiagLines.length % 3 === 0 || _placeDiagLines.length >= _PLACE_DIAG_MAX) {
            _fs.write(_app.getResource() + "/NXPlaceDiag.txt", _placeDiagLines.join("\n"));
        }
    } catch (e) { }
}

function buildBlock(id, x, y, z, face) {
    const p = _localPlayer();
    if (!p) return false;
    const fx = Math.floor(Number(x)), fy = Math.floor(Number(y)), fz = Math.floor(Number(z));
    if (!isFinite(fx) || !isFinite(fy) || !isFinite(fz)) return false;
    const _diagHead = "[调] 目标格 " + fx + "," + fy + "," + fz + " face=" + face + " | " + _placeDiagCtx();
    if (Number(face) === 6) {
        
        try {
            const r = !!p.useItem();
            _placeDiag(_diagHead + " → useItem() => " + r);
            return r;
        } catch (e) { }
    }
    try {
        
        const here = getBlock(fx, fy, fz);
        if (here && here.id !== 0 && here.namespace &&
            here.namespace !== "minecraft:air" && here.namespace !== "minecraft:water" &&
            here.namespace !== "minecraft:lava") {
            const r = !!p.buildBlock({ x: fx, y: fy, z: fz }, Number(face) || 0);
            _placeDiag(_diagHead + " → 目标格已有 " + here.namespace + "，直接点击该块 => " + r);
            return r;
        }
        const sup = _findPlaceSupport(fx, fy, fz);
        if (!sup) {
            _placeDiag(_diagHead + " → 找不到支撑块，返回 false");
            return false;
        }
        const r = !!p.buildBlock({ x: sup.x, y: sup.y, z: sup.z }, sup.face);
        _placeDiag(_diagHead + " → 支撑块 " + sup.x + "," + sup.y + "," + sup.z + "" +
            " face=" + sup.face + " => " + r);
        return r;
    } catch (e) {
        _placeDiag(_diagHead + " → 抛异常: " + (e && e.message));
        return false;
    }
}

function swingArm() {
    const p = _localPlayer();
    try { if (p) p.swing(); } catch (e) { }
}

function playerJump() {
    const p = _localPlayer();
    try { if (p) p.jumpFromGround(); } catch (e) { }
}

function setCameraAnchor(x, y, z) {
    try { _camera.setAnchor({ x: x, y: y, z: z }); } catch (e) { }
}

function setCameraOffset(x, y, z) {
    try { _camera.setOffset({ x: x, y: y, z: z }); } catch (e) { }
}

function getWorldData() {
    const w = _level();
    if (!w) return {};
    try {
        return {
            difficulty: w.getDifficulty(),
            flatWorldLayers: w.getFlatWorldLayers(),
            forceGameType: w.getForceGameType(),
            gameType: w.getGameType(),
            levelName: w.getLevelName(),
            randomSeed: w.getRandomSeed(),
            time: w.getTime(),
            lightningLevel: w.getLightningLevel(),
            lightningTime: w.getLightningTime(),
            rainLevel: w.getRainLevel(),
            rainTime: w.getRainTime(),
            randomTickSpeed: w.getRandomTickSpeed()
        };
    } catch (e) { return {}; }
}

function setWorldData(data) {
    const w = _level();
    if (!w || !data) return false;
    try {
        if (typeof data.time === "number") w.setTime(BigInt(Math.floor(data.time)));
        if (typeof data.rainTime === "number") w.setRainTime(data.rainTime);
        if (typeof data.rainLevel === "number") w.setRainLevel(data.rainLevel);
        if (typeof data.difficulty === "number") w.setDifficulty(data.difficulty);
        if (typeof data.gameType === "number") w.setGameType(data.gameType);
        if (typeof data.forceGameType === "boolean") w.setForceGameType(data.forceGameType);
        if (typeof data.levelName === "string") w.setLevelName(data.levelName);
        if (typeof data.lightningLevel === "number") w.setLightningLevel(data.lightningLevel);
        if (typeof data.lightningTime === "number") w.setLightningTime(data.lightningTime);
        if (typeof data.randomTickSpeed === "number") w.setRandomTickSpeed(data.randomTickSpeed);
        if (typeof data.flatWorldLayers === "string") w.setFlatWorldLayers(data.flatWorldLayers);
        return true;
    } catch (e) { return false; }
}

function findStructure(x, y, z, name) {
    const w = _level();
    if (!w) return { state: false };
    try {
        const r = w.findStructure(name, { x: x, y: y, z: z });
        if (!r) return { state: false };
        return { state: true, x: r.x, y: r.y, z: r.z };
    } catch (e) { return { state: false }; }
}

function addParticle(type, start_x, start_y, start_z, offset_x, offset_y, offset_z, size, animation) {
    const w = _level();
    if (!w) return false;
    try {
        w.addParticle({
            type: type,
            pos: { x: start_x, y: start_y, z: start_z },
            dir: { x: offset_x - start_x, y: offset_y - start_y, z: offset_z - start_z },
            data: size,
            global: !!animation
        });
        return true;
    } catch (e) { return false; }
}

const _arrayListItems = {};
function addCustomArrayList(functionId, longName, shortName, enabled) {
    try {
        let item = _arrayListItems[functionId];
        if (!item) {
            item = new _gui.ArrayList({
                function: functionId,
                name: longName,
                shortName: shortName,
                enabled: !!enabled
            });
            _arrayListItems[functionId] = item;
        } else {
            item.name = longName;
            item.shortName = shortName;
            item.enabled = !!enabled;
        }
        return true;
    } catch (e) { return false; }
}

function removeCustomArrayList(functionId) {
    const item = _arrayListItems[functionId];
    if (!item) return false;
    try { item.remove(); } catch (e) { }
    delete _arrayListItems[functionId];
    return true;
}

const _textItems = {};
let _textIdSeq = 0;
function createText(content, alignment, x, y) {
    try {
        const t = new _gui.Text({
            content: content,
            alignment: alignment,
            position: { x: x, y: y },
            color: { r: 1, g: 1, b: 1, a: 1 },
            scale: 1
        });
        const id = _textIdSeq++;
        _textItems[id] = t;
        return id;
    } catch (e) { return -1; }
}

function updateTextContent(id, content) {
    const t = _textItems[id];
    if (!t) return;
    try { t.content = content; } catch (e) { }
}

function updateTextPosition(id, x, y) {
    const t = _textItems[id];
    if (!t) return;
    try { t.position = { x: x, y: y }; } catch (e) { }
}

function updateTextColor(id, r, g, b, a) {
    const t = _textItems[id];
    if (!t) return;
    try { t.color = { r: r, g: g, b: b, a: a }; } catch (e) { }
}

function updateTextScale(id, scale) {
    const t = _textItems[id];
    if (!t) return;
    try { t.scale = scale; } catch (e) { }
}

function removeText(id) {
    const t = _textItems[id];
    if (!t) return;
    try { t.remove(); } catch (e) { }
    delete _textItems[id];
}

const _shapeItems = {};
let _shapeIdSeq = 0;
function createShape(options) {
    try {
        const o = options || {};
        const s = new _Shape({
            visible: o.visible !== false,
            isFill: !!o.isFill,
            lower: o.lower,
            upper: o.upper,
            color: o.color
        });
        const id = _shapeIdSeq++;
        _shapeItems[id] = s;
        return id;
    } catch (e) { return -1; }
}

function updateShape(id, options) {
    const s = _shapeItems[id];
    if (!s || !options) return false;
    try {
        if (options.visible !== undefined) s.visible = options.visible;
        if (options.isFill !== undefined) s.isFill = options.isFill;
        if (options.lower) s.lower = options.lower;
        if (options.upper) s.upper = options.upper;
        if (options.color) s.color = options.color;
        return true;
    } catch (e) { return false; }
}

function removeShape(id) {
    const s = _shapeItems[id];
    if (!s) return false;
    try { s.remove(); } catch (e) { }
    delete _shapeItems[id];
    return true;
}

function getScreenSizeData() {
    try {
        const s = _gui.getSizeData();
        return {
            deviceWidth: s.totalScreenSizeWidth,
            deviceHeight: s.totalScreenSizeHeight,
            screenWidth: (s.clientUIScreenWidth !== undefined ? s.clientUIScreenWidth : s.clientScreenWidth),
            screenHeight: (s.clientUIScreenHeight !== undefined ? s.clientUIScreenHeight : s.clientScreenHeight)
        };
    } catch (e) {
        return { deviceWidth: 0, deviceHeight: 0, screenWidth: 0, screenHeight: 0 };
    }
}

class _CompatPacket {
    constructor() { this._p = new _packet.Packet(); }
    writeByte(v) { this._p.writeByte(v); return this; }
    writeUnsignedChar(v) { this._p.writeByte((isFinite(v) ? Math.round(v) : 0) & 0xFF); return this; }
    writeBool(v) { this._p.writeBool(v); return this; }
    writeUnsignedShort(v) { this._p.writeUnsignedShort(v); return this; }
    writeSignedShort(v) { this._p.writeSignedShort(v); return this; }
    writeUnsignedInt(v) { this._p.writeUnsignedInt(v); return this; }
    writeSignedInt(v) { this._p.writeSignedInt(v); return this; }
    writeUnsignedInt64(v) { this._p.writeUnsignedInt64(v); return this; }
    writeSignedInt64(v) { this._p.writeSignedInt64(v); return this; }
    writeVarInt(v) { this._p.writeVarInt(v); return this; }
    writeVarInt64(v) { this._p.writeVarInt64(v); return this; }
    writeFloat(v) { this._p.writeFloat(v); return this; }
    writeDouble(v) { this._p.writeDouble(v); return this; }
    writeString(v) { this._p.writeString(v); return this; }
    writeBytes(v) { this._p.buffer = _sanitizePacketBytes(v); return this; }
    send(id) { return this._p.sendToServer(id); }
    sendToLocal(id) { return this._p.sendToLocal(id); }
    destroy() {  }
}
const Packet = _CompatPacket;

function _sanitizePacketBytes(data) {
    if (!data || typeof data.length !== "number") return data;
    try {
        for (let i = 0; i < data.length; i++) {
            const v = Number(data[i]);
            if (!isFinite(v)) data[i] = 0;
            else if (v < 0 || v > 255) data[i] = Math.round(v) & 0xFF;
            else data[i] = Math.round(v);
        }
    } catch (e) { }
    return data;
}

function sendNetworkPacket(id, data) {
    try {
        const p = new _packet.Packet();
        p.buffer = _sanitizePacketBytes(data);
        return p.sendToServer(id);
    } catch (e) { return false; }
}

function sendLocalPacket(id, data) {
    try {
        const p = new _packet.Packet();
        p.buffer = _sanitizePacketBytes(data);
        return p.sendToLocal(id);
    } catch (e) { return false; }
}

function sendCommandRequest(command) {
    try { return _packet.sendCommandRequestPacket({ command: command }); }
    catch (e) { return false; }
}

function sendPlayerAuthInput(options) {
    try {
        const o = options || {};
        const out = {};
        for (const k in o) out[k] = o[k];
        if (out.posDelta === undefined && o.motion !== undefined) out.posDelta = o.motion;
        if (out.delta === undefined && o.motion !== undefined) out.delta = o.motion;
        if (out.analogMoveVector === undefined && o.analogMove !== undefined) out.analogMoveVector = o.analogMove;
        if (out.moveVector === undefined && o.moveVec !== undefined) out.moveVector = o.moveVec;
        if (out.rawMoveVector === undefined && o.rawMoveVec !== undefined) out.rawMoveVector = o.rawMoveVec;
        return _packet.sendPlayerAuthInputPacket(out);
    } catch (e) { return false; }
}

function sendPlayerAction(options) {
    try {
        const o = options || {};
        const out = {};
        for (const k in o) out[k] = o[k];
        if (out.action === undefined && o.type !== undefined) out.action = o.type;
        if (out.face === undefined) {
            if (o.value !== undefined) out.face = o.value;
            else if (o.actionType !== undefined) out.face = o.actionType;
        }
        if (out.resultPos === undefined) out.resultPos = o.resultPos || o.pos;
        return _packet.sendPlayerActionPacket(out);
    } catch (e) { return false; }
}

function curl_get_game_api(url, callback) {
    try { _https.get(url, {}, callback); } catch (e) { }
}

function curl_post_game_api(url, body, callback) {
    try { _https.post(url, {}, body, callback); } catch (e) { }
}

function playSound(source) {
    try {
        if (!_media) return;
        const api = (typeof _media.playSound === "function")
            ? _media
            : (_media.system || _media.media || _media);
        const snd = api.createSound(source);
        api.playSound(snd);
    } catch (e) { }
}

function TU_SendPyRpc(id, u8) {
    try { if (_packet.sendPyRpcPacket(id, u8.buffer)) return true; } catch (e) { }
    try { if (_packet.sendPyRpcPacket(id, u8)) return true; } catch (e) { }
    return false;
}

function callModule(tag, json) {
    const payload = (typeof json === "string") ? json : JSON.stringify(json);
    try { return _app.callModule(String(tag), payload); } catch (e) { }
    try { return _app.callModule(tag, payload); } catch (e) { }
    return false;
}

function thread(fn, ms) {
    return setTimeout(fn, ms || 0);
}

var _nxJumpHold = 0;      
var _nxJumpHeld = false;  

function nxJumpDown() {
    try {
        if (!_input || typeof _input.buttonDown !== "function") return false;
        _input.buttonDown("button.jump");
        _nxJumpHeld = true;
        return true;
    } catch (e) { return false; }
}

function nxJumpUp() {
    try {
        if (!_input || typeof _input.buttonUp !== "function") return false;
        _input.buttonUp("button.jump");
        _nxJumpHeld = false;
        return true;
    } catch (e) { return false; }
}

function nxJump(ticks) {
    var t = Number(ticks);
    if (!isFinite(t) || t <= 0) t = 3;
    if (t > _nxJumpHold) _nxJumpHold = t;
    if (!_nxJumpHeld) nxJumpDown();
    return true;
}

function nxJumpTick() {
    if (_nxJumpHold > 0) {
        if (!_nxJumpHeld) nxJumpDown();
        _nxJumpHold--;
        if (_nxJumpHold === 0) nxJumpUp();
    }
}

var _nxFBPending = null;   

function nxFightBack(id) {
    if (id === null || id === undefined) _nxFBPending = 'any';
    else _nxFBPending = id;
    return true;
}

function _nxNearestEntityId() {
    var list = getEntityList();
    var best = null, bd = Infinity;
    for (var i = 0; i < list.length; i++) {
        if (String(list[i]) === String(self_id)) continue;
        var d = getDistanceByID(list[i], self_id);
        if (d < bd) { bd = d; best = list[i]; }
    }
    return best;
}

function nxFightBackTick() {
    var p = _nxFBPending;
    if (p === null) return false;
    _nxFBPending = null;
    var id = (p === 'any') ? _nxNearestEntityId() : p;
    if (id === null || id === undefined) return false;
    if (String(id) === String(self_id)) return false;      
    if (getDistanceByID(id, self_id) >= fb_range) return false;
    Attack(id, Swing);
    return true;
}

var _nxJRPending = 0;

function nxJumpReset(n) {
    var t = Number(n);
    if (!isFinite(t) || t <= 0) t = 3;
    if (t > _nxJRPending) _nxJRPending = t;
    return true;
}

function nxJumpResetPacket() {
    try {
        var p = _localPlayer();
        if (!p || !_packet || typeof _packet.sendPlayerAuthInputPacket !== "function") return false;
        var pos = p.getPos();
        var rot = p.getRotation();
        return _packet.sendPlayerAuthInputPacket({
            rot: { pitch: rot.pitch, yaw: rot.yaw },
            pos: { x: pos.x, y: pos.y, z: pos.z },
            yHeadRot: rot.yaw,
            inputMode: 2,
            playMode: 0,
            inputData: [6]          
        });
    } catch (e) { return false; }
}

function nxJumpResetTick() {
    if (_nxJRPending <= 0) return false;
    _nxJRPending--;
    return nxJumpResetPacket();
}

var _nxSRPending = -1;   
var _nxSRWas = false;    

function nxIsSprinting() {
    try {
        const p = _localPlayer();
        if (p && typeof p.isSprinting === "function") return !!p.isSprinting();
    } catch (e) { }
    return false;
}

function setEntitySprinting(id, value) {
    const a = _localOrActor(id);
    if (!a) return false;
    try { a.setSprinting(!!value); return true; } catch (e) { return false; }
}

function nxSprintReset(ticks) {
    var t = Number(ticks);
    if (!isFinite(t) || t <= 0) t = 2;
    if (_nxSRPending < 0) {                       
        _nxSRWas = nxIsSprinting();
        if (_nxSRWas) {                           
            try { if (_input && _input.buttonUp) _input.buttonUp("button.sprint"); } catch (e) { }
        }
    }
    if (t > _nxSRPending) _nxSRPending = t;
    return true;
}

function nxSprintResetTick() {
    if (_nxSRPending < 0) return false;
    if (_nxSRWas && _input && _input.buttonUp) {  
        try { _input.buttonUp("button.sprint"); } catch (e) { }
    }
    _nxSRPending--;
    if (_nxSRPending <= 0) {
        if (_nxSRWas && _input && _input.buttonDown) {
            try { _input.buttonDown("button.sprint"); } catch (e) { }
        }
        _nxSRPending = -1;
        _nxSRWas = false;
    }
    return true;
}

function nxOnGame(fn) {
    if (typeof fn !== "function") return false;
    try {
        if (_thread && typeof _thread.runOnGameThread === "function") {
            _thread.runOnGameThread(fn);
            return true;
        }
    } catch (e) { }
    try { fn(); return true; } catch (e) { return false; }
}

var _nxHJRStage = -1;   

var _nxHJRHeld = [];

function _nxHJRDown(btn) {
    try {
        if (_input && _input.buttonDown) _input.buttonDown(btn);
        if (_nxHJRHeld.indexOf(btn) < 0) _nxHJRHeld.push(btn);
        return true;
    } catch (e) { return false; }
}

function _nxHJRReleaseAll() {
    try {
        if (_input && _input.buttonUp) {
            for (var i = 0; i < _nxHJRHeld.length; i++) {
                try { _input.buttonUp(_nxHJRHeld[i]); } catch (e) { }
            }
        }
    } catch (e) { }
    _nxHJRHeld = [];
    _nxHJRStage = -1;
    return true;
}

function nxHurtResetStart() {
    _nxHJRReleaseAll();          
    _nxHJRStage = 0;
    _nxHJRHeld = [];
    try {
        if (_input && _input.buttonUp) {
            _input.buttonUp("button.up");        
            _input.buttonUp("button.sprint");    
        }
    } catch (e) { }
    return true;
}

function nxHurtResetTick() {
    if (_nxHJRStage < 0) {
        if (_nxHJRHeld.length > 0) _nxHJRReleaseAll();   
        return false;
    }
    _nxHJRStage++;
    try {
        if (_nxHJRStage === 1) {
            
            _nxHJRDown("button.jump");
        } else if (_nxHJRStage === 2) {
            
            try { if (_input && _input.buttonUp) _input.buttonUp("button.jump"); } catch (e) { }
            _nxHJRDown("button.up");
            _nxHJRDown("button.sprint");
        } else if (_nxHJRStage >= 5) {
            
            _nxHJRReleaseAll();
        }
    } catch (e) { _nxHJRReleaseAll(); }
    return true;
}

function nxAutoSprint() {
    try {
        if (_input && _input.buttonDown) {
            _input.buttonDown("button.up");        
            _input.buttonDown("button.sprint");    
        }
    } catch (e) { }
    return true;
}

function executeCommand(cmd) {
    try { return _minecraft.queueExecuteCommand(String(cmd)); } catch (e) { return false; }
}

function requestExecuteCommand(cmd, callback) {
    try { return _minecraft.requestExecuteCommand(String(cmd), callback); } catch (e) { return false; }
}

const _V1DATA_PREFIX = "v1sys_";

function setData(key, value) {
    try {
        const k = _V1DATA_PREFIX + String(key);
        const t = typeof value;
        if (t === "boolean") return _sp.putString(k, "b:" + (value ? "1" : "0"));
        if (t === "number") return _sp.putString(k, (isFinite(value) && value % 1 === 0) ? ("i:" + value) : ("f:" + value));
        if (t === "bigint") return _sp.putString(k, "g:" + value.toString());
        if (value === undefined || value === null) return _sp.putString(k, "s:");
        return _sp.putString(k, "s:" + String(value));
    } catch (e) { return false; }
}

function getData(key, defValue) {
    const k = _V1DATA_PREFIX + String(key);
    try {
        if (!_sp.contains(k)) return defValue;
        const raw = _sp.getString(k) || "";
        const tag = raw.slice(0, 2);
        const body = raw.slice(2);
        if (tag === "b:") return body === "1";
        if (tag === "i:") return parseInt(body, 10);
        if (tag === "f:") return parseFloat(body);
        if (tag === "g:") return BigInt(body);
        return body;
    } catch (e) { return defValue; }
}

function getCameraRotation() {
    try {
        const r = _camera.getRotation() || {};
        const pitch = (r.x !== undefined) ? r.x : (r.pitch || 0);
        const yaw = (r.y !== undefined) ? r.y : (r.yaw || 0);
        const roll = (r.z !== undefined) ? r.z : (r.roll || 0);
        return { pitch: pitch, yaw: yaw, roll: roll };
    } catch (e) { return { pitch: 0, yaw: 0, roll: 0 }; }
}

function setCameraRotation(pitch, yaw, roll) {
    try { return _camera.setRotation({ x: Number(pitch) || 0, y: Number(yaw) || 0, z: Number(roll) || 0 }); }
    catch (e) { return false; }
}

function setCameraPitchLimit(min, max) {
    try { return _camera.setPitchLimit({ x: Number(min) || 0, y: Number(max) || 0 }); }
    catch (e) { return false; }
}

function _blockAt(x, y, z) {
    try {
        const d = _dimension();
        if (!d) return null;
        return d.getBlock({ x: x, y: y, z: z });
    } catch (e) { return null; }
}

function getBlockNBT(x, y, z) {
    const b = _blockAt(x, y, z);
    if (!b) return "";
    try {
        const s = b.getNBT();
        return (s === undefined || s === null) ? "" : String(s);
    } catch (e) { return ""; }
}

function getBlockEntityNBT(x, y, z) {
    return getBlockNBT(x, y, z);
}

function getBlockEntityData(x, y, z) {
    return getBlockNBT(x, y, z);
}

function setBlockEntityData(x, y, z, nbt) {
    try {
        if (!_block || !_block.setBlockEntityData) return false;
        return _block.setBlockEntityData({ x: x, y: y, z: z }, String(nbt));
    } catch (e) { return false; }
}

function setCommandBlockData(x, y, z, data) {
    try {
        if (!_block || !_block.setCommandBlock) return false;
        const d = data || {};
        const opt = {
            pos: { x: x, y: y, z: z },
            command: (d.command !== undefined ? d.command : ""),
            tickDelay: (d.tickDelay !== undefined ? d.tickDelay : 0)
        };
        if (d.mode !== undefined) opt.mode = d.mode;
        if (d.isRedStoneMode !== undefined) opt.redstoneMode = d.isRedStoneMode;
        else if (d.redstoneMode !== undefined) opt.redstoneMode = d.redstoneMode;
        if (d.isConditional !== undefined) opt.isConditional = d.isConditional;
        if (d.lastOutput !== undefined) opt.lastOutput = d.lastOutput;
        if (d.shouldTrackOutput !== undefined) opt.trackOutput = d.shouldTrackOutput;
        else if (d.trackOutput !== undefined) opt.trackOutput = d.trackOutput;
        if (d.executeOnFirstTick !== undefined) opt.executeOnFirstTick = d.executeOnFirstTick;
        return _block.setCommandBlock(opt);
    } catch (e) { return false; }
}

function findEntity(id) {
    if (id === undefined || id === null || id === "") return false;
    return !!_actor(id);
}

function setEntityNBT(id, mojangson) {
    const a = _actor(id);
    if (!a || !a.setNBT) return false;
    try { a.setNBT(String(mojangson)); return true; } catch (e) { return false; }
}

function getEntityNBT(id) {
    const a = _actor(id);
    if (!a || !a.getNBT) return "";
    try {
        const s = a.getNBT();
        return (s === undefined || s === null) ? "" : String(s);
    } catch (e) { return ""; }
}

function setEntityTarget(id, target) {
    const a = _actor(id);
    if (!a || !a.setTarget) return false;
    try {
        const t = _actor(target);
        a.setTarget(t || target);
        return true;
    } catch (e) { return false; }
}

function getEntityTarget(id) {
    const a = _actor(id);
    if (!a || !a.getTarget) return "";
    try {
        const t = a.getTarget();
        if (!t) return "";
        if (typeof t === "string") return t;
        if (t.getUniqueID) return t.getUniqueID();
        return "";
    } catch (e) { return ""; }
}

function startRidingEntity(id) {
    const veh = _actor(id);
    if (!veh) return false;
    const me = _localPlayer();
    try { if (me && me.startRiding) { me.startRiding(veh); return true; } } catch (e) { }
    try { if (veh.getVehicle && veh.startRiding) { veh.startRiding(me); return true; } } catch (e) { }
    return false;
}

function stopRidingEntity(id) {
    const a = _actor(id) || _localPlayer();
    if (!a || !a.stopRiding) return false;
    try { a.stopRiding(); return true; } catch (e) { return false; }
}

function _nbtToItem(nbtOrItem) {
    try {
        if (nbtOrItem && typeof nbtOrItem === "object") return nbtOrItem;   
        const it = new _item.ItemStack();
        const text = (nbtOrItem === undefined || nbtOrItem === null) ? "" : String(nbtOrItem);
        if (!text.trim()) return it;
        try { it.setNBT(text); return it; } catch (e) { }
        
        let name = "", count = 1, aux = 0;
        let m = /Name\s*:\s*"([^"]+)"/.exec(text);
        if (m) name = m[1];
        m = /Count\s*:\s*(-?\d+)/.exec(text);
        if (m) count = parseInt(m[1], 10);
        m = /Damage\s*:\s*(-?\d+)/.exec(text);
        if (m) aux = parseInt(m[1], 10);
        if (name) it.reinit(name, count, aux);
        return it;
    } catch (e) {
        try { return new _item.ItemStack(); } catch (e2) { return null; }
    }
}

/* shim 的 getEntityCarriedItem 返回 v1 文本；这里补「先转 ItemStack」的入口，
   供 set* 系列使用。 */
function _itemFor(id, fallbackText) {
    const a = _actor(id);
    if (a && a.getCarriedItem) {
        try { const it = a.getCarriedItem(); if (it) return it; } catch (e) { }
    }
    return _nbtToItem(fallbackText);
}

/* v1: setEntityCarriedItem(id, nbt) -> boolean */
function setEntityCarriedItem(id, nbt) {
    const a = _actor(id);
    if (!a || !a.setCarriedItem) return false;
    try { a.setCarriedItem(_nbtToItem(nbt)); return true; } catch (e) { return false; }
}

/* v1: setEntityOffhandItem(id, nbt) -> boolean */
function setEntityOffhandItem(id, nbt) {
    const a = _actor(id);
    if (!a || !a.setOffhandItem) return false;
    try { a.setOffhandItem(_nbtToItem(nbt)); return true; } catch (e) { return false; }
}

/* v1: setPlayerArmorItem(id, slot, nbt) -> boolean
   slot: 0 头盔 / 1 胸甲 / 2 护腿 / 3 靴子（v2 actor.setArmorItem(slot, item)） */
function setPlayerArmorItem(id, slot, nbt) {
    const a = _actor(id);
    if (!a || !a.setArmorItem) return false;
    try { a.setArmorItem(Number(slot) || 0, _nbtToItem(nbt)); return true; } catch (e) { return false; }
}

/* v1: setPlayerInventoryItem(id, slot, nbt) -> boolean
   v2 的 player 模块即本地玩家对象，不接受玩家 id。 */
function setPlayerInventoryItem(id, slot, nbt) {
    try { _player.setInventoryItem(Number(slot) || 0, _nbtToItem(nbt)); return true; }
    catch (e) { return false; }
}

/* ---------- 杂项 ---------- */

/* v1: loadNbtFromFile(path) -> string（NBT 二进制 → 文本，失败返回 ""）
   v2 走 nbt 模块；loadData 是通用入口（loadSchematic/loadBdx 各有专门格式）。 */
function loadNbtFromFile(path) {
    if (!_nbt) return "";
    try {
        const s = _nbt.loadData(path, "mojangson");
        return (s === undefined || s === null) ? "" : (typeof s === "string" ? s : JSON.stringify(s));
    } catch (e) { }
    try { return _nbt.loadData(path) || ""; } catch (e) { }
    try { const s = _nbt.loadVanillaData(path); return s || ""; } catch (e) { }
    return "";
}

/* v1: getBlockDestroyTime(方块名, 物品名, extra) -> number（越小破坏越快）
   v2 改为 player.getBlockDestroyTime(slot, 方块名)，按「槽位」查。
   这里按物品名在快捷栏里找槽位，找不到就退回当前手持槽位 —— 调用方（自动选工具）
   拿到的仍是「该物品打这个方块的耗时」，语义保持不变。 */
function _slotByName(name) {
    try {
        const n = String(name || "");
        if (!n) return -1;
        const hot = _player.getHotBarSize();
        for (let i = 0; i < hot; i++) {
            const it = _player.getInventoryItem(i);
            if (it && !(it.isNull && it.isNull())) {
                let iname = "";
                try { iname = it.getName(); } catch (e) { }
                if (iname === n) return i;
            }
        }
    } catch (e) { }
    return -1;
}

function getBlockDestroyTime(blockName, itemName, extra) {
    try {
        let slot = (typeof itemName === "number") ? itemName : _slotByName(itemName);
        if (slot < 0) slot = _player.getSelectItemSlot();
        return _player.getBlockDestroyTime(slot, blockName);
    } catch (e) { return 0; }
}

/* v1: simulateClick() -> boolean（模拟一次点击）；v2 对应 input.click() */
function simulateClick() {
    try { if (_input && _input.click) { _input.click(); return true; } } catch (e) { }
    try { _input.buttonDown("button.attack"); _input.buttonUp("button.attack"); return true; } catch (e) { }
    return false;
}

/* v1: setLocalPlayerGameType(type) —— v2 player.setGameType(type) */
function setLocalPlayerGameType(type) {
    try { _player.setGameType(Number(type) || 0); return true; } catch (e) { return false; }
}

/* v1: File.readBinary(path) -> ArrayBuffer
   v2 的 fs.read(path) 只返回文本，读二进制必须显式传 encoding —— 少了这个参数
   拿到的是字符串，下游 uncompress() 会直接失效。 */
function _fsReadBinary(path) {
    if (!_fs) return null;
    try { const b = _fs.read(String(path), "binary"); if (b) return b; } catch (e) { }
    try { return _fs.read(String(path), "bin"); } catch (e) { }
    try { return _fs.read(String(path)); } catch (e) { }
    return null;
}

/* v1: sendRpc(id, data) —— data 实际可为 ArrayBuffer / Uint8Array（脚本里两者都出现过）。
v2 的 packet.sendPyRpcPacket 文档只写 string，实测能收 ArrayBuffer；而 Uint8Array
不是 ArrayBuffer，直接传会被拒（TimeUnity 踩过同一个坑，它的 TU_SendPyRpc 就是干这个的）。
这里统一取出底层的 ArrayBuffer 再发。 */
function sendRpc(id, data) {
    let payload = data;
    try {
        if (data && typeof data === "object" && typeof data.byteLength === "number"
            && !(data instanceof ArrayBuffer) && data.buffer instanceof ArrayBuffer) {
            payload = data.buffer;
        }
    } catch (e) { }
    try { return _packet.sendPyRpcPacket(id, payload); } catch (e) { }
    try { return _packet.sendPyRpcPacket(id, data); } catch (e) { }
    return false;
}

/* ---------- 安全退出 ----------
   v1 的 exit() 是「立即卸载脚本实例」，在 v2 上裸调会崩（TimeUnity 踩过：崩溃栈落在
   网易 libkernel.so，符号被混淆，无法精确归因）。它的解法是把卸载拆成两步：
   先把本脚本创建的东西回收干净、并把 onTickEvent 换成空函数（而不是 delete，
   避免引擎在同一帧继续回调已开始卸载的脚本），再让引擎延迟卸载。
   这里做成不依赖具体脚本内部变量的通用版本 —— 回收清单直接取自适配层的登记表。 */
function _safeExit() {
    /* ① 停 tick：换成空函数，不 delete */
    try { globalThis.onTickEvent = function () { }; } catch (e) { }
    /* ② 回收 HUD：适配层登记过的 Text / ArrayList / Shape 全部逐个移除，
          每一项单独容错，不让一个坏对象阻断后面的清理。 */
    try { for (const k in _textItems) { try { _textItems[k].remove(); } catch (e) { } } } catch (e) { }
    try { for (const k in _arrayListItems) { try { _arrayListItems[k].remove(); } catch (e) { } } } catch (e) { }
    try { for (const k in _shapeItems) { try { _shapeItems[k].remove(); } catch (e) { } } } catch (e) { }
    /* ③ 相机复位：脱离相机的状态不跟着脚本卸载而恢复 */
    try { _camera.resetCamera(); } catch (e) { }
    try { _app.showToast("已退出脚本"); } catch (e) { }
    /* ④ 让上面的清理先提交到引擎，再请求卸载 */
    setTimeout(function () { try { exit(); } catch (e) { } }, 100);
}

/* ---------- 表单回调的线程切换 ----------
   v1: addForm(json, callback, cancelCallback)

   v2 的 gui.addForm 回调在 **UI 线程**执行，而表单回调里常常立刻去读游戏数据 ——
   Rebirth 的「两点导出」就是在回调里调 getChunkBlocks → getBlock。
   而 README 第 5 节把「在 UI 线程调 world.getClientWorld()」明确列为**错误示例**：
   那个线程下 getDimension() 拿不到维度（实测返回 null），于是 getBlock 一路抛
   "Cannot read properties of null (reading 'getBlock')"，适配层兜底返回空气块，
   方块全被 EXCLUDE_LIST 当空气滤掉 —— 表现就是「选了很大范围却导出 0 方块」。

   这里统一把回调转到游戏线程执行，不用逐个改调用点；线程模块不可用时退回原行为。 */
function addForm(json, callback, cancelCallback) {
    function wrap(fn) {
        if (typeof fn !== "function") return fn;
        return function () {
            const args = arguments;
            try {
                if (_thread && typeof _thread.runOnGameThread === "function") {
                    _thread.runOnGameThread(function () {
                        try { fn.apply(null, args); } catch (e) { }
                    });
                    return;
                }
            } catch (e) { }
            return fn.apply(null, args);
        };
    }
    try { return _gui.addForm(json, wrap(callback), wrap(cancelCallback)); }
    catch (e) { return false; }
}

/* v1: file_copy(from, to) -> boolean；v2 fs.copyFile(from, to) */
function file_copy(from, to) {
    if (!_fs) return false;
    try { return _fs.copyFile(String(from), String(to)); } catch (e) { }
    try { return _fs.copy(String(from), String(to)); } catch (e) { }
    return false;
}

/* v1: sendSound(event, x, y, z, level) -> boolean；v2 packet.sendLevelSoundEventPacket */
function sendSound(event, x, y, z, level) {
    try {
        return _packet.sendLevelSoundEventPacket({
            eventId: Number(event) || 0,
            pos: { x: x, y: y, z: z },
            data: Number(level) || 0
        });
    } catch (e) { return false; }
}

/* v1: getEntityEffectList(id) -> array(EntityEffect)，元素含 {id, amplifier, duration...} */
function getEntityEffectList(id) {
    const a = _actor(id);
    if (!a || !a.getEffectList) return [];
    try { return a.getEffectList() || []; } catch (e) { return []; }
}

/* v1: destroyBlock(id, x, y, z, side) -> boolean
   v2: player.destroyBlock(pos, face)，作用于本地玩家，不接受玩家 id。 */
function destroyBlock(id, x, y, z, side) {
    try { _player.destroyBlock({ x: x, y: y, z: z }, Number(side) || 0); return true; }
    catch (e) { return false; }
}

/* 「这个事件 id 是不是本地玩家」—— 受击类功能（反击退 / 受击卡空 / 受击跳跃 /
   被击后反击）整段都挂在这个判定上，判错就是整段不动（静默失效）。
   NoveXare 的 onEntityBehaviorEvent 原本写的是 `id === self_id`，而：
     · 脚本侧 self_id 被桥接统一成 String（实测布吉岛为哨兵值 "-10"），
     · 事件回调传进来的 id 是引擎原生类型（不保证是 string）。
   类型一错，严格相等永远为 false。这里把判定放宽到两层：
     ① 字符串层面相等；
     ② 还不行就拿 id 去取实体，比它的 uid / runtimeID ——
        将来若引擎把事件 id 换成运行时编号或服务端编号，这一步能译回来。
   两层都是精确匹配，不会把别的实体的受伤算到自己头上。 */
function _isLocalId(id, selfId) {
    if (id === selfId) return true;
    try { if (String(id) === String(selfId)) return true; } catch (e) { }
    let a = null;
    try { a = _actor(id); } catch (e) { }
    if (!a) return false;
    try { if (String(a.getUniqueID()) === String(selfId)) return true; } catch (e) { }
    try { if (String(a.getRuntimeID()) === String(selfId)) return true; } catch (e) { }
    return false;
}

/* 「对着某一块已有方块点击」（而不是「往某个目标格放」）。
   NoveXare 的 simulatePlace() 就是这个语义：它先在目标空气格的六个邻居里找到
   一块实体方块，再点击那一块 —— 面号用的是 pos_list 的下标，而那个下标恰好与
   基岩版的 BlockFace 编号一致（0=下 1=上 2=北 3=南 4=西 5=东），所以直接透传给
   v2 的 player.buildBlock(pos, face) 就是对的。
   ★ 不能走 shim 的 buildBlock()：那个桥接把入参当「目标格」、会再往旁边找一圈支撑块，
   而这里传进来的已经是支撑块本身 —— 再找一次就错位一格，表现为「搭路一直在旁边
   放方块 / 放不出来」。 */
function placeAgainst(x, y, z, face) {
    const p = _localPlayer();
    if (!p) return false;
    try {
        return !!p.buildBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }, Number(face) || 0);
    } catch (e) { return false; }
}

/* v1: getScreenName() -> string
   v1 实测：游戏内 "hud_screen"、背包 "inventory_screen"、箱子 "chest_screen"。
   v2 换成 gui.getCurrentScreenName()。同一环境里按 v2 写的 TimeUnity.js 是拿
   `getCurrentScreenName() == ""` 判「没有打开任何界面」的 —— 说明 v2 在游戏内
   很可能返回空串而不是 "hud_screen"。
   而本脚本把 `current_hud.includes('hud_screen')` 当作「在游戏里」的入口条件
   （自动药水那段就挂在它上面），且 moveItem() 要求名字等于 "inventory_screen"。
   这里按 v1 语义归一：空串 → "hud_screen"；其余名字原样透传（若 v2 用同一套命名，
   inventory_screen / chest_screen 这类判断不受影响）。 */
function getScreenName() {
    let n = "";
    try { n = _gui.getCurrentScreenName(); } catch (e) { }
    if (n === null || n === undefined) return "hud_screen";
    n = String(n);
    if (!n.length) return "hud_screen";
    return n;
}

/* ---------- 低血量喷药：治疗药水的识别与查找（NoveXare「喷药 / 投药」共用） ----------
   v1 原逻辑把药水写死成 `aux !== 22`（只认治疗 II）。实机数据
   （resources/InvChainDiag2.txt 背包 slot[5]）：同一瓶「喷溅型治疗药水」在 v2 里
   getAux() = 21，getNBT() 原文是
   `{Count:1b,Damage:21s,Name:"minecraft:splash_potion",WasPickedUp:0b}`。
   于是原判断在手持治疗 I 时恒为「手上不是药水」→ 每 tick 都调
   selectPlayerInventorySlot(self_id, null)（getItemSlot 只扫快捷栏且要求 aux 全等，
   找不到就返回 null）→ 喷药、喝汤、金头盔这三种「切物品再用」的低血量模式全部卡死，
   而只用命令的「退出 / 重开 / 退出游戏」不受影响 —— 与实机表现一致。
   这里把 21/22 都认作治疗药水，并且**只扫快捷栏 0~8**：
   从背包直接喷不合法，背包里的药水由「自动药水」先搬到快捷栏。 */
function _isHealPotionAux(aux) {
    const a = Number(aux);
    return a === 21 || a === 22;
}
function _findHealPotionSlot(id) {
    try {
        for (let i = 0; i < 9; i++) {
            const item = getInventory(id, i);
            if (item && item.namespace === 'minecraft:splash_potion' && _isHealPotionAux(item.aux)) return i;
        }
    } catch (e) { }
    return null;
}
function _hotbarHealPotionCount(id) {
    let n = 0;
    try {
        for (let i = 0; i < 9; i++) {
            const item = getInventory(id, i);
            if (item && item.namespace === 'minecraft:splash_potion' && _isHealPotionAux(item.aux)) n += (item.count || 0);
        }
    } catch (e) { }
    return n;
}

/* ---------- 背包整理：药水按效果分槽 + 归位目标 ----------
   需求（SkyWars 布局）：「增益药水」放7号快捷栏、「损害药水」放8号。
   但药水的 namespace 只有 potion / splash_potion / lingering_potion 三种，
   具体效果全由 aux 区分 —— 而 clear_config 是 JSON 对象、键唯一，
   **没法给同一个 namespace 写两条不同 slot**，所以只能在这里算。
   aux 取值与实机一致：治疗 I=21、治疗 II=22（见 _isHealPotionAux 的实测记录），
   其余按基岩版药水 aux 表。 */
const _NX_BENEFICIAL_AUX = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    19, 20, 21, 22, 28, 29, 30, 31, 32, 33, 36, 37, 38, 39, 40, 41, 42];
const _NX_HARMFUL_AUX = [17, 18, 23, 24, 25, 26, 27, 34, 35];
const _NX_POTION_NS = ['minecraft:potion', 'minecraft:splash_potion', 'minecraft:lingering_potion'];

/* 返回药水该去的快捷栏槽位（0 基）；不是药水或无法判定时返回 undefined */
function _nxPotionSlot(item) {
    try {
        if (!item) return undefined;
        if (_NX_POTION_NS.indexOf(item.namespace) === -1) return undefined;
        const a = Number(item.aux);
        if (_NX_HARMFUL_AUX.indexOf(a) !== -1) return 7;      // 8 号槽：损害药水
        if (_NX_BENEFICIAL_AUX.indexOf(a) !== -1) return 6;   // 7 号槽：增益药水
    } catch (e) { }
    return undefined;
}

/* ---------- 投掷物优先占「损害药水」那一格 ----------
   用户要求：8 号槽（slot 7）优先给投掷物（雪球/鸡蛋/钓鱼竿），投掷物没有时才放损害药水。
   光靠「目标格为空才搬」不够 —— 那是先到先得，常见的药水会先把格子占住。
   所以这里做显式让位：背包里只要有投掷物，非投掷物就不许占用 _NX_THROWABLE_SLOT。
   覆盖两条路径：配置里写了 slot 的（投掷物本体）与没写 slot 的（靠 _nxPotionSlot 算出的药水）。 */
const _NX_THROWABLE_NS = ['minecraft:snowball', 'minecraft:egg', 'minecraft:fishing_rod'];
const _NX_THROWABLE_SLOT = 7;
let _NX_HAS_THROWABLE = false;

/* 每轮整理前刷新一次（只读背包槽，不发包） */
function _nxRefreshThrowable(id) {
    _NX_HAS_THROWABLE = false;
    try {
        for (let i = 0; i < 36; i++) {
            if (_NX_THROWABLE_NS.indexOf(getInventory(id, i).namespace) !== -1) { _NX_HAS_THROWABLE = true; break; }
        }
    } catch (e) { }
}

/* 归位目标槽：配置里写了 slot 就用它，否则看是不是药水（药水分增益/损害两槽） */
function _nxSortSlot(item, clearItem) {
    let slot;
    if (clearItem && clearItem.slot !== undefined) slot = clearItem.slot;
    else slot = _nxPotionSlot(item);
    if (slot === _NX_THROWABLE_SLOT && _NX_HAS_THROWABLE
        && _NX_THROWABLE_NS.indexOf(item.namespace) === -1) return undefined;
    return slot;
}

// NoveXare - XxxGBRCxxX
// 方法
const sendShadow = (x, y, z) => sendPlayerAction({
    id: self_id,
    pos: {
        x,
        y,
        z
    },
    type: 17
})
const getPos = id => {
    let p = getEntityPos(id)
    if (p) p.y += getPos_offset
    return (p || {
        x: 0,
        y: 0,
        z: 0
    })
}
const silentMove = (x, y, z, motion = {
    x: 0,
    y: 0,
    z: 0
}) => sendPlayerAuthInput({
    pos: {
        x,
        y,
        z
    },
    yHeadRot: 0,
    inputMode: 2,
    playMode: 0,
    flags: [6],
    motion,
    rot: {
        yaw: 0,
        pitch: 0
    },
})

const movePlayer = (x, y, z, ground = true) => _packet.sendMovePlayerPacket({
    id: self_id,
    pos: {
        x,
        y,
        z
    },
    yHeadRot: 0,
    mode: 0,
    rot: {
        yaw: 0,
        pitch: 0
    },
    ground,
});

function calHexPos(hex) {
    function hexToFloat(hex) {
        if (hex.length !== 16) throw new Error("Hex data must be 16 characters");
        const bytes = new Uint8Array(8);
        for (let i = 0; i < 8; i++) bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        const view = new DataView(bytes.buffer);
        return view.getFloat64(0, false); // false 表示大端序
    }
    const valueKeyHex = "76616c7565";
    const valueKeyIndex = hex.indexOf(valueKeyHex);
    if (valueKeyIndex === -1) throw new Error("Value key not found in hex string");
    let pos = valueKeyIndex + valueKeyHex.length;
    const arrayTag = hex.substring(pos, pos + 2); // 取 2 字符
    if (arrayTag !== "93") throw new Error("Expected array tag '93' after value key");
    pos += 2;
    const coordinates = [];
    for (let i = 0; i < 3; i++) {
        const typeTag = hex.substring(pos, pos + 2);
        if (typeTag !== "cb") throw new Error(`Expected float64 tag 'cb' at position ${pos}, found ${typeTag}`);
        pos += 2;
        const floatData = hex.substring(pos, pos + 16); // 取 16 字符数据
        pos += 16;
        const num = hexToFloat(floatData);
        coordinates.push(num);
    }
    return {
        x: Number(coordinates[0].toFixed(2)),
        y: Number(coordinates[1].toFixed(2)),
        z: Number(coordinates[2].toFixed(2))
    };
}
const stringToHex = (str) => {
    let hex = '';
    for (let i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(2, '0');
    return hex;
} // 字符串转哈希
const sendPlayerPos = (id) => {
    sendPyRpc(98247598, `93c401729200c4314d696e6563726166743a7065743a7065745f736b696c6c5f667269656e645f6332735f6765745f667269656e645f706f73c0`)
    sendPyRpc(98247598, `93c40163920082c407706c617965727391c4${id.length.toString(16).toLowerCase().padStart(2,'0')}${stringToHex(id)}c40b726571506c617965724964c4${self_id.length.toString(16).toLowerCase().padStart(2,'0')}${stringToHex(self_id)}c0`)
}

const ab2str = (arrayBuffer) => {
    const uint8Array = new Uint8Array(arrayBuffer);
    let str = "";
    for (let i = 0; i < uint8Array.length;) {
        let byte1 = uint8Array[i++];
        if (byte1 <= 0x7f) str += String.fromCharCode(byte1);
        else if (byte1 >> 5 === 0b110) {
            let byte2 = uint8Array[i++];
            str += String.fromCharCode(((byte1 & 0x1f) << 6) | (byte2 & 0x3f));
        } else if (byte1 >> 4 === 0b1110) {
            let byte2 = uint8Array[i++];
            let byte3 = uint8Array[i++];
            str += String.fromCharCode(
                ((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f)
            );
        } else if (byte1 >> 3 === 0b11110) {
            let byte2 = uint8Array[i++];
            let byte3 = uint8Array[i++];
            let byte4 = uint8Array[i++];
            let codePoint =
                ((byte1 & 0x07) << 18) |
                ((byte2 & 0x3f) << 12) |
                ((byte3 & 0x3f) << 6) |
                (byte4 & 0x3f);
            str += String.fromCharCode(codePoint);
        }
    }
    return str;
}
const splitText = (string, strA, strB, extra) => {
    let start = string.indexOf(strA) + strA.length
    let finish = string.indexOf(strB, start)
    if (typeof extra !== 'undefined' && string.indexOf(extra, start) < finish && string.indexOf(extra, start) != -1) finish = string.indexOf(extra, start)
    if (start === -1 || finish === -1) return null
    return string.substring(start, finish)
} // 切割字符串
const rainbowMsg = (msg) => {
    let msg_char = msg.split("")
    let result = ""
    let color = "4c6e2a3b195d".split("")
    for (let i in msg_char) result += "§" + color[i % color.length] + msg_char[i]
    return result
}
const hex2u8a = (hex) => {
    if (hex.startsWith('0x')) hex = hex.slice(2);
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
        const byte = parseInt(hex.slice(i, i + 2), 16);
        bytes.push(byte);
    }
    return new Uint8Array(bytes);
}
const sendPyRpc = (id, data, mode = 1) => {
    if (mode == 1) sendRpc(id, hex2u8a(data))
    if (mode == 2) sendRpc(id, data)
    if (mode == 3) {
        const uint8Array = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) uint8Array[i] = str.charCodeAt(i);
        sendRpc(id, uint8Array)
    }
}
const nbt2object = (nbt) => {
    if (nx_nbts[nbt] !== undefined) return nx_nbts[nbt]
    const namespace = splitText(nbt, ',Name:"', '",WasPickedUp')
    if (namespace === '' || typeof namespace !== 'string') return {
        aux: 0,
        count: 0,
        namespace: "minecraft:air",
        curDamage: 0,
        enchants: []
    }
    const aux = Number(splitText(nbt, ',aux:', ','))
    const count = Number(splitText(nbt, 'Count:', 'b,D'))
    const name = nbt.includes(',name:"') ? splitText(nbt, ',name:"', '",') : namespace.replace("minecraft:", "")
    const id = nbt.includes(',netId:') ? Number(splitText(nbt, ',netId:', '}')) : 0
    const damage = nbt.includes('maxDamage') ? Number(splitText(nbt, ',maxDamage:', ',')) : 0
    const curDamage = nbt.includes('Damage:') ? Number(splitText(nbt, 'Damage:', 's')) : 0
    const attackDamage = nbt.includes('attackDamage') ? Number(splitText(nbt, 'attackDamage:', ',')) : 1
    const color = nbt.includes('customColor') ? splitText(nbt, 'customColor:', '}', ',') : ""
    const enchant = nbt.includes('ench:[{') ? ("[{" + splitText(nbt, 'ench:[{', '}]')).replace(/s/g, '').replace(/id/g, '"id"').replace(/lvl/g, '"lvl"').replace(/modEnchant/g, '"modEnchant"') + "}]" : "[]"
    const isBlock = nbt.startsWith('{Block:')
    const obj = {
        name,
        namespace,
        aux,
        damage,
        curDamage,
        attackDamage,
        count,
        color,
        isBlock,
        id,
        enchants: JSON.parse(enchant)
    }
    nx_nbts[nbt] = obj
    return obj
} // 解析NBT
const getTargetInfo = (target) => {
    const size = getEntitySize(target);
    const motion = getEntityMotion(target);
    const pos = getPos(target);
    const name = getEntityName(target);
    const namespace = getEntityNamespace(target);
    const distance = getDistanceByID(self_id, target);
    const item = getCarried(target);
    const speed = getSpeed(target);
    const health = getEntityAttribute(target, 'minecraft:health');
    const abilitySpeed = getEntityAttribute(target, 'minecraft:movement');
    const typeId = getEntityTypeId(target);
    const tg = getEntityTarget(target);
    const inventorySize = getPlayerInventorySize(target);
    const hotBarSize = getPlayerHotBarSize(target);
    const {
        yaw,
        pitch
    } = getEntityRot(target);
    const formatNumber = (num) => num.toFixed(2);
    const infoLines = [`唯一ID:${target} 昵称:${name}§r 实体命名空间:${namespace} 水平碰撞箱:${formatNumber(size.x)} 垂直碰撞箱:${formatNumber(size.y)} Mot速度:${speed}`, `ability速度:[max:${abilitySpeed.max}, min:${abilitySpeed.min}, current:${abilitySpeed.current}] 血量:[max:${health.max}, min:${health.min}, current:${health.current}]`, `手持:[id:${item.id}, namespace:${item.namespace}, name:${item.name}§r, aux:${item.aux}] 距离:${distance} 实体类型:${typeId}`, `仰俯角:${formatNumber(pitch)}° 偏航角:${formatNumber(yaw)}° 仇恨目标:${getEntityName(tg)}^${tg}`, `移动值:[${formatNumber(motion.x)}, ${formatNumber(motion.y)}, ${formatNumber(motion.z)}] 坐标值:[${formatNumber(pos.x)}, ${formatNumber(pos.y)}, ${formatNumber(pos.z)}]`, `背包容量:${inventorySize} 物品栏容量:${hotBarSize}`];
    return infoLines.join('\n');
};

const getCarried = (id) => nbt2object(getEntityCarriedItem(id)) // 获取手持
const getOffhand = (id) => nbt2object(getEntityOffhandItem(id)) // 获取副手
const getInventory = (id, slot) => nbt2object(getPlayerInventoryItem(id, slot)) // 获取背包
function destroy(id, x, y, z, side) {
    destroyBlock(id, x, y, z, side)
    packetDestroy(x, y, z, true, true)
}
const packetDestroy = (ex, ey, ez, AuthInput = false, action = false) => {
    let Destroy_pos = {
        x: ex,
        y: ey,
        z: ez
    }
    const type_list = [0, 13, 18, 27]
    const AuthInputDestroy = type_list => sendPlayerAuthInput({
        pos: self_pos,
        inputMode: 2,
        playMode: 0,
        flags: [35],
        actions: type_list.map(type => ({
            type: type,
            pos: Destroy_pos,
            value: 1
        }))
    })
    const PlayerActionDestroy = type => sendPlayerAction({
        id: self_id,
        pos: Destroy_pos,
        type: type
    })
    if (AuthInput) AuthInputDestroy(type_list)
    if (action) type_list.forEach(type => PlayerActionDestroy(type))
} // 发包破坏
const moveItem = (from, to, move = true, swap = false) => {
    if (from === to || getScreenName() !== 'inventory_screen') return false
    let f_i = getInventory(self_id, from)
    let t_i = getInventory(self_id, to)
    if (move && to < 9 && t_i.namespace != "minecraft:air") {
        for (let i = 35; i > 8; i--) {
            const e_i = getInventory(self_id, i)
            if (e_i.namespace === "minecraft:air") {
                moveInventoryItem(to, i)
                break
            }
        }
    }
    if (swap && f_i.namespace === "minecraft:air" && t_i.namespace !== "minecraft:air") moveInventoryItem(to, from)
    if (f_i.namespace !== "minecraft:air" && t_i.namespace === "minecraft:air") moveInventoryItem(from, to)
} // 移动物品
const silentRot = (pitch, yaw) => {
    let yaw2 = yaw - 180
    if (pitch > 90) pitch -= 90
    if (pitch < -90) pitch += 90
    if (yaw2 > 180) yaw2 = yaw2 - 360
    if (yaw2 < -180) yaw2 = 360 + yaw2
    if (_options.getPlayerViewPerspective() === 0 || yaw2 > 180 || yaw2 < -180 || pitch > 90 || pitch < -90) return false
    setEntityBodyRot(self_id, yaw2)
    setEntityRot(self_id, pitch, yaw2)

} // 静默转头
const isAlive = (id) => {
    const health = getEntityAttribute(id, 'minecraft:health')
    const pos = getPos(id)
    if (typeof pos != 'object' || !pos || !pos.x || !pos.y || !pos.z) return false
    if (!findEntity(id) && (health.max === undefined || health.min === undefined || health.current === undefined)) return false
    if (health.current > 0) return true
}
const nxCall = (key, value) => {
    if (typeof globalThis[key] === 'undefined' || globalThis[key] === value) return;
    globalThis[key] = value
    nx_cfg[key] = value
    if (SoundManager && sm_switch) playSound(nx_paths + '/音效/switch.mp3', 100, 100)
    if (SoundManager && sm_switch) playSound(nx_paths + '/音效/switch_' + (value ? 'on' : 'off') + '.mp3', 100, 100)
    if (FuncSwitchTip && (!FuncMessage || !key.includes('_'))) {
        if (modes.tip_mode === 0) {
            if (value) makeMsg(0, key, "§oEnable ◆", '§a')
            else makeMsg(0, key, "§oDisable ◇", '§c')
        }
        if (modes.tip_mode === 1) {
            addCustomArrayList(key, key + (value ? ' - Enable' : ' - Disable'), key + (value ? ' - Enable' : ' - Disable'), true)
            setTimeout(() => addCustomArrayList(key, key + (value ? ' - Enable' : ' - Disable'), key + (value ? ' - Enable' : ' - Disable'), false), 50 * fst_time)
        }
    }
    if (typeof nx_arraylist[key] !== 'undefined') addCustomArrayList(key, nx_arraylist[key].CN, nx_arraylist[key].EN, value)
    else if (modes.tip_mode != 1 && ArrayList && !key.includes('_')) addCustomArrayList(key, key, key, value)
    if (typeof nx_binds[key] !== 'undefined') nx_binds[key].forEach(k => nxCall(k, value))
    if (typeof nx_raBinds[key] !== 'undefined' && !nx_raBinds[key].isNX) callModule(nx_funcid[nx_raBinds[key].module], JSON.stringify({
        value
    }))
} // 调用功能
const createParticle = (type, x, y, z, num, offset = false, end_pos = {}) => {
    for (let i = 0; i < num; i++) addParticle(Number(type), x, y, z, offset ? end_pos.x : x, offset ? end_pos.y : y, offset ? end_pos.z : z, 1, offset)
} // 绘制粒子
const useItem = () => {
    const item = getEntityCarriedItem(self_id)
    const pos = getPos(self_id)
    if (!item.includes('count:0')) buildBlock(self_id, pos.x, pos.y, pos.z, 6)
} // 使用手持物品
const equipArmor = (slot) => {
    const type = getItemType(self_id, slot)
    const list = ['helmet', 'chestplate', 'leggings', 'boots']
    if (slot > 8 && !moveItem(slot, 8, true, false)) return   // 搬不动（没开背包）就别往下走
    if (list.includes(type) && selectPlayerInventorySlot(self_id, slot) && getPlayerSelectItemSlot(self_id) === slot) useItem()
} // 穿装备
const calParabola = (x, pitch, v, g) => {
    let isDown = pitch > 0
    pitch = Math.abs(pitch)
    let v0 = v * Math.cos(pitch * Math.PI / 180)
    let vy = v * Math.sin(pitch * Math.PI / 180)
    let t = vy / g
    let max_h = g * (t * t) * 0.5
    let dis_hor = v0 * t
    let a = -max_h / (dis_hor * dis_hor)
    return {
        data: a * Math.pow(x - (isDown ? (-dis_hor) : (dis_hor)), 2) + max_h,
        bool: isDown
    }
} // 计算抛物线
const getLocal = (id) => (!id) ? getLocalPlayerUniqueID() : id // 获取玩家ID
const simulatePlace = (x, y, z, boost = false) => {
    const block_c = getBlock(x, y, z)
    if (block_c.id !== 0) return
    const pos_list = [
        [x, y + 1, z],
        [x, y - 1, z],
        [x, y, z + 1],
        [x, y, z - 1],
        [x + 1, y, z],
        [x - 1, y, z]
    ]
    pos_list.some((pos, i) => {
        const block = getBlock(pos[0], pos[1], pos[2])
        if (block.namespace !== "minecraft:air") return placeAgainst(pos[0], pos[1], pos[2], i)
    })
} // 花雨庭/EC放置方块
const createSound = (id, level) => {
    const pos = getPos(self_id)
    sendSound(id, pos.x, pos.y, pos.z, level)
} // 播放音效
const motTP = (x, y, z) => {
    const pos = getPos(self_id)
    motion_list.push([x - pos.x, y - pos.y, z - pos.z])
    motion_list.push([0, 0, 0])
} // 传送
const getItemCount = (slot, namespace) => {
    let main_item = (slot === -1) ? getCarried(self_id) : getInventory(self_id, slot);
    if (typeof namespace !== 'undefined') main_item.namespace = namespace;
    return Array.from({
        length: 36
    }, (_, k) => getInventory(self_id, k)).filter(item => (item.namespace === main_item.namespace && (typeof namespace !== 'undefined' || item.aux === main_item.aux))).reduce((acc, item) => acc + item.count, 0);
};

const hasItem = (id, namespace, range = 'hotbar', count = 0) => {
    const inventorySize = (range == 'hotbar') ? 9 : 36;
    let baseArray = Array.from({
        length: inventorySize
    }, (_, i) => getInventory(id, i))
    let hasMatchingItem = baseArray.some(item => item.namespace.includes(namespace));
    let nCount = baseArray.reduce((acc, item) => acc + item.count, 0);
    return (hasMatchingItem && nCount > count);
};

const getItemType = (id, num, namespace) => {
    let item = (num === -1) ? getCarried(id) : getInventory(id, num)
    if (!item.namespace.includes("_") && typeof namespace === 'undefined') return 'other'
    let item_namespace = (typeof namespace === 'undefined') ? (item.namespace.replace("minecraft:", "")) : (namespace.replace("minecraft:", ""))
    const item_split = item_namespace.split("_")
    return item_split[item_split.length - 1]
} // 获取物品种类
const getEntityMaxDamage = (id) => Array.from({
    length: 36
}, (_, i) => getItemDamage(id, i)).reduce((max, damage) => Math.max(max, damage), 0);
const getEntityMaxArmor = (id, type, all = false) => {
    let output = all ? [0, 0, 0, 0] : 0
    const nx_armors = ['helmet', 'chestplate', 'leggings', 'boots'];
    for (let i = 0; i < 36; i++) {
        const c_type = getItemType(id, i)
        const index = nx_armors.indexOf(c_type)
        if (index === -1) continue;
        const armor = getItemArmor(id, i)
        if (!all && c_type === type && output < armor) output = armor
        if (all && output[index] < armor) output[index] = armor
    }
    return output
} // 获取实体最大装备值
const getItemArmor = (id, slot, texture = true, enchant = true) => {
    let item = (slot === -1) ? getCarried(id) : getInventory(id, slot)
    if (slot < -1) item = nbt2object(getPlayerArmorItem(id, Math.abs(slot) - 2))
    if (item.count === 0 || item.damage === 0 || item.attackDamage > 0) return 0
    if (!enchant) return item.damage
    let ench = 0
    let index = item.enchants.findIndex(enchant => enchant.id === 0)
    if (index > -1) ench = item.enchants[index].lvl
    if (!texture) return (1 + ench / 100)
    return (item.damage * (1 + ench / 100))
} // 获取物品装备值
const getItemDamage = (id, slot, texture = true, enchant = true) => {
    let item = (slot === -1) ? getCarried(id) : getInventory(id, slot)
    if (item.count === 0 || item.attackDamage === 0 || item.attackDamage === 0) return 1
    if (!enchant) return item.attackDamage
    let ench = 0
    let index = item.enchants.findIndex(enchant => enchant.id === 9)
    if (index > -1) ench = item.enchants[index].lvl * 1.25
    if (!texture) return ench
    return (item.attackDamage + ench)
} // 获取物品伤害
const b2s = bool => bool ? 'true' : 'false' // 布朗值转换
const getText = (string, strA, strB) => {
    let match_num = string.split(strA).length - 1
    let last_index = 0
    let output = []
    for (let i = 0; i < match_num; i++) {
        let start = string.indexOf(strA, last_index) + strA.length
        let finish = string.indexOf(strB, start)
        if (finish === -1 || start === -1) break
        last_index = finish
        output.push(string.substring(start, finish))
    }
    return match_num > 1 ? output : output[0]
} // 切割字符串
const Attack = (target, swing) => {
    if (ECAttack) sendPyRpc(98247598, '93c40b4d6f644576656e7443325394c41145434e756b6b6974436c69656e744d6f64c41445434e756b6b6974436c69656e7453797374656dc419496e7465726163744265666f7265436c69656e744576656e7481c40474797065c403544150c0')
    return attackEntity(target, swing)
} // 攻击
const getItemSlot = (id, namespace, aux, name) => {
    if (typeof aux === 'undefined') aux = -1
    if (typeof name === 'undefined') name = -1
    let output = null
    for (index = 0; index < 9; index++) {
        const item = getInventory(id, index)
        if (!item.namespace || !item.name) continue
        if (item.namespace.includes(namespace) && (item.aux === aux || aux === -1) && (item.name.includes(name) || name === -1)) {
            output = index
            break
        }
    }
    return output
} // 获取物品索引
const getSpeed = (id) => {
    const Motion = getEntityMotion(id)
    const bpt = Math.sqrt(Motion.x * Motion.x + Motion.y * Motion.y + Motion.z * Motion.z)
    return bpt * 20
} // 获取速度
const getRand = (min, max) => {
    const range = max - min + 1;
    return Math.floor(Math.random() * range) + min;
} // 随机数
const predictPos = (entity_mot, entity_pos, ticks) => {
    return {
        x: entity_pos.x + (entity_mot.x * ticks),
        y: entity_pos.y + (entity_mot.y * ticks),
        z: entity_pos.z + (entity_mot.z * ticks)
    }
} // 预测坐标
const timeFormat = (s) => {
    if (s < 60) return s + "s"
    if (s >= 60) return Math.floor(s / 60) + 'min ' + s % 60 + "s"
} // 时间格式化
const checkWall = (pos, pos2, enable, p1_offset = 0, p2_offset = 0) => {
    if (!enable) return true
    pos.y += p1_offset
    pos2.y += p2_offset
    const yaw = getPlayerAngle(pos, pos2, "yaw_pos")
    const pitch = -getPlayerAngle(pos, pos2, "pitch_pos")
    const distance = getDistance(pos, pos2)
    let nowall = true
    for (let i = 0; i < distance; i += 0.5) {
        const p = calDisplacement(i, pos2, {
            yaw,
            pitch
        })
        const block = getBlock(p.x, p.y, p.z)
        if (block.namespace != "minecraft:air") {
            nowall = false
            break
        }
    }
    return nowall
} // 检测墙壁
const playerSelector = (key, mode) => {
    let list = getWorldPlayerList().sort((a, b) => a.name.localeCompare(b.name));
    let buttons = (list.length > 0) ? list.map(target => ({
        text: ('§e' + target.name + '\n§b距离: ' + getDistanceByID(self_id, target.id).toFixed(2))
    })) : [{
        text: '没有玩家'
    }]
    let menu = {
        type: 'form',
        title: '§5选择',
        content: '§5选择一个目标',
        buttons
    };
    const json = JSON.stringify(menu);
    addForm(json, function(index) {
        if (list.length > 0 && index >= 0) {
            const r = (mode === 0) ? list[index].name : list[index].id
            if (typeof globalThis[key] === 'object') globalThis[key].push(r)
            if (typeof globalThis[key] === 'string') globalThis[key] = r
            makeMsg(0, 'addTarget', r, '§r')
        }
    });
} // 目标选择器
const calDisplacement = (length, pos, rot) => {
    if (length === 0) return pos
    let isLow = (length < 0) ? true : false
    let {
        yaw,
        pitch
    } = rot
    if (yaw > 180) yaw = yaw - 360
    if (yaw < -180) yaw = 360 + yaw
    if (pitch < -90) pitch = -90
    if (pitch > 90) pitch = 90
    length = Math.abs(length);
    const a = yaw * Math.PI / 180;
    const b = pitch * Math.PI / 180;
    let y = (pitch != 0) ? (Math.sin(b) * length) : 0
    let l = (pitch != 0) ? (y / Math.tan(b)) : length
    let isLow2 = l < 0
    l = Math.abs(l)
    const cos_d = Math.cos(a) * l
    const sin_d = Math.sin(a) * l
    let x = -Math.sin(a) * l;
    let z = Math.cos(a) * l;
    if (isLow || isLow2) {
        x = -x;
        if (!isLow2) y = -y;
        z = -z;
    }
    return {
        x: pos.x + x,
        y: pos.y - y,
        z: pos.z + z
    };
}; // 获取相对坐标
const getPlayerItemCount = (id) => (Array.from({
    length: 36
}, (_, k) => getInventory(id, k)).filter((item) => item.count !== 0).reduce((acc, item) => acc + item.count, 0));

const isSimilar = (num, num2, min) => Math.abs(num - num2) < min // 比较
const getTargets = (id) => {
    let List = [];
    if (at_entity) List.push(...getEntityList());
    if (at_player) List.push(...getPlayerList());
    let max_num = Math.min(at_maxCount, List.length);
    let output = [];
    for (const target of List) {
        if (!isAlive(target)) continue;
        const type = getEntityNamespace(target)
        if (at_typeWhite.length > 0 && at_typeWhite.some(key => type.includes(key)) != at_back) continue;
        const pos = getPos(target);
        const distance = getDistance(pos, getPos(id));
        if ((distance > at_maxDist || distance < at_minDist) != at_back && !InfiniteAura && !at_inf) continue;
        const heal = getEntityAttribute(target, 'minecraft:health');
        if (at_heal && (!heal || heal.min > heal.max || heal.max > 1e5 || heal.current <= 0 || heal.max === 0) != at_back) continue;
        if (type === 'minecraft:player') {
            const rot = getEntityRot(target);
            const ability_speed = at_BWM ? getEntityAttribute(target, 'minecraft:movement') : ({
                current: 0
            });
            const name = getEntityName(target);
            if (at_BWM && ability_speed.current >= 0.5 && !name.includes('[') && !name.includes('【')) {
                if (DeleteDummy) removeEntity(target)
                continue;
            }
            if (at_fov && (typeof rot.yaw === 'undefined' || typeof rot.pitch === 'undefined' || rot.yaw.toFixed(2) === 0.00 || rot.pitch.toFixed(2) === 0.00) != at_back) continue;
            const hidden = getEntityFlag(target, 5);
            if (at_hide && hidden != at_back) continue;
            const ground = getEntityIsGround(target);
            if (at_ground && ground === at_back) continue;
            if (at_wall && !checkWall(getPos(self_id), pos, at_wall, true, 1.53, 0.9) != at_back) continue;
            if (Teams && teams_name && (name.startsWith(ct_team) || (ct_team.includes('[') && name.includes(ct_team)))) continue;
            if ((at_whileLists.includes(target) != at_back) || (!at_name && (name === getEntityName(id) || name === "") != at_back) || ((pos.y > at_maxY || pos.y < at_minY) != at_back && !at_infY) || target === self_id) continue;
            if (at_regexEnable && at_regex.some(str => name.includes(str))) continue;
            const armor = (teams_armor) ? (teams_blur ? getPlayerArmorItem(target, teams_slot) : nbt2object(getPlayerArmorItem(target, teams_slot))) : {}
            if (Teams && teams_armor && ((teams_blur && armor != "{}" && armor === teams_self) || (!teams_blur && armor.color && armor.color === teams_self.color))) continue;
            const size = at_size ? getEntitySize(target) : {
                x: 0,
                y: 0
            };
            if (at_size && !HitBox && ((size.x > at_defaultSize.x + 0.1 || size.x < at_defaultSize.x - 0.1) && (size.y > 1.66 || size.y < 1.64) && (size.y < at_defaultSize.y || size.y > at_defaultSize.y + 0.1) && (size.y > 1.51 || size.y < 1.49)) != at_back) continue;
        }
        const items = modes.at_mode === 4 ? getPlayerItemCount(target) : 0;
        const yaw = modes.at_mode === 3 ? getPlayerAngle(self_id, target, 'yaw_rot') : 0;
        const pitch = modes.at_mode === 3 ? getPlayerAngle(self_id, target, 'pitch_rot') : 0;
        const damage = modes.at_mode === 2 ? getItemDamage(target, -1) : 0;
        output.push({
            distance,
            target,
            damage,
            heal: heal.current,
            crosshair: Math.sqrt(yaw * yaw + pitch * pitch),
            items,
            random: getRand(0, List.length - 1)
        });
    }
    const sortFunctions = [
        (a, b) => a.distance - b.distance, (a, b) => a.heal - b.heal, (a, b) => a.damage - b.damage, (a, b) => a.crosshair - b.crosshair, (a, b) => b.items - a.items, (a, b) => a.random - b.random
    ];
    output.sort(sortFunctions[modes.at_mode]);
    if (at_reverse) output.reverse();
    if (at_infCount) return output.map(t => t.target)
    return output.slice(0, max_num).map(t => t.target);
}; // 获取目标

const makeMsg = (mode = 0, desc = 'Tip', msg, color = '§r') => {
    if (!FuncTip) return false
    if (mode == 0) return _minecraft.clientMessage(`§b◇ §r§lNoveXare §r§7>>>§r ${desc} §7>>>${(RainbowTip ? "§" + rgb_color[rgb_l] : color)} ${msg}`)
    if (mode == 1) {
        if (modes.tipType_mode === 0) return (`§r${desc} §7>>> ${(RainbowTip ? "§" + rgb_color[rgb_l] : color)}${msg}`)
        if (modes.tipType_mode >= 1) return (`${(RainbowTip ? "§" + rgb_color[rgb_l] : color)}${msg}`)
    }
}

const getDistance = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2) + Math.pow(p1.z - p2.z, 2)) // 计算距离
const getDistanceByID = (id, target) => {
    if (!isAlive(id) || !isAlive(target)) return Infinity
    const p1 = getPos(id)
    const p2 = getPos(target)
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2) + Math.pow(p1.z - p2.z, 2))
} // 通过ID计算距离
const getHorizontalDistanceByID = (id, target) => {
    if (!isAlive(id) || !isAlive(target)) return Infinity
    const p1 = getPos(id)
    const p2 = getPos(target)
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.z - p2.z, 2))
} // 通过ID计算水平距离
const MenuTP = (x, y, z) => {
    let pos = {
        'fn-set-player-pos': {
            x,
            y,
            z
        }
    }
    callModule(5, JSON.stringify(pos))
} // 传送菜单TP
const getHorizontalDistance = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.z - p2.z, 2)) // 计算水平距离
const setRealPos = (id, x, y, z) => setEntityPos(id, x, y + setPos_offset, z) // 设置坐标
const setPos = (x, y, z) => setRealPos(self_id, x, y, z) // 设置坐标
const setMotion = (x, y, z) => setEntityMotion(self_id, x, y, z) // 设置移动值
const str2obj = (str) => {
    if (str === "") return []
    return str.split(",")
} // 字符串转数组
const obj2str = (obj) => {
    if (typeof obj != "object" || obj.length === 0) return ""
    return obj.join(",")
} // 数组转字符串
const editVal = (key, value) => {
    let s = (typeof value === "object") ? obj2str(value) : value
    let mode = (typeof value === "object") ? 0 : 1
    addForm('{"type":"custom_form","title":"编辑变量","content":[{"type":"input","text":"' + key + '","placeholder":"","default":"' + s + '"}]}', function(text) {
        if (mode === 1) globalThis[key] = text
        if (mode === 0) globalThis[key] = str2obj(text)
        makeMsg(0, 'setValue', key + " §7>>>§r " + text, '§r')
        nx_cfg[key] = globalThis[key]
    })
} // 编辑变量
const getTeams = (name) => {
    if (typeof name != "string" || name === "") return "None"
    let matches = name.match(/\[(.*?)\]/g);
    if (matches === null) return "None"
    return matches[0]
} // 获取队伍
const readFile = (path) => {
    if (!_fs.exists(path)) return '{}'
    const content = _fs.read(path)
    return content ? content : '{}'
} // 读取文件
const getEntityBlockPos = (id) => {
    const pos = getPos(id)
    let y = (id === self_id) ? Math.floor(pos.y) - 1 : Math.floor(pos.y)
    return {
        x: Math.floor(pos.x),
        y,
        z: Math.floor(pos.z)
    }
} // 获取玩家方块坐标
const arrayDedup = (obj1, obj2) => {
    if (obj1.length === obj2.length) {
        return [];
    }
    const longerArray = obj1.length >= obj2.length ? obj1 : obj2;
    const shorterArray = obj1.length < obj2.length ? obj1 : obj2;
    return longerArray.filter((element) => !shorterArray.includes(element));
};

const calAngle = (hor, vec) => {
    const v = aa_speed
    const g = aa_g
    const angle_triangle = Math.atan(Math.floor(-vec) / hor)
    const distance = Math.sqrt(hor * hor + vec * vec)
    const theta = Math.atan(distance / v / 2 / v * g)
    return -((theta + angle_triangle) / Math.PI * 180)
} // 计算角度
const getFlyTime = (x, v) => x / v
const roundAngle = (angle, precision) => Math.round(angle / precision) * precision
const getPlayerAngle = (mid, target, mode, predict = false, offset = false, random_xy = 0, random_y = 0) => {
    let target_pos = (typeof target != "string") ? target : getPos(target)
    let self_pos = (typeof mid != "string") ? mid : getPos(mid)
    let rot = getEntityRot(mid);
    if (!target_pos || !self_pos) return Infinity
    const level = getHorizontalDistance(self_pos, target_pos)
    if (predict) target_pos = predictPos(getEntityMotion(target), getPos(target), getFlyTime(level, aa_speed) * 20)
    let length_x = target_pos.x - self_pos.x
    let length_y = self_pos.y - target_pos.y + ((aa_y - 20) / 10) + getRand(-random_y, random_y) / 10
    let length_z = target_pos.z - self_pos.z
    let angle_h = Math.atan2(length_z, length_x) * 180 / Math.PI
    const launchangle = calAngle(level, length_y)
    let angle_v = (offset) ? launchangle : (Math.atan2(length_y, level) * 180 / Math.PI);
    if (mode === "yaw_pos") return (angle_h > -180 && angle_h <= 90) ? (angle_h + 90) : (angle_h - 270)
    if (mode === "yaw_rot") {
        angle_h = (angle_h > -180 && angle_h <= 90) ? (angle_h + 90) : (angle_h - 270)
        let result = angle_h - rot.yaw + getRand(-random_xy / 2, random_xy / 2)
        return (result > 0) ? (-result + 180) : (-result - 180)
    }
    if (mode === "pitch_pos") return angle_v
    if (mode === "pitch_rot") return angle_v - rot.pitch
} // 计算相对角度
const isAimed = (id, target, fov, mode) => {
    let yaw = Math.abs(getPlayerAngle(id, target, "yaw_rot"))
    let pitch = Math.abs(getPlayerAngle(id, target, "pitch_rot"))
    if (mode === 0) return Math.sqrt(yaw * yaw + pitch * pitch) < fov
    if (mode === 1) return (Math.abs(yaw) < fov)
    if (mode === 2) return (Math.abs(pitch) < fov)
} // 是否瞄准
const hex2str = (hex) => {
    let str = '';
    for (let i = 0; i < hex.length; i += 2) {
        str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return str;
} // 哈希转字符串

const findPath = (start, end, size = 0.5, includePitch = false) => {
    let output = []
    let yaw = getPlayerAngle(start, end, "yaw_pos")
    let pitch = getPlayerAngle(start, end, "pitch_pos")
    if (getDistance(start, end) < size) return [start]
    for (let i = 0; i <= getDistance(start, end); i += size) {
        let goal_pos = calDisplacement(-i, start, {
            yaw,
            pitch: includePitch ? -pitch : 0
        })
        if (getBlock(goal_pos.x, goal_pos.y, goal_pos.z).namespace === 'minecraft:air') output.push({
            x: goal_pos.x,
            y: goal_pos.y,
            z: goal_pos.z
        })
    }
    return output
} // 获取路径
const getHealth = (id, mode) => {
    if (!isAlive(id)) return ''
    let health = getEntityAttribute(id, 'minecraft:health')
    let current = health.current
    let max = health.max
    const ratio = current / max
    switch (mode) {
        case 0:
            return ratio.toFixed(2) * 100 + "%%"
        case 1:
            let output = "§c"
            for (let i = 0; i < Math.floor(ratio * 20); i++) output += "❤"
            return output + "§r"
        case 2:
            return "§c❤§rx" + Math.floor(current)
        case 3:
            return Math.floor(current) + "/" + Math.floor(max)
        case 4:
            return getProgress(current, max, '▌', 20)
        default:
            return current
    }
} // 获取血量
const randomStr = (length) => {
    let output = ""
    let Random_str = '.,?!@":;+-*/=~|_\\^`&#%$·'.split('')
    for (let i = 0; i < length; i++) {
        let num = getRand(0, Random_str.length - 1)
        output += Random_str[num]
    }
    return output
} // 随机字符串
function getProgress(current, max, graph = '▌', length = 40) { //获取任务进度
    let percentage = Math.min(current / max, 1)
    const rgb_color = "4c6e2a3b195d591b3a2e6c4".split("")
    let color = rgb_color[Math.min(Math.floor(percentage * rgb_color.length), rgb_color.length - 1)]
    let progress_bar = graph.repeat(length).split("")
    let insert = Math.min(Math.floor(percentage * progress_bar.length), progress_bar.length)
    progress_bar[Math.min(insert, progress_bar.length - 1)] = graph + '§r§o§l'
    return (`§r[§o§l§${color}${progress_bar.join("")}§r]`)
}
const ModuleDestroy = (start_pos) => {
    for (let dx = Math.ceil(-cd_size / 2); dx < Math.floor(cd_size / 2 + 1); dx++) {
        for (let dy = Math.ceil(-cd_size / 2); dy < Math.floor(cd_size / 2 + 1); dy++) {
            for (let dz = Math.ceil(-cd_size / 2); dz < Math.floor(cd_size / 2 + 1); dz++) {
                const {
                    x,
                    y,
                    z
                } = start_pos
                const block = getBlock(x + dx, y + dy, z + dz)
                if (block.namespace === 'minecraft:air') continue;
                if (cd_exclude && start_pos.y + dy <= start_pos.y - 1) continue;
                if (cd_fake) setBlock(x + dx, y + dy, z + dz, 'air', 0)
                if (!cd_fake) destroyBlock(self_id, start_pos.x + dx, start_pos.y + dy, start_pos.z + dz, 0)
                if (cd_packet) packetDestroy(start_pos.x + dx, start_pos.y + dy, start_pos.z + dz, true, true)
            }
        }
    }
}
const tpback = () => {
    if (!InfiniteAura_backPos || !InfiniteAura_backMot) return
    if (ia_comeClick) {
        buildBlock(self_id, InfiniteAura_backPos.x, InfiniteAura_backPos.y, InfiniteAura_backPos.z, 0);
        if (!ia_nopacket && modes.ia_mode === 0) silentMove(InfiniteAura_backPos.x, InfiniteAura_backPos.y, InfiniteAura_backPos.z)
    }
    if (ia_back) {
        for (let i = 0; i < ia_move; i++) {

            if (modes.ia_mode === 0) setPos(InfiniteAura_backPos.x, InfiniteAura_backPos.y, InfiniteAura_backPos.z);
            if (modes.ia_mode === 1) silentMove(InfiniteAura_backPos.x, InfiniteAura_backPos.y, InfiniteAura_backPos.z)
            if (modes.ia_mode === 2) movePlayer(InfiniteAura_backPos.x, InfiniteAura_backPos.y, InfiniteAura_backPos.z)
        }
        setMotion(InfiniteAura_backMot.x, InfiniteAura_backMot.y, InfiniteAura_backMot.z)
    }
    InfiniteAura_backMot = null
    InfiniteAura_backPos = null
}

const hex2format = (hex) => {
    let output = ""
    let d = hex.split("")
    for (let i in d) {
        let string = d[i].toUpperCase()
        if (i != d.length - 1) {
            if (i % 2 === 1) output += (string + " ")
            else output += string
        } else output += string
    }
    if (rpc_remark) {
        let obj = output.split(' ')
        let output2 = ""
        for (let j in obj) output2 += obj[j] + '(' + hex2str(obj[j]) + ') '
        return output2
    } else return output
} // 哈希格式化

const setTarget = (id, target, two = false) => {
    setEntityTarget(id, target)
    if (two) setEntityTarget(target, id)
}

// 变量
// 玩家数据
var self_id = getLocal(otherId)
var prev_id = getLocal(otherId)
var prev_heal = 20
var last_world_player = []
var self_pos = getEntityPos(self_id)
var prev_pos = getEntityPosPrev(self_id)
var kills = 0
var seconds = 0
var ticks = 0
var self_itemCount = 0
var prev_itemCount = 0
var ct_team = "NoveXare"
var death_pos = {}
var prev_item = {}
var gd_ping = 0
var gd_ping1 = 0
var gd_ping2 = 0
var attack_list = []
var self_moving = false
var self_item = {}
var prev_ground = true
var max_damage = {}
var max_armor = [0, 0, 0, 0]

// NoveXare配置
var nx_nbts = {}
var nx_paths = _app.getResource() + "/GBRC/NoveXare"
var nx_screen = getScreenSizeData()
var nx_arraylist = JSON.parse(readFile(nx_paths + "/FuncArrayList.json"))
var nx_funcid = JSON.parse(readFile(nx_paths + "/RunAwayFunc.json"))
var nx_keys = []
var nx_cfgs = _app.getResource() + "/GBRC/NoveXare/配置"
var nx_ui = JSON.parse(readFile(_app.getResource() + "/ui/ui_definition.json"))
var nx_blocks = readFile(_app.getResource() + "/GBRC/NoveXare/blocks.json")
var nx_binds = {}
var nx_goal = null
var nx_raBinds = []
var nx_cfg = {
    binds: {},
    key_binds: [],
    nx_raBinds: [],
    name: getEntityName(self_id)
}
var modes = {}
var nx_goalSpeed = 1.5
var nx_isBind = null
var nx_armors = ['helmet', 'chestplate', 'leggings', 'boots'];
let nx_defaultName = getData("nx_defaultCfg", "null")
let nx_defaultCfg = ((nx_defaultName !== '') ? readFile(nx_cfgs + '/' + nx_defaultName + '.json') : '{}')
var resList = ['minecraft:iron_ingot', 'minecraft:diamond', 'minecraft:gold_ingot', 'minecraft:emerald']
var PacketCfg = JSON.parse(readFile(nx_paths + "/PacketManager.json"))
var PacketTranslate = JSON.parse(readFile(_app.getResource() + "/ui/conf_packet.json")).packets

// 数据包管理
var PacketTmp = {
    send: {},
    receive: {}
}
var srp_ignore = false
var srp_id = true
var sp_id = true
var srp_name = true
var srp_trans = true
var sp_name = true
var sp_trans = true
var srp_save = false
var sp_save = false
var srp_intercept = false
var sp_ignore = false
var sp_intercept = false
var sp_statistic = false
var srp_statistic = false

// 下落丢资源&资源商店
var dr_mot = 1.30

// 背包整理
var {
    clear_config,
    trash_slot
} = JSON.parse(readFile(nx_paths + "/Cleaner.json"))
var ic_max = 1
var ic_delay = 3
modes.ic_mode = 1
var cleaner_slot = 35
var ic_bow = false
var ic_chest = false
var ic_move = true
var ic_inv = false
var ic_all = false

// 智能背包
var {
    SmartInvCfg,
    move_armor_slot,
    drop_slot,
    layout: nx_layout,
    quota: nx_quota,
    blocks: nx_blocks,
    offhand_shield: nx_offhand_shield,
    silent: nx_silent
} = JSON.parse(readFile(nx_paths + "/SmartInv.json"))
var armor_slot = 0
var da_all = false
var da_bow = false
var da_enchant = true
var da_texture = true
var da_weapon = true
var da_armor = true
var da_chest = false
var da_move = true
var da_delay = 3
var da_slot = 35
var da_inv = false
var da_max = 1

// motion tp
var motion_list = []

// 自动开箱
var ca_chest_pos = []
var chestStates = {
    packet: false,
    click: false
}
var ca_range = 3
var ca_wall = false
var ca_exclude = true
var ca_fov = 90
var ca_rot = false
var ca_check = false
var ca_block = false

// 连锁挖矿
var mine_list = []
var mine_destroy = false
var mine_name = null
var mine_current = 0
var mine_num = 500
var mine_info = true
var mine_distance = 5
var mine_speed = 5
var mine_white = []
var mine_black = []

// 丢弃背包
var dl_list = []
var di_speed = 1

// 8D音效
var sp_length = 0
var sp_file = null
var sp_target = false
var sp_entity = false
var sp_vec = 1
var sp_exclude = false
var sp_data = []
var sp_count = 1
var sp_yaw = -180
var sp_loop = false
var sp_distance = 5
var sp_posList = []
var sp_all = true
var sp_type = 81
var sp_range = 8
var sp_space = 16
var sp_large = false
var sp_level = 0
var sp_y = 0
var sp_info = true

// 转移用户
var otherId = null

// 伪延迟
var fl_abnormal = 5
var fl_t = 0
var fl_show = false
modes.fl_mode = 0
var fl_reverse = true
var fakelag_status = false
var fl_normal = 20

// 选择目标
var at_defaultSize = {
    x: 0.6,
    y: 1.8,
}
var at_regex = ["player", "entity", "主城", "商店", "[LV", "CIT-", "ˉ", "－", "%", "-", "%"]
var at_typeWhite = []
var at_hide = true
var at_lists = [];
var at_whileLists = [];
var at_maxCount = 3;
var at_maxDist = 6
var at_minDist = 0
var at_entity = false
var at_player = true
var at_maxY = 380
var at_minY = -60
var at_infY = true
var at_inf = false
var at_size = true
var at_fov = true
var at_infCount = false
var at_heal = true
var at_BWM = true
modes.at_mode = 0
var at_regexEnable = true
var at_back = false
var at_reverse = false
var at_wall = false
var at_ground = false
var at_name = true
var at_delay = 1
var at_lock = false

// 无坏效果
var debuff = [2, 4, 7, 9, 15, 17, 18, 19, 20, 27, 31, 33]

// 上帝模式
var gm_pos = {}
var gm_mot = {}
var gm_back = false
var gm_local = false
var gm_tick = 0
var gm_move = false
var gm_ground = false
var gm_y = 0
var gm_cycle = 1
var gm_delay = 1
var gm_xz = false
var gm_edit_y = true
var gm_count = 5
modes.gm_mode = 2

// 自动搭路
var sca_y = false
var sca_count = false
var sca_yaw = 0
var sca_len = 2
var sca_prec = 30
var sca_surface = true
var sca_fake = false
var sca_move = true
var sca_moveRot = false
var sca_clickRot = false
var sca_up = false
var sca_block = true
var sca_auto = false
var sca_keep = false
var sca_current = 0
var sca_pitch = 60
var sca_acc = false
var sca_space = 10
var sca_prevTower = 0
var sca_tower = false

// pyrpc管理
var rpc_config = JSON.parse(readFile(_app.getResource() + "/GBRC/NoveXare/PyRpc_Config.json"));
var rpc_black = ["kick", "movemcpkick", "rank", "music", "setcan"]
var rpc_white = []
var rpc_sendBlack = ["pongggg", "clicked"]
var rpc_sendWhite = []
var rpc_recBlack = []
var rpc_recWhite = []
var rpc_t = 0
var prev_rpc = {}
var rpc_repeat_times = 1
var rpc_exclude = false
var rpc_showDisintercept = false
var rpc_showIntercept = false
modes.rpc_mode = 0
var rpc_tipWhite = []
var rpc_cycle = false
var rpc_repeat_ticks = 1
var rpc_id = true
var rpc_remark = false
var rpc_store = false
var rpc_intercept = false
var rpc_temp = []
var rpc_send = true
var rpc_rec = false
var rpc_tip = false
var rpc_record = false

// 灵魂出窍
var fc_pos = {}
modes.fc_mode = 0
var fc_draw = false
var fc_dist = false

// 伪造移动
var fmo_pos = {}

// 虚空回弹
modes.av_mode = 0
var av_pos = []
var av_running = false
var av_minY = 0.8
var av_derp = false

// 避免攻击
var aa_pos = {}

// 自动潜行
var shift_tick = 0
var shift_num = 100

// 点击破坏
var cd_fake = false
var cd_size = 1
var cd_delay = 1
var cd_exclude = false

// 原地复活
var lr_delay = 0
var lr_random = 1

// 迷你世界击杀
var mini_title = true
var mini_tip = ["重重一击", "两连击", "三连击", "非常犀利", "无人能挡", "主宰比赛", "迈向超神", "正在暴走", "如神一般", "已经超神"]
var mini_tick = 0
var mini_delay = 0
var mini_kills = 0

// 功能显示
var fst_y = 0
var fst_x = 0
var fst_time = 20
modes.tip_mode = 0

// 反协管
var as_config = JSON.parse(readFile(nx_paths + '/Staff.json'))
modes.as_mode = 0
modes.anti_mode = 0
var as_ground = false
var as_hide = false

// 方块连点
var bc_select = false
var bc_packet = false
var bc_delay = 1
var ac_pos = []

// rgb提示
var rgb_color = "4c6e2a3b195d591b3a2e6c4".split("")
var rgb_l = 0
var rgb_t = 0
var rgb_cycle = 2

// 编辑Y轴
var Edit_Y = 85

// 水晶光环
var ac_auto = false
var ac_delay = 1
var ac_count = 1
var ac_tp = false

// 攻击水晶
var ca_distTo = 3

// 重生锚光环
var ab_auto = false
var ab_delay = 1
var ab_click = false
var ab_offset = 0

// 自动踏空
var aj_continue = false
var aj_modify = false
var aj_speed = 5
var aj_height = 42

// 弓箭平飞
var arrow_rot = {}

// 遍历快捷栏
var select_slot = 0
var select_t = 0
var selectitems = []
var hs_slot = []
var hs_use = false
var hs_damage = false
var hs_delay = 1

// 秒人斧检查
modes.ca_mode = 0
var ca_delay = 1

// 自动重开
var gg_list = ['easecation:all_games', 'minecraft:emerald']
modes.gg_mode = 0

// 辅助瞄准
var aa_prec = 0
var aa_min = 20
var aa_max = 20
var aa_pred = false
var aa_auto = false
var aa_range = 5.00
var aa_fov = 90
var aa_randomY = 0
var aa_xz = 0
var aa_speed = 100
var aa_g = 16
var aa_throw = false
var aa_silent = false
var aa_y = 20
modes.AssistAim_mode = 1

// 自动药水
var ap_autobag = false
var ap_min = 3
var ap_slot = -1

// 复制物品
var ie_drop = true
var ie_data = '0'
var ie_delay = 20
modes.itemedit_mode = 0

// 无摔落
var nf_max = 0.42
modes.nf_mode = 0

// 消息小尾巴
var cs_text = "This is a suffix"

// 粒子连线
var lp_offset = 0
var lp_type = 3
var lp_size = 1

// 躲避投掷物
var at_remove = false

// 瞄准攻击
var aaa_aps = 10
var aaa_fov = 15
var aa_use = false
var aim_t0 = -Infinity
var aim_t1 = 0

// 骑人
var rid_random = false
var rid_y = 1

// 平衡变速
var bt_lock = false

// 绕过禁言
modes.bm_mode = 0

// 攻击音效
var as_gradually = true
var as_type = 81
var as_level = 0

// 点击白名单
var cw_size = 6

// 粒子环绕
var srp_y = 0
var srp_len = 0
var srp_speed = 5

// 速度
var bhop_heigh = 0.42
var bhop_pos = {
    x: 0,
    y: 0,
    z: 0
}
var bhop_mot = {
    x: 0,
    y: 0,
    z: 0
}
var bhop_speed = 5
modes.bhop_mode = 0
var bhop_airjump = false

// 杀戮光环
var ka_empty = 0
var ka_delay = 0
var ka_times = 1
var ka_balance = false
var ka_max = 10
var ka_min = 10
var ka_fov = 90
var ka_range = 4.00
var ka_infDist = false
var KillAura_d_1 = []
var KillAura_d_2 = []
var ka_close = true
var ka_fall = false
var ka_third = false
var random_num = 0
var random_delay = 0
var ka_wall = true

// 无视减速
var nl_water = {}
var nl_lava = {}

// 百米大刀
var ia_random = false
var ia_packet = 3
var ia_nopacket = false
var ia_jump = false
var ia_range = 100
var ia_move = 1
var ia_return = 1
var ia_multi = false
var ia_back = true
var ia_switch = 0
var ia_delay_r = 10
var ia_tmp_list = []
var ia_targets = []
var ia_delay = 5
var ia_tick = 10
var ia_attack = 1
modes.ia_mode = 1
var InfiniteAura_backPos = null
var InfiniteAura_backMot = null
var ia_toClick = true
var ia_comeClick = true
var ia_offset = 0
var ia_fix = true

// 低血量操作
var ad_min = 10
modes.ad_mode = 0

// 锁定视角
modes.person_mode = 0

// 锁背环绕
var aai_len = 3
var aai_max = 2
var aai_current = -180
var sur_speed = 5
var aai_min = 0
var aai_speed = 5
var aai_h = 0
var aai_reverse = false
var aai_random = false
modes.sur_mode = 0

// 环绕粒子
var srp_current = -180
var srp_type = 19
var srp_size = 1
var srp_move = 0

// 喷气背包
var spr_speed = 5
var spr_hor = false
var spr_packet = false
var spr_auth = false
modes.sprint_mode = 0
var spr_nowall = false
var spr_move = false

// 飞行
var fly_playerAuth = false
var fly_moveplayer = false
var fly_speed = 20
var fly_move = false
var fly_zero = true
var fly_y = false
var fly_ud = false
var fly_ud_val = 10
var fly_current = 1
var fly_air = false
modes.fly_mode = 0
var up_down_speed = 1.00

// 实体追踪
var tra_range = 5
var tra_speed = 5

// 击杀嘲讽
var km_text = "Lmao"
var km_hide = false

// 聊天管理
var cm_black = []
var cm_length = 100
var cm_self = false
var cm_target = ""
var cm_fake = false
var cm_other = false
var cm_repeat_times = 1
var cm_list = {
    self: null,
    other: null
}
var isRepeating = false

// 黑洞
var suck_range = 3

// 缓降
var sd_speed = 5

// 控距
var kd_distance = 3
var kd_only_ground = false
var kd_speed = 5
var kd_anti = false

// 踢人光环
var ka_packet = 500
var ka_multi = false
var ka_count = 50
var ka_text = "🤓"
var ka_repeat = 50
var ka_fake = false
var ka_target = false
var ka_player = false
modes.ka_mode = 0

// 崩溃器
var cs_packet = 500
var cs_multi = false
var cs_count = 75
modes.cs_mode = 0

// 碰撞箱
var hb_hor = 2.0
var hb_y = 1.8

// 显血
modes.health_mode = 0

// 受击跳跃
var hj_height = 0.42

// cpvp
modes.cpvp_mode = 0

// 长跳
var lj_len = 5
var lj_y = 0.5

// 自定义kb
var ckb_len = 1
var ckb_y = 0.5

// 自动发言
var spm_text = "NoveXare YYDS"
var spm_delay = 20
var spm_random = false
var spm_gradual = false
var spm_rainbow = false
var spm_attack = false
var spm_file = false
var spm_count = 1

// 冲刺
var rush_length = 5

// 快速建造
var fb_len = 4
var fb_delay = 10
var fb_t = 0
var fb_list = []
var fb_success = true

// 摇杆
var rc_speed = 8
var rc_lock = 3.0
var rc_follow = true
var rc_bhop = true
var rc_ahop = false
var rc_legal = true
var rc_antiair = true
modes.rocker_mode = 0
modes.rc_mode = 0
var rc_surround = true
var rc_dist = 1.5
var rc_angles = {}
var rc_directions = {}
var rc_uds = {}
var rc_relative = true
var rc_range = 180
var rc_roll = 0
var rc_yaw = getEntityRot(self_id).yaw
var rc_pitch = 180 - (getEntityRot(self_id).pitch + 90)
var Camera_anchor_pos = {
    x: 0,
    y: 0,
    z: 0
}
var rc_boost = false
var rc_y = 0.42

// 传送目之所及
modes.LookTP_mode = 0

// 点击破坏方块
var bk_bed = true
var bk_chest = true
var bk_tool = false
var bk_range = 5
var bk_last = 1
var bk_pos = null
var bk_timer = 0
var bk_up = false
var bk_action = false
var bk_auth = false
var cd_packet = false
var bk_auto = false
var bk_origin = false

// 自动自救
var as_fake = false
var as_near = false
var as_keep = true
var as_block = true
var as_water = false
var as_minY = -0.42

// 攻击粒子
var ap_count = 20
var ap_offset = 12
var ap_type = 3
var ap_crit = false
var ap_density = 10
var ap_random_slope = false
var ap_sb_slope = 15
var ap_sb_space = 3
var ap_sb_dist = 2
var ap_sb_count = 10
var ap_slashblade = false

// 目标粒子
var tp_size = 1
var tp_type = 0

// 信息显示
var click_num = 0
var click_t = 0
var isClicking = false
var ka_show = true
var attack_tick = 0
var attack_ticks = 0
var isAttacking = false
var attack_frequency = 0
var real_attack = 0
var last_attack_target = []
var show_real_aps = false
var show_pos = false
var show_item = false
var show_speed = false
var show_attack_rate = false
var show_ping = false
var show_detail_item = false
var show_self_health = false
var show_resources = false
var show_time = true
var show_kill_num = false
var show_real_time = false

// 自动围床
var ab_running = false

// 弓箭追踪
var tt_speed = 0.5

// 弓箭粒子
var arp_type = 12

// 躲避投掷物
modes.avoid_mode = 0
var at_range = 5.00

// 箱子小偷
var cs_delay = 0
var cs_close = false
var cs_maxCount = 36
var cs_current = 0
var cs_tick = 1
var cs_timer = 1
var cs_slot = 0
var cs_sort = true
var cs_max = 35
var cs_min = 0
var cs_min_damage = 0
var cs_min_lasting = 0
var cs_weapon = true
var cs_armor = true
var cs_other = true
var cs_white = []
var cs_black = ['planks', 'stone', 'apple', 'ender', 'sword', 'helmet', 'leggings', 'chestplate', 'boots', 'totem']

// 目标信息记录
var ri_click = false
var ri_save = false

// 自动战斗
var fb_legal = false
var fb_seek = 4.00
var fb_moveSpeed = 5
var fb_heal = 0
var fb_jump = false
var fb_ka = true
var fb_aa = false
var fb_kd = false
var fb_combo = false
var fb_y = 0.42
var fb_sca = false
var fb_chest = false
var fb_jumpRate = 33
var fb_moveRate = 33
var fb_fishRate = 0
var fb_snowRate = 0
var fb_randJump = false
var fb_randMove = false
var fb_weapon = false

// 自定义时间
var mt_custom = 25
var mt_speed = 20
modes.mt_time = 0

// 自动跳跃
var aj_y = 42

// 反击退
var akb_hor = 100
var akb_y = 100
var akb_rare = 100

// 投掷物轨迹显示
var tr_g = 20
var tr_speed = 100
var tr_len = 200
var tr_type = 56
var tr_offset = 20
var tr_show = true
var tr_dens = 10
modes.tr_mode = 0

// 低血量操作
var ad_sword = false

// 自我掉帧
var fpsr_rate = 10

// 灵活移动
var fb_speed = 5

// 自定义物品
modes.custom_mode = 0
var ci_slot = 0

// 伪造提示
modes.fakeTip_mode = 0
var current_poem = ""
var tip_t1 = 201

// 平衡变速
var BalanceTimer_t = 0
var BalanceTimer_st = false

// 变化量显示
var sv_player = false
var sv_id = false

// 挥刀修改
var ms_speed = 0

// 音效管理
var sm_attack = false
var sm_destroy = false
var sm_build = false
var sm_hurt = false
var sm_switch = false
var sm_kill = false

// 弓箭视角
var av_x = 10
var av_z = 10
var av_y = 10
var av_id = null
var av_list = []

// 摄像机管理
var cm_x = 25
var cm_y = 25
var cm_z = 25
var cm_pitch = 90
var cm_anchor_y = 15
var cm_roll = 0
var cm_unlock = false
var cm_pos = {
    x: 0,
    y: 0,
    z: 0
}
var cm_moverange = 5
var cm_editanchor = false
var cm_actioncamera = false
var cm_follow = false
var cm_ts_delay = 1
var cm_attack = null
var cm_transfer = false
var cm_id = self_id

// 安全攻击
var sa_fov = 50
var sa_size = 0.8
var sa_range = 4.00

// 玩家旋转
var dp_pitch = 90
var dp_yaw = -180
modes.derp_mode = 0
var dp_bodySpeed = 30
var dp_headSpeed = 5
var dp_head = false
var dp_body = true
var dp_lock = true
var dp_random = false

// 测试功能
var TestModule = false

// 连点器
var ac_min = 10
var ac_aimed = false
var ac_fov = 15
var ac_max = 10
var ac_t_1 = 0
var ac_excludeY = false
var ac_click = false
var ac_use = false
var ac_times = false
var ac_t_2 = -Infinity

// 穿透飞行
var nc_depart = false
var nc_bypass = true
var nc_dist = 15
var nc_blink = true
var nc_pos = {}

// Sauth登录
var sl_hook = false
var Sauths = getData('sauths', '')

// 自定义封号
var bantip = ""

// 玩家行为管理
var am_count = 1
var am_id = 0
var am_value = 0
var am_delay = 0
var am_tick = 0
var am_file = false

// 玩家授权认证管理
var pam_delay = 1
var pam_id = 0
var pam_value = 0
var pam_array = [0]
var pam_count = 1

// 智能队友
var teams_name = false
var teams_armor = true
var teams_blur = false
var teams_self = {}
var teams_slot = 0

// 仇恨编辑器
var te_all = false
var te_two = false
var te_target = null

// 方块编辑器
var btc_pos = null

// 实体NBT复制
var enc_target = null

// 骑乘编辑器
var re_cancel = false

// 随机功能列表
var ral_length = 5
var ral_num = 3

// 慢动作
var sm_speed = 10
var sm_circulate_last_tick = 20
var sm_onhurt = false
var sm_onhit = false
var sm_onkill = false
var sm_circulate_tick = 60
var sm_circulate_t = 0
var sm_circulate = false
var sm_status = false

// 伪造聊天
var fc_target = ''

// 伪造悄悄话
var fw_target = ''

// 绘制椭圆
var do_density = 20
var do_s_axis = 1
var do_l_axis = 1
var do_pos = [0, 0, 0]
var do_delay = 100
var do_jump = true
var do_lock = true
var do_cycle = false

// 物品旋转
var ir_move = false
var ir_min = 0
var ir_max = 360
var ir_speed = 1
var ir_angle = 0
var ir_isBack = false

// 自动穿装
modes.aa_mode = 0
var aa_delay = 2
var aa_times = 1
var aa_inv = false
var aa_chest = false

// 小地图
var sm_proportion = 5
var sm_size = 100
var sm_entity = false
var sm_target = true
var sm_player = false

// 反文本爆炸
var at_max_text = 5
var at_max_time = 20
var at_current = 0
var at_tick = 0

// 随机传送
var rt_target = false
var rt_y = false
var rt_delay = 10
var rt_range = 5

// 爬墙
var sp_speed = 5

// 受击卡空
var as_time = 20
var as_time_t = 21

// 攻击嘲讽
var am_text = '是不是'

// 目标信息
var th_head = 'PLC·公安部全国人口信息库'
var th_dist = true
var th_pos = false
var th_effect = false
var th_carry = true
var th_health = true
var th_name = true
modes.th_health_mode = 0
modes.th_select_mode = 0
var th_x = 60
var th_y = 40
var th_a = 0
var th_size = 1.00
var th_r = 100
var th_g = 100
var th_b = 100
var th_target = null
var th_tick = 0
var th_id = createText('', 'Center', th_x, th_y)
const EffectsEnum = [
    "无效果", // 0
    "速度", // 1
    "缓慢", // 2
    "急迫", // 3
    "挖掘疲劳", // 4
    "力量", // 5
    "瞬间治疗", // 6
    "瞬间伤害", // 7
    "跳跃提升", // 8
    "反胃", // 9
    "生命恢复", // 10
    "抗性提升", // 11
    "防火", // 12
    "水下呼吸", // 13
    "隐身", // 14
    "失明", // 15
    "夜视", // 16
    "饥饿", // 17
    "虚弱", // 18
    "中毒", // 19
    "凋零", // 20
    "生命提升", // 21
    "吸收", // 22
    "饱和", // 23
    "发光", // 24
    "飘浮", // 25
    "幸运", // 26
    "霉运", // 27
    "缓降", // 28
    "潮涌能量", // 29
    "海豚的恩惠", // 30
    "不祥之兆", // 31
    "村庄英雄" // 32
];

// 无隐身玩家
var nh_exclude = false

// 锁定本体
var fm_auto = false
var fm_cycle = 20
var fm_range = -1
var fm_item = false
var fm_pos = null

// 阴影爆破
var sb_length = 1
var sb_offset = 0
var sb_ud = 0
var sb_exclude = true
var sb_hide = false
var sb_tick = 5
modes.sb_mode = 0
var sb_pos = null
var sb_rot = false
var sb_custom = false
var sb_rc_yaw = 0

// 被打还击
var fb_attack = 1
var fb_ishurt = false
var fb_range = 7
modes.fb_mode = 0

// 死亡墓碑
var dc_pos = []

// 无液体减速
var nl_offset = 1

// 移除器
var rmer_item = false
var rmer_entity = false

// 管理员显示
var as_range = 20

// 消息提示
modes.tipType_mode = 0
var tip_x_offset = 60
var tip_y_offset = 40
var tip_size = 1.00
var tip_a = 0
var tip_r = 100
var tip_g = 100
var tip_b = 100
var tip_id = createText('', 'Center', tip_x_offset, tip_y_offset)

// 弹幕通知
var bn_max = 5
var bn_min = 5
var bn_rainbow = false
var bn_gradual = false
var bn_range = 50
var bn_exclude = false
var bn_intercept = false
var bn_format = '[名字]: [消息]'
var bn_list = []

// 反瞄准
var aaim_rot = false
var aaim_dist = 4
var aaim_fov = 30
var aaim_hurt = false
var aaim_speed = 5
var aaim_states = false

// 种地光环
var fa_range = 3

// 方向渲染
var dr_space = 3
var dr_num = 3
var dr_move = true
var dr_rot = true

// 智能武器
var sw_enchant = true
var sw_texture = true
var sw_open = true
modes.sw_mode = 0

// 砂狼白子光环
var sa_inner = 0.6
var sa_outer = 0.8
var sa_length = 0.6
var sa_density = 3
var sa_offset = 18

// 租赁服传送
var isTP = false
var st_offset = 2
var st_tp = true

// 药效管理
var em_eff = false
var em_nv = true
var em_level = 1

// 按键管理
var sb_interact = false
var sb_long = false
var sb_back = false
var sb_click = false
var sb_right = false
var sb_forward = true
var sb_left = false
var sb_list = []

// 移动水印
var mwm_speed = 5
var mwm_text = 'NoveXare'
var mwm_size = 0.8
var mwm_pos = [getRand(0, nx_screen.screenWidth), getRand(0, nx_screen.screenHeight)]
var mwm_id = createText('', 'Center', mwm_pos[0], mwm_pos[1])
var mwm_vector = [getRand(-1, 1), getRand(-1, 1)]

// 功能列表
var AutoTrap = false
var ECAttack = false
var Swing = true
var BlockClicker = false
var ReplaceMsg = false
var FuncMessage = true
var KillAura = false
var AutoTarget = true
var FuncTip = true
var vec_bhop = false
var Velocity = false
var AutoDo = false
var ClickTarget = false
var ClickWhiteList = false
var AutoClicker = false
var NoLiquid = false
var ShowTargetList = false
var Rider = false
var ShowInfo = false
var Jesus = false
var Teams = false
var AssistAim = false
var ClickTeam = false
var AssAssInate = false
var Surround = false
var JetPack = false
var Trace = false
var Suspend = false
var InfiniteAura = false
var GodMode = false
var Fly = false
var SafeWalk = false
var KillMessage = false
var Sucker = false
var Scaffold = false
var SlowDown = false
var AirJump = false
var KeepDistance = false
var Crasher = false
var HitBox = false
var PauseNX = false
var InvCleaner = false
var LongJump = false
var AntiVoid = false
var CustomKB = false
var SmartWeapon = false
var PyRpcManager = false
var Spammer = false
var Derp = false
var AttackSelf = false
var ResShop = false
var AutoSave = false
var AutoSaveCfg = false
var AutoLoadCfg = false
var FastBuild = false
var RecordInfo = false
var NoFall = false
var Rocker = false
var ShowHurt = false
var Breaker = false
var FreeCam = false
var AutoBed = false
var TargetParticle = false
var SurroundParticle = false
var ClickDestroy = false
var AutoDestroy = false
var AutoCrystal = false
var AutoAnchor = false
var AvoidAttack = false
var AttackRender = false
var ThrowTracer = false
var ThrowFly = false
var ArrowView = false
var CrystalAura = false
var ArrowParticle = false
var Remover = false
var NoHider = false
var FarmAura = false
var DropRes = false
var PlayerAuthInputPacket = false
var PVPDaLao = false
var ActivitySender = false
var ShowClickBlock = false
var SmartInv = false
var AttackAim = false
var FakeLag = false
var DeathInfo = false
var LocalRespawn = false
var AttackParticle = false
var AutoVoid = false
var Hover = false
var ChestAura = false
var ShowPressKey = false
var ShowUpliftKey = false
var ShowClientMessage = false
var ShowUI = false
var ShowCommand = false
var ShowCommandOutput = false
var WorldPlayerInfo = false
var TargetHealth = false
var RainbowTip = false
var RandomDrop = false
var RandomSelect = false
var OtherUser = false
var AvoidThrow = false
var Miner = false
var ChestStealer = false
var Criticals = false
var FightBot = false
var AttackSound = false
var SoundPlayer = false
var InteractAura = false
var FPSReducer = false
var ChatManager = false
var AvoidInvalid = false
var CheckAxe = false
var NoAnyReceive = false
var AutoJump = false
var AntiKB = false
var TrajectoryRender = false
var KickAura = false
var HotbarSelector = false
var AutoSelect = false
var AutoArmor = false
var AutoGG = false
var LineParticle = false
var FlexibleMove = false
var AntiStaff = false
var FakeBuilder = false
var ClickBlock = false
var FakeTip = false
var FakeWhisper = false
var FakeChat = false
var BalanceTimer = false
var ShowVariable = false
var ShowDestroyBlock = false
var ClickTP = false
var EffEctManager = false
var ModifySwing = false
var ModifyTime = false
var ShowGameInfo = false
var ShowEntityAnime = false
var ChunkRender = false
var ChatSuffix = false
var FakeMove = false
var AutoShifter = false
var ActionManager = false
var PlayerAuthManager = false
var FunnyKill = false
var LockPerson = false
var NoDebuff = false
var ShortList = false
var getDelay = false
var MoveJump = false
var SafeAttack = false
var FastStop = false
var HurtJump = false
var FakeMotion = false
var GetCommand = false
var ShowReceivePacket = false
var ShowSendPacket = false
var ArrayList = true
var NoCamShake = false
var DumpResponseSauth = false
var DumpCookieSauth = false
var DumpRequestSauth = false
var AutoPot = false
var SpinAttack = false
var NoWall = false
var TargetEdit = false
var RiderEdit = false
var InfinityExp = false
var NoHunger = false
var CameraManager = false
var SoundManager = false
var ClickSwing = false
var FuncSwitchTip = true
var ClickRot = false
var CustomItem = false
var EntityNBTCopy = false
var BlockTagCopy = false
var DeleteDummy = false
var BJDEscape = false
var AutoCamera = false
var RandomArrayList = false
var SlowMotion = false
var DeviceShake = false
var DrawOval = false
var ItemRotation = false
var ShowNXInfo = true
var NoClip = false
var SmallMap = false
var AntiText = false
var RandomTP = false
var AirStuck = false
var Spider = false
var AttackMessage = false
var TimePause = false
var TargetHud = false
var ShadowBoomer = false
var FightBack = false
var ShowMoveContainer = false
var AutoSwing = false
var DeadCross = false
var AdminShow = false
var getSelf = 100
var setPos_offset = 0
var getPos_offset = 0
var BulletNotice = false
var ShowScreenHud = false
var AntiAim = false
var DirectRender = false
var ShirokoAura = false
var SimulateButton = false
var MobileWaterMark = false
var AutoTool = false
var NoSlowDown = false

function onTickEvent() {
    _nxTickMark();
    nxJumpTick();
    nxHurtResetTick();
    nxFightBackTick();
    // 获取数据
    try {
        if (PauseNX) return;
        let message = []

        self_id = getLocal(otherId)
        self_pos = getPos(self_id)
        prev_pos = getEntityPosPrev(self_id)
        teams_self = nbt2object(getPlayerArmorItem(self_id, teams_slot))
        let self_heal = getEntityAttribute(self_id, 'minecraft:health')
        let self_motion = getEntityMotion(self_id)
        self_moving = (getEntityFlag(self_id, 34) || typeof rc_angles.angle !== 'undefined')
        if (FastStop && !self_moving) setMotion(0, self_motion.y, 0)
        let Camera_rot = getCameraRotation()
        let self_rot = {
            yaw: Camera_rot.yaw > 0 ? 180 - Camera_rot.yaw : -180 - Camera_rot.yaw,
            pitch: -Camera_rot.pitch
        }
        let bps = getDistance(self_pos, prev_pos) / 0.05
        let bps_hor = getHorizontalDistance(self_pos, prev_pos) / 0.05
        let bps_mot = getSpeed(self_id)
        let block_pos = getEntityBlockPos(self_id)
        let world_player_list = getWorldPlayerList()

        let on_ground = getEntityIsGround(self_id)
        let current_hud = getScreenName()
        if (ticks % getSelf == 0) {
            if (getDelay) {
                gd_ping1 = Date.now()
                _https.get('https://www.baidu.com', {}, (r, d) => globalThis.gd_ping2 = Date.now())
                gd_ping = Math.abs(gd_ping2 - gd_ping1)
            }
        }
        self_item = getCarried(self_id)
        // 基本功能
        if (self_heal.current - prev_heal > 8) {
            if (DeathInfo) makeMsg(0, 'Tip', `You are Dead - DeathPos: ${Math.round(death_pos.x)}, ${Math.round(death_pos.y)}, ${Math.round(death_pos.z)}`, '§r')
            if (LocalRespawn) setTimeout(() => {
                _camera.departCamera()
                setTimeout(() => setPos(death_pos.x + getRand(-lr_random + 1, lr_random - 1), death_pos.y, death_pos.z + getRand(-lr_random + 1, lr_random - 1)), 100)
                setTimeout(() => _camera.resetCamera(), 200)
            }, 50 * lr_delay)
            if (DeadCross) dc_pos.push(death_pos)
        } else if (self_heal.current < prev_heal) death_pos = self_pos

        if (ShowScreenHud) makeMsg(0, 'Tip', '当前所处屏幕: ' + getScreenName(), '§r')

        if (DeadCross) dc_pos.forEach(pos => {
            sendShadow(pos.x, pos.y, pos.z)
            sendShadow(pos.x, pos.y + 1, pos.z)
            sendShadow(pos.x, pos.y + 2, pos.z)
            sendShadow(pos.x + 1, pos.y + 2, pos.z)
            sendShadow(pos.x - 1, pos.y + 2, pos.z)
            sendShadow(pos.x, pos.y + 3, pos.z)
        })

        if (AdminShow) {
            let admins = world_player_list.filter(player => (player.permissionLevel === as_level || player.commandPermissionLevel === as_level))
            if (admins.length > 0) message.push(makeMsg(1, 'Admin', '服务器管理员: ' + obj2str(admins.map(player => player.name)), '§r'))
            let warns = admins.filter(player => getDistanceByID(player.id, self_id) < as_range)
            if (warns.length > 0) message.push(makeMsg(1, 'Warn', '附近' + as_range + '格管理员: ' + obj2str(warns.map(player => player.name)), '§r'))
        }
        if (AutoTarget && (!at_lock || !findEntity(at_lists[0])) && ticks % at_delay == 0) at_lists = getTargets(self_id);

        if (NoHider) {
            const list = getPlayerList()
            list.forEach(id => {
                if (id != self_id) {
                    removeEntityEffect(id, 14)
                    setEntityFlag(id, 5, false)
                    if (nh_exclude && at_lists.includes(id)) at_lists.splice(at_lists.indexOf(id), 1)
                }
            })
        }

        if (BJDEscape && getBlock(block_pos.x, block_pos.y - 1, block_pos.z).namespace === 'minecraft:glass' && on_ground) setPos(self_pos.x, self_pos.y - 6, self_pos.z)

        if (AutoSwing) swingArm()

        if (AutoCamera) {
            if (_options.getPlayerViewPerspective() === 0) _camera.resetCamera()
            else _camera.departCamera()
        }

        if (Criticals) silentMove(self_pos.x, self_pos.y + 100, self_pos.z, {
            x: 0,
            y: -1,
            z: 0
        })

        if (SpinAttack) setEntityFlag(self_id, 56, true)

        if (RandomTP && ticks % rt_delay === 0 && (!rt_target || at_lists.length > 0)) {
            const pos = rt_target ? getPos(at_lists[0]) : self_pos
            if (pos) setPos(pos.x + getRand(-rt_range, rt_range), pos.y + (rt_y ? getRand(-rt_range, rt_range) : 0), pos.z + getRand(-rt_range, rt_range))
        }

        if (NoWall) setEntityFlag(self_id, 48, false)

        if (AutoClicker && ac_t_1 - ac_t_2 >= 0) {
            let ac_num = getRand(ac_min, ac_max)
            let delay = Math.round(1000 / ac_num)
            const Aimed = (at_lists.length > 0) ? (isAimed(self_id, at_lists[0], ac_fov, 0) || !ac_aimed) : !ac_aimed
            for (let i = 0; i < ac_times; i++) {
                if (!Aimed) break
                if (ac_click) simulateClick()
                if (ac_use) useItem()
            }
            ac_t_2 = ac_t_1 + delay
        }
        ac_t_1 = Date.now()

        if (FakeMotion && ticks % fm_cycle === 0 && fm_item) {
            const list = getEntityList().forEach(id => {
                if (getEntityNamespace(id) != 'minecraft:item' || !findEntity(id) || (getDistanceByID(id, self_id) > fm_range && fm_range != -1)) return
                const pos = getPos(id)
                silentMove(pos.x, pos.y, pos.z)
            })
        } else if (FakeMotion && ticks % fm_cycle === 0 && fm_pos && !fm_item) sendPlayerAuthInput({
            pos: fm_pos,
            rot: self_rot,
            inputMode: 2,
            playMode: 0,
            yHeadRot: self_rot.yaw
        })

        if (CustomItem) {
            const item = getEntityCarriedItem(self_id)
            if (modes.custom_mode < 4) setPlayerArmorItem(self_id, modes.custom_mode, item)
            else if (modes.custom_mode === 4) setEntityOffhandItem(self_id, item)
            else if (modes.custom_mode === 5) setPlayerInventoryItem(self_id, ci_slot, item)
        }

        if (ShadowBoomer && ticks % sb_tick == 0) {
            let list = []
            if (modes.sb_mode == 0) list = getPlayerList()
            if (modes.sb_mode == 1) list = at_lists
            if (modes.sb_mode == 2) list = ['lock_pos']
            list.forEach(id => {
                if (sb_exclude && id == self_id) return;
                let target_pos = null
                if (id == 'lock_pos') target_pos = sb_pos
                else target_pos = getEntityBlockPos(id)
                if (!target_pos) return
                let erot = getEntityRot(id)
                if (modes.sb_mode < 2) {
                    target_pos = calDisplacement(sb_offset, target_pos, erot)
                    target_pos.y += sb_ud
                }
                if (sb_custom) {
                    const data = JSON.parse(readFile(nx_paths + '/Shadow.json'))
                    data.forEach(pos => {
                        let dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z)
                        let angle_yaw = getPlayerAngle({
                            x: 0,
                            y: 0,
                            z: 0
                        }, pos, "yaw_pos")
                        let angle_pitch = getPlayerAngle({
                            x: 0,
                            y: 0,
                            z: 0
                        }, pos, "pitch_pos")
                        let offset_pos = calDisplacement(dist, {
                            x: 0,
                            y: 0,
                            z: 0
                        }, {
                            pitch: angle_pitch,
                            yaw: (angle_yaw + sb_rc_yaw)
                        })
                        sendShadow(target_pos.x + offset_pos.x, target_pos.y + offset_pos.y, target_pos.z + offset_pos.z)
                    })
                } else {
                    for (let dx = Math.ceil(-sb_length / 2); dx < Math.floor(sb_length / 2 + 1); dx++) {
                        for (let dy = Math.ceil(-sb_length / 2); dy < Math.floor(sb_length / 2 + 1); dy++) {
                            for (let dz = Math.ceil(-sb_length / 2); dz < Math.floor(sb_length / 2 + 1); dz++) {
                                sendShadow(target_pos.x + dx, target_pos.y + dy + 2, target_pos.z + dz)
                            }
                        }
                    }
                }
            })
        }
        if (sb_rc_yaw < 180) sb_rc_yaw += sb_rot
        else sb_rc_yaw = -180

        if (SmallMap) {
            let map_array = [
                ['  ', '  ', '  ', '  ', '   ', '│', '   ', '  ', '  ', '  ', '  '],
                ['  ', '  ', '  ', '  ', '   ', '│', '   ', '  ', '  ', '  ', '  '],
                ['  ', '  ', '  ', '  ', '   ', '│', '   ', '  ', '  ', '  ', '  '],
                ['  ', '  ', '  ', '  ', '   ', '│', '   ', '  ', '  ', '  ', '  '],
                ['  ', '  ', '  ', '  ', '   ', '│', '   ', '  ', '  ', '  ', '  '],
                ['一', '一', '一', '一', '一', '十', '一', '一', '一', '一', '一'],
                ['  ', '  ', '  ', '  ', '   ', '│', '   ', '  ', '  ', '  ', '  '],
                ['  ', '  ', '  ', '  ', '   ', '│', '   ', '  ', '  ', '  ', '  '],
                ['  ', '  ', '  ', '  ', '   ', '│', '   ', '  ', '  ', '  ', '  '],
                ['  ', '  ', '  ', '  ', '   ', '│', '   ', '  ', '  ', '  ', '  '],
                ['  ', '  ', '  ', '  ', '   ', '│', '   ', '  ', '  ', '  ', '  ']
            ]
            let list = []
            if (sm_player) list.push(...getPlayerList())
            if (sm_entity) list.push(...getEntityList())
            if (sm_target) list.push(...at_lists)
            list.forEach(id => {
                let yaw = getPlayerAngle(self_id, id, "yaw_rot");
                let dist = getDistanceByID(self_id, id);
                let x = Math.floor(dist / sm_size * sm_proportion * -Math.sin(yaw * Math.PI / 180) * 10)
                let y = Math.floor(dist / sm_size * sm_proportion * -Math.cos(yaw * Math.PI / 180) * 10)
                if (x > 5) x = 5
                if (y > 5) y = 5
                if (x < -5) x = -5
                if (y < -5) y = -5
                map_array[y + 5][x + 5] = ' §e◆§r '
            })
            let output_map = map_array.map(l => l.join('')).join('\n')
            message.push(makeMsg(1, 'Map', '\n' + output_map, '§r'))
        }
        if (ShirokoAura) {
            for (let i = 0; i < 360; i += sa_density) {
                const inner_x = sa_inner * Math.cos(i * Math.PI / 180)
                const inner_y = sa_inner * Math.sin(i * Math.PI / 180)
                createParticle(26, self_pos.x + inner_x, self_pos.y + sa_offset / 10, self_pos.z + inner_y, 1)
                const outer_x = sa_outer * Math.cos(i * Math.PI / 180)
                const outer_y = sa_outer * Math.sin(i * Math.PI / 180)
                createParticle(26, self_pos.x + outer_x, self_pos.y + sa_offset / 10, self_pos.z + outer_y, 1)
            }
            for (let j = 0; j < sa_length; j += (sa_density / 10)) {
                let forward = calDisplacement(j + sa_outer, self_pos, {
                    yaw: self_rot.yaw,
                    pitch: 0
                })
                let left = calDisplacement(j + sa_outer, self_pos, {
                    yaw: 90 + self_rot.yaw,
                    pitch: 0
                })
                let right = calDisplacement(j + sa_outer, self_pos, {
                    yaw: -90 + self_rot.yaw,
                    pitch: 0
                })
                let back = calDisplacement(j + sa_outer, self_pos, {
                    yaw: self_rot.yaw + 180,
                    pitch: 0
                })
                createParticle(26, forward.x, self_pos.y + sa_offset / 10, forward.z, 1)
                createParticle(26, back.x, self_pos.y + sa_offset / 10, back.z, 1)
                createParticle(26, left.x, self_pos.y + sa_offset / 10, left.z, 1)
                createParticle(26, right.x, self_pos.y + sa_offset / 10, right.z, 1)
            }
        }

        if (CameraManager) {
            if (cm_roll > 0) setCameraRotation(90, 0, cm_roll)
            if (cm_id === self_id) setCameraAnchor(0, (cm_anchor_y - 15) / 5, 0)
            else {
                const target_pos = getPos(cm_id)
                const target_size = getEntitySize(cm_id)
                setCameraAnchor(target_pos.x - self_pos.x, target_pos.y - self_pos.y + 0.85 * target_size.y, -target_pos.z + self_pos.z)
            }
            if (cm_attack != null) {
                const target_pos = getPos(cm_attack)
                const target_size = getEntitySize(cm_attack)
                if (target_pos && target_size) setCameraAnchor(target_pos.x - self_pos.x, target_pos.y - self_pos.y + 0.85 * target_size.y, -target_pos.z + self_pos.z)
            } else if (cm_actioncamera) setCameraAnchor(-self_motion.x * cm_moverange, -self_motion.y * cm_moverange, self_motion.z * cm_moverange)
            else setCameraAnchor(0, (cm_anchor_y - 15) / 5, 0)
            setCameraOffset(cm_x / 3, cm_y / 3, cm_z / 3)
            setCameraPitchLimit(-cm_pitch, cm_pitch)
            if (!cm_unlock) cm_pos = self_pos
            if (cm_unlock) setCameraAnchor(cm_pos.x - self_pos.x, cm_pos.y - self_pos.y, -cm_pos.z + self_pos.z)
        }

        if (self_heal.current < prev_heal) prev_heal = self_heal.current

        if (NoDebuff) debuff.forEach(id => removeEntityEffect(self_id, id))

        if (MoveJump && self_moving && on_ground) playerJump()

        if (ChunkRender) {
            let chunk_pos = {
                x: Math.floor(self_pos.x / 16),
                z: Math.floor(self_pos.z / 16)
            }
            let chunk_start = {
                x: chunk_pos.x * 16,
                z: chunk_pos.z * 16
            }
            let chunk_end = {
                x: (chunk_pos.x + 1) * 16,
                z: (chunk_pos.z + 1) * 16
            }
            for (let i = 0; i < 16; i++) {
                createParticle(56, chunk_start.x + i, self_pos.y, chunk_start.z, 1)
                createParticle(56, chunk_start.x, self_pos.y, chunk_start.z + i, 1)
                createParticle(56, chunk_end.x - i, self_pos.y, chunk_end.z, 1)
                createParticle(56, chunk_end.x, self_pos.y, chunk_end.z - i, 1)
            }
            message.push(makeMsg(1, 'Chunk', "区块坐标: " + chunk_pos.x + '， ' + chunk_pos.z, '§r'))
        }

        if (AutoGG) {
            for (let i of gg_list) {
                if (modes.gg_mode === 0) dropPlayerInventorySlot(self_id, getItemSlot(self_id, i, -1, '一局'), false, true)
                if (modes.gg_mode === 1) {
                    selectPlayerInventorySlot(self_id, getItemSlot(self_id, i, -1, '一局'))
                    const carried = getCarried(self_id)
                    if (carried.name.includes("一局")) useItem()
                }
            }
        }

        if (nx_goal != null) {
            const d1 = getHorizontalDistance(self_pos, nx_goal)
            const d2 = getDistance(self_pos, nx_goal)
            if (d2 >= 5) {
                let yaw = getPlayerAngle(self_id, nx_goal, "yaw_pos")
                let goal_pos = calDisplacement(-nx_goalSpeed / 10, self_pos, {
                    yaw,
                    pitch: 0
                })
                if (d1 >= 3) setMotion(goal_pos.x - self_pos.x, self_motion.y, goal_pos.z - self_pos.z)
                else setMotion(self_motion.x, ((goal_pos.y - self_pos.y) > 0 ? nx_goalSpeed : -nx_goalSpeed) / 10, self_motion.z)
            } else {
                nx_goal = null
                makeMsg(0, 'Tip', '已到达设置目的地', '§r')
            }
        }

        if (RandomArrayList) {
            for (let i = 0; i < ral_num; i++) {
                const Random = randomStr(ral_length)
                addCustomArrayList('RandomArrayList' + i, Random, Random, true)
            }
        }

        if (ChestAura) {
            let mp = getEntityBlockPos(self_id)
            let len = ca_range
            for (let dx = -len; dx < len; dx++) {
                for (let dy = -len; dy < len; dy++) {
                    for (let dz = -len; dz < len; dz++) {
                        if (ca_check && current_hud.includes('chest_screen') && chestStates.packet && chestStates.click) {
                            chestStates.click = false
                            chestStates.packet = false
                        }
                        const block = getBlock(mp.x + dx, mp.y + dy, mp.z + dz)
                        if (block.namespace != "minecraft:chest") continue;
                        const block2 = getBlock(mp.x + dx, mp.y + dy + 1, mp.z + dz)
                        const ca_chest_pos_str = {
                            x: mp.x + dx,
                            y: mp.y + dy,
                            z: mp.z + dz
                        }
                        if ((ca_chest_pos.includes(JSON.stringify(ca_chest_pos_str)) && ca_exclude) || !checkWall(mp, ca_chest_pos_str, ca_wall, 1.53, 0.5) || (ca_block && block2.namespace != "minecraft:air") || !isAimed(self_id, ca_chest_pos_str, ca_fov, 0) || current_hud.includes('chest_screen')) break;
                        buildBlock(self_id, mp.x + dx, mp.y + dy, mp.z + dz, 1)
                        if (!ca_check || (chestStates.packet && chestStates.click)) ca_chest_pos.push(JSON.stringify(ca_chest_pos_str))
                    }
                }
            }
        }

        if (AntiStaff) {
            world_player_list.forEach(player => {
                const {
                    name,
                    id
                } = player
                if (id === self_id || name === "") return;
                let hasStaff = null
                if (modes.as_mode === 0 && (!name.includes('§') || !name.includes('[') || !name.includes(']')) && !name.includes('锭') && !name === "村民") hasStaff = id
                if (modes.as_mode === 1 && ((name.includes('管') && name.includes('理') && name.includes('员')) || name.includes('管理员'))) hasStaff = id
                if (modes.as_mode === 2) {
                    as_config.forEach(cfg => {
                        if (cfg.match_mode === "精准" && cfg.has_mode === "存在" && cfg.texts.some(text => name === text) != cfg.reverse_selection) hasStaff = id
                        if (cfg.match_mode === "精准" && cfg.has_mode === "同时" && cfg.texts.every(text => name === text) != cfg.reverse_selection) hasStaff = id
                        if (cfg.match_mode === "模糊" && cfg.has_mode === "存在" && cfg.texts.some(text => name.includes(text)) != cfg.reverse_selection) hasStaff = id
                        if (cfg.match_mode === "精准" && cfg.has_mode === "存在" && cfg.texts.every(text => name.includes(text)) != cfg.reverse_selection) hasStaff = id
                    })
                }
                if (modes.as_mode === 3) hasStaff = id
                if (as_hide && !getEntityFlag(id, 5)) hasStaff = null
                if (as_ground && getEntityIsGround(id)) hasStaff = null
                if (hasStaff === null) return;
                if (modes.anti_mode === 0) makeMsg(0, 'Tip', '可能存在协管: ' + name, '§r')
                else if (modes.anti_mode === 1) executeCommand('/hub')
                else if (modes.anti_mode === 2) executeCommand('/again')
                else if (modes.anti_mode === 3) message.push(makeMsg(1, 'Staff', '可能存在协管: ' + name, '§r'))
                else if (modes.anti_mode === 4) _world.leaveWorld()
            })
        }

        if (InteractAura) at_lists.forEach(id => interactEntity(id))

        if (InfinityExp) setEntityAttribute(getLocalPlayerUniqueID(), 'minecraft:player.level', {
            current: 32767
        })

        if (NoHunger) setEntityAttribute(getLocalPlayerUniqueID(), 'minecraft:player.hunger', {
            current: 20
        })

        if (cm_transfer && cm_attack != null && ticks % (cm_ts_delay * 20) === 0) cm_attack = null

        if (LockPerson) _options.setPlayerViewPerspective(modes.person_mode)

        if (ShowVariable) {
            if (sv_player && last_world_player.length != world_player_list.length) {
                makeMsg(0, 'Tip', "玩家数量发生变化 " + last_world_player.length + ' => ' + world_player_list.length, '§r')
                last_world_player = world_player_list
            }
            if (sv_id && self_id != prev_id) makeMsg(0, 'Tip', "玩家本地ID发生变化 " + prev_id + ' => ' + self_id, '§r')
        }

        if (CheckAxe && ticks % ca_delay === 1) {
            let list = []
            world_player_list.forEach(id => {
                if (modes.ca_mode == 0 && getItemDamage(id.id, -1) > 20) list.push(getEntityName(id.id))
                if (modes.ca_mode == 1 && getEntityMaxDamage(id.id) > 20) list.push(getEntityName(id.id))
            })
            if (list.length > 0) message.push(makeMsg(1, 'Axe', "下列玩家背包存在秒人斧:" + obj2str(list), '§r'))
        }

        if (WorldPlayerInfo && last_world_player.length != world_player_list.length) {
            const world_name = world_player_list.map(player => player.name)
            let changed_player_list = arrayDedup(last_world_player, world_name)
            let comparison = last_world_player.length < world_name.length
            if (comparison) makeMsg(0, 'Tip', obj2str(changed_player_list) + "进入了世界", '§r')
            else makeMsg(0, 'Tip', obj2str(changed_player_list) + "离开了世界", '§r')
            last_world_player = world_name
        }

        if (DropRes && self_motion.y < -dr_mot) {
            for (index = 0; index < 36; index++) {
                const item = getInventory(self_id, index)
                if (resList.includes(item.namespace)) dropPlayerInventorySlot(self_id, index, false, true)
            }
        }

        if (AttackAim) {
            if (aim_t1 - aim_t0 > (Math.round(1000 / aaa_aps) - 50)) {
                at_lists.forEach(id => {
                    if (isAimed(self_id, id, aaa_fov, 0)) {
                        if (aa_use) useItem()
                        else Attack(id, Swing)
                    }
                })
                aim_t0 = aim_t1
            }
            aim_t1 = Date.now()
        }

        if (HotbarSelector) {
            let item = getInventory(self_id, select_slot)
            if (hs_damage) {
                if (item.attackDamage > 1) selectPlayerInventorySlot(self_id, select_slot)
            } else if (hs_slot.length > 0) {
                if (hs_slot.includes(select_slot + '')) {
                    selectPlayerInventorySlot(self_id, select_slot)
                    const carried = getCarried(self_id)
                    if (hs_use && !carried.namespace.includes("air")) useItem()
                }
            } else if (selectitems.includes(item.name) || selectitems.includes(item.namespace) || selectitems.length === 0) {
                selectPlayerInventorySlot(self_id, select_slot)
                const carried = getCarried(self_id)
                if (hs_use && !carried.namespace.includes("air")) useItem()
            }
        }

        if (AutoPot && ap_autobag && current_hud.includes('hud_screen')) openInventory()

        if (AutoPot && (current_hud.includes('hud_screen') || getScreenName() === 'inventory_screen')) {
            const hassplash_b = (_hotbarHealPotionCount(self_id) >= ap_min)
            if (!hassplash_b) {
                for (let i = (ap_slot === -1) ? 35 : 9; i > -1; i--) {
                    if (ap_slot > -1) {
                        const item2 = getInventory(self_id, i)
                        if (item2.namespace === 'minecraft:air') {
                            moveItem(ap_slot, i, false, false)
                            ap_slot = -1
                            break;
                        }
                    }
                    const item = getInventory(self_id, i)
                    if (ap_slot === -1 && item.namespace === 'minecraft:splash_potion') ap_slot = i
                }
            } else if (ap_autobag) deleteContainer()
        }

        if (AirJump && (aj_continue || self_motion.y < -0.42)) {
            let goal = predictPos(self_motion, self_pos, getSpeed(self_id))
            let yaw = getPlayerAngle(goal, self_id, "yaw_pos")
            let pos = calDisplacement(aj_speed / 10, self_pos, {
                yaw,
                pitch: 0
            })
            if (aj_modify) setMotion(pos.x - self_pos.x, aj_height / 100, pos.z - self_pos.z)
            else setMotion(self_motion.x, aj_height / 100, self_motion.z)
            return true
        }
        _nxInvBrain(self_id, current_hud, self_rot.pitch, ticks)
        if (false && SmartInv && (!da_inv || current_hud === 'inventory_screen') && (!da_chest || current_hud.includes('chest_screen')) && (!da_bow || self_rot.pitch > 80) && ticks % da_delay === 0) {
            for (let i = 0; i < da_max; i++) {
                const item_type = getItemType(self_id, da_slot);
                if (da_weapon && ['sword', 'axe', 'pickaxe', 'shovel', 'hoe', 'trident', 'mace'].includes(item_type)) {
                    const item_damage = getItemDamage(self_id, da_slot, da_texture, da_enchant)
                    if (item_damage > 1) {
                        if (item_damage > (max_damage[item_type] || 0)) {
                            max_damage[item_type] = item_damage;
                            if (da_move && SmartInvCfg[item_type] !== undefined) moveItem(da_slot, SmartInvCfg[item_type], true, false)
                        } else {
                            if (drop_slot > -1) {
                                moveItem(da_slot, drop_slot, true, false)
                                dropPlayerInventorySlot(self_id, drop_slot, false, da_all)
                            } else dropPlayerInventorySlot(self_id, da_slot, false, da_all)

                        }
                    }
                }
                const armorIndex = nx_armors.indexOf(item_type);
                const item_armor = getItemArmor(self_id, da_slot, da_texture, da_enchant)
                if (da_armor && armorIndex !== -1 && item_armor > 0) {
                    if (item_armor > max_armor[armorIndex]) {
                        max_armor[armorIndex] = item_armor;
                        if (da_move) {
                            if (move_armor_slot > -1) moveItem(da_slot, move_armor_slot, true, false)
                            else if (nx_armors[armorIndex]) moveItem(da_slot, SmartInvCfg[nx_armors[armorIndex]], true, false)
                        }
                    } else {
                        if (drop_slot > -1) {
                            moveItem(da_slot, drop_slot, true, false)
                            dropPlayerInventorySlot(self_id, drop_slot, false, da_all)
                        } else dropPlayerInventorySlot(self_id, da_slot, false, da_all)

                    }
                }
                if (da_slot < 35) da_slot++
                else {
                    da_slot = 0
                    max_damage = {}
                    max_armor = [0, 0, 0, 0]
                }
            }
        }

        if (false && AutoArmor && (!aa_inv || current_hud === 'inventory_screen') && (!aa_chest || current_hud.includes('chest_screen'))) {
            let item_type = getItemType(self_id, armor_slot)
            let carmor = getItemArmor(self_id, armor_slot)
            if (item_type != "other" && carmor !== 0) {
                let selfArmor = [getItemArmor(self_id, -2), getItemArmor(self_id, -3), getItemArmor(self_id, -4), getItemArmor(self_id, -5)]
                for (let i = 0; i < aa_times; i++) {
                    if (item_type === 'helmet' && carmor > selfArmor[0]) equipArmor(armor_slot)
                    if (item_type === 'chestplate' && carmor > selfArmor[1]) equipArmor(armor_slot)
                    if (item_type === 'leggings' && carmor > selfArmor[2]) equipArmor(armor_slot)
                    if (item_type === 'boots' && carmor > selfArmor[3]) equipArmor(armor_slot)
                }
            }
            if (ticks % aa_delay == 0) armor_slot++
            if (armor_slot > (modes.aa_mode === 0 ? 8 : 35)) armor_slot = 0
        }

        if (Remover) {
            const list = getEntityList()
            list.forEach(id => {
                let isRemove = false
                if (rmer_entity) isRemove = !isPlayer(id)
                if (rmer_item) isRemove = (getEntityNamespace(id) == 'minecraft:item')
                if (isRemove) removeEntity(id)
            })
        }

        if (AutoSelect && self_item.count <= 0 && prev_item.count > 0 && prev_item.namespace != 'minecraft:air') {
            for (let i = 8; i >= 0; i--) {
                let item = getInventory(self_id, i)
                if (item.namespace === prev_item.namespace) {
                    selectPlayerInventorySlot(self_id, i)
                    break
                }
            }
        }

        if (FreeCam && fc_pos != {}) {
            if (fc_draw) {
                for (let h = 0; h <= 18; h += 2) createParticle(56, fc_pos.x, fc_pos.y - 1.53 + h / 10, fc_pos.z, 1)
                message.push(makeMsg(1, 'FreeCam', `本体坐标: [X:${fc_pos.x['toFixed'](2)}, Y:${fc_pos.y['toFixed'](2)}, Z:${fc_pos.z['toFixed'](2)}]`, '§r'))
            }
            if (fc_dist) message.push(makeMsg(1, 'FreeCam', "本体距离:" + getDistance(self_pos, fc_pos)['toFixed'](2) + 'm', '§r'))
        }

        if (ThrowTracer) {
            const list = getEntityList()
            list.forEach(id => {
                if (['minecraft:bow', 'minecraft:snowball', 'minecraft:egg', 'minecraft:ender_pearl'].includes(getEntityNamespace(id)) && at_lists.length > 0) {
                    const epos = getPos(at_lists[0])
                    let yaw = getPlayerAngle(epos, getPos(id), "yaw_pos")
                    let pitch = -getPlayerAngle(epos, getPos(id), "pitch_pos")
                    const tpos = getPos(id)
                    const pos = calDisplacement(tt_speed, tpos, {
                        yaw,
                        pitch
                    })
                    setEntityMotion(id, pos.x - tpos.x, pos.y - tpos.y, pos.z - tpos.z)
                }
            })
            if (at_lists.length > 0) message.push(makeMsg(1, 'Tracer', "LockedTarget:" + getEntityName(at_lists[0]), '§r'))

        }

        if (ThrowFly) {
            const list = getEntityList()
            list.forEach(id => {
                if (['minecraft:bow', 'minecraft:snowball', 'minecraft:egg', 'minecraft:ender_pearl'].includes(getEntityNamespace(id))) {
                    const tpos = getPos(id)
                    if (typeof arrow_rot[id] === 'undefined') arrow_rot[id] = self_rot
                    const yaw = arrow_rot[id].yaw
                    const pitch = arrow_rot[id].pitch
                    const pos = calDisplacement(1, tpos, {
                        yaw,
                        pitch
                    })
                    setEntityMotion(id, pos.x - tpos.x, pos.y - tpos.y, pos.z - tpos.z)
                }
            })
        }

        if (ArrowView) {
            const list = getEntityList()
            list.forEach(id => {
                if (['minecraft:arrow', 'minecraft:snowball', 'minecraft:egg', 'minecraft:ender_pearl'].includes(getEntityNamespace(id)) && av_id === null && !av_list.includes(av_id)) av_id = id
            })
            if (av_id != null) {
                if (!av_list.includes(av_id)) av_list.push(av_id)
                let Arrow_pos = getPos(av_id)
                setCameraAnchor(Arrow_pos.x - self_pos.x + (av_x - 10), Arrow_pos.y - self_pos.y + (av_y - 10), -Arrow_pos.z + self_pos.z + (av_z - 10))
            } else setCameraAnchor(0, 0, 0)
            if (!findEntity(av_id)) av_id = null
        }

        if (FPSReducer) {
            for (let i = 0; i < fpsr_rate * 10; i++) {
                for (let k = 0; k < fpsr_rate * 10; k++) getEntityName(i + k)
            }
        }

        if (ArrowParticle) {
            const list = getEntityList()
            list.forEach(id => {
                if (getEntityNamespace(id) === "minecraft:arrow") {
                    const pos = getPos(id)
                    createParticle(arp_type, pos.x, pos.y, pos.z, 1)
                }
            })
        }

        if (FightBot && at_lists.length > 0) {
            let entity_pos = getPos(at_lists[0]);
            let cp = {}

            if (fb_chest) {
                const mp = getEntityBlockPos(self_id)
                for (let dx = -2; dx < 3; dx++) {
                    for (let dy = -2; dy < 3; dy++) {
                        for (let dz = -2; dz < 3; dz++) {
                            const block = getBlock(mp.x + dx, mp.y + dy, mp.z + dz)
                            const ca_chest_pos_str = obj2str([mp.x + dx, mp.y + dy, mp.z + dz])
                            if (block.namespace === "minecraft:chest" && !ca_chest_pos.includes(ca_chest_pos_str)) {
                                cp = {
                                    x: mp.x + dx,
                                    y: mp.y + dy,
                                    z: mp.z + dz
                                }
                                ca_chest_pos.push(ca_chest_pos_str)
                                break;
                            }
                        }
                    }
                }
            }

            let move_speed = ((on_ground) ? -0.278 : -0.293) - (fb_moveSpeed * Number(!fb_legal) / 5);
            let isRandomMove = getRand(0, 100) < fb_moveRate
            if (fb_randMove && isRandomMove) {
                entity_pos = calDisplacement(move_speed, entity_pos, {
                    yaw: getRand(0, 1) ? 90 : -90,
                    pitch: 0
                });
            }
            let yaw = getPlayerAngle(self_id, entity_pos, "yaw_pos");
            let goal_pos = calDisplacement(move_speed, getPos(self_id), {
                yaw,
                pitch: 0
            });
            if (self_heal.current < fb_heal) {
                if (self_item.namespace !== 'minecraft:splash_potion' || !_isHealPotionAux(self_item.aux)) { const _healSlot = _findHealPotionSlot(self_id); if (_healSlot !== null) selectPlayerInventorySlot(self_id, _healSlot); }
                else {
                    setLocalPlayerTurn(-90, 0);
                    if (self_item.namespace.includes("splash_potion")) setTimeout(() => useItem(), 75);
                }
            }
            const distanceToTarget = getHorizontalDistanceByID(self_id, at_lists[0]);

            if (distanceToTarget > fb_seek) {
                if (on_ground) setEntityMotion(self_id, goal_pos.x - self_pos.x, ((fb_jump || (getRand(0, 100) < fb_jumpRate && fb_randJump)) && on_ground) ? fb_y : self_motion.y, goal_pos.z - self_pos.z)
                KillAura = false;
                KeepDistance = false;
                if (fb_sca) Scaffold = true
                if (Scaffold && sca_keep) sca_current = 0
                if (getRand(0, 100) < fb_fishRate && isAimed(self_id, at_lists[0], 20, 0) && distanceToTarget < fb_seek * 3) {
                    selectPlayerInventorySlot(self_id, getItemSlot(self_id, "fishing_rod"));
                    if (self_item.namespace.includes("fishing_rod")) useItem();
                }
            } else {
                if (getRand(0, 100) < fb_snowRate && isAimed(self_id, at_lists[0], 20, 0)) {
                    selectPlayerInventorySlot(self_id, getItemSlot(self_id, "snowball"));
                    if (self_item.namespace.includes("snowball")) useItem();
                }
                if (on_ground) setEntityMotion(self_id, (fb_randMove && isRandomMove) ? (goal_pos.x - self_pos.x) : self_motion.x, (fb_combo && !getEntityIsGround(at_lists[0])) ? fb_y : self_motion.y, (fb_randMove && isRandomMove) ? (goal_pos.z - self_pos.z) : self_motion.z);
                if (fb_weapon) selectPlayerInventorySlot(self_id, getItemSlot(self_id, "sword"));
                if (fb_ka) KillAura = true;
                if (fb_kd) KeepDistance = true;
                if (fb_aa) AssistAim = true;
                Scaffold = false;
            }
            if (JSON.stringify(cp) != '{}') {
                let yaw2 = getPlayerAngle(self_id, cp, "yaw_pos");
                let goal_pos2 = calDisplacement(move_speed, getPos(self_id), {
                    yaw: yaw2,
                    pitch: 0
                });
                if (on_ground) setEntityMotion(self_id, goal_pos2.x - self_pos.x, ((fb_jump || (getRand(0, 100) < fb_jumpRate && fb_randJump)) && on_ground) ? fb_y : self_motion.y, goal_pos2.z - self_pos.z);
            }
        }

        if (rpc_cycle && rpc_t > rpc_repeat_ticks) {
            for (let i = 0; i < rpc_repeat_times; i++) sendRpc(prev_rpc.id, prev_rpc.data)
            rpc_t = 0
        }

        if (AutoShifter && ticks % shift_tick == 0) {
            for (let i = 0; i < shift_num; i++) setEntityFlag(self_id, 1, true)
        }

        if (AutoCrystal && at_lists.length > 0) {
            if (ac_auto) selectPlayerInventorySlot(self_id, getItemSlot(self_id, 'end_crystal'))
            if (self_item.namespace === "minecraft:end_crystal" && ticks % ac_delay == 0) {
                let build_count = 0
                at_lists.forEach(id => {
                    let pos = getEntityBlockPos(id)
                    if (ac_excludeY && Math.abs(pos.y - self_pos.y) < 1) return;
                    if (ac_tp) setPos(pos.x, pos.y + 1, pos.z)
                    for (let dx = -1; dx < 2; dx++) {
                        for (let dz = -2; dz < 0; dz++) {
                            for (let dy = -1; dy < 2; dy++) {
                                let block = getBlock(pos.x + dx, pos.y + dy, pos.z + dz)
                                if (build_count > ac_count) break
                                if ((block.namespace === "minecraft:bedrock" || block.namespace === "minecraft:obsidian") && build_count < ac_count) {
                                    buildBlock(self_id, pos.x + dx, pos.y + dy, pos.z + dz, 1)
                                    build_count++;
                                }
                            }
                        }
                    }
                })
            } else message.push(makeMsg(1, 'Crystal', "请手持水晶", '§r'))
        }

        if (CrystalAura) {
            const entities = getEntityList()
            entities.forEach(id => {
                if (!isAlive(id)) return
                const pos = getPos(id)
                if (getEntityTypeId(id) !== 71 || getDistanceByID(id, at_lists[0]) > ca_distTo) return
                if (ca_block && !self_item.isBlock) {
                    for (let i = 0; i < 9; i++) {
                        const item = getInventory(self_id, i)
                        if (item.isBlock) {
                            selectPlayerInventorySlot(self_id, i)
                            break
                        }
                    }
                    buildBlock(self_id, (block_pos.x + pos.x) / 2, (block_pos.y + pos.y) / 2, (block_pos.z + pos.z) / 2, 0)
                    Attack(id, Swing)
                }
            })
        }

        if (AutoAnchor && at_lists.length > 0) {
            if (ab_auto) selectPlayerInventorySlot(self_id, getItemSlot(self_id, 'respawn_anchor'))
            if (self_item.namespace === "minecraft:respawn_anchor" && ticks % ab_delay === 0) {
                at_lists.forEach(id => {
                    let pos = getEntityBlockPos(id)
                    let block = getBlock(pos.x, pos.y + 2, pos.z)
                    if (block.namespace === "minecraft:air") buildBlock(self_id, pos.x, pos.y + 2 + ab_offset, pos.z, 0)
                    block = getBlock(pos.x, pos.y + 2 + ab_offset, pos.z)
                    if (ab_click && block.namespace === "minecraft:respawn_anchor") buildBlock(self_id, pos.x, pos.y + 2 + ab_offset, pos.z, 0)
                })
            } else message.push(makeMsg(1, 'Anchor', "请手持重生锚", '§r'))
        }

        if (AutoTrap && at_lists.length > 0) {
            at_lists.forEach(id => {
                const bp = getEntityBlockPos(id)
                let blocklist = [
                    [bp.x, bp.y + 1, bp.z],
                    [bp.x + 1, bp.y, bp.z],
                    [bp.x - 1, bp.y, bp.z],
                    [bp.x, bp.y, bp.z + 1],
                    [bp.x, bp.y, bp.z - 1],
                    [bp.x + 1, bp.y - 1, bp.z],
                    [bp.x - 1, bp.y - 1, bp.z],
                    [bp.x, bp.y - 1, bp.z + 1],
                    [bp.x, bp.y - 1, bp.z - 1]
                ]
                for (pos of blocklist) {
                    let block = getBlock(pos[0], pos[1], pos[2])
                    if (block.namespace === "minecraft:air" && modes.cpvp_mode === 1) buildBlock(self_id, pos[0], pos[1], pos[2], 1)
                    if (block.namespace != "minecraft:air" && modes.cpvp_mode === 0) destroy(self_id, pos[0], pos[1], pos[2], 1)
                }
            })
        }

        if (KillAura && at_lists.length > 0) {
            let list = []
            let enable = false
            random_num = (getRand(ka_min, ka_max) / ((ka_balance) ? (at_lists.length) : (1)))
            random_delay = (ka_delay > 0 ? (ka_delay * 50) : (Math.round(1000 / random_num)))
            at_lists.forEach(target => {
                let t_pos = getPos(target)
                if (!((getDistanceByID(self_id, target) <= ka_range || ka_infDist) && isAimed(self_id, target, ka_fov, 0) && checkWall(self_pos, t_pos, !ka_wall, 1.53, 0.9) && (!ka_fall || self_motion.y < -0.42))) return
                list.push(target)
                KillAura_d_1[target] = Date.now()
                if (typeof KillAura_d_2[target] !== 'undefined' && KillAura_d_1[target] - KillAura_d_2[target] < 0) return
                enable = true
                for (k = 0; k < ka_times; k++) Attack(target, Swing);
                KillAura_d_2[target] = KillAura_d_1[target] + random_delay
                if (ka_third) _options.setPlayerViewPerspective(enable ? 1 : 0)
            })
            if (list.length > 0) message.push(makeMsg(1, 'KillAura', ShortList ? (list.length + '个目标') : obj2str(list.map(id => getEntityName(id))), '§r'))
            const aps = list.length * random_num * ka_times
            if (ka_show && aps > 0) message.push(makeMsg(1, 'APS', aps + "/s", '§r'))
        }

        if (AvoidAttack) setPos(100000, 100000, 100000)

        if (SlowDown && self_motion.y < -0.074 && !on_ground) setMotion(self_motion.x, -sd_speed / 20, self_motion.z)

        if (SurroundParticle && (self_moving || !srp_move)) {
            srp_current = srp_current + srp_speed * 3
            if (srp_current > 180) srp_current = -180
            let goal_pos = calDisplacement(srp_len, self_pos, {
                yaw: srp_current,
                pitch: 0
            })
            createParticle(srp_type, goal_pos.x, goal_pos.y - 1.8 + srp_y, goal_pos.z, srp_size)
        }

        if (motion_list.length > 0) {
            const p2 = motion_list.shift()
            setMotion(p2[0], p2[1], p2[2])
        }

        if (Scaffold && self_item.isBlock) {
            sca_current = (!sca_keep || sca_current === 0) ? Math.floor(self_pos.y) : sca_current;
            if (sca_count) message.push(makeMsg(1, 'BlockCount', self_item.name + ' x' + self_item.count + '\n' + getProgress(self_item.count, 64, '▌', 30), '§r'))
            const goal = predictPos(self_motion, self_pos, 10);
            const __sca_has_move = (sca_move || self_moving) && (Math.abs(goal.x - self_pos.x) + Math.abs(goal.z - self_pos.z)) > 0.5;
            var yaw = __sca_has_move ? getPlayerAngle(goal, self_id, "yaw_pos") : self_rot.yaw;
            var pitch = __sca_has_move ? getPlayerAngle(goal, self_id, "pitch_pos") : self_rot.pitch;
            if (!sca_acc) yaw = roundAngle(yaw, sca_prec)
            if (!sca_acc) pitch = roundAngle(pitch, sca_prec)
            if (sca_auto) {
                for (let i = -3; i <= 3; i++) {
                    for (let j = -2; j <= 0; j++) {
                        for (let k = -3; k <= 3; k++) {
                            let p3 = {
                                x: i + block_pos.x,
                                y: Math.floor(sca_current) - 1 + j,
                                z: k + block_pos.z
                            };
                            const block = getBlock(p3.x, p3.y, p3.z);
                            if (block.namespace != 'minecraft:air') {
                                let pos_list = findPath(p3, block_pos, 1, true);
                                pos_list.forEach(p => {
                                    if (sca_surface) simulatePlace(Math.floor(p.x), Math.floor(sca_current - 1), Math.floor(p.z));
                                    else buildBlock(self_id, Math.floor(p.x), Math.floor(sca_current - 1), Math.floor(p.z), 1)
                                });
                                break;
                            }
                        }
                    }
                }
            }
            for (let i = 0; i < sca_len; i++) {
                const pos = calDisplacement(i, self_pos, {
                    yaw,
                    pitch: sca_y ? pitch : 0
                });
                let block_pos_obj = {
                    x: Math.floor(pos.x),
                    y: Math.floor(sca_current) - 1,
                    z: Math.floor(pos.z)
                };
                let block = getBlock(block_pos_obj.x, Math.floor(block_pos_obj.y), block_pos_obj.z);
                if (!['minecraft:air', 'minecraft:water', 'minecraft:lava'].includes(block.namespace)) continue;
                if (sca_fake) setBlock(block_pos_obj.x, Math.floor(block_pos_obj.y), block_pos_obj.z, self_item.namespace, self_item.aux)
                else if (sca_surface) simulatePlace(block_pos_obj.x, Math.floor(block_pos_obj.y), block_pos_obj.z);
                else buildBlock(self_id, block_pos_obj.x, Math.floor(block_pos_obj.y), block_pos_obj.z, 1)
                if (sca_up) {
                    const block2 = getBlock(block_pos_obj.x, Math.floor(block_pos_obj.y), block_pos_obj.z);
                    if (['minecraft:air', 'minecraft:water', 'minecraft:lava'].includes(block2.namespace)) buildBlock(self_id, block_pos_obj.x, Math.floor(block_pos_obj.y), block_pos_obj.z, 0)
                };
            }
        }
        if (Scaffold && sca_block && !self_item.isBlock && !isAttacking) {
            for (let i = 0; i < 9; i++) {
                const item = getInventory(self_id, i)
                if (item.isBlock) {
                    selectPlayerInventorySlot(self_id, i)
                    break
                }
            }
        }

        if (AttackSelf) Attack(self_id, Swing)

        if (TargetHud) {
            if (modes.th_select_mode === 0) th_target = at_lists[0]
            if (th_target && isAlive(th_target)) {
                let info = []
                const item = isPlayer(th_target) ? getCarried(th_target) : {
                    name: '无',
                    count: 0
                }
                const dist = getDistanceByID(th_target, self_id).toFixed(2)
                const pos = getEntityBlockPos(th_target)
                info.push(th_head)
                if (th_name) info.push('名称:' + getEntityName(th_target))
                if (th_carry) info.push(`手持: ${item.name} x${item.count}`)
                if (th_dist) info.push(`距离: ${dist}m`)
                if (th_pos) info.push(`坐标: [${pos.x}, ${pos.y}, ${pos.z}]`)
                if (th_effect) info.push(`药水效果: ${obj2str(getEntityEffectList(th_target).map(effect=>EffectsEnum[effect.id]+(effect.amplifier+1)))}`)
                if (th_health) info.push(`血量: ${getHealth(th_target,modes.th_health_mode)}`)
                if (th_tick < 40 || !modes.th_select_mode == 1) {
                    updateTextContent(th_id, info.join('\n'))
                    updateTextPosition(th_id, nx_screen.screenWidth * th_x / 100, nx_screen.screenHeight * th_y / 100)
                    updateTextColor(th_id, th_r / 100, th_g / 100, th_b / 100, th_a / 100)
                    updateTextScale(th_id, th_size)
                } else th_target = null
            } else updateTextContent(th_id, '')
        }

        if (AntiVoid) {
            if (modes.av_mode === 0) {
                if (!av_running && !on_ground && self_motion.y > -av_minY) av_pos.push(block_pos)
                if (!av_running && on_ground) av_pos = []
                if (!av_running && self_motion.y <= -av_minY) av_running = true
                if (av_running) {
                    if (av_pos.length > 0) {
                        let record_pos = av_pos.pop()
                        setPos(record_pos.x, record_pos.y, record_pos.z)
                        if (av_derp) setLocalPlayerTurn(0, 120);
                    } else av_running = false
                }
            }
            if (self_motion.y <= -av_minY && modes.av_mode === 1) {
                const commonData = {
                    rot: self_rot,
                    yHeadRot: 0
                };
                const authInputData = {
                    inputMode: 2,
                    playMode: 0,
                    pos: {
                        x: 10000,
                        y: 10000,
                        z: 10000
                    },
                    motion: {
                        x: 10000,
                        y: 10000,
                        z: 10000
                    },
                    ...commonData
                };
                const movePlayerData = {
                    id: self_id,
                    pos: {
                        x: 10000,
                        y: 10000,
                        z: 10000
                    },
                    mode: 1,
                    ground: true,
                    ...commonData
                };
                sendPlayerAuthInput(authInputData);
                _packet.sendMovePlayerPacket(movePlayerData);

            }
            if (modes.av_mode === 2) {
                if (!av_running && on_ground && self_motion.y > -av_minY) av_pos[0] = self_pos
                if (!av_running && self_motion.y <= -av_minY) av_running = true
                if (av_running) {
                    if (av_pos.length > 0) {
                        let record_pos = av_pos[0]
                        setPos(record_pos.x, record_pos.y, record_pos.z)
                        av_pos = []
                    } else av_running = false
                }
            }
        }

        if (GodMode && (!gm_move || self_moving) && (!gm_ground || on_ground)) {
            if (gm_tick <= gm_cycle) {
                gm_pos = getPos(self_id)
                gm_mot = getEntityMotion(self_id)
                for (let i = 0; i < gm_count; i++) {
                    if (modes.gm_mode === 0) motTP(gm_xz ? 114514 : self_pos.x, gm_edit_y ? (gm_y > 0 ? (10 ** gm_y) : -3) : self_pos.y, gm_xz ? 114514 : self_pos.z)
                    if (modes.gm_mode === 1) setPos(gm_xz ? 114514 : self_pos.x, gm_edit_y ? (gm_y > 0 ? (10 ** gm_y) : -3) : self_pos.y, gm_xz ? 114514 : self_pos.z)
                    if (modes.gm_mode === 2) silentMove(gm_xz ? 114514 : self_pos.x, gm_edit_y ? (gm_y > 0 ? (10 ** gm_y) : -3) : self_pos.y, gm_xz ? 114514 : self_pos.z)
                    if (modes.gm_mode === 3) movePlayer(gm_xz ? 114514 : self_pos.x, gm_edit_y ? (gm_y > 0 ? (10 ** gm_y) : -3) : self_pos.y, gm_xz ? 114514 : self_pos.z)
                }
                if (!gm_back) gm_tick = 0
            }
            if (gm_back && gm_tick >= gm_cycle + gm_delay) {
                for (let i = 0; i < gm_count; i++) {
                    if (modes.gm_mode < 2) setPos(gm_pos.x, gm_pos.y, gm_pos.z)
                    if (modes.gm_mode < 2) setMotion(gm_mot.x, gm_mot.y, gm_mot.z)
                    if (modes.gm_mode === 2) {
                        if (gm_local) setPos(self_pos.x, self_pos.y, self_pos.z)
                        sendPlayerAuthInput({
                            inputMode: 2,
                            playMode: 0,
                            pos: {
                                x: self_pos.x,
                                y: self_pos.y,
                                z: self_pos.z
                            },
                            motion: {
                                x: 0,
                                y: 0,
                                z: 0
                            },
                            rot: self_rot,
                            yHeadRot: 0
                        })
                    }
                }
                gm_tick = 0
            }
        }

        if (KeepDistance && at_lists.length > 0 && getHorizontalDistanceByID(self_id, at_lists[0]) < kd_distance && (on_ground || !kd_only_ground)) {
            const yaw = getPlayerAngle(getPos(at_lists[0]), self_id, "yaw_pos")
            const pos = calDisplacement(-kd_speed / 10, self_pos, {
                yaw,
                pitch: self_rot.pitch
            })
            if (kd_anti) silentMove(pos.x * 2, pos.y * 2, pos.z * 2)
            else setMotion(pos.x - self_pos.x, self_motion.y, pos.z - self_pos.z)
        }

        if (dl_list.length > 0) {
            for (let s = 0; s < di_speed; s++) {
                let slot = dl_list.pop()
                dropPlayerInventorySlot(self_id, slot, false, true)
            }
        }

        if (RandomDrop) dropPlayerInventorySlot(self_id, getRand(0, 8))

        if (RandomSelect) selectPlayerInventorySlot(self_id, getRand(0, 8))

        if (Trace && at_lists.length > 0 && getDistanceByID(self_id, at_lists[0]) > tra_range) {
            let yaw = getPlayerAngle(self_id, at_lists[0], "yaw_pos")
            let pitch = getPlayerAngle(self_id, at_lists[0], "pitch_pos")
            let goal_pos = calDisplacement(-tra_speed / 5, getPos(self_id), {
                yaw,
                pitch: -pitch
            })
            setPos(goal_pos.x, goal_pos.y, goal_pos.z)
        }

        if (LineParticle && at_lists.length > 0) {
            let spos = getPos(self_id)
            spos.y += lp_offset / 10
            at_lists.forEach(id => {
                let t_pos = getPos(id)
                t_pos.y += 0.765
                let yaw = getPlayerAngle(spos, t_pos, "yaw_pos")
                let pitch = getPlayerAngle(spos, t_pos, "pitch_pos")
                for (let i = 0; i < getDistanceByID(id, self_id); i += (11 - lp_size) / 5) {
                    let goal_pos = calDisplacement(-i, getPos(self_id), {
                        yaw,
                        pitch: -pitch
                    })
                    createParticle(lp_type, goal_pos.x, goal_pos.y - 1.53 + (lp_offset / 10), goal_pos.z, 1)
                }
            })
        }

        if (PyRpcManager && rpc_store) message.push(makeMsg(1, 'PyRpcManager', `已储存的RPC: ${rpc_temp.length}个`, '§r'));

        if (Spammer && ticks % spm_delay == 0) {
            let spam_msg = spm_text
            if (spm_file) {
                let cm_list = readFile(nx_paths + '/Spammer.txt').split('\n')
                spam_msg = cm_list[getRand(0, cm_list.length - 1)]
            }
            const colors = 'abcdef'
            if (spm_gradual) spam_msg = rainbowMsg(spam_msg)
            if (spm_rainbow) spam_msg = '§' + colors[getRand(0, colors.length - 1)] + spam_msg
            if (spm_attack && at_lists.length > 0) spam_msg = ' §e@' + at_lists.map(id => getEntityName(id)).join(',') + ' §r' + spam_msg
            for (let i = 0; i < spm_count; i++) {
                let randomText = randomStr(6)
                _minecraft.sendChatMessage(spm_random ? spam_msg + "§r || " + randomText : spam_msg)
            }
        }

        if (HitBox && at_lists.length > 0) at_lists.forEach((target) => setEntitySize(target, hb_hor, hb_y))

        if (Sucker && at_lists.length > 0) {
            at_lists.forEach((target) => {
                const target_pos = calDisplacement(suck_range, self_pos, self_rot)
                setRealPos(target, target_pos.x, target_pos.y, target_pos.z)
            })
        }

        if (AntiAim && !aaim_states) aaim_states = at_lists.some(id => (isAimed(id, self_id, aaim_fov, 0 && getDistanceByID(self_id, id) < aaim_dist)))

        if (aaim_states) {
            let end_pos = calDisplacement(0.3 * aaim_speed / 5, self_pos, {
                yaw: (self_rot.yaw + (Math.round(getRand(0, 1)) ? 90 : -90)),
                pitch: 0
            });
            setMotion(end_pos.x - self_pos.x, self_motion.y, end_pos.z - self_pos.z)
            aaim_states = false
        }

        if (Velocity && self_moving) {
            let yaw = self_rot.yaw
            if (modes.bhop_mode === 1) {
                bhop_mot = getEntityMotion(self_id)
                bhop_pos = getPos(self_id)
                const goal = predictPos(bhop_mot, getPos(self_id), 5)
                yaw = getPlayerAngle(self_id, goal, "yaw_pos")
            }
            let end_pos = calDisplacement(((modes.bhop_mode === 0) ? bhop_speed : -bhop_speed) / 10, self_pos, {
                yaw,
                pitch: 0
            })
            setMotion(end_pos.x - self_pos.x, (vec_bhop && (on_ground || bhop_airjump) && (!bhop_airjump || self_motion.y < -0.42)) ? bhop_heigh : self_motion.y, end_pos.z - self_pos.z)
        }

        if (FlexibleMove) {
            const rot = getCameraRotation()
            const end_pos = calDisplacement(fb_speed / 10, self_pos, {
                yaw: rot.yaw > 0 ? 180 - rot.yaw : -180 - rot.yaw,
                pitch: -rot.pitch
            })
            if (!on_ground && self_moving) setMotion(end_pos.x - self_pos.x, 0, end_pos.z - self_pos.z)
        }

        if (TargetParticle) {
            at_lists.forEach(target => {
                const epos = getPos(target)
                createParticle(tp_type, epos.x, epos.y + 0.3, epos.z, tp_size)
            })
        }

        /* SkyWars：盾牌常驻副手。v2 的副手是**独立槽**，不在 getPlayerInventoryItem 的 0–35
   之内，moveItem（只操作背包槽）够不着它，只能用 actor.setOffhandItem 设置。
   这里把「设置副手 + 丢弃背包原槽」合成一次位移，净效果与手动把盾牌搬进副手槽一致。
   setEntityOffhandItem 走 _nbtToItem()：优先 setNBT，失败才退回 reinit(Name/Count/Damage)
   —— 后者会丢附魔，盾牌本身无附魔，影响可忽略。 */
        if (false && InvCleaner && ticks % ic_delay === 0 && getOffhand(self_id).namespace !== 'minecraft:shield') {
            for (let _sh = 0; _sh < 36; _sh++) {
                if (getInventory(self_id, _sh).namespace !== 'minecraft:shield') continue
                if (setEntityOffhandItem(self_id, getPlayerInventoryItem(self_id, _sh))) dropPlayerInventorySlot(self_id, _sh, false, true)
                break
            }
        }
        if (false && InvCleaner && modes.ic_mode < 2 && ticks % ic_delay === 0 && (!ic_inv || current_hud === 'inventory_screen') && (!ic_chest || current_hud.includes('chest_screen')) && (!ic_bow || self_rot.pitch > 80)) {
            _nxRefreshThrowable(self_id)
            for (let i = 0; i < ic_max; i++) {
                const item = getInventory(self_id, cleaner_slot);
                if (item.count === 0) {
                    if (cleaner_slot > 0) cleaner_slot--;
                    else cleaner_slot = 35
                    continue
                };
                let shouldDrop = false
                let clear_item = clear_config[item.namespace]
                let item_count = getItemCount(-2, item.namespace)
                if (modes.ic_mode === 0 && clear_item) shouldDrop = true
                if (modes.ic_mode === 1 && (!clear_item || (clear_item && (clear_item.max_num !== -1 && item_count > clear_item.max_num) && (clear_item.aux === 'any' || item.aux === clear_item.aux)))) shouldDrop = true
                const _nx_dst = _nxSortSlot(item, clear_item)
                if (ic_move && !shouldDrop && _nx_dst !== undefined && cleaner_slot !== _nx_dst && getInventory(self_id, _nx_dst).count === 0) moveItem(cleaner_slot, _nx_dst, true, false)
                if (shouldDrop) {
                    if (trash_slot > -1 && cleaner_slot > 8) {
                        moveItem(cleaner_slot, trash_slot, true, false)
                        dropPlayerInventorySlot(self_id, trash_slot, false, ((modes.ic_mode === 0 && clear_item) || (modes.ic_mode === 1 && !clear_item)) || ic_all);
                    } else dropPlayerInventorySlot(self_id, cleaner_slot, false, ((modes.ic_mode === 0 && clear_item) || (modes.ic_mode === 1 && !clear_item)) || ic_all);
                }
                if (cleaner_slot > 0) cleaner_slot--;
                else cleaner_slot = 35
            }
        }

        if (SafeWalk && self_moving) {
            const yaw = getEntityRot(self_id).yaw
            const pos = calDisplacement(0.3, self_pos, {
                yaw,
                pitch: 0
            })
            const block = getBlock(pos.x, pos.y - 1.7, pos.z)
            if (block.namespace === "minecraft:air" && on_ground) setMotion(-self_motion.x, self_motion.y, -self_motion.z)
        }

        if (Spider && self_moving) {
            const yaw = self_rot.yaw
            const pos = calDisplacement(0.5, self_pos, {
                yaw,
                pitch: 0
            })
            const block = getBlock(pos.x, self_pos.y - 1.3, pos.z)
            if (block.namespace != "minecraft:air") setMotion(self_motion.x, sp_speed / 15, self_motion.z)
        }

        if (DirectRender) {
            const goal = predictPos(self_motion, self_pos, 10);
            const pos = calDisplacement(1, self_pos, {
                yaw,
                pitch: 0
            })
            var rotAngle = self_rot.yaw
            var moveAngle = getPlayerAngle(goal, self_id, "yaw_pos");
            for (let i = 0; i < dr_num; i++) {
                const rotPos = calDisplacement(i * dr_space / 5, self_pos, {
                    yaw: rotAngle,
                    pitch: 0
                })
                const movePos = calDisplacement(i * dr_space / 5, self_pos, {
                    yaw: moveAngle,
                    pitch: 0
                })
                if (dr_rot) createParticle(56, rotPos.x, self_pos.y - 0.27, rotPos.z, 1)
                if (dr_move) createParticle(56, movePos.x, self_pos.y - 1.3, movePos.z, 1)
            }
        }

        if (Fly && (!on_ground || !fly_air) && (!fly_move || self_moving)) {
            const fly_off = fly_ud ? fly_current : 0
            let goal_pos = predictPos(self_motion, self_pos, fly_speed * 2.5)
            if (modes.fly_mode === 0) {
                if (fly_y) setPos(goal_pos.x, self_pos.y + fly_off, goal_pos.z)
                else setPos(self_pos.x, goal_pos.y, self_pos.z)
                if (fly_zero) setMotion(0, 0, 0)
            }
            if (modes.fly_mode === 1) setMotion(goal_pos.x - self_pos.x, goal_pos.y - self_pos.y, goal_pos.z - self_pos.z)
            if (fly_playerAuth) silentMove(goal_pos.x, goal_pos.y, goal_pos.z)
            if (fly_moveplayer) _packet.sendMovePlayerPacket({
                id: self_id,
                pos: {
                    x: goal_pos.x,
                    y: goal_pos.y,
                    z: goal_pos.z
                },
                mode: 1,
                ground: true,
                rot: {
                    pitch: self_rot.pitch,
                    yaw: self_rot.yaw
                },
                yHeadRot: getEntityBodyRot(self_id)
            })
            fly_current = (fly_current > 0) ? (-fly_ud_val / 10) : (fly_ud_val / 10)
        }

        if (ActivitySender && self_moving) {
            let pos = predictPos(self_motion, self_pos, 1)
            const angle = getPlayerAngle(self_id, pos, "yaw_pos");
            _minecraft.sendChatMessage('我正在向' + Math.round(angle) + '°方向移动')
        }

        if (Suspend) setMotion(self_motion.x, -1e5, self_motion.z)

        if (Hover) setMotion(self_motion.x, 0.05, self_motion.z)

        if (Rider && at_lists.length > 0) {
            let target_pos = getPos(at_lists[0])
            const offset = rid_random ? getRand(-2, 2) : 0
            MenuTP(target_pos.x + offset, target_pos.y + rid_y + 1, target_pos.z + offset)
            message.push(makeMsg(1, 'Rider', getEntityName(at_lists[0]), '§r'));
        }

        if (JetPack) {
            const rot = getCameraRotation()
            if (self_moving || !spr_move) {
                let goal_pos = calDisplacement((modes.sprint_mode === 0) ? spr_speed / 11 : spr_speed / 11, getPos(self_id), {
                    yaw: rot.yaw > 0 ? 180 - rot.yaw : -180 - rot.yaw,
                    pitch: -rot.pitch
                })
                if (spr_hor) goal_pos.y = self_pos.y
                const block = getBlock(goal_pos.x, goal_pos.y, goal_pos.z)
                if (block.namespace === "minecraft:air" || spr_nowall) {
                    if (modes.sprint_mode === 0) {
                        setPos(goal_pos.x, goal_pos.y, goal_pos.z)
                        setEntityMotion(self_id, self_motion.x, -1.0e-7, self_motion.z)
                    }
                    if (modes.sprint_mode === 1) setMotion(goal_pos.x - self_pos.x, goal_pos.y - self_pos.y, goal_pos.z - self_pos.z)
                    if (spr_auth) silentMove(goal_pos.x, goal_pos.y, goal_pos.z)
                    if (spr_packet) _packet.sendMovePlayerPacket({
                        id: self_id,
                        pos: {
                            x: goal_pos.x,
                            y: goal_pos.y,
                            z: goal_pos.z
                        },
                        mode: 1,
                        ground: true,
                        rot: {
                            pitch: self_rot.pitch,
                            yaw: self_rot.yaw
                        },
                        yHeadRot: getEntityBodyRot(self_id)
                    })
                } else setPos(self_pos.x, self_pos.y, self_pos.z)
            }
        }

        if (Crasher) {
            for (let i = 0; i < cs_count; i++) {
                const offset = Math.sqrt(i)
                if (modes.cs_mode === 0) buildBlock(self_id, block_pos.x, block_pos.y, block_pos.z, offset)
                if (modes.cs_mode === 1 && prev_rpc) sendRpc(prev_rpc.id, prev_rpc.data)
                if (modes.cs_mode === 2) _minecraft.sendChatMessage('§e§w§l' + '\n\n\n\n\n'.repeat(50))
                if (modes.cs_mode === 3) executeCommand('/w @a[rm=0.1] ' + '§l§e§w\n\n\n\n\n'.repeat(50))
                if (modes.cs_mode === 4) sendSound(i, self_pos.x, self_pos.y, self_pos.z, i)
                if (modes.cs_mode === 5) getEntityList().concat(getPlayerList()).forEach(id => {
                    if (id !== self_id) Attack(id, false)
                })
                if (modes.cs_mode === 6) sendPlayerAuthInput({
                    pos: self_pos,
                    yHeadRot: 0,
                    inputMode: 2,
                    playMode: 0,
                    flags: [i],
                    motion: {
                        x: 0,
                        y: 0,
                        z: 0
                    },
                    rot: {
                        yaw: 0,
                        pitch: 0
                    },
                })
                if (modes.cs_mode === 7) sendPlayerAction({
                    id: self_id,
                    pos: self_pos,
                    type: i,
                    value: 1
                })
            }
            if (modes.cs_mode === 8) _minecraft.sendChatMessage('/w 你好 ' + '再见'.repeat(cs_count * 10))
        }

        if (KickAura && at_lists.length > 0) {
            let list = []
            if (ka_player) list.concat(world_player_list.map(player => player.id))
            if (ka_target) list.concat(at_lists)
            if (modes.ka_mode == 0) list.forEach(target => {
                if (target == self_id) return
                const name = getEntityName(target)
                let Index = name.indexOf(']') - 2
                let name_color = ['b', 'c', 'e', 'a']
                for (let c of name_color) {
                    if (name.indexOf('·§' + c) != -1) {
                        Index = name.indexOf('·§' + c)
                        break
                    }
                }
                let real_name = (Index === -1) ? name : (name.slice(Index + 3, name.length))
                if (real_name.includes('【') && real_name.includes('】')) real_name = getText(real_name, '【', '】')
                for (let i = 0; i < ka_count; i++) executeCommand('/tell "' + real_name + (ka_fake ? '\n§r§e' : '') + '" §l§eNoveXareCrasher-§r' + ka_text.repeat(ka_repeat))
            })
            if (modes.ka_mode == 1) {
                for (let i = 0; i < ka_count; i++) executeCommand(`/tell @a[${(list.map(id => ('name="' + getEntityName(id) + '"'))).join(',')} ${(ka_fake ? ']\n\n\n\n\n\n\n\n\n\n\n\n\n\n§r§e' : ']')} §l§eNoveXareCrasher-§r' + ` + ka_text.repeat(ka_repeat))
            }
        }

        if (AutoSave && self_motion.y < as_minY && !on_ground) {
            if (as_block && !self_item.isBlock) {
                for (let i = 0; i < 9; i++) {
                    const item = getInventory(self_id, i)
                    if (item.isBlock || (as_water && item.namespace === 'minecraft:water_bucket')) {
                        selectPlayerInventorySlot(self_id, i)
                        break
                    }
                }
            }
            if (as_water && self_item.namespace === 'minecraft:water_bucket') {
                for (let pos of findPath(block_pos, {
                        x: block_pos.x,
                        y: block_pos.y + as_minY * 5,
                        z: block_pos.z
                    }, 1, true)) {
                    const block = getBlock(pos.x, pos.y, pos.z)
                    if (block.namespace != 'minecraft:air') continue;
                    const block2 = getBlock(pos.x, pos.y - 1, pos.z)
                    if (block2.namespace === 'minecraft:air' || block2.namespace === 'minecraft:water') continue;
                    buildBlock(self_id, pos.x, pos.y, pos.z, 0)
                }
            }
            if (as_keep) setPos(self_pos.x, self_pos.y, self_pos.z)
            if (!as_near && self_item.namespace != 'minecraft:water_bucket' && self_item.isBlock && !as_water) {
                if (as_fake) setBlock(self_pos.x, block_pos.y + self_motion.y * 3.1, self_pos.z, self_item.namespace, self_item.aux)
                else buildBlock(self_id, block_pos.x, block_pos.y + self_motion.y * 3.1, block_pos.z, 0)
            }
            if (as_near) {
                let nearest_pos = {}
                let block_dis = Infinity
                for (let i = -5; i <= 5; i++) {
                    for (let j = -1; j <= 0; j++) {
                        for (let k = -5; k <= 5; k++) {
                            let dis = Math.sqrt(i * i + k * k + j * j)
                            let p3 = {
                                x: i + block_pos.x,
                                y: j + block_pos.y,
                                z: k + block_pos.z
                            }
                            const block = getBlock(p3.x, p3.y, p3.z)
                            if (block.namespace === 'minecraft:air') continue;
                            if (dis < block_dis) {
                                block_dis = dis
                                nearest_pos = p3
                            }
                        }
                    }
                }
                if (nearest_pos != {}) {
                    let p2 = {
                        x: block_pos.x,
                        y: block_pos.y - 1 + self_motion.y * 3,
                        z: block_pos.z
                    }
                    let pos_list = findPath(nearest_pos, p2, 0.8, true)
                    pos_list.forEach(p => {
                        const block = getBlock(p.x, p.y, p.z)
                        if (block.namespace === "minecraft:air") simulatePlace(Math.round(p.x), Math.floor(p.y), Math.round(p.z))
                    })
                }
            }
        }

        if (AssAssInate && at_lists.length > 0) {
            let rot = getEntityRot(at_lists[0])
            let pos = getPos(at_lists[0])
            if (aai_h > aai_max) aai_reverse = true
            else if (aai_h < aai_min) aai_reverse = false
            aai_h += (aai_reverse ? (-1) : 1) * aai_speed / 20
            const offset = aai_random ? getRand(-10, 10) : (sur_speed * 3)
            aai_current = Surround ? (aai_current + offset) : rot.yaw
            if (Surround && aai_current > 180) aai_current = -180
            let goal_pos = calDisplacement(-aai_len, pos, {
                yaw: aai_current,
                pitch: 0
            })
            if (modes.sur_mode === 0) setPos(goal_pos.x, pos.y + 1.83 + aai_h, goal_pos.z)
            if (modes.sur_mode === 1) motTP(goal_pos.x, pos.y + 1.83 + aai_h, goal_pos.z)
            message.push(makeMsg(1, 'LockBack', getEntityName(at_lists[0]), '§r'));
        }

        if (SoundPlayer || sp_data.length > 0) {
            let plist = []
            if (sp_target) plist = at_lists
            if (sp_all) plist = getPlayerList()
            if (sp_entity) plist = getEntityList()
            if (sp_posList.length > 0) plist = sp_posList
            let data = [{
                sound: sp_type,
                level: sp_level
            }]
            sp_yaw += 20
            if (sp_yaw > 180) sp_yaw = -180
            for (let j = 0; j < sp_vec; j++) {
                if (sp_data.length > 0) data = sp_data.shift()["sounds"]
                if (data.length > 0) {
                    outer: for (let so of data) {
                        let sound = so.sound
                        let level = so.level
                        if (level === -1 && sound === 0) continue;
                        if (sp_large) {
                            const range = Math.round((sp_range * sp_space) / 2)
                            for (let x = -range; x <= range; x += sp_space) {
                                for (let z = -range; z <= range; z += sp_space) {
                                    sendSound(Number(sound), self_pos.x + x, self_pos.y + sp_y, self_pos.z + z, Number(level))
                                }
                            }
                            continue outer;
                        }
                        plist.forEach(id => {
                            if (typeof id != 'string')
                                for (let i = 0; i < sp_count; i++) sendSound(Number(sound), id.x, id.y + sp_y, id.z, Number(level))
                            else {
                                if (id === self_id && sp_exclude) return;
                                const pos = getPos(id)
                                let goal_pos = calDisplacement(sp_distance, pos, {
                                    yaw: sp_yaw,
                                    pitch: 0
                                })
                                for (let i = 0; i < sp_count; i++) sendSound(Number(sound), goal_pos.x, goal_pos.y + sp_y, goal_pos.z, Number(level))
                            }
                        })
                    }
                }
            }
            if (sp_info && sp_data.length > 0) message.push(makeMsg(1, 'SoundPlayer', `进度: ${sp_length-sp_data.length}/${sp_length} - ${((sp_length-sp_data.length)/sp_length*100).toFixed(2)}%%\n${getProgress(sp_length-sp_data.length, sp_length, '▌', 32)}`, '§r'));
        }
        if (sp_loop && SoundPlayer && sp_file && sp_data.length === 0) {
            sp_data = JSON.parse(sp_file)
            makeMsg(0, '进度', '循环播放中 共' + sp_data.length + '条音频数据', '§r')
        }

        if (self_heal.current < 6) message.push(makeMsg(1, 'Warning', 'Low Health!', '§c'))

        if (AutoDo && Math.round(self_heal.current) <= ad_min) {
            const mode = modes.ad_mode;
            if (mode === 2) removeEntity(self_id);
            if (mode === 0 || mode === 1) executeCommand(mode === 0 ? "/hub" : "/again");
            if (mode === 3) {
                if (self_item.namespace !== 'minecraft:splash_potion' || !_isHealPotionAux(self_item.aux)) { const _healSlot = _findHealPotionSlot(self_id); if (_healSlot !== null) selectPlayerInventorySlot(self_id, _healSlot); }
                else {
                    setEntityRot(self_id, 90, self_rot.yaw);
                    if (self_item.namespace.includes("splash_potion")) setTimeout(() => useItem(), 0);
                    if (ad_sword) setTimeout(() => selectPlayerInventorySlot(self_id, getItemSlot(self_id, "sword")), 500);
                }
            }
            if (mode === 4) {
                if (self_item.namespace !== 'minecraft:mushroom_stew') selectPlayerInventorySlot(self_id, getItemSlot(self_id, 'mushroom_stew'));
                else {
                    useItem();
                    if (ad_sword) setTimeout(() => selectPlayerInventorySlot(self_id, getItemSlot(self_id, "sword")), 500);
                }
            }
            if (mode === 5) {
                if (self_item.namespace !== 'minecraft:skull') selectPlayerInventorySlot(self_id, getItemSlot(self_id, 'skull'));
                else {
                    useItem();
                    if (ad_sword) setTimeout(() => selectPlayerInventorySlot(self_id, getItemSlot(self_id, "sword")), 500);
                }
            }
            if (mode === 6) _world.leaveWorld();
        }

        if (NoLiquid) {
            let {
                max,
                current,
                min
            } = getEntityAttribute(self_id, 'minecraft:movement')
            max *= nl_offset
            min *= nl_offset
            current *= nl_offset
            setEntityAttribute(self_id, 'minecraft:lava_movement', {
                max,
                min,
                current
            })
            setEntityAttribute(self_id, 'minecraft:underwater_movement', {
                max,
                min,
                current
            })
        }

        if (Breaker && bk_auto) buildBlock(self_id, self_pos.x, self_pos.y, self_pos.z, 1)

        if (Jesus) {
            const block = getBlock(block_pos.x, block_pos.y - 1, block_pos.z)
            if (block.namespace === "minecraft:flowing_water" || block.namespace === "minecraft:water" || block.namespace === "minecraft:flowing_lava" || block.namespace === "minecraft:lava") setEntityMotion(self_id, self_motion.x, 0, self_motion.z)
        }

        if (RecordInfo && !ri_click && at_lists.length > 0) {
            at_lists.forEach(target => {
                let info = getTargetInfo(target)
                makeMsg(0, 'TargetInfo', "\n" + info + "\n§r§b==============================", '§r')
                if (ri_save) _fs.write(nx_paths + '/' + getEntityName(target) + '_' + target + '.txt', info)
            })
        }
        if (AssistAim && aa_auto) aa_throw = ['minecraft:bow', 'minecraft:snowball', 'minecraft:egg', 'minecraft:ender_pearl'].includes(self_item.namespace)

        if (AssistAim && !aa_silent && at_lists.length > 0) {
            const target = at_lists[0];
            const distance = getDistanceByID(self_id, target);
            const isAimedTarget = isAimed(self_id, target, aa_fov, 0);
            if ((distance <= aa_range && isAimedTarget) || aa_throw) {
                const aim_speed = getRand(aa_min, aa_max)
                let yaw = getPlayerAngle(self_id, target, "yaw_rot", aa_pred, aa_throw, aa_xz, aa_randomY);
                let pitch = getPlayerAngle(self_id, target, "pitch_rot", aa_pred, aa_throw, aa_xz, aa_randomY);
                if (yaw <= 180 && yaw >= -180 && pitch <= 90 && pitch >= -90) {
                    let need_yaw = (yaw >= 0) ? -aim_speed : aim_speed;
                    let need_pitch = (pitch >= 0) ? aim_speed : -aim_speed;
                    if (modes.AssistAim_mode === 1 || (modes.AssistAim_mode === 0 && (Math.abs(yaw) < aim_speed || Math.abs(pitch) < aim_speed))) {
                        need_yaw = -yaw / ((40 - aim_speed) / 2);
                        need_pitch = -pitch / ((40 - aim_speed) / 1.125);
                    }
                    const isAimedX = isAimed(self_id, target, aa_prec * 2, 1);
                    const isAimedY = isAimed(self_id, target, aa_prec * 4, 2);
                    if (!isAimedX) setLocalPlayerTurn(0, need_yaw);
                    if ((!isAimedY && !aa_throw) || (!isSimilar(pitch, 0, 1) && aa_throw)) setLocalPlayerTurn(need_pitch, 0);
                }
                message.push(makeMsg(1, 'AssistAim', getEntityName(target), '§r'))
            }
        }

        if (InfiniteAura && ia_targets.length > 0) {
            ia_targets.forEach(id => {
                const target = id;
                const target_pos = getPos(target);
                if (!target || !findEntity(target)) return
                if (getDistanceByID(ia_targets[0], self_id) > ia_range) return
                if (ia_tick === 0) {
                    const random_offset = ia_random ? getRand(-2, 2) : 0
                    InfiniteAura_backPos = self_pos;
                    InfiniteAura_backMot = self_motion;
                    for (let i = 0; i < ia_move; i++) {
                        if (ia_toClick) {
                            buildBlock(self_id, target_pos.x + random_offset, target_pos.y, target_pos.z + random_offset, 1);
                            if (!ia_nopacket && modes.ia_mode === 0) sendPlayerAuthInput({
                                pos: {
                                    x: target_pos.x + random_offset,
                                    y: target_pos.y + ia_offset / 5,
                                    z: target_pos.z + random_offset
                                },
                            })
                        }
                        if (modes.ia_mode === 0) setPos(target_pos.x, target_pos.y, target_pos.z);
                        if (modes.ia_mode === 1) silentMove(target_pos.x + random_offset, target_pos.y + ia_offset / 5, target_pos.z + random_offset)
                        if (modes.ia_mode === 2) movePlayer(target_pos.x + random_offset, target_pos.y + ia_offset / 5, target_pos.z + random_offset)
                    }
                    if (ia_jump) playerJump()
                    for (let t = 0; t < ia_attack; t++) Attack(target, Swing);
                }
                if (ia_tick <= -ia_return && ia_fix) tpback()
            })
            if (ia_tick <= -ia_return) {
                if (!ia_fix) tpback()
                ia_tick = ia_delay;
            }
            if (ia_tick > -ia_return) ia_tick--;
            message.push(makeMsg(1, 'InfiniteAura', ShortList ? (ia_targets.length + '个目标') : obj2str(ia_targets.map(id => getEntityName(id))), '§r'))
        }

        if (ClickDestroy && AutoDestroy && ticks % cd_delay === 0) ModuleDestroy(block_pos)

        if (AutoVoid) {
            const mp = getEntityBlockPos(self_id)
            const block2 = getBlock(mp.x, block_pos.y - 1, mp.z)
            for (let dx = -2; dx < 3; dx++) {
                for (let dz = -2; dz < 3; dz++) {
                    const block = getBlock(mp.x + dx, block_pos.y - 1, mp.z + dz)
                    if (block.namespace === "minecraft:air" && self_motion.y < -0.0783 && self_motion.y > -0.0785 && block2.namespace != "minecraft:air") {
                        const yaw = -getPlayerAngle(self_id, {
                            x: mp.x + dx,
                            y: self_pos.y,
                            z: mp.z - dz
                        }, "yaw_pos")
                        const pos = calDisplacement(0.5, self_pos, {
                            yaw,
                            pitch: 0
                        })
                        setMotion(pos.x - self_pos.x, self_motion.y, pos.z - self_pos.z)
                        break;
                    }
                }
            }
        }

        if (AvoidThrow) {
            const entities = getEntityList()
            entities.forEach(id => {
                if ((getEntityTypeId(id) === 4194389 || getEntityTypeId(id) === 4194390 || getEntityTypeId(id) === 12582992) && getDistanceByID(id, self_id) <= at_range) {
                    if (at_remove) removeEntity(id)
                    if (modes.avoid_mode === 0) {
                        const yaw = getPlayerAngle(getPos(id), self_id, "yaw_pos")
                        const pos = calDisplacement(0.5, self_pos, {
                            yaw,
                            pitch: self_rot.pitch
                        })
                        setMotion(pos.x - self_pos.x, self_motion.y, pos.z - self_pos.z)
                    }
                    if (modes.avoid_mode === 1) Attack(id, Swing)
                    if (modes.avoid_mode === 2) setMotion(0, 0.6, 0)
                }
            })
        }

        if (TrajectoryRender) {
            const plist = getPlayerList()
            let pos_list = []
            let hastarget = false
            let end_pos = {
                x: 0,
                y: 0,
                z: 0
            }
            for (let l = 1; l <= tr_len; l += tr_dens / 10) {
                let heigh = calParabola(l, self_rot.pitch, tr_speed, tr_g)['data']
                let real_pos = calDisplacement(l, self_pos, {
                    yaw: self_rot.yaw,
                    pitch: 0
                })
                let block = getBlock(real_pos.x, real_pos.y + heigh, real_pos.z)
                if (tr_show || !hastarget) {
                    plist.forEach(id => {
                        if (!hastarget) {
                            let epos = getPos(id)
                            let tpos = {
                                x: real_pos.x,
                                y: real_pos.y + heigh,
                                z: real_pos.z
                            }
                            let esize = getEntitySize(id)
                            if (tpos.x <= epos.x + esize.x / 2 && tpos.x >= epos.x - esize.x / 2 && tpos.y <= epos.y + esize.y / 2 && tpos.y >= epos.y - esize.y / 2 && tpos.z <= epos.z + esize.x / 2 && tpos.z >= epos.z - esize.x / 2) {
                                message.push(makeMsg(1, 'HasAimed', getEntityName(id), '§r'))
                                hastarget = true
                            }
                        }
                    })
                }
                if (block.namespace != "minecraft:air" || hastarget) {
                    end_pos = real_pos
                    if (modes.tr_mode === 1 && block.namespace != "minecraft:air") {
                        for (let h = 0; h <= 20; h += 2) createParticle(tr_type, end_pos.x, end_pos.y + heigh + h / 10, end_pos.z, 1)
                    }
                    break
                }
            }
            if (modes.tr_mode === 0) {
                let l2 = getDistance(end_pos, self_pos)
                for (let l = 1; l <= l2; l += tr_dens / 10) {
                    let heigh = calParabola(l, self_rot.pitch, tr_speed, tr_g)['data']
                    let offset = (tr_offset - 10) / 10
                    let cur_yaw = self_rot.yaw + 90
                    if (cur_yaw > 180) cur_yaw = cur_yaw - 360
                    if (cur_yaw < -180) cur_yaw = cur_yaw + 360
                    let spos = calDisplacement(offset, self_pos, {
                        yaw: cur_yaw,
                        pitch: 0
                    })
                    let pos = calDisplacement(l, spos, {
                        yaw: self_rot.yaw - (Math.atan(offset / l2) * (180 / Math.PI)),
                        pitch: 0
                    })
                    let block = getBlock(pos.x, pos.y + heigh, pos.z)
                    if (modes.tr_mode === 0 && block.namespace === "minecraft:air") createParticle(tr_type, pos.x, pos.y + heigh + 0.5, pos.z, 1)
                }
            }
        }

        if (FarmAura) {
            const mp = getEntityBlockPos(self_id)
            for (let dx = -fa_range; dx < fa_range; dx++) {
                for (let dz = -fa_range; dz < fa_range; dz++) {
                    const block = getBlock(mp.x + dx, block_pos.y - 1, mp.z + dz)
                    const block2 = getBlock(mp.x + dx, block_pos.y, mp.z + dz)
                    if ((block.namespace === "minecraft:dirt" || block.namespace === "minecraft:grass") && self_item.namespace.includes('hoe')) buildBlock(self_id, mp.x + dx, block_pos.y - 1, mp.z + dz, 1)
                    if (block.namespace === "minecraft:farmland" && (self_item.namespace === "minecraft:beetroot_seeds" || self_item.namespace === "minecraft:wheat_seeds" || self_item.namespace === "minecraft:carrot" || self_item.namespace === "minecraft:potato")) buildBlock(self_id, mp.x + dx, block_pos.y - 1, mp.z + dz, 1)
                    if (block2.aux === 7 && (block2.namespace === "minecraft:beetroot" || block2.namespace === "minecraft:wheat" || block2.namespace === "minecraft:carrots" || block2.namespace === "minecraft:potatoes")) destroy(self_id, mp.x + dx, block_pos.y, mp.z + dz, 1)
                    if (self_item.namespace === "minecraft:bone_meal" && block2.aux <= 6 && (block2.namespace === "minecraft:beetroot" || block2.namespace === "minecraft:wheat" || block2.namespace === "minecraft:carrots" || block2.namespace === "minecraft:potatoes")) buildBlock(self_id, mp.x + dx, block_pos.y, mp.z + dz, 1)
                }
            }
        }

        if (ActionManager) {
            if (!am_file) {
                if (ticks % am_delay == 0) {
                    for (let i = 0; i < am_count; i++) sendPlayerAction({
                        id: self_id,
                        pos: {
                            x: block_pos.x,
                            y: block_pos.y - 1,
                            z: block_pos.z
                        },
                        type: Number(am_id),
                        value: Number(am_value)
                    })
                }
            } else {
                const action_config = JSON.parse(readFile(nx_paths + '/PlayerAction.json'))
                action_config.forEach(action => {
                    if (action.delay % am_tick === 0) {
                        for (let i = 0; i < action.count; i++) sendPlayerAction({
                            id: self_id,
                            pos: self_pos,
                            value: action.value,
                            type: Number(action.id)
                        })
                    }
                })
            }
        }

        if (PlayerAuthManager && ticks % pam_delay === 0) {
            for (let i = 0; i < pam_count; i++) sendPlayerAuthInput({
                pos: {
                    x: block_pos.x,
                    y: block_pos.y - 1,
                    z: block_pos.z
                },
                inputs: pam_array.map(id => Number(id)),
                actions: [{
                    id: self_id,
                    pos: self_pos,
                    type: Number(pam_id),
                    value: Number(pam_value)
                }]
            })
        }

        if (mine_destroy && (mine_list.length === 0 || mine_current >= mine_num)) {
            mine_destroy = false
            mine_name = null
            mine_list = []
            mine_current = 0
        }

        if (AutoJump && on_ground) setMotion(self_motion.x, aj_y / 100, self_motion.z)

        if (BlockClicker && !bc_select && ac_pos.length > 0 && ticks % bc_delay == 0) ac_pos.forEach(pos => {
            if (bc_packet) silentMove(pos.x, pos.y, pos.z)
            buildBlock(self_id, pos.x, pos.y, pos.z, 0)
        }) // 方块连点

        if (NoFall && self_motion.y < -nf_max && !on_ground) {
            if (modes.nf_mode === 0) setMotion(0, 0, 0)
            if (modes.nf_mode === 1) {
                callModule(37, JSON.stringify({
                    value: true
                }))
                setTimeout(() => callModule(37, JSON.stringify({
                    value: false
                })), 100)
            }
            if (modes.nf_mode === 2) {
                callModule(30, JSON.stringify({
                    value: true,
                    speed: 0
                }))
                setTimeout(() => JSON.stringify({
                    value: false
                }), 75)
            }
            if (modes.nf_mode === 3) sendPlayerAction({
                id: self_id,
                pos: self_pos,
                value: 1,
                type: 7
            })
        }

        if (DrawOval && ((ticks % do_delay === 0 && do_cycle) || (do_jump && prev_ground != on_ground && on_ground))) {
            if (do_lock) do_pos = [self_pos.x, self_pos.y - 1.5, self_pos.z]
            for (let angle = 0; angle < 360; angle += do_density / 10) {
                const oval_x = do_l_axis * Math.cos(angle * Math.PI / 180)
                const oval_y = do_s_axis * Math.sin(angle * Math.PI / 180)
                createParticle(56, do_pos[0] + oval_x, do_pos[1], do_pos[2] + oval_y, 1)
            }
        }

        if (FakeLag) {
            if (fl_t >= fl_normal + fl_abnormal) {
                fakelag_status = !fl_reverse
                fl_t = 0
            }
            if (fl_t > fl_normal && fl_t < fl_normal + fl_abnormal) fakelag_status = fl_reverse
            if (fl_show) message.push(makeMsg(1, 'LagStatus', `停止发包: ${(fakelag_status&&modes.fl_mode === 0)}, 停止发送移动包: ${(fakelag_status&&modes.fl_mode === 1)}, 停止接受移动包 ${(fakelag_status&&modes.fl_mode === 2)}, 停止收包: ${(fakelag_status&&modes.fl_mode === 3)}`, '§r'))
        }

        if (fb_list.length > 0 && fb_t > fb_delay && !fb_success) {
            const bp = fb_list.shift()
            buildBlock(self_id, Math.round(bp.x), Math.round(bp.y - 1), Math.round(bp.z), 0)
            fb_t = 0
            if (fb_list.length === 0) fb_success = true
        }

        if (TargetHealth && at_lists.length > 0) message.push(makeMsg(1, 'Health', `Health: ${getHealth(at_lists[0], modes.health_mode)}`, '§r'))

        if (ShowTargetList && at_lists.length > 0) message.push(makeMsg(1, 'Targets', obj2str(at_lists.map(id => getEntityName(id))), '§r'))

        if (ShowInfo) {
            const speed = getEntityAttribute(self_id, 'minecraft:movement')
            const hor_mot_speed = Math.sqrt(self_motion.x * self_motion.x + self_motion.z * self_motion.z)
            if (show_speed) message.push(makeMsg(1, 'Speed', "水平移动速度: " + hor_mot_speed.toFixed(2) + "m/s 移动速度: " + bps_mot.toFixed(2) + "m/s\n水平坐标速度: " + bps_hor.toFixed(2) + "m/s 坐标速度:" + bps.toFixed(2) + "m/s" + " 能力速度:" + speed.current.toFixed(2) + `\n移动值: [${self_motion.x.toFixed(2)}, ${self_motion.y.toFixed(2)}, ${self_motion.z.toFixed(2)}]`, '§r'))
            if (show_pos) message.push(makeMsg(1, 'Pos', `EntityPos:[X:${self_pos.x}, Y:${self_pos.y}, Z:${self_pos.z}]\nBlockPos:[X:${block_pos.x}, Y:${block_pos.y}, Z:${block_pos.z}]`, '§r'))
            if (show_item && self_item.count > 0) message.push(makeMsg(1, 'Item', `${self_item.name} §r§ox${getItemCount(-1)}`, '§r'))
            if (show_resources) {
                const res = {
                    gold: getItemCount(-2, 'minecraft:gold_ingot'),
                    iron: getItemCount(-2, 'minecraft:iron_ingot'),
                    diamond: getItemCount(-2, 'minecraft:diamond'),
                    emerald: getItemCount(-2, 'minecraft:emerald'),
                    star: getItemCount(-2, 'minecraft:nether_star')
                }
                const level = getEntityAttribute(self_id, 'minecraft:player.level').current
                message.push(makeMsg(1, 'Resource', `绿宝石:${res.emerald}, 钻石:${res.diamond}, 金锭:${res.gold}, 铁锭:${res.iron}\n下界之心:${res.star}, 经验:${level}`, '§r'))
            }
            if (show_kill_num) message.push(makeMsg(1, 'Kills', `击杀: ${kills}人`, '§r'))
            if (show_time) message.push(makeMsg(1, 'Time', `Time: ${timeFormat(seconds)}, Ticks: ${ticks}`, '§r'))
            if (show_attack_rate) message.push(makeMsg(1, 'AttackInfo', `命中率: ${Math.round(real_attack / attack_frequency * 100)}%%, 攻击总次数: ${attack_frequency}, 空刀次数:${attack_frequency - real_attack}, 命中次数:${real_attack}`, '§r'))
            if (show_real_aps) message.push(makeMsg(1, 'CPS', `点击CPS: ${Math.round(click_num / click_t * 20)-20}/s 预期APS: ${Math.round(attack_frequency / attack_ticks * 20)-20}/s, 实际APS: ${Math.round(real_attack / attack_ticks * 20)}/s`, '§r'))
            if (show_ping) message.push(makeMsg(1, 'PING', `${gd_ping}ms`, '§r'))
            if (show_self_health) message.push(makeMsg(1, 'Health', `当前血量: ${self_heal.current}, 最大值:${self_heal.max}, 最小值:${self_heal.min}`, '§r'))
            if (show_detail_item) message.push(makeMsg(1, 'ItemData', `JSON:${JSON.stringify(self_item)}\n\nNBT:${getEntityCarriedItem(self_id)}`, '§r'))
            if (show_real_time) {
                const now = new Date();
                const year = now.getFullYear();
                const month = ('0' + (now.getMonth() + 1)).slice(-2);
                const day = ('0' + now.getDate()).slice(-2);
                const hours = ('0' + now.getHours()).slice(-2);
                const minutes = ('0' + now.getMinutes()).slice(-2);
                const seconds = ('0' + now.getSeconds()).slice(-2);
                const formattedTime = year + '-' + month + '-' + day + ' ' + hours + ':' + minutes + ':' + seconds;
                message.push(makeMsg(1, 'RealTime', formattedTime, '§r'))
            }
        }

        if (ModifySwing && ms_speed != 0) setEntityEffect(self_id, {
            id: (ms_speed < 0 ? 4 : 3),
            duration: 20,
            amplifier: ms_speed < 0 ? (-ms_speed) : ms_speed,
            displayOnScreenTextureAnimation: false,
            noCounter: true,
            ambient: true,
            effectVisible: false
        })

        if (EffEctManager) {
            if (em_nv) setEntityEffect(self_id, {
                id: 16,
                duration: 20,
                amplifier: em_level,
                displayOnScreenTextureAnimation: false,
                noCounter: true,
                effectVisible: false,
                ambient: true
            })
            if (em_eff) setEntityEffect(self_id, {
                id: 3,
                duration: 20,
                amplifier: em_level,
                displayOnScreenTextureAnimation: false,
                noCounter: true,
                effectVisible: false,
                ambient: true
            })
        }

        if (rc_angles.angle) {
            let yaw = self_rot.yaw
            yaw += (rc_angles.angle < 90) ? rc_angles.angle + 90 : rc_angles.angle - 270
            if (yaw >= 180) yaw -= 360 // 135 -- -45
            if (yaw <= -180) yaw += 360 // 135 -- -45

            let move_speed = ((on_ground) ? 0.22 : 0.23) + ((rc_boost) ? (rc_speed / 100) : 0)
            let spr_speed = ((on_ground) ? 0.29 : 0.3) + ((rc_boost) ? (rc_speed / 100) : 0)
            let end_pos = {}
            if (rc_surround && at_lists.length > 0 && getDistanceByID(self_id, at_lists[0]) <= rc_lock) {
                let Angle = getPlayerAngle(self_id, at_lists[0], "yaw_pos")
                let Angle3 = getPlayerAngle(self_id, at_lists[0], "yaw_rot")
                let t = (Angle3 > -90 || Angle3 < 90) ? rc_speed : -rc_speed
                let t2 = (yaw > -90 || yaw < 90) ? rc_speed : -rc_speed
                let now_angle = (rc_relative) ? t : t2
                Angel = ((rc_angles.angle > (450 - rc_range) && rc_angles.angle <= (rc_range + 180)) || (rc_angles.angle > (180 - rc_range) && rc_angles.angle <= (rc_range - 90))) ? (Angle -= now_angle * 5) : (Angle += now_angle * 5)
                if (Angle > 180) Angle -= 360
                if (Angle < -180) Angle += 360
                let temp_pos = calDisplacement(rc_dist, getPos(at_lists[0]), {
                    yaw: Angle,
                    pitch: 0
                })
                let Angle2 = getPlayerAngle(temp_pos, self_id, "yaw_pos")

                end_pos = calDisplacement((rc_legal) ? ((modes.rc_mode === 0) ? move_speed : spr_speed) : (rc_speed / 8), self_pos, {
                    yaw: Angle2,
                    pitch: 0
                })
            } else end_pos = calDisplacement((rc_legal) ? ((modes.rc_mode === 0) ? move_speed : spr_speed) : (rc_speed / 8), self_pos, {
                yaw,
                pitch: 0
            })
            Camera_anchor_pos = {
                x: Camera_anchor_pos.x + (end_pos.x - self_pos.x),
                y: Camera_anchor_pos.y,
                z: Camera_anchor_pos.z + (-end_pos.z + self_pos.z)
            }
            if (rc_follow && modes.rocker_mode < 3) {
                if (Scaffold && sca_moveRot && self_moving && getEntityIsGround(self_id) && self_item.isBlock) silentRot(sca_pitch, (sca_len === 1 ? 0 : 180) + yaw + sca_yaw)
                else silentRot(self_rot.pitch, yaw - 180)
            }
            if (modes.rocker_mode === 2) setCameraAnchor(Camera_anchor_pos.x, Camera_anchor_pos.y, Camera_anchor_pos.z)
            if (modes.rocker_mode === 3) {
                if ((rc_angles.angle < 315 && rc_angles.angle > 225) || (rc_angles.angle > 45 && rc_angles.angle < 135)) {
                    end_pos = calDisplacement(rc_speed / 8, self_pos, self_rot)
                    setMotion(end_pos.x - self_pos.x, end_pos.y - self_pos.y, end_pos.z - self_pos.z)
                } else {
                    const offset = (rc_angles.angle > 315 || rc_angles.angle < 45)
                    const C = getCameraRotation()
                    rc_roll += (offset ? 1 : -1) * getSpeed(self_id) / 5
                    setCameraRotation(rc_pitch, rc_yaw, rc_roll)
                }
            }
            if (modes.rocker_mode === 0) setMotion(end_pos.x - self_pos.x, (((rc_bhop && on_ground) || (rc_ahop && self_motion.y < -0.4))) ? rc_y : self_motion.y, end_pos.z - self_pos.z)
            if (modes.rocker_mode === 1) setPos(end_pos.x, self_pos.y, end_pos.z)
            if (rc_directions.direction === 0) rc_angles = {}
        }

        if (typeof rc_uds.operation !== 'undefined' && (on_ground || !rc_antiair)) {
            const self_motion = getEntityMotion(self_id)
            const C = getCameraRotation()
            if (rc_uds.operation === "up") {
                Camera_anchor_pos.y += rc_y
                if (modes.rocker_mode === 1) setPos(self_pos.x, self_pos.y + rc_y, self_pos.z)
                if (modes.rocker_mode === 0) setMotion(self_motion.x, rc_y, self_motion.z)
                if (modes.rocker_mode === 2) setCameraAnchor(Camera_anchor_pos.x, Camera_anchor_pos.y, Camera_anchor_pos.z)
                if (modes.rocker_mode === 3) {
                    rc_yaw -= Math.sin(C.roll * Math.PI / 180) * 2
                    rc_pitch += Math.cos(C.roll * Math.PI / 180) * 2
                    setCameraRotation(rc_pitch, rc_yaw, rc_roll)
                }
            }
            if (rc_uds.operation === "down") {
                Camera_anchor_pos.y -= rc_y
                if (modes.rocker_mode === 1) setPos(self_pos.x, self_pos.y - rc_y, self_pos.z)
                if (modes.rocker_mode === 0) setMotion(self_motion.x, -rc_y, self_motion.z)
                if (modes.rocker_mode === 2) setCameraAnchor(Camera_anchor_pos.x, Camera_anchor_pos.y, Camera_anchor_pos.z)
                if (modes.rocker_mode === 3) {
                    rc_yaw += Math.sin(C.roll * Math.PI / 180) * 2
                    rc_pitch -= Math.cos(C.roll * Math.PI / 180) * 2
                    setCameraRotation(rc_pitch, rc_yaw, rc_roll)
                }
            }
            if (rc_yaw >= 180) rc_yaw -= 360 // 135 -- -45
            if (rc_yaw <= -180) rc_yaw += 360 // 135 -- -45
            if (rc_pitch > 180) rc_pitch = 180 // 135 -- -45
            if (rc_pitch < 0) rc_pitch = 0 // 135 -- -45
            if (rc_uds.operation === "none") rc_uds = {}
        }

        if (BalanceTimer || BalanceTimer_st) {
            message.push(makeMsg(1, 'BalanceTimer', '储存的Tick: ' + BalanceTimer_t + "ticks", '§r'))
            if (BalanceTimer_t <= 0 && BalanceTimer_st) {
                callModule(30, JSON.stringify({
                    value: false
                }))
                BalanceTimer_st = false
            }
            if (BalanceTimer_t > 0 && bt_lock) setMotion(0, 0, 0)
        }

        if (ModifyTime) {
            if (mt_speed != 20) {
                let time = (ticks * mt_speed / 20) % 24000
                setWorldData({
                    time
                })
            } else if (mt_custom === 25) {
                let time = 0
                if (modes.mt_time === 0) time = 1000
                if (modes.mt_time === 1) time = 13000
                if (modes.mt_time === 2) time = 6000
                if (modes.mt_time === 3) time = 12500
                setWorldData({
                    time
                })
            } else setWorldData({
                time: mt_custom * 1000 // 24000
            })
        }

        if (!BalanceTimer && BalanceTimer_t > 0 && BalanceTimer_st) BalanceTimer_t--;

        if (bk_pos != null) {
            const {
                ex,
                ey,
                ez
            } = bk_pos
            destroyBlock(self_id, ex, ey, ez, 0)
            packetDestroy(ex, ey, ez, bk_auth, bk_action)
            if (bk_timer > bk_last) bk_pos = null
            bk_timer++
        }

        if (FakeTip) {
            switch (modes.fakeTip_mode) {
                case 0:
                    _minecraft.showTipMessage("§bProtoHax §r| " + bps.toFixed(2) + " §eBlocks/sec");
                    break;
                case 1:
                    if (tip_t1 > 200) {
                        _https.get('https://v1.jinrishici.com/jieri/chunjie', {}, (r, d) => globalThis.current_poem = JSON.parse(d)['content']);
                        tip_t1 = 0;
                    }
                    _minecraft.showTipMessage("[§bCheat§ePlugin§r] " + current_poem);
                    break;
                case 5:
                    _minecraft.showTipMessage("Ping: " + gd_ping + "ms Speed: " + bps.toFixed(2) + "B/S APS: " + Math.round(real_attack / attack_ticks * 20));
                    break;
                case 6:
                    _minecraft.showTipMessage("§cWelcome to use §rTianYuByte");
                    break;
            }
        }

        if (sm_circulate_t > sm_circulate_tick && !sm_status) {
            sm_status = true
            sm_circulate_t = 0
        }

        if (SlowMotion && sm_status) {
            callModule(30, JSON.stringify({
                value: true,
                speed: sm_speed / 10
            }))
            setTimeout(() => {
                callModule(30, JSON.stringify({
                    value: true,
                    speed: 20
                }))
                sm_status = false
            }, sm_circulate_last_tick * 50)
        }

        if (mine_list.length > 0 && mine_destroy) {
            for (let i = 0; i < mine_speed; i++) {
                let p = mine_list.shift()
                if (typeof p != "object" || p.length === 0) continue;
                const block = getBlock(p[0], p[1], p[2])
                if (block.namespace != "minecraft:air" && block.namespace === mine_name) {
                    destroy(self_id, p[0], p[1], p[2], 0)
                    mine_current++;
                }
            }
            if (mine_info) message.push(makeMsg(1, 'Miner', `进度: ${mine_current}/${mine_num} - ${(mine_current/mine_num*100).toFixed(2)}%%\n${getProgress(mine_current, mine_num, '▌', 32)}`, '§r'));
        }

        if (AirStuck && as_time_t < as_time) nxJump(2)

        if (message.length > 0 && !FakeTip) {
            if (modes.tipType_mode === 0) _minecraft.showTipMessage("§b◇ §r§lNoveXare §r§7>>> §r" + message.join("\n"))
            if (modes.tipType_mode === 1) updateTextContent(tip_id, message.join('\n'))
            if (modes.tipType_mode === 2) updateTextContent(tip_id, message.join(' | '))
        }
        if (TargetHud && modes.th_select_mode == 1) th_tick++
        if (modes.tipType_mode >= 1) {
            updateTextPosition(tip_id, nx_screen.screenWidth * tip_x_offset / 100, nx_screen.screenHeight * tip_y_offset / 100)
            updateTextColor(tip_id, tip_r / 100, tip_g / 100, tip_b / 100, tip_a / 100)
            updateTextScale(tip_id, tip_size)
        } else updateTextContent(tip_id, '')

        if (prev_id != self_id) prev_id = self_id;
        if (FakeLag) fl_t++;
        if (GodMode) gm_tick++;
        if (SlowMotion && sm_circulate && !sm_status) sm_circulate_t++;
        if (FastBuild && fb_list.length > 0) fb_t++;
        if (ticks % rgb_cycle == 0) rgb_l++;
        if (rgb_l >= rgb_color.length) rgb_l = 0
        if (attack_tick > 20 && as_gradually) as_level = 0
        if (isAttacking) {
            attack_ticks++;
            isAttacking = false
        }
        if (isClicking) {
            click_t++;
            isClicking = false
        }
        attack_tick++;
        if (ChestStealer && ticks % cs_tick === 0) cs_current = 0
        if (ChestStealer && cs_close && cs_current === 0 && cs_timer === (cs_delay + 1)) deleteContainer()
        if (ChestStealer && cs_timer > cs_tick) cs_sort = 0
        if (ChestStealer) cs_timer++
        if (HotbarSelector) select_t++;
        if (rpc_cycle) rpc_t++;
        if (InfiniteAura) ia_delay_r++;
        if (FakeTip && modes.fakeTip_mode === 1) tip_t1++;
        if (select_t > hs_delay) {
            select_slot++;
            select_t = 0;
        }
        if (select_slot > 8) select_slot = 0;
        if (at_lists.length > 0 && ia_switch === 0) ia_tmp_list = at_lists
        if (ia_switch > 0 && ia_delay_r > ia_switch && ia_tmp_list.length > 0) {
            ia_targets[0] = ia_tmp_list.shift()
            ia_delay_r = 0
        }
        if (ia_switch === 0 && at_lists.length > 0) ia_targets = at_lists
        if (mini_kills > 0) mini_tick++
        if (at_tick > at_max_time) {
            at_tick = 0
            at_current = 0
        }
        if (AntiText) at_tick++;
        if (mini_tick > 100) {
            mini_kills = 0
            mini_tick = 0
        }
        if (BalanceTimer && !BalanceTimer_st) BalanceTimer_t++;
        seconds = Math.floor(ticks / 20)
        ticks++;
        if (AirStuck) as_time_t++;

        prev_pos = self_pos;
        prev_item = self_item;
        prev_heal = self_heal.current
        prev_ground = on_ground
        prev_itemCount = self_itemCount
    } catch (e) {
        _minecraft.clientMessage(e.stack)
    }
    if (ShowNXInfo) addCustomArrayList('NoveXare', `NoveXare | 用户: ${getEntityName(self_id)} | 目标数量: ${at_lists.length}个 实体数量: ${getEntityList().length} 玩家数量: ${getWorldPlayerList().length}`, `NoveXare | 用户: ${getEntityName(self_id)} | 目标数量: ${at_lists.length}个 实体数量: ${getEntityList().length} 玩家数量: ${getWorldPlayerList().length}`, true);
}

setInterval(() => {
    if (bn_list.length > 0) {
        for (let i = bn_list.length - 1; i >= 0; i--) {
            bn_list[i].x -= bn_list[i].speed;
            if (bn_list[i].x < 0) {
                bn_list.splice(i, 1);
                removeText(bn_list[i].id)
            } else updateTextPosition(bn_list[i].id, bn_list[i].x, bn_list[i].y)
        }
    }
    if (MobileWaterMark) {
        mwm_pos[0] += mwm_vector[0] * mwm_speed / 5;
        mwm_pos[1] += mwm_vector[1] * mwm_speed / 5;
        if (mwm_pos[0] > nx_screen.screenWidth || mwm_pos[0] < 0) mwm_vector[0] *= -1
        if (mwm_pos[1] > nx_screen.screenHeight || mwm_pos[1] < 0) mwm_vector[1] *= -1
        updateTextPosition(mwm_id, mwm_pos[0], mwm_pos[1])
        updateTextScale(mwm_id, mwm_size)
    }
    if (Derp) {
        var self_rot = getEntityRot(self_id)
        if (modes.derp_mode === 0) {
            setEntityRot(self_id, dp_pitch, dp_yaw)
            setEntityBodyRot(self_id, dp_yaw)
        }
        if (modes.derp_mode === 1) sendPlayerAuthInput({
            inputMode: 2,
            playMode: 0,
            pos: self_pos,
            motion: getEntityMotion(self_id),
            rot: {
                pitch: dp_pitch,
                yaw: dp_yaw
            },
            yHeadRot: dp_yaw,
            inputs: []
        })
        if (modes.derp_mode === 2) _packet.sendMovePlayerPacket({
            id: self_id,
            pos: self_pos,
            mode: 0,
            ground: getEntityIsGround(self_id),
            rot: {
                pitch: dp_pitch,
                yaw: dp_yaw
            },
            yHeadRot: 0
        })
        dp_pitch -= (dp_random ? getRand(-10, 10) : (dp_headSpeed * 2));
        dp_yaw += (dp_random ? getRand(-10, 10) : (dp_bodySpeed * 2));
        if (dp_pitch < -90) dp_pitch = 90
        if (dp_yaw > 180) dp_yaw = dp_yaw - 360
        if (!dp_head) dp_pitch = self_rot.pitch
        if (!dp_body) dp_yaw = self_rot.yaw
        if (dp_lock) dp_pitch = 90
    }
    if (Scaffold && sca_moveRot && self_moving && getEntityIsGround(self_id) && self_item.isBlock) {
        const rot = getCameraRotation()
        const goal = predictPos(getEntityMotion(self_id), getPos(self_id), 5);
        const yaw = sca_move ? getPlayerAngle(goal, self_id, "yaw_pos") : rot.yaw > 0 ? (180 - rot.yaw) : (-180 - rot.yaw);
        silentRot(sca_pitch, (sca_len === 1 ? 0 : 180) + yaw + sca_yaw)
    }
    if (AssistAim && aa_silent && at_lists.length > 0) {
        let need_pitch = getPlayerAngle(self_id, at_lists[0], "pitch_pos")
        let need_yaw = getPlayerAngle(self_id, at_lists[0], "yaw_pos")
        silentRot(need_pitch, need_yaw)
    }
    if (ItemRotation) {
        ir_angle += (ir_isBack ? -1 : 1) * 0.0175 * ir_speed
        if (ir_angle >= 6.3 * ir_max / 360) {
            if (ir_move) ir_isBack = true
            else ir_angle = ir_min
        }
        if (ir_angle <= 6.3 * ir_min / 360) ir_isBack = false
        callModule(38, JSON.stringify({
            rotate_angle: ir_angle
        }))
    }
}, 10)

function onExecuteCommandEvent(cmd) {
    if (ActivitySender) _minecraft.sendChatMessage('我正在执行命令')
    if (ShowCommand) makeMsg(0, 'ExecuteCMD', cmd, '§r')
    const msg = cmd.split(' ')
    if (msg[0] === "/set" && msg[1] === 'pos') {
        nx_goal = {
            x: Number(msg[2]),
            y: Number(msg[3]),
            z: Number(msg[4])
        }
        if (msg[5]) nx_goalSpeed = Number(msg[5])
        makeMsg(0, 'Tip', '已设置目标坐标 准备赶路', '§r')
        return true
    }
    if (msg[0] === "/set" && msg[1] === 'default' && msg[2] === 'config') {
        if (msg[3] === 'clear') {
            makeMsg(0, 'Tip', '已清除默认配置', '§r')
            setData("nx_defaultCfg", 'null')
            return true
        }
        if (readFile(nx_cfgs + '/' + msg[3] + '.json') != '{}') {
            setData("nx_defaultCfg", msg[3])
            makeMsg(0, 'Tip', '已设置默认配置 - ' + msg[3], '§r')
        } else makeMsg(0, 'Tip', '文件为空或不存在 - ' + msg[3], '§r')
        return true
    }
    if (msg[0] === "/target") {
        if (msg[1] === "self") at_lists[0] = self_id
        if (msg[1] === "player") at_lists = getPlayerList()
        if (msg[1] === "all") at_lists = getEntityList()
        makeMsg(0, 'Tip', '已设置' + at_lists.length + '个目标', '§r')
        return true
    }
    if (msg[0] === "/cleaner") {
        if (msg[1] === 'reload') clear_config = JSON.parse(readFile(cleaner_path))
        if (msg[1] === 'load') clear_config = JSON.parse(readFile(msg[2]))
    }
    if (msg[0] === "/bind") {
        if (msg[1] === "RunAway") {
            if ((typeof globalThis[msg[2]] == 'undefined' && typeof nx_funcid[msg[2]] == 'undefined') || (typeof globalThis[msg[3]] == 'undefined' && typeof nx_funcid[msg[3]] == 'undefined')) {
                makeMsg(0, 'Tip', 'NX功能Key不存在 或跑路功能Tag不存在', '§r')
                return true
            }
            let isNX = typeof globalThis[msg[3]] !== 'undefined'
            nx_raBinds[msg[2]] = {
                module: msg[3],
                isNX
            }
            makeMsg(0, 'Tip', '绑定 ' + msg[2] + ' 与 ' + msg[3] + ' 成功', '§r')
            nx_cfg.nx_raBinds = nx_raBinds
            return true
        }
        if (msg[1] === "key" && typeof globalThis[msg[2]] !== 'undefined') {
            nx_isBind = msg[2]
            makeMsg(0, 'Tip', '按下任意按键与' + msg[2] + '绑定', '§r')
            return true
        }
        if (typeof nx_binds[msg[1]] === 'undefined') nx_binds[msg[1]] = []
        if (typeof globalThis[msg[2]] !== 'undefined' && typeof globalThis[msg[1]] !== 'undefined') {
            nx_binds[msg[1]].push(msg[2])
            makeMsg(0, 'Tip', '绑定 ' + msg[1] + ' 与 ' + msg[2] + ' 成功', '§r')
            nx_cfg.binds = nx_binds
        } else makeMsg(0, 'Tip', '功能Key不存在', '§r')
        return true;
    }
    if (msg[0] === "/unbind") {
        if (msg[1] === "key" && typeof globalThis[msg[2]] !== 'undefined') {
            for (let i in nx_keys) {
                if (nx_keys[i] === msg[2]) {
                    delete nx_keys[i]
                    break
                }
            }
            nx_isBind = msg[2]
            makeMsg(0, 'Tip', '解除' + msg[2] + '的按键绑定', '§r')
            return true
        }
        if (typeof nx_binds[msg[1]] === 'undefined') {
            makeMsg(0, 'Tip', '该功能没有绑定任何功能', '§r')
            return true;
        }
        if (typeof globalThis[msg[1]] !== 'undefined' && msg[2] === 'all') {
            delete nx_binds[msg[1]]
            makeMsg(0, 'Tip', '解除 ' + msg[1] + ' 的所有绑定', '§r')
            nx_cfg.binds = nx_binds
            return true;
        }
        if (msg[1] === 'all') {
            nx_binds = {}
            makeMsg(0, 'Tip', '解除所有功能绑定', '§r')
            nx_cfg.binds = nx_binds
            return true;
        }
        if (typeof globalThis[msg[2]] !== 'undefined' && typeof globalThis[msg[1]] !== 'undefined') {
            nx_binds[msg[1]].splice(nx_binds[msg[1]].indexOf(msg[2]), 1)
            if (nx_binds[msg[1]].length === 0) delete nx_binds[msg[1]]
            makeMsg(0, 'Tip', '解除绑定 ' + msg[1] + ' 和 ' + msg[2] + ' 成功', '§r')
            nx_cfg.binds = nx_binds
        } else makeMsg(0, 'Tip', '功能Key不存在', '§r')
        return true;
    }
    if (msg[0] === "/nx") {
        if (typeof globalThis[msg[2]] === 'undefined') {
            makeMsg(0, 'Tip', '变量不存在', '§r')
            return true
        }
        if (msg[1] === 'num') globalThis[msg[2]] = Number(msg[3])
        if (msg[1] === 'bool') globalThis[msg[2]] = Boolean(msg[3])
        if (msg[1] === 'str') globalThis[msg[2]] = msg[3]
        if (msg[1] === 'arr') globalThis[msg[2]] = str2obj(msg[3])
        if (msg[1] === 'obj') globalThis[msg[2]] = JSON.parse(msg[3])
        makeMsg(0, 'setValue', globalThis[msg[2]] + ' => ' + msg[2], '§r')
        return true
    }
}

function onCommandOutputEvent(type, args, value) {
    if (ShowCommandOutput) makeMsg(0, 'Tip', `§e类型:§r${type} §e结果:§r${value} §e数据:§r${JSON.stringify(args, null, 2)}`, '§r')
    if (Crasher && modes.cs_mode === 8 && !value) return true
}

function onCallModuleEvent(fun) {
    if (ShowUI) makeMsg(0, 'UI-Data', JSON.stringify(fun, null, 4), '§r')
    try {
        if (typeof fun !== 'undefined' && typeof fun.fun !== 'undefined' && typeof nx_raBinds[fun.fun] !== 'undefined') {
            const module = nx_raBinds[fun.fun].module
            if (!nx_raBinds[fun.fun].isNX) callModule(nx_funcid[module], JSON.stringify({
                value: fun.value
            }))
            else nxCall(module, fun.value)
        }
        if (ActivitySender) _minecraft.sendChatMessage('我正在调用UI')
        if (PVPDaLao) _minecraft.setTitle("又或是红石大佬")
        if (typeof fun.name === 'undefined') {
            if (Rocker && typeof fun.angle !== 'undefined') rc_angles = fun
            if (Rocker && typeof fun.direction !== 'undefined') rc_directions = fun
            if (Rocker && typeof fun.operation !== 'undefined') rc_uds = fun
            return;
        }
        if (!fun.name.includes('NoveXare') && fun.fun != 'fun_ride_flying') return;
        if (typeof fun.SauthLogin !== 'undefined') {
            Sauths = fun.SauthLogin
            setData('sauths', Sauths)
            _app.showToast('请退出我的世界登录 并重新登录')
        }
        if (typeof fun.CustomBanTip !== 'undefined') bantip = fun.CustomBanTip
        if (typeof fun.key !== 'undefined') {
            const key = fun.key
            if (key === "ItemEditor") {
                const nbt = getEntityCarriedItem(self_id)
                const aux = splitText(nbt, 'Damage:', 's')
                const damage = splitText(nbt, '{Damage:', '}', ',')
                if (modes.itemedit_mode === 0) setEntityCarriedItem(self_id, nbt.replace('Damage:' + aux + 's', 'Damage:' + ie_data + 's'))
                if (modes.itemedit_mode === 1) setEntityCarriedItem(self_id, nbt.replace('{Damage:' + damage, '{Damage:' + ie_data))
                if (modes.itemedit_mode > 1) setEntityCarriedItem(self_id, nbt.replace('{', '{' + (modes.itemedit_mode === 2 ? 'CanPlaceOn' : 'CanDestroy') + ':' + nx_blocks + ','))
                if (ie_drop) setTimeout(() => dropPlayerInventorySlot(self_id, getPlayerSelectItemSlot(self_id), false, true), ie_delay * 50)
                else _app.showToast('请长按物品栏丢弃手中物品')
            }
            if (key === "EditBackGround") {
                const importFileName = 'loginVideoNew.mp4';
                const importPath = '/data/user/0/com.netease.x19/files/games/com.netease/storge/asset/';
                if (!_fs.exists(_app.getResource() + '/' + importFileName)) {
                    _app.showToast('请将视频改成loginVideoNew.mp4 并放在 ' + _app.getResource() + ' 中')
                    return;
                }
                _fs.remove(importPath + importFileName)
                file_copy(_app.getResource() + '/' + importFileName, importPath + importFileName);
                _app.showToast('已复制文件');
            }
            if (key === "ServerTeleport") {
                let list = getWorldPlayerList()
                let buttons = (list.length > 0) ? list.map(target => ({
                    text: target.name,
                })) : [{
                    text: '没有数据'
                }]
                let menu = {
                    type: 'form',
                    title: '选择',
                    content: '选择一个目标',
                    buttons
                };
                const json = JSON.stringify(menu);
                addForm(json, function(index) {
                    if (list.length > 0 && index >= 0) {
                        sendPlayerPos(list[index].id)
                        isTP = true
                    }
                });
            }
            if (key === "exit") {
                makeMsg(0, 'Tip', 'Exit Script!', '§c')
                if (AutoSaveCfg) {
                    makeMsg(0, 'Tip', "自动保存当前配置", '§r')
                    const time = Date.now()
                    _fs.write(nx_cfgs + "/自动保存配置 - " + time + ".json", JSON.stringify(nx_cfg, null, 4))
                    if (AutoLoadCfg) setData("nx_defaultCfg", "自动保存配置 - " + time)
                }
                _safeExit();
                _v8.gc();
            }
            if (key === "DropInv") {
                for (let i = 0; i < 36; i++) {
                    const item = getInventory(self_id, i)
                    if (item.namespace === "minecraft:air") continue;
                    if (item.count < 1) continue;
                    dl_list.push(i)
                }
            }
            if (key === "LookTP") {
                let goal = {}
                for (let i = 0; i < 500; i++) {
                    goal = calDisplacement(i, getPos(self_id), getEntityRot(self_id))
                    const block = getBlock(goal.x, goal.y, goal.z)
                    if (block.namespace != "minecraft:air") break
                }
                if (goal != {}) {
                    const pos = getPos(self_id)
                    if (modes.LookTP_mode === 0) motTP(goal.x, goal.y + 1.53, goal.z)
                    if (modes.LookTP_mode === 1) setPos(goal.x, goal.y + 1.53, goal.z)
                }
            }
            if (key === "OpenChest") {
                let jbon = {
                    type: 'form',
                    title: '容器列表',
                    content: '请选择需要打开的容器',
                    buttons: [{
                        text: "暂无容器"
                    }]
                };
                let container_pos = []
                let container_num = 0
                let target_pos = getEntityBlockPos(self_id)
                const namespaces = ["minecraft:barrel", "minecraft:chest", "minecraft:trapped_chest"];
                const shulkerBox = "shulker_box";

                for (let dx = -7; dx < 7; dx++) {
                    for (let dy = -7; dy < 7; dy++) {
                        for (let dz = -7; dz < 7; dz++) {
                            const x = dx + target_pos.x;
                            const y = dy + target_pos.y;
                            const z = dz + target_pos.z;
                            const block = getBlock(x, y, z);

                            if (namespaces.includes(block.namespace) || block.namespace.includes(shulkerBox)) {
                                const block3 = getBlock(x, y + 1, z);
                                jbon.buttons[container_num] = {
                                    text: `命名空间: ${block.namespace}\n坐标:   ${block3.namespace === 'minecraft:air' ? '' : ' §c=>§e 容器顶上存在方块'}`
                                };
                                container_pos[container_num] = {
                                    x,
                                    y,
                                    z
                                };
                                container_num++;
                            }
                        }
                    }
                }

                if (container_num === 0) {
                    makeMsg(0, 'Tip', '暂无容器', '§r')
                    return;
                }
                addForm(JSON.stringify(jbon), function(index) {
                    const pos = container_pos[index]
                    buildBlock(self_id, pos.x, pos.y, pos.z, 1)
                    makeMsg(0, 'Tip', '已打开该容器', '§r')
                })
            }
            if (key === "UpJump") setMotion(0, up_down_speed, 0)
            if (key === "DownJump") setMotion(0, -up_down_speed, 0)
            if (key === "rpc_repeat") {
                for (let i = 0; i < rpc_repeat_times; i++) sendRpc(prev_rpc.id, prev_rpc.data)
            }
            if (key === "AttackSelf_one") Attack(self_id, Swing)
            if (key === "RemoveSelf") removeEntity(self_id)
            if (key === "QuitGame") _world.leaveWorld()
            if (key === "sl_delete") setData('sauths', '')
            if (key === "dc_delete") dc_pos = []
            if (key === "SearchModule") {
                addForm('{"type":"custom_form","title":"搜索功能","content":[{"type":"input","text":"功能名或者功能Key","placeholder":"AssistAim或自动瞄准","default":""},{"type": "toggle","text": "模糊搜索","default": true},{"type": "toggle","text": "搜索功能","default": true},{"type": "toggle","text": "搜索功能选项","default": false}]}', function(keyword, match_mode, tag, key) {
                    let ui_show = JSON.parse('{"type":"Menu","title":{"name":"『Search』","size":12,"elevation":3,"background":"$menu_title_background_color","padding":[5,4,5,4],"colors":["$menu_title_gradient_text_begin_color","$menu_title_gradient_text_end_color"]},"color":"$menu_color","alpha":0.9,"items":[{"type":"TextView","name":"NoveXare搜索结果","size":13,"color":"$menu_item_color","tag":"extra_nove_xare","padding":[5,5,5,5],"items":[{"type":"TextView","name":"没有结果","color":"$menu_item_color","size":12,"padding":[5,5,5,5]}]}]}')
                    let matched_num = 0
                    const main_path = _app.getResource();
                    const ui_list = (JSON.parse(_fs.read(main_path + '/ui/ui_definition.json')).ui.map(name => ({
                        name: (name + '.json'),
                        path: (main_path + '/ui/' + name + '.json')
                    })))
                    for (let file of ui_list) {
                        if (!file.name.includes('NoveXare')) continue;
                        let content = JSON.parse(_fs.read(file.path))
                        if (typeof content.items[0].items === 'undefined') continue;
                        for (let func of content.items[0].items) {
                            if (typeof func.name === 'undefined' || typeof func.key === 'undefined') continue;
                            if (tag && func.type != 'Switch') continue
                            if (key && func.type == 'Switch') continue
                            if ((!match_mode && (func.name === keyword || func.key === keyword)) || (match_mode && (func.name.includes(keyword) || func.key.includes(keyword)))) {
                                ui_show.items[0].items[matched_num] = func
                                matched_num++
                            }
                        }
                    }
                    _menu.load('search_' + keyword, JSON.stringify(ui_show))
                    _menu.show('search_' + keyword)
                })
            }
            if (key === "sp_clear") sp_posList = []
            if (key === "sp_add") {
                const {
                    x,
                    y,
                    z
                } = getEntityBlockPos(self_id)
                addForm('{"type":"custom_form","title":"添加坐标","content":[{"type":"input","text":"以英文逗号 , 分割坐标","placeholder":"0,0,0","default":"' + obj2str([x, y, z]) + '"}]}', function(pos) {
                    const p = pos.split(",")
                    sp_posList.push({
                        x: Number(p[0]),
                        y: Number(p[1]),
                        z: Number(p[2]),
                    })
                    makeMsg(0, 'Tip', "添加坐标成功 当前" + sp_posList.length + "组坐标", '§r')
                })
            }
            if (key === "sp_load") {
                const menu = '{"type":"custom_form","title":"输入路径","content":[{"type":"input","text":"路径:","default":""}]}';
                addForm(menu, function(path) {
                    const content = _fs.read(path)
                    if (content != "" && SoundPlayer) {
                        sp_data = JSON.parse(content)
                        sp_file = content
                        sp_length = sp_data.length
                        makeMsg(0, 'Tip', "加载成功 共" + sp_data.length + "条音频数据", '§r')
                    } else makeMsg(0, 'Tip', "加载失败 - 文件为空或不存在或未启用功能", '§r')
                })
            }
            if (key === "sp_select") {
                const menu = {
                    type: 'form',
                    title: '音乐文件',
                    content: '选择要加载的音乐',
                    buttons: [{
                        text: '没有文件'
                    }]
                };
                const files = _fs.list(_app.getResource() + '/sound_manager');
                files.sort((a, b) => a.name.localeCompare(b.name));
                for (let j = 0; j < files.length; j++) {
                    menu.buttons[j] = {
                        text: files[j].name,
                        image: {
                            type: 'path',
                            data: 'textures/ui/sound_glyph_color_2x.png'
                        }
                    }
                }
                const json = JSON.stringify(menu);
                addForm(json, function(index) {
                    if (files.length > 0 && index >= 0) {
                        const content = _fs.read(files[index].path)
                        if (content != "" && SoundPlayer) {
                            sp_data = JSON.parse(content)
                            sp_file = content
                            sp_length = sp_data.length
                            makeMsg(0, 'Tip', "加载成功 共" + sp_data.length + "条音频数据", '§r')
                        } else makeMsg(0, 'Tip', "加载失败 - 文件为空或不存在或未启用功能", '§r')
                    }
                });
            }
            if (key === "save_config") {
                const menu = `{"type":"custom_form","title":"输入保存名称","content":[{"type":"input","text":"名称:","default":"配置_${Object.keys(nx_cfg).length-4}_${Date.now()}"},{"type": "toggle","text": "清除记录的配置","default": false}]}`;
                addForm(menu, function(name, remove) {
                    _fs.write(nx_cfgs + "/" + name + ".json", JSON.stringify(nx_cfg, null, 4))
                    makeMsg(0, 'Tip', '保存成功', '§r')
                    if (remove) nx_cfg = {
                        binds: {},
                        key_binds: [],
                        nx_raBinds: [],
                        name: getEntityName(self_id)
                    }
                })
            }
            if (key === "load_config") {
                const menu = {
                    type: 'form',
                    title: '配置文件',
                    content: '选择要加载的配置',
                    buttons: [{
                        text: '§c没有配置'
                    }]
                };
                const files = _fs.list(nx_cfgs);
                files.sort((a, b) => a.name.localeCompare(b.name));
                for (let j = 0; j < files.length; j++) {
                    menu.buttons[j] = {
                        text: `§e${files[j].name}`,
                        image: {
                            type: 'path',
                            data: 'textures/ui/gear.png'
                        }
                    }
                }
                const json = JSON.stringify(menu);
                addForm(json, function(index) {
                    if (files.length > 0 && index >= 0) {
                        let list = JSON.parse(readFile(files[index].path))
                        let num = 0
                        nx_binds = list.binds
                        nx_keys = list.key_binds
                        nx_raBinds = list.nx_raBinds
                        for (let key in list) {
                            num++;
                            if (key.includes("_mode") && fun.index) modes[key] = list[key]
                            if (key != "nx_raBinds" && key != "key_binds" && key != 'binds' && key != 'name') nxCall(key, list[key])
                        }
                        nx_cfg = list
                        makeMsg(0, 'Tip', "成功加载" + list.name + "的配置，共" + num + "条配置", '§r')
                    }
                });
            }
            if (key === "rpc_select") {
                const menu = {
                    type: 'form',
                    title: 'PyRpc列表',
                    content: '选择PyRpc',
                    buttons: [{
                        text: '没有PyRpc'
                    }]
                };
                let list = JSON.parse(_fs.read(_app.getResource() + "/GBRC/NoveXare/PyRpc_Record.json"))
                for (let j = 0; j < list.length; j++) {
                    menu.buttons[j] = {
                        text: ((list[j]['type'] === "Send") ? "§a" : "§c") + list[j].packet_str
                    }
                }
                const json = JSON.stringify(menu);
                addForm(json, function(index) {
                    const values = Object.values(list[index]['packet_bin']);
                    const buffer = new ArrayBuffer(values.length);
                    const uint8Array = new Uint8Array(buffer);
                    values.forEach((value, index) => {
                        uint8Array[index] = value;
                    });
                    prev_rpc = {
                        id: list[index]['id'],
                        data: buffer
                    }
                    makeMsg(0, 'Tip', "已设置上一条PyRpc", '§r')
                });
            }
            if (key === "cw_range") {
                let List = getPlayerList()
                let num = 0
                for (let i of List) {
                    const pos = getPos(i)
                    const distance = getDistance(pos, getPos(self_id))
                    if (!at_whileLists.includes(i) && distance < cw_size && i != self_id) {
                        at_whileLists.push(i)
                        num++;
                    }
                }
                makeMsg(0, 'Tip', "已添加" + num + "个玩家到白名单", '§r')
            }
            if (key === "KickSelf")
                for (let c = 0; c < 1000; c++) Attack(self_id, Swing)
            if (key === "bc_delete") ac_pos = []
            if (key === "cm_depart") _camera.departCamera()
            if (key === "cm_anchor") setCameraAnchor(0, 0, 0)
            if (key === "cm_reset") _camera.resetCamera()
            if (key === "cm_lock") _camera.lockCamera()
            if (key === "ou_recover") otherId = null
            if (key === "delete_chest") ca_chest_pos = []
            if (key === "do_place") do_pos = [self_pos.x, self_pos.y, self_pos.z]
            if (key === "fm_place") fm_pos = self_pos
            if (key && ['ct_team', 'km_text', 'spm_text', 'am_text', 'ka_text', 'tp_type', 'lp_type', 'ap_type', 'arp_type', 'srp_type', 'th_head', 'tr_type', 'as_type', 'sp_type', 'as_level', 'am_id', 'am_value', 'pam_id', 'pam_value', 'pam_array', 'sp_level', 'cs_text', 'rpc_black', 'rpc_tipWhite', 'rpc_sendBlack', 'cm_black', 'rpc_recBlack', 'rpc_white', 'hs_item', 'hs_slot', 'rpc_sendWhite', 'rpc_recWhite', 'at_typeWhite', 'ie_data', 'mine_white', 'cs_white', 'mine_black', 'cs_black', 'at_regex', 'mwm_text'].includes(key)) editVal(key, globalThis[key])
            if (key === "cw_add" || key === "ct_add" || key === "ct_add") playerSelector(key === "cw_add" ? "at_whileLists" : "at_lists", 1)
            if (key === "fw_target" || key === "fc_target") playerSelector(key === "fw_target" ? "fw_target" : "fc_target", 0)
            if (key === "cm_target") playerSelector('cm_target', 0)
            if (key === "EditY") setPos(self_pos.x, Edit_Y, self_pos.z)
            if (key === "srp_add") srp_type = Number(srp_type) + 1
            if (key === "cw_remove") at_whileLists = []
            if (key === "DumpList") _fs.write(nx_paths + '/List.json', JSON.stringify({
                targets: at_lists.map(id => ({
                    name: getEntityName(id),
                    id,
                    namespace: getEntityNamespace(id)
                })),
                players: getWorldPlayerList(),
                entities: getEntityList().map(id => ({
                    name: getEntityName(id),
                    id,
                    namespace: getEntityNamespace(id)
                }))
            }))
            if (key === "DumpWorldInfo") _fs.write(nx_paths + '/WorldInfo.json', JSON.stringify(getWorldData(), null, 2))
            if (key === "ImportWorldInfo") setWorldData(JSON.parse(readFile(nx_paths + '/WorldInfo.json')))
            if (key === "Rusher") {
                const rot = getCameraRotation()
                let goal_pos = calDisplacement(rush_length / 6, getPos(self_id), {
                    yaw: rot.yaw > 0 ? 180 - rot.yaw : -180 - rot.yaw,
                    pitch: -rot.pitch
                })
                setMotion(goal_pos.x - self_pos.x, goal_pos.y - self_pos.y, goal_pos.z - self_pos.z)
            }
            return;
        }
        for (let key in fun) {
            if (["value", "fun", "name", "index", "shortcut"].includes(key)) continue;
            if (typeof fun.index !== 'undefined' && (modes[key] !== fun.index - 1) && fun.index > 0) {
                modes[key] = fun.index - 1
                nx_cfg[key] = fun.index - 1
                makeMsg(0, key.toUpperCase(), "§7>>>§r SetMode §7>> §r" + fun[key], '§r')
                if (key === 'tip_mode' && modes.tip_mode === 1) {
                    callModule(41, JSON.stringify({
                        "array_list": true,
                        "array_offset_x": (fst_x / 5), // 数学表达式需保留括号
                        "array_offset_y": (fst_y / 5)
                    }));

                    _app.showToast('注: 该功能会影响正常的ArrayList显示')
                }
                return true
            }
            if (key === "KickAura" && ka_multi) callModule(35, JSON.stringify({
                "value": fun[key], // 若为布尔值或数值，无需额外处理；若为字符串需确保已转义
                "count": ka_packet
            }));
            if (key === 'TestModule') {
                sendPyRpc(98247598, '93c40172920ac4294d696e6563726166743a7065743a7065745f736b696c6c5f6e6f746966795f6164645f626561636f6ec0')
                sendPyRpc(98247598, '93c40163920a82c4057065744964c40c2d3733303134343434303331c4086d6978436f6c6f7282c4085f5f747970655f5fc4057475706c65c40576616c756594cb3fed63d4ff3e7cd8cb3fe1829a125cf16ecb3fd984e419d50b1401c0')
            }
            if (key === "RandomArrayList" && !fun[key]) {
                for (let i = 0; i < ral_num; i++) addCustomArrayList('RandomArrayList' + i, '', '', false)
            }
            if (key === 'Rocker') callModule(57, JSON.stringify({
                "value": (modes.rc_mode === 1 && fun[key]), // 直接使用布尔表达式结果
                "fov": 150
            }));
            if (key === 'SimulateButton') {
                if (fun[key]) {
                    sb_list.forEach(button => _input.buttonDown(button))
                    _input.buttonDown('button.sprint')
                } else {
                    sb_list.forEach(button => _input.buttonUp(button))
                    _input.buttonUp('button.sprint')
                }
            }
            if (key === 'MobileWaterMark') {
                if (fun[key]) updateTextContent(mwm_id, mwm_text)
                else updateTextContent(mwm_id, '')
            }
            if (key === 'sb_interact') {
                if (fun[key]) sb_list.push('button.interact')
                else {
                    sb_list.splice(sb_list.indexOf('button.interact'), 1)
                    _input.buttonUp('button.interact')
                }
            }
            if (key === 'sb_forward') {
                if (fun[key]) sb_list.push('button.up')
                else {
                    sb_list.splice(sb_list.indexOf('button.up'), 1)
                    _input.buttonUp('button.up')
                }
            }
            if (key === 'sb_right') {
                if (fun[key]) sb_list.push('button.right')
                else {
                    sb_list.splice(sb_list.indexOf('button.right'), 1)
                    _input.buttonUp('button.right')
                }
            }
            if (key === 'sb_left') {
                if (fun[key]) sb_list.push('button.left')
                else {
                    sb_list.splice(sb_list.indexOf('button.left'), 1)
                    _input.buttonUp('button.left')
                }
            }
            if (key === 'sb_back') {
                if (fun[key]) sb_list.push('button.down')
                else {
                    sb_list.splice(sb_list.indexOf('button.down'), 1)
                    _input.buttonUp('button.down')
                }
            }
            if (key === 'sb_long') {
                if (fun[key]) sb_list.push('button.destroy_or_interact')
                else {
                    sb_list.splice(sb_list.indexOf('button.destroy_or_interact'), 1)
                    _input.buttonUp('button.destroy_or_interact')
                }
            }
            if (key === 'sb_click') {
                if (fun[key]) sb_list.push('button.build_or_attack')
                else {
                    sb_list.splice(sb_list.indexOf('button.build_or_attack'), 1)
                    _input.buttonUp('button.build_or_attack')
                }
            }
            if (key === "FakeMove") {
                if (fun[key]) fmo_pos = getPos(self_id)
                else if (!fun[key]) MenuTP(fmo_pos.x, fmo_pos.y, fmo_pos.z)
                let noac = {
                    enable: !fun[key],
                    index: 19,
                    packet: "receive"
                }
                callModule(7, JSON.stringify({
                    enable: false,
                    index: 19,
                    packet: "send"
                }))
                MenuTP(self_pos.x + 1000, self_pos.y + 1000, self_pos.z + 1000)
                callModule(7, JSON.stringify({
                    enable: true,
                    index: 19,
                    packet: "send"
                }))
                callModule(7, JSON.stringify(noac))
                setTimeout(() => MenuTP(fmo_pos.x + 15, fmo_pos.y + 15, fmo_pos.z + 15), 1000)
            }
            if (key === "Crasher" && cs_multi) callModule(35, JSON.stringify({
                value: fun[key], // 若 b2s 返回布尔值或数值，直接使用；若为字符串需确保转义
                count: cs_packet // 确保为数值类型
            }));

            if (key === "ShowNXInfo" && !fun[key]) addCustomArrayList('NoveXare', '', '', false)
            if (key === "RandomFunc") {
                const outputs = (Object.keys(globalThis))
                let bools = []
                for (let i of outputs) {
                    if (typeof globalThis[i] === 'boolean') bools.push(i)
                }
                const keyname = bools[getRand(0, bools.length - 1)]
                nxCall(keyname, fun[key])
            }
            if (key === "InfiniteAura" && ia_multi) callModule(35, JSON.stringify({
                value: fun[key], // 若为布尔值直接传递，无需字符串转换
                count: ia_packet // 确保 ia_packet 为数值类型
            }));

            if (key === "FlashBack") sb()
            if (key === "ClickTP") callModule(56, `{"reach":255,"value":${b2s(fun[key])}}`);
            if (key === "PyRpcManager" && rpc_store && !fun[key]) {
                rpc_temp.forEach(rpc => sendRpc(rpc.id, rpc.data))
                makeMsg(0, 'Tip', "成功发送储存的" + rpc_temp.length + "个rpc数据包", '§r')
                rpc_temp = []
            }
            if (key === "HideHud") _options.setBoolean(335, {
                value: fun[key],
                defaultValue: false
            })
            if (key === "EntityXRay") _options.setBoolean(329, {
                value: fun[key],
                defaultValue: false
            })
            if (key === "ShowChunk") _options.setBoolean(327, {
                value: fun[key],
                defaultValue: false
            })
            if (key === "NoPractice") _options.setBoolean(332, {
                value: fun[key],
                defaultValue: false
            })
            if (key === "NoWeather") _options.setBoolean(334, {
                value: fun[key],
                defaultValue: false
            })
            if (key === "FreeCam") {
                let player = {
                    value: fun[key],
                    noclip: fun[key],
                    flying: fun[key],
                }
                callModule(1, JSON.stringify(player))
                if (fun[key]) fc_pos = getPos(self_id)
                else setPos(fc_pos.x, fc_pos.y, fc_pos.z)
            }
            if (key === "FakeMotion" && fm_auto && fun[key]) fm_pos = getPos(self_id)
            if (key === "ShadowBoomer" && fun[key]) sb_pos = getPos(self_id)
            if (key === "AvoidAttack" && fun[key]) aa_pos = getPos(self_id)
            else if (key === "AvoidAttack" && !fun[key]) setPos(aa_pos.x, aa_pos.y, aa_pos.z)
            if (key === "NoClip") {
                let player = {
                    value: fun[key],
                    noclip: fun[key],
                    flying: fun[key],
                }
                if (nc_depart && fun[key]) _camera.departCamera()
                if (nc_depart && !fun[key]) _camera.resetCamera()
                if (nc_bypass) callModule(44, JSON.stringify({
                    no_move_check: fun[key], // 直接使用布尔值，无需 b2s 转换
                    no_fall_check: fun[key],
                    value: fun[key]
                }));

                callModule(1, JSON.stringify(player))
                if (nc_blink) nc_pos = getPos(self_id)
                else nc_pos = {}
            }
            if (key === "BalanceTimer") {
                callModule(37, JSON.stringify({
                    value: fun[key] // 自动处理数值/布尔值，字符串需确保已转义
                }));

                BalanceTimer_st = !fun[key]
            }
            if (key === "IQBoost") {
                const iqboost_list = _fs.read(nx_paths + '/iQBoost.txt').split('\n')
                let rand = getRand(0, iqboost_list.length - 1)
                _minecraft.sendChatMessage('!' + iqboost_list[rand])
            }
            if (key === "AutoTarget" && !fun[key]) at_lists = []
            if (key === "SoundPlayer" && !fun[key]) sp_data = []
            if (key === "FightBot" && !fun[key]) {
                if (fb_ka) KillAura = false
                if (fb_aa) AssistAim = false
                if (fb_kd) KeepDistance = false
                if (fb_sca) Scaffold = false
            }
            if (key === "ShowSendPacket" && !fun[key] && JSON.stringify(PacketTmp.send) != '{}') {
                let str = ''
                for (let k in PacketTmp.send) str += ('名称:' + k + '，ID:' + PacketTmp.send[k].id + '，发送数量:' + PacketTmp.send[k].count + '\n')
                if (sp_save) _fs.write(nx_paths + '/SendPacket-' + Date.now() + '.json', JSON.stringify(PacketTmp.send, null, 2))
                makeMsg(0, 'sendPacket', '\n' + str, '§r')
                PacketTmp.send = {}
            }
            if (key === "ShowReceivePacket" && !fun[key] && JSON.stringify(PacketTmp.receive) != '{}') {
                let str = ''
                for (let k in PacketTmp.receive) str += ('名称:' + k + '，ID:' + PacketTmp.receive[k].id + '，接受数量:' + PacketTmp.receive[k].count + '\n')
                if (srp_save) _fs.write(nx_paths + '/ReceivePacket-' + Date.now() + '.json', JSON.stringify(PacketTmp.receive, null, 2))
                makeMsg(0, 'receivePacket', '\n' + str, '§r')
                PacketTmp.receive = {}
            }
            if (key === "Scaffold" && sca_keep && fun[key]) sca_current = 0
            if (key === "SmartInv" && fun[key]) {
                da_slot = 35
                max_damage = {}
                max_armor = [0, 0, 0, 0]
            }
            if (key === "sp_loop" && !fun[key]) sp_file = null
            if (key === "NoLiquid" && fun[key]) {
                nl_water = getEntityAttribute(self_id, 2)
                nl_lava = getEntityAttribute(self_id, 6)
            } else if (key === "NoLiquid" && !fun[key]) {
                setEntityAttribute(self_id, 'minecraft:underwater_movement', nl_water)
                setEntityAttribute(self_id, 'minecraft:lava_movement', nl_lava)
            }
            if (typeof fun[key] === "boolean" || typeof fun[key] === "number") {
                if (typeof fun[key] === "boolean") {
                    nxCall(key, fun[key])
                    return;
                }
                nx_cfg[key] = fun[key]
                globalThis[key] = fun[key]
            }
        }
    } catch (e) {
        _minecraft.clientMessage(e.stack)
    }
}

function onPlayerAttackEvent(mid, target) {
    if (SoundManager && sm_attack) playSound(nx_paths + '/音效/attack.mp3')
    if (CameraManager && cm_transfer) cm_attack = target
    if (SlowMotion && sm_onhit && !sm_status) sm_status = true
    if (FakeTip && modes.fakeTip_mode === 2) _minecraft.showTipMessage("§b[Relic] §r§lAttacking | §r" + getEntityName(target))
    if (FakeTip && modes.fakeTip_mode === 3) _minecraft.showTipMessage("§a§l[Kaleidoscop - 万花筒]\n§r§l正在攻击： §r" + getEntityName(target))
    if (FakeTip && modes.fakeTip_mode === 4) _minecraft.showTipMessage("§2[Heal Module] §r§l正在攻击： §r" + getEntityName(target))
    if (FakeTip && modes.fakeTip_mode === 7) _minecraft.showTipMessage("§6正在攻击: " + getEntityName(target))
    if (TargetEdit) {
        if (te_target === null) te_target = target
        else {
            if (te_all) getEntityList().forEach(id => {
                if (id != te_target) setTarget(id, te_target, te_two)
            })
            else setTarget(target, te_target, te_two)
            te_target = null;
            makeMsg(0, 'Tip', '设置完成', '§r')
        }
        return true
    }
    if (RiderEdit) {
        if (re_cancel) stopRidingEntity(target)
        else startRidingEntity(target)
        makeMsg(0, 'Tip', '已骑乘目标', '§r')
        return true
    }
    if (EntityNBTCopy) {
        if (enc_target === null) enc_target = target
        else {
            setEntityNBT(target, getEntityNBT(te_target))
            enc_target = null;
            makeMsg(0, 'Tip', '已复制NBT', '§r')
        }
        return true
    }
    if (ActivitySender) _minecraft.sendChatMessage('我正在攻击' + getEntityName(target))
    if (!attack_list.includes(target)) attack_list.push(target)
    if (target === null || attack_list.every(id => last_attack_target.includes(id))) {
        attack_frequency++;
        isAttacking = true
    } else {
        last_attack_target = target
        attack_ticks = 0
        real_attack = 0
        attack_frequency = 0
        click_num = 0
        click_t = 0
    }
    if (PVPDaLao) _minecraft.setTitle("还是PVP大佬")
    if (OtherUser) {
        otherId = target
        return true
    }
    if (CameraManager && cm_editanchor) {
        cm_id = target
        makeMsg(0, 'Tip', "正在视奸: " + getEntityName(target), '§r')
        return true
    }
    if (AttackMessage) _minecraft.sendChatMessage(am_text)
    if (AttackParticle) {
        if (ap_crit) {
            const epos = getPos(target)
            const esize = getEntitySize(target)
            for (let i = 0; i < getRand(ap_count, ap_count + 20); i++) createParticle(ap_type, epos.x + getRand(-esize.x * getRand(5, ap_density), esize.x * getRand(5, ap_density)) / 10, epos.y + getRand(-esize.y * 9, esize.y * 2) / 10 + ap_offset / 10, epos.z + getRand(-esize.x * getRand(5, ap_density), esize.x * getRand(5, ap_density)) / 10, 1)
        }
        if (ap_slashblade) {
            let Camera_rot = getCameraRotation()
            let self_rot = {
                yaw: Camera_rot.yaw > 0 ? 180 - Camera_rot.yaw : -180 - Camera_rot.yaw,
                pitch: -Camera_rot.pitch
            }
            let randDirect = getRand(0, 1)
            let slope = (ap_random_slope ? getRand(0, 45) : (ap_sb_slope)) / 10
            for (let i = (-ap_sb_count * 2); i <= (ap_sb_count * 2); i += ap_sb_space) {
                let offset = randDirect ? i : (-i)
                const tpos = calDisplacement(ap_sb_dist, self_pos, {
                    yaw: self_rot.yaw + offset,
                    pitch: self_rot.pitch + i * slope
                })
                createParticle(ap_type, tpos.x, tpos.y + ap_offset / 10, tpos.z, 1)
            }
        }
    }
    if (NoSlowDown) {
        let mot = getEntityMotion(self_id)
        setMotion(mot.x, mot.y, mot.z)
    }
    if (AttackSound) {
        createSound(Number(as_type), Number(as_level))
        if (as_gradually) as_level = Number(as_level) + 1
        if (as_gradually) attack_tick = 0
    }
    if (AttackRender) {
        const Distance = getDistanceByID(self_id, target)
        callModule(75, JSON.stringify({
            value: true,
            line_width: 0.25,
            mode: 2,
            distance: Distance * 1.01 // 自动计算数值，无需括号包裹（保留表达式逻辑）
        }));

        setTimeout(() => callModule(75, JSON.stringify({
            value: false
        })), 200);

    }
    if (RecordInfo && ri_click) {
        let info = getTargetInfo(target)
        makeMsg(0, 'Info', '\n' + info + "\n§r§b==============================", '§r')
        if (ri_save) _fs.write(nx_paths + '/' + getEntityName(target) + '_' + target + '.txt', info)
        return true
    }
    if (SmartWeapon) {
        let result = []
        let max_slot = modes.sw_mode ? 36 : 9
        for (let i = 0; i < max_slot; i++) result.push({
            slot: i,
            d: getItemDamage(self_id, i, sw_texture, sw_enchant)
        })
        result.sort((a, b) => b.d - a.d)
        let data = result[0]
        let current_slot = getPlayerSelectItemSlot(self_id)
        if (data.d > 1 && data.slot !== current_slot) {
            if (data.slot > 8) {
                if (sw_open) openInventory()
                setTimeout(() => moveItem(data.slot, current_slot, true, false), 200)
            } else selectPlayerInventorySlot(self_id, data.slot)
        }
    }
    if (ClickTarget) {
        if (!at_lists.includes(target)) at_lists.push(target)
        else at_lists.splice(at_lists.indexOf(target), 1)
        makeMsg(0, !at_lists.includes(target) ? 'delTarget' : 'addTarget', getEntityName(target), '§r')
        return true
    }
    if (CustomKB) {
        const pos = getPos(target)
        const angle = getPlayerAngle(self_pos, pos, "yaw_pos")
        const end_pos = calDisplacement(-ckb_len / 2, self_pos, {
            yaw: angle,
            pitch: 0
        })
        setEntityMotion(target, end_pos.x - self_pos.x, ckb_y, end_pos.z - self_pos.z)
    }
    if (ClickWhiteList) {
        if (!at_whileLists.includes(target)) at_whileLists.push(target)
        else at_whileLists.splice(at_whileLists.indexOf(target), 1)
        makeMsg(0, !at_whileLists.includes(target) ? 'delTarget' : 'addTarget', getEntityName(target), '§r')
        return true
    }
    if (ClickTeam && (!KillAura || ct_team === "NoveXare")) {
        ct_team = getTeams(getEntityName(target))
        makeMsg(0, 'setTeam', ct_team, '§r')
        return true
    }
    if (TargetHud && modes.th_select_mode == 1) {
        th_target = target
        th_tick = 0
    }
    if (KillAura) return (getRand(0, 100) < ka_empty)
}

function onSendChatMessageEvent(text) {
    if (text === "") return true;
    if (ReplaceMsg) {
        if (modes.bm_mode === 0) executeCommand('me ' + text)
        if (modes.bm_mode === 1) executeCommand('tell @a ' + text)
        if (modes.bm_mode === 2) executeCommand('tell @a \n\n\n\n\n\n\n\n\n\n\n\n\n\n§r§f' + text)
        return true
    }
    if (ChatManager && cm_fake) {
        executeCommand(`tell @a \n\n\n\n\n\n\n\n\n\n\n\n\n\n §r§f<${cm_target}> ${text}`)
        return true
    }
    if (FakeChat) {
        _minecraft.chatMessage(fc_target, text)
        return true
    }
    if (FakeWhisper) {
        _minecraft.whisperMessage(fw_target, text)
        return true
    }
    if (ChatSuffix && !text.includes(cs_text)) {
        _minecraft.sendChatMessage(text + cs_text)
        return true;
    }
}

function onClientMessageEvent(name, msg) {
    if (ChatManager && ((name != getEntityName(self_id) && cm_other) || name == getEntityName(self_id) && cm_self) && !isRepeating) {
        isRepeating = true;
        for (let i = 0; i < cm_repeat_times; i++) _minecraft.sendChatMessage(msg);
        setTimeout(() => isRepeating = false, 100);
    };
    if (ShowClientMessage) makeMsg(0, 'clientMsg', `来源: ${name}, 消息:${msg}`, '§r')
    if (ChatManager) return cm_black.some(key => msg.includes(key))
    if (ChatManager && msg.length > cm_length) return
    if (BulletNotice) {
        let randY = Math.round(getRand(0, nx_screen.screenHeight * bn_range / 100))
        let context = bn_format.replaceAll('[名字]', name).replaceAll('[消息]', msg)
        const colors = 'abcdef'
        if (bn_format) context = rainbowMsg(context)
        if (bn_rainbow) context = '§' + colors[getRand(0, colors.length - 1)] + context
        let id = createText(context, 'Center', nx_screen.screenWidth, randY)
        if (id !== -1) bn_list.push({
            id,
            speed: getRand(bn_min, bn_max),
            x: nx_screen.screenWidth,
            y: randY
        })
        return bn_intercept
    }
    return ShowClientMessage
}

function onPlayerJumpEvent(id) {
    if (ActivitySender) _minecraft.sendChatMessage('我正在跳跃')
    if (PVPDaLao) _minecraft.setTitle("还是什么都不知道的小白")
    if (Scaffold && sca_tower) {
        let sca_currentTower = Date.now()
        if (sca_currentTower - sca_prevTower < sca_space * 50 && setPos(self_pos.x, self_pos.y + 1.3, self_pos.z) && buildBlock(self_id, self_pos.x, self_pos.y - 2.3, self_pos.z, 1) && sca_keep) sca_current = Math.floor(self_pos.y) + 1
        sca_prevTower = sca_currentTower
    }
    if (LongJump) {
        const self_motion = getEntityMotion(id)
        const rot = getCameraRotation()
        const goal = predictPos(self_motion, self_pos, 20)
        const end_pos = calDisplacement(lj_len / 4, self_pos, {
            yaw: rot.yaw > 0 ? 180 - rot.yaw : -180 - rot.yaw,
            pitch: 0
        })
        setMotion(end_pos.x - self_pos.x, lj_y, end_pos.z - self_pos.z)
        return true
    }
}

function onPyRpcReceiveEvent(id, data) {
    if (isTP) {
        const rpc = ab2str(data).toLowerCase()
        if (rpc.includes('posmap')) {
            const byteArray = new Uint8Array(data);
            const hexString = Array.from(byteArray, byte => byte.toString(16).padStart(2, '0')).join('');
            let pos = calHexPos(hexString)
            makeMsg(0, 'Pos', `坐标: [${pos.x}, ${pos.y}, ${pos.z}]`, '§r')
            if (st_tp) setPos(pos.x, pos.y + st_offset, pos.z)
            isTP = false
        }
    }
    if (PyRpcManager && rpc_rec) {
        const byteArray = new Uint8Array(data);
        const hexString = Array.from(byteArray, byte => byte.toString(16).padStart(2, '0')).join('');
        const rpc = ab2str(data).toLowerCase()
        let match = false;
        let match2 = rpc_tipWhite.some(key => rpc.includes(key));
        if (!match) match = rpc_black.some(key => rpc.includes(key))
        if (!match) match = rpc_recBlack.some(key => rpc.includes(key))
        if (rpc_white.some(key => rpc.includes(key))) match = false
        if (rpc_recWhite.some(key => rpc.includes(key))) match = false
        if (rpc_record && ((!match2 || !rpc_exclude))) {
            const p = _app.getResource() + "/GBRC/NoveXare/PyRpc_Record.json";
            const d = JSON.parse(readFile(p));
            d[d.length] = {
                packet_hex: hexString,
                packet_format: hex2format(hexString),
                packet_str: ab2str(data),
                packet_bin: byteArray,
                time: Date.now(),
                id,
                type: "Receive",
                keword: rpc_recBlack,
                global_keyword: rpc_black,
                intercept: match
            };
            _fs.write(p, JSON.stringify(d, null, 4));
        }

        let pack = "Null";
        if (modes.rpc_mode === 0) pack = ab2str(data);
        if (modes.rpc_mode === 1) pack = hexString;
        if (modes.rpc_mode === 2) pack = hex2format(hexString);
        if (modes.rpc_mode === 3) pack = JSON.stringify(data)
        const suffix = match ? "\n§e§l已拦截该PyRpc数据包\n§r§e==============================\n" : "\n§r§e==============================\n";
        if (rpc_tip && !match2 && ((rpc_showDisintercept && !match) || (rpc_showIntercept && match))) makeMsg(0, 'Receive-PyRpc', '\n' + ((rpc_id) ? ('ID: ' + id + '\n') : '') + pack + suffix, '§r')
        return match;
    }
}

function onPyRpcSendEvent(id, data) {
    if (PyRpcManager && rpc_send) {
        const byteArray = new Uint8Array(data);
        const hexString = Array.from(byteArray, byte => byte.toString(16).padStart(2, '0')).join('');
        const rpc = ab2str(data).toLowerCase()
        let match = false;
        let match2 = rpc_tipWhite.some(key => rpc.includes(key));
        if (!match) match = rpc_black.some(key => rpc.includes(key))
        if (!match) match = rpc_sendBlack.some(key => rpc.includes(key))
        if (rpc_white.some(key => rpc.includes(key))) match = true
        if (rpc_sendWhite.some(key => rpc.includes(key))) match = false
        if (!match2) prev_rpc = {
            id,
            data: byteArray
        }
        if (rpc_store) rpc_temp.push({
            id,
            data: byteArray
        })
        if (rpc_intercept) match = true
        if (rpc_record && ((!match2 || !rpc_exclude))) {
            const p = _app.getResource() + "/GBRC/NoveXare/PyRpc_Record.json"
            const d = JSON.parse(readFile(p))
            d[d.length] = {
                packet_hex: hexString,
                packet_format: hex2format(hexString),
                packet_str: ab2str(data),
                packet_bin: byteArray,
                time: Date.now(),
                id: id,
                type: "Send",
                keword: rpc_sendBlack,
                global_keyword: rpc_black,
                intercept: match
            }
            _fs.write(p, JSON.stringify(d, null, 4))
        }
        let pack = "Null"
        if (modes.rpc_mode === 0) pack = ab2str(data)
        if (modes.rpc_mode === 1) pack = hexString
        if (modes.rpc_mode === 2) pack = hex2format(hexString)
        if (modes.rpc_mode === 3) pack = JSON.stringify(data)
        for (let i of rpc_config) {
            if (typeof i === "object") {
                if (i.match_mode === 0 && pack.includes(i.packet)) pack = remarks
                if (i.match_mode === 1 && pack.includes === i.packet) pack = remarks
            } else continue;
        }
        let suffix = match ? "\n§e§l已拦截该PyRpc数据包\n§r§e==============================" : "\n§r§e=============================="
        if (rpc_tip && !match2 && ((rpc_showDisintercept && !match) || (rpc_showIntercept && match))) makeMsg(0, 'Send-PyRpc', '\n' + ((rpc_id) ? ('ID: ' + id + '\n') : '') + pack + suffix, '§r')
        return match
    }
}

function onEntityBehaviorEvent(id, behavior, value) {
    if (ShowEntityAnime) makeMsg(0, 'EntityBehavior', "实体ID:" + id + " 实体昵称:" + getEntityName(id) + " 行为ID:" + behavior + " 行为数据:" + value, '§r')
    if (behavior === 39 && id === av_id) av_id = null
    if (behavior === 3 && attack_list.includes(id)) {
        if (SlowMotion && sm_onkill && !sm_status) sm_status = true
        if (KillMessage) {
            if (km_hide) {
                for (let i = 0; i < 50; i++) executeCommand(`tell @a \n\n\n\n\n\n\n${getEntityName(id)} 死了`)
                executeCommand(`tell @a \n\n\n\n\n\n\n` + km_text)
            } else _minecraft.sendChatMessage(km_text)
        }
        makeMsg(0, 'Kill', 'You Kill ' + getEntityName(id), '§r')
        if (SoundManager && sm_kill) playSound(nx_paths + '/音效/kill.mp3')
        kills++;
        mini_tick = 0
        if (FunnyKill && mini_kills < 10) mini_kills++;
        setTimeout(() => {
            if (FunnyKill && mini_kills > 0) playSound(nx_paths + '/音效/' + ((mini_kills > 6) ? 6 : mini_kills) + '.mp3')
            if (FunnyKill && mini_kills > 0 && mini_title) _minecraft.setTitle(mini_tip[mini_kills - 1])
        }, mini_delay * 1000)
    }
    if (behavior === 2 && AvoidInvalid) Swing = attack_list.includes(id)
    if (behavior === 2 && attack_list.includes(id)) real_attack++;
    if (FightBack && fb_ishurt && (modes.fb_mode == 0 || (behavior === 4 && !_isLocalId(id, self_id)))) {
        nxFightBack(modes.fb_mode == 0 ? null : id)
        fb_ishurt = false
    }
    if (behavior === 2 && _isLocalId(id, self_id)) {
        let mot = getEntityMotion(self_id)
        if (SoundManager && sm_hurt) playSound(nx_paths + '/音效/hurt.mp3')
        if (SlowMotion && sm_onhurt && !sm_status) sm_status = true
        if (ActivitySender) _minecraft.sendChatMessage('我正在被攻击')
        if (ShowHurt) makeMsg(0, 'Hurt', "受伤类型: " + value, '§r')
        if (HurtJump) nxOnGame(() => nxHurtResetStart())
        if (AntiKB && getRand(0, 100) <= akb_rare) {
            let h_offset = akb_hor / 100
            let h_offset2 = akb_y / 100
            setMotion(mot.x - h_offset * mot.x, mot.y - h_offset2 * mot.y, mot.z - h_offset * mot.z)
        }
        if (AirStuck) as_time_t = 0
        if (FightBack && value == 2) fb_ishurt = true
        if (AntiAim && aaim_hurt && !aaim_states) aaim_states = true
    }
    if (behavior === 2) attack_list = []
}

function onPlayerDestroyBlockEvent(self_id, x, y, z, side) {
    const item = getCarried(self_id)
    const block = getBlock(x, y, z)
    if (block.namespace == 'minecraft:air') return
    if (SoundManager && sm_destroy) playSound(nx_paths + '/音效/destroy.mp3')
    if (ShowDestroyBlock) makeMsg(0, 'destroy', `命名空间:${block.namespace}, §rID:${block.id}, 方块选择面:${side}, §r特殊值:${block.aux}\n手持:${item.name}-[${item.namespace}], 特殊值:${item.aux}\n坐标:[${x}, ${y}, ${z}]`, '§r')
    if (ActivitySender) _minecraft.sendChatMessage(`我正在破坏${x} ${y} ${z}的${block.namespace}`)
    if (Miner && (block.namespace === mine_name || !mine_destroy)) {
        if (!mine_destroy && mine_current <= mine_num && ((mine_white.length === 0 || mine_white.some(keyword => block.namespace.includes(keyword))) && (mine_black.length === 0 || mine_black.every(keyword => !block.namespace.includes(keyword))))) {
            mine_destroy = true
            mine_name = block.namespace
        }
        if (mine_destroy && mine_name != block.namespace && mine_current < mine_num && mine_list.length > 0) mine_name = block.namespace
        if (getDistance(self_pos, {
                x,
                y,
                z
            }) <= mine_distance && mine_destroy) {
            let block_pos = [
                [x + 1, y, z],
                [x - 1, y, z],
                [x, y, z + 1],
                [x, y, z - 1],
                [x, y + 1, z],
                [x, y - 1, z]
            ]
            for (p of block_pos) {
                const block2 = getBlock(p[0], p[1], p[2])
                if (block2.namespace != "minecraft:air" && block.namespace === mine_name) mine_list.push(p)
            }
        }
    }
}

function onReadyEvent() {
    if (ShowGameInfo) {
        const world = getWorldData()
        if (ShowGameInfo) makeMsg(0, 'Tip', `进入世界 ${world.levelName} ，难度:${world.difficulty} 游戏模式:${world.gameType} 游戏时间:${world.time} 随机刻速度:${world.randomTickSpeed}`, '§r')
    }
}

function onPlayerBuildBlockEvent(id, x, y, z, side) {
    if (PVPDaLao) _minecraft.setTitle("又或是建筑大佬")
    if (SoundManager && sm_build) playSound(nx_paths + '/音效/build.mp3')
    const item = getCarried(self_id)
    const block = getBlock(x, y, z)
    if (ActivitySender) _minecraft.sendChatMessage('我正在放置' + item.name)
    if (ShowClickBlock) makeMsg(0, 'build', `命名空间:${block.namespace}, §rID:${block.id}, 方块选择面:${side}, §r特殊值:${block.aux}\n手持:${item.name}-[${item.namespace}], 特殊值:${item.aux}\n坐标:[${x}, ${y}, ${z}]`, '§r')
    if (ClickTP) MenuTP(x, y + 2, z)
    if (AutoTool) {
        let result = []
        let max_slot = 9
        for (let i = 0; i < max_slot; i++) result.push({
            slot: i,
            d: getBlockDestroyTime(block.namespace, i, {})
        })
        result.sort((a, b) => a.d - b.d)
        let data = result[0]
        let current_slot = getPlayerSelectItemSlot(self_id)
        if (data.slot !== current_slot) selectPlayerInventorySlot(self_id, data.slot)
    }
    const condition = (ChestAura && ca_rot && block.namespace === 'minecraft:chest') || (Scaffold && sca_clickRot && self_item.isBlock && !getEntityIsGround(self_id)) || (ClickRot)
    if (condition) {
        let cpos = {
            x,
            y,
            z
        }
        const ppos = predictPos(getEntityMotion(self_id), getPos(self_id), 20)
        let need_pitch = getPlayerAngle(ppos, cpos, "pitch_pos")
        let need_yaw = getPlayerAngle(ppos, cpos, "yaw_pos")
        silentRot(need_pitch, need_yaw)
    }
    if (GetCommand && block.namespace.includes("command_block")) {
        let cha = getBlockEntityNBT(x, y, z)
        let cmds = getText(cha, "Command:\"", "\",Cu")
        let auto = ((getText(cha, "auto:", "b,c") === "1") ? ("是") : ("否"))
        let td = getText(cha, "TickDelay:", ",Tr")
        makeMsg(0, 'Cmd', `坐标:[${x} ${y} ${z}]\n指令:${cmds}\n是否自动:${auto}\n执行延迟:${td}Tick`, '§r')
        return true
    }
    if (BlockTagCopy) {
        if (btc_pos === null) btc_pos = [x, y, z]
        else {
            setBlockEntityData(x, y, z, getBlockEntityData(btc_pos[0], btc_pos[1], btc_pos[2]))
            btc_pos = null;
            makeMsg(0, 'Tip', '复制标签成功', '§r')
        }
        return true
    }
    if (FakeBuilder) {
        let pos_list = [
            [x, y - 1, z],
            [x, y + 1, z],
            [x, y, z - 1],
            [x, y, z + 1],
            [x - 1, y, z],
            [x + 1, y, z]
        ]
        setBlock(pos_list[side][0], pos_list[side][1], pos_list[side][2], item.namespace, item.aux)
        return true;
    }
    if (ClickBlock) return setBlock(x, y, z, item.namespace, item.aux)
    if (ClickDestroy && !AutoDestroy) ModuleDestroy({
        x,
        y,
        z
    })
    if (AutoBed && block.namespace === "minecraft:bed" && !ab_running) {
        makeMsg(0, 'Tip', '请手持方块', '§r')
        let pos_list = [
            [x + 1, y, z],
            [x - 1, y, z],
            [x, y, z + 1],
            [x, y, z - 1],
            [x, y + 1, z]
        ]
        ab_running = true
        for (let pos of pos_list) {
            const block2 = getBlock(pos[0], pos[1], pos[2])
            if (block2.namespace === 'minecraft:air') simulatePlace(pos[0], pos[1], pos[2])
        }
        ab_running = false
    }
    if (Breaker && (item.namespace.includes("_sword") || item.namespace.includes("_pickaxe") || item.namespace.includes("_axe") || item.namespace.includes("shears"))) {
        if (bk_origin) {
            callModule(15, JSON.stringify({
                value: true
            }));
            setTimeout(() => callModule(15, JSON.stringify({
                value: false
            })), bk_last * 50);
            return true
        }
        if (bk_tool) {
            let result = []
            let max_slot = 9
            for (let i = 0; i < max_slot; i++) result.push({
                slot: i,
                d: getBlockDestroyTime(block.namespace, i, {})
            })
            result.sort((a, b) => a.d - b.d)
            let data = result[0]
            let current_slot = getPlayerSelectItemSlot(self_id)
            if (data.slot !== current_slot) selectPlayerInventorySlot(self_id, data.slot)
        }
        const len = Math.round(bk_range)
        outer: for (let dx = -len; dx <= len; dx++) {
            for (let dy = -len; dy < len; dy++) {
                for (let dz = -len; dz <= len; dz++) {
                    let ex = x + dx;
                    let ey = y + dy;
                    let ez = z + dz;
                    let block = getBlock(ex, ey, ez);
                    if ((bk_bed && block.namespace === "minecraft:bed") || (bk_chest && block.namespace === "minecraft:chest")) {
                        let block2 = getBlock(ex, ey + 1, ez);
                        if (block2.namespace != "minecraft:air" && bk_up) ey += 1
                        bk_pos = {
                            ex,
                            ey,
                            ez
                        }
                        bk_timer = 0
                        break outer;
                    }
                }
            }
        }
    }
    if (bc_select && BlockClicker) {
        ac_pos.push({
            x,
            y,
            z
        })
        makeMsg(0, 'Tip', `已添加[${x}, ${y}, ${z}]`, '§r')
        return true
    }
    if (FastBuild && fb_list.length === 0 && fb_success) {
        const rot = getCameraRotation()
        for (let l = 0; l < fb_len + 1; l++)
            fb_list.push(calDisplacement(l, getEntityBlockPos(self_id), {
                pitch: 0,
                yaw: rot.yaw > 0 ? 180 - rot.yaw : -180 - rot.yaw
            }))
        fb_success = false
        return true
    }
    if (ca_check && block.namespace === "minecraft:chest") chestStates.click = true
}

function onKeyboardDownEvent(key) {
    if (ShowPressKey) makeMsg(0, 'KeyBoard', "按下键值 " + key, '§r')
    if (nx_keys.length > 0 && typeof nx_keys[key] !== 'undefined') nxCall(nx_keys[key], !globalThis[nx_keys[key]])
    if (nx_isBind != null && key != 66) {
        nx_keys[key] = nx_isBind
        nx_cfg.key_binds = nx_keys
        makeMsg(0, 'Tip', "绑定 " + nx_isBind + " 与键值 " + key, '§r')
        nx_isBind = null
    }
}

function onKeyboardUpEvent(key) {
    if (ShowUpliftKey) makeMsg(0, 'Tip', "释放键值 " + key, '§r')
}

function onSendServerPacketEvent(id, name) {
    if (NoClip && nc_blink && Object.keys(nc_pos).length > 0) {
        if (getDistance(nc_pos, self_pos) > nc_dist) nc_pos = self_pos
        else return true
    }
    if (FakeLag && modes.fl_mode === 0 && fakelag_status) return true
    if (FakeLag && modes.fl_mode === 1 && fakelag_status && id === 19) return true
    if (FreeCam && modes.fc_mode === 1 && id === 19) return true
    if (FreeCam && modes.fc_mode === 2 && id === 161) return true
    if (FreeCam && modes.fc_mode === 3 && id === 144) return true
    if (FreeCam && modes.fc_mode === 0) return true
    if (ShowSendPacket) {
        const Translate = PacketTranslate[PacketTranslate.map(packet => packet.id).indexOf(id)].text
        if (sp_statistic) {
            if (typeof PacketTmp.send[name] === 'undefined') PacketTmp.send[name] = {
                id,
                Translate,
                count: 1
            };
            PacketTmp.send[name].count++;
        }
        const send = PacketCfg.send
        const {
            ignore,
            intercept
        } = PacketCfg.send
        let result = []
        if (sp_id) result.push(id)
        if (sp_name) result.push(name)
        if (sp_trans) result.push(Translate)
        let isintercepted = (sp_intercept && (intercept.includes(id) || intercept.includes(name)))
        if (!sp_ignore || !(ignore.includes(id) || ignore.includes(name))) makeMsg(0, 'SendPacket', "发送数据包: " + result.join(' - ') + (isintercepted ? '\n§e已拦截数据包' : ''), '§r')
        return isintercepted
    }
}

function onReceiveServerPacketEvent(id, name) {
    if (_nxSilentRecv(id)) return true
    if (ShadowBoomer && id == 25 && sb_hide) return true
    if (KillAura && ka_close && id == 85) {
        KillAura = false
        makeMsg(0, 'Tip', 'Auto Disable KillAura', '§r')
    }
    if ((TimePause || AvoidAttack) && id === 19) return true
    if (NoAnyReceive) return true
    if (AntiText && id === 9) at_current++
    if ((KickAura || (AntiText && at_current > at_max_text)) && id === 9) return true
    if (ModifyTime && id === 10) return true
    if (ca_check && id === 47) chestStates.packet = true
    if (FakeLag && modes.fl_mode === 2 && fakelag_status && id === 19) return true
    if (FakeLag && modes.fl_mode === 3 && fakelag_status) return true
    if (FreeCam && modes.fc_mode === 4 && id === 18) return true
    if (NoCamShake && id === 27) return true
    if (ShowReceivePacket) {
        const Translate = PacketTranslate[PacketTranslate.map(packet => packet.id).indexOf(id)].text
        if (srp_statistic) {
            if (typeof PacketTmp.receive[name] === 'undefined') PacketTmp.receive[name] = {
                id,
                Translate,
                count: 1
            }
            PacketTmp.receive[name].count++;
        }
        const receive = PacketCfg.receive
        const {
            ignore,
            intercept
        } = PacketCfg.receive
        let result = []
        if (srp_id) result.push(id)
        if (srp_name) result.push(name)
        if (srp_trans) result.push(Translate)
        let isintercepted = (srp_intercept && (intercept.includes(id) || intercept.includes(name)))
        if (!srp_ignore || !(ignore.includes(id) || ignore.includes(name))) makeMsg(0, 'ReceivePacket', "接收数据包: " + result.join(' - ') + (isintercepted ? '\n§e已拦截数据包' : ''), '§r')
        return isintercepted
    }
    return ((modes.cs_mode === 2 || modes.cs_mode === 3) && id === 9)
}

function onTouchMotionDownEvent(point, x, y) {
    if (SafeAttack) {
        const x_min = 0 + (1 - sa_size) / 2 * nx_screen.deviceWidth
        const x_max = nx_screen.deviceWidth - (1 - sa_size) / 2 * nx_screen.deviceWidth
        const y_min = 0 + (1 - sa_size) / 2 * nx_screen.deviceHeight
        const y_max = nx_screen.deviceHeight - (1 - sa_size) / 2 * nx_screen.deviceHeight
        if (at_lists.length > 0 && isAimed(self_id, at_lists[0], sa_fov, 0) && getDistanceByID(self_id, at_lists[0]) < sa_range && x > x_min && x < x_max && y > y_min && y < y_max) Attack(at_lists[0], Swing)
    }
    if (ClickSwing) swingArm()
    isClicking = true
    click_num++;
}

function onContainerItemMoveEvent(containerName, slot, nbt) {
    const item = nbt2object(nbt)
    if (false && InvCleaner && modes.ic_mode >= 2 && ((typeof clear_config[item.namespace] !== 'undefined' && modes.ic_mode == 2) || (typeof clear_config[item.namespace] == 'undefined' && modes.ic_mode == 3))) return true
    if (ChestStealer && (!cs_sort || slot > cs_sort) && cs_current < cs_maxCount) {
        let isSteal = (cs_black.length === 0 || cs_black.some(keyword => item.namespace.includes(keyword)))
        if (cs_white.length !== 0 && cs_white.some(keyword => item.namespace.includes(keyword))) isSteal = false
        if (slot < cs_min && slot > cs_max) isSteal = false
        if (item.attackDamage !== 0 && item.attackDamage < cs_min_damage) isSteal = false
        if (item.damage !== 0 && item.damage < cs_min_lasting) isSteal = false
        if (!cs_weapon && item.attackDamage > 0 && item.damage > 0) isSteal = false
        if (!cs_armor && item.attackDamage === 0 && item.damage > 0) isSteal = false
        if (!cs_other && item.attackDamage === 0 && item.damage === 0) isSteal = false
        if (cs_sort) cs_sort = slot
        if (isSteal) cs_timer = 0
        if (isSteal) cs_current++;
        return isSteal
    }
    if (ShowMoveContainer) makeMsg(0, 'Container', `§e容器所在格子: §r${slot}\n§e物品NBT数据: §r${nbt}`, '§r')
}

function onPlayerAuthInputEvent(input) {
    if (PlayerAuthInputPacket) makeMsg(0, 'Tip', `玩家授权输入:\n视角:[仰俯角:${input.rot.pitch.toFixed(2)}, 偏航角:${input.rot.yaw.toFixed(2)}],\n坐标[${input.pos.x.toFixed(2)}, ${input.pos.y.toFixed(2)},${input.pos.z.toFixed(2)}],\n移动值:[${input.delta.x.toFixed(2)}, ${input.delta.y.toFixed(2)}, ${input.delta.z.toFixed(2)}],\n预测移动值:[左右:${input.analogMove.x.toFixed(2)}, 上下:${input.analogMove.y.toFixed(2)}], 实际移动值:[左右:${input.moveVec.x.toFixed(2)}, 上下:${input.moveVec.y.toFixed(2)}],\n操作标识组:${1<<input.flags}`, '§r')
}

function onSAuthLoginRequestEvent(Sauth) {
    if (DumpRequestSauth) {
        _fs.write(nx_paths + '/SauthRequest.json', Sauth)
        _app.showToast('已导出请求体')
    }
    if (Sauths != null && Sauths != "" && !sl_hook) {
        let sau_obj2 = Sauths.replace(/\\"/g, '"').replace('"{', '{').replace('"}"}', '"}}').replace(/\\\\"/g, '转义').replace('}}"}', '}"}}')
        const replace_sauths = Sauth.replace(getText(Sauth, '"sauth_json":', ',"seed'), JSON.stringify(JSON.parse(sau_obj2).sauth_json))
        _app.showToast('已拦截替换Sauth')
        return replace_sauths.replace(/转义/g, '\\"')
    }
}

function onSAuthLoginResponseEvent(Sauth) {
    if (DumpResponseSauth) {
        _fs.write(nx_paths + '/SauthResponse.json', Sauth)
        _app.showToast('已导出响应体')
    }
    if (bantip != null && bantip != "") return `{"code":29,"message":"${bantip}","details":"{\"ban_type\":\"login\",\"ban_to_ts\":\"0\",\"ban_msg\":\"${bantip}\"}","entity":null}`
}

function onSAuthJsonHookEvent(Sauth) {
    if (DumpCookieSauth) {
        _fs.write(nx_paths + '/SauthCookie.json', Sauth)
        _app.showToast('已导出本账号Cookie')
    }
    if (Sauths != null && Sauths != "" && sl_hook) {
        _app.showToast('已拦截替换Sauth')
        let data = JSON.parse(Sauths)
        if (typeof data.sauth_json !== 'undefined') data = data.sauth_json
        return data
    }
}

if (nx_defaultCfg != '{}') {
    let list = JSON.parse(nx_defaultCfg)
    let num = 0
    nx_binds = list.binds
    nx_keys = list.key_binds
    nx_raBinds = list.nx_raBinds
    for (let key in list) {
        num++;
        if (key.includes("_mode")) modes[key] = list[key]
        if (key != "nx_raBinds" && key != "key_binds" && key != 'binds' && key != 'name') nxCall(key, list[key])
    }
    nx_cfg = list
    makeMsg(0, 'Tip', "成功加载" + list.name + "的配置，共" + num + "条配置", '§r')
}

makeMsg(0, 'Tip', "§aNoveXare Load Successful!", '§a')
makeMsg(0, 'Tip', "You Are Use " + nx_ui.name + " To Play NX", '§b')

/* =====================================================================================
 *  NoveXare 静默容器（silent container）
 *  由 migration/migrate.py 从 migration/nx_silent.js 拼进 NoveXare.js。
 *
 *  ---- 原理（2026-09-18 实机验证：work/silent3_result.txt、work/silent4_result.txt）----
 *  最初以为「不打开背包就没法搬东西」是引擎限制。实测推翻了这个判断：
 *
 *      getCurrentScreenName() = hud_screen        ← 引擎认为界面不在
 *      localPlayer.moveInventoryItem(9, 35)       ← 却**搬成功了**
 *
 *  引擎的 moveInventoryItem **不依赖界面是否显示**，只依赖「引擎有没有容器态」。
 *  容器态由 openInventory() 建立；服务器回的那个 ContainerOpen 包**只负责渲染界面**。
 *  所以：openInventory() → 拦掉确认包 → 界面不弹，但引擎 API 全可用。
 *
 *  实机闭环（探针4，用户确认「没有弹出背包界面」）：
 *      openInventory() → 收到 ContainerOpen #1（被拦）→ moveInventoryItem 成功 → closeInventory()
 *
 *  ---- 为什么不用自己发 147 包 ----
 *  试过：自己构造 ItemStackRequest(147) 直接发 → **客户端崩溃**。
 *  原因：requestId 必须与引擎自己的序列同步（TimeUnity 是 `reqId = resp.requestId ± 2`
 *  从 148 响应学的），凭空造一个会撞号 → 状态错乱。
 *  走引擎 API 则 requestId 由引擎自己维护，天然自洽 —— 零崩溃风险。
 *
 *  ---- 已知副作用 ----
 *  静默会话期间（借态到还态之间）会吞掉服务器回的容器开/关包，
 *  所以**这段时间里玩家自己按「打开背包」也打不开** —— 这是静默的固有代价
 *  （TimeUnity 的静默整理同样如此）。会话在整理完成后立刻释放，通常只有几个 tick。
 * ===================================================================================== */

/* 开关：SmartInv.json 的 silent（默认关，需要时手动开） */
var _NX_SILENT = false;
try { if (nx_silent === true) _NX_SILENT = true; } catch (e) { }

var _nxSilentState = { active: false, seen: 0, borrowTicks: 0, lastAct: 0 };

/* 收包钩子：静默会话期间把容器开/关包吞掉 —— 界面就不渲染了。
   返回 true 表示「已拦截」。非会话期间一律放行，不影响玩家自己开背包。 */
function _nxSilentRecv(id) {
    if (!_nxSilentState.active) return false;
    if (id === 46) { _nxSilentState.seen++; return true; }
    if (id === 47) return true;
    return false;
}

/* 借一次容器态。返回 true 表示「已发起」，下一轮确认包到了才能真正干活。 */
function _nxSilentBorrow() {
    if (!_NX_SILENT) return false;
    if (_nxSilentState.active) return true;
    try {
        var lp = _player.getLocalPlayer();
        if (!lp || typeof lp.openInventory !== 'function') return false;
        _nxSilentState.active = true;
        _nxSilentState.seen = 0;
        _nxSilentState.borrowTicks = 0;
        lp.openInventory();
        return true;
    } catch (e) {
        _nxSilentState.active = false;
        return false;
    }
}

/* 还掉容器态 */
function _nxSilentRelease() {
    if (!_nxSilentState.active) return false;
    try {
        var lp = _player.getLocalPlayer();
        if (lp && typeof lp.closeInventory === 'function') lp.closeInventory();
    } catch (e) { }
    _nxSilentState.active = false;
    _nxSilentState.seen = 0;
    _nxSilentState.borrowTicks = 0;
    _nxSilentState.lastAct = 0;
    /* 会话结束时放弃未结的穿戴登记，免得跨会话残留 */
    try { _nxEquipPending = null; } catch (e) { }
    return true;
}

/* 容器态是否真的就绪（确认包到过） */
function _nxSilentReady() {
    return _nxSilentState.active && _nxSilentState.seen > 0;
}

/* =====================================================================================
 *  NoveXare 智能背包 v2 —— 空岛战争特化（2026-09-18）
 *  由 migration/migrate.py 从 migration/nx_inv.js 拼到 NoveXare.js 正文末尾（仅 NoveXare）。
 *
 *  布局：1剑 2垫脚方块 3雪球/鸡蛋/钓鱼竿 4末影珍珠 5金苹果 6附魔金苹果/水桶 7药水 8斧 9镐
 *   - '/' 的槽位是「或」：任一满足即保持不动，空了才从背包补，候选多于一个时随机取。
 *   - 剑/斧/镐三格按质量择优替换；其余槽只做补位。
 *  背包只留：垫脚方块 ×5 组、雪球 ×5 组、药水 ×3 瓶、水桶 ×1 桶，其余丢弃。
 *  布局 / 配额 / 垫脚方块白名单可外置到 SmartInv.json（缺省用本文件的内置默认值）。
 *
 *  ---- 择优判据为什么用「核心分」而不是「总分」 ----
 *  用过一次的装备耐久就会掉，若把耐久算进比较，「hotbar 里那把刚磨了一点的剑」会立刻
 *  被背包里全新的同类剑顶掉 —— 每次使用都触发一次替换 + 一次丢弃，纯属抖动与浪费发包。
 *  所以：**替换只看核心分（材质 + 类型 + 附魔，与耐久无关）**；
 *  核心分相同时，只在新件明显更耐用（旧件 <25% 且新件 >75%）时才换 —— 也就是
 *  「快碎了换新的」。这样正常使用中的磨损不产生任何比较结果变化。
 *  耐久仅在 _nxQuality（绝对质量值，供外部/诊断用）里以 ±15% 计入。
 *
 *  ---- 算法 ----
 *  每 da_delay tick 一次全量快照（36 格 + 4 装备槽）→ 生成计划 → 每 tick 落地一个动作。
 *  计划顺序：副手 → 算 keep → 先丢多余（腾空间）→ 再搬运/换装。
 *  「先丢后搬」是必需的：v2 的搬运要把快捷栏目标格里的旧物品挪到背包空位才肯搬，
 *  背包 9–35 全满时它静默失败，反过来会永久死锁。
 * ===================================================================================== */

/* ---------- 1. 数据表（基岩版；数值出处见 work/wiki_research/w4/） ---------- */

/* 近战基础攻击伤害：类型 × 材质 */
var _NX_ATK = {
    sword:   { wooden: 5, golden: 5, stone: 6, iron: 7, diamond: 8, netherite: 9 },
    axe:     { wooden: 4, golden: 4, stone: 5, iron: 6, diamond: 7, netherite: 8 },
    pickaxe: { wooden: 3, golden: 3, stone: 4, iron: 5, diamond: 6, netherite: 7 },
    shovel:  { wooden: 2, golden: 2, stone: 3, iron: 4, diamond: 5, netherite: 6 }
};

/* 单件护甲点（×2 让它与武器伤害同量级；比较只在同类别内进行，绝对量级不影响结果） */
var _NX_ARM = {
    helmet:     { leather: 1, golden: 2, chainmail: 2, iron: 2, diamond: 3, netherite: 3, turtle: 2 },
    chestplate: { leather: 3, golden: 5, chainmail: 5, iron: 6, diamond: 8, netherite: 8 },
    leggings:   { leather: 2, golden: 3, chainmail: 4, iron: 5, diamond: 6, netherite: 6 },
    boots:      { leather: 1, golden: 1, chainmail: 1, iron: 2, diamond: 3, netherite: 3 }
};

/* 垫脚方块白名单（默认值；可在 SmartInv.json 的 blocks 里覆盖） */
var _NX_BLOCK_DEFAULT = [
    'minecraft:oak_planks', 'minecraft:cobblestone', 'minecraft:stone', 'minecraft:dirt',
    'minecraft:glass', 'minecraft:grass', 'minecraft:wool', 'minecraft:white_wool',
    'minecraft:end_stone', 'minecraft:netherrack'
];
var _NX_BLOCK_NS = {};
_NX_BLOCK_DEFAULT.forEach(function (ns) { _NX_BLOCK_NS[ns] = 1; });
try {
    if (Object.prototype.toString.call(nx_blocks) === '[object Array]' && nx_blocks.length) {
        _NX_BLOCK_NS = {};
        nx_blocks.forEach(function (ns) { _NX_BLOCK_NS[String(ns)] = 1; });
    }
} catch (e) { }

/* 投掷物（快捷栏 3 号槽的「或」集合） */
var _NX_THROW_NS = { 'minecraft:snowball': 1, 'minecraft:egg': 1, 'minecraft:fishing_rod': 1 };
/* 药水命名空间 */
var _NX_POTION_KINDS = { 'minecraft:potion': 1, 'minecraft:splash_potion': 1, 'minecraft:lingering_potion': 1 };

/* 背包储备配额（单位：占用格数；可在 SmartInv.json 的 quota 里覆盖） */
var _NX_QUOTA = { block: 5, snowball: 5, potion: 3, bucket: 1 };
/* 盾牌上副手（SmartInv.json 的 offhand_shield 设为 false 可关闭） */
var _NX_OFFHAND_SHIELD = true;
try { if (nx_offhand_shield === false) _NX_OFFHAND_SHIELD = false; } catch (e) { }
try {
    if (nx_quota && typeof nx_quota === 'object') {
        for (var _qk in _NX_QUOTA) {
            if (nx_quota[_qk] !== undefined && isFinite(Number(nx_quota[_qk]))) _NX_QUOTA[_qk] = Number(nx_quota[_qk]);
        }
    }
} catch (e) { }

/* 内置默认布局：accept(classify(item)) 为真即「该格已就绪」。
   best = 同类别里核心分最高的那件留在该格；keep = 类别对就绝不动，空了才补。 */
function _nxAcceptKinds(kinds) {
    return function (c) {
        for (var i = 0; i < kinds.length; i++) {
            if (kinds[i] === 'throwable') { if (_nxIsThrowable(c)) return true; continue; }
            if (c.kind === kinds[i]) return true;
        }
        return false;
    };
}
var _NX_HOTBAR_DEFAULT = [
    { label: '剑',   mode: 'best', kinds: ['sword'] },
    { label: '垫脚', mode: 'keep', kinds: ['block'] },
    { label: '投掷', mode: 'keep', kinds: ['throwable'] },
    { label: '珍珠', mode: 'keep', kinds: ['pearl'] },
    { label: '金苹果', mode: 'keep', kinds: ['gapple'] },
    { label: '附魔金苹果/水桶', mode: 'keep', kinds: ['egapple', 'bucket'] },
    { label: '药水', mode: 'keep', kinds: ['potion'] },
    { label: '斧',   mode: 'best', kinds: ['axe'] },
    { label: '镐',   mode: 'best', kinds: ['pickaxe'] }
];

/* 构建生效布局：SmartInv.json 的 layout 只覆盖它写了的槽位，其余沿用默认 */
var _NX_HOTBAR = (function () {
    var def = _NX_HOTBAR_DEFAULT.map(function (e) {
        return { label: e.label, mode: e.mode, kinds: e.kinds, accept: _nxAcceptKinds(e.kinds) };
    });
    try {
        if (Object.prototype.toString.call(nx_layout) !== '[object Array]') return def;
        nx_layout.forEach(function (e) {
            if (!e || e.slot === undefined) return;
            var k = Number(e.slot);
            if (!(k >= 0 && k < 9)) return;
            var kinds = (Object.prototype.toString.call(e.kinds) === '[object Array]') ? e.kinds : def[k].kinds;
            def[k] = {
                label: e.label || def[k].label,
                mode: (e.mode === 'best') ? 'best' : 'keep',
                kinds: kinds,
                accept: _nxAcceptKinds(kinds)
            };
        });
    } catch (e) { }
    return def;
})();

/* ---------- 2. 物品分类与质量值 ---------- */

function _nxIsAir(item) {
    return !item || !item.namespace || item.namespace === 'minecraft:air' || !(Number(item.count) > 0);
}

function _nxIsThrowable(c) { return c.kind === 'snowball' || c.kind === 'egg' || c.kind === 'rod'; }

/* namespace -> {kind, mat}
   多段名的坑：enchanted_golden_apple / splash_potion 等要按「整名」特判。 */
function _nxClassify(item) {
    var ns = (item && item.namespace) ? String(item.namespace) : '';
    if (!ns || ns === 'minecraft:air') return { kind: 'air', mat: '' };
    var short = (ns.indexOf(':') >= 0) ? ns.slice(ns.indexOf(':') + 1) : ns;
    if (short === 'enchanted_golden_apple') return { kind: 'egapple', mat: 'golden' };
    if (ns === 'minecraft:snowball') return { kind: 'snowball', mat: '' };
    if (ns === 'minecraft:egg') return { kind: 'egg', mat: '' };
    if (short === 'ender_pearl') return { kind: 'pearl', mat: '' };
    if (_NX_POTION_KINDS[ns]) return { kind: 'potion', mat: '' };
    if (_NX_BLOCK_NS[ns]) return { kind: 'block', mat: '' };
    var us = short.indexOf('_');
    var mat = (us < 0) ? '' : short.slice(0, us);
    var type = (us < 0) ? short : short.slice(us + 1);
    if (type === 'apple' && mat === 'golden') return { kind: 'gapple', mat: 'golden' };
    if (type === 'bucket') return { kind: 'bucket', mat: mat };
    if (type === 'rod' && mat === 'fishing') return { kind: 'rod', mat: '' };
    if (_NX_ATK[type] && _NX_ATK[type][mat] !== undefined) return { kind: type, mat: mat };
    if (_NX_ARM[type] && _NX_ARM[type][mat] !== undefined) return { kind: type, mat: mat };
    return { kind: 'other', mat: mat, type: type };
}

/* 附魔加成（基岩版数字 id：9 锋利 / 0 保护 / 17 耐久 / 26 经验修补 / 15 效率 / 16 精准采集 / 18 时运）
   受 da_enchant 开关控制。 */
function _nxEnchBonus(item, isTool, isArmor) {
    var bonus = 0;
    if (!da_enchant) return 0;
    try {
        (item.enchants || []).forEach(function (e) {
            var id = Number(e.id), lvl = Number(e.lvl) || 0;
            if (!isFinite(id) || lvl <= 0) return;
            if (isTool && id === 9) bonus += lvl * 0.125;
            if (isTool && id === 10) bonus += lvl * 0.05;
            if (isTool && id === 11) bonus += lvl * 0.05;
            if (isTool && id === 13) bonus += lvl * 0.03;
            if (isArmor && id === 0) bonus += lvl * 0.04;
            if (id === 17) bonus += lvl * 0.05;
            if (id === 26) bonus += 0.15;
            if (isTool && id === 15) bonus += lvl * 0.02;
            if (isTool && id === 16) bonus += 0.05;
            if (isTool && id === 18) bonus += lvl * 0.03;
        });
    } catch (e) { }
    return bonus;
}

/* 核心分：材质 + 类型 + 附魔，**不含耐久** —— 择优替换的唯一依据 */
function _nxCore(item, cls) {
    cls = cls || _nxClassify(item);
    var isTool = !!_NX_ATK[cls.kind];
    var isArmor = !!_NX_ARM[cls.kind];
    if (!isTool && !isArmor) return 0;
    var base = isTool ? (_NX_ATK[cls.kind][cls.mat] || 0) : (_NX_ARM[cls.kind][cls.mat] || 0) * 2;
    if (!base) return 0;
    return base * (1 + _nxEnchBonus(item, isTool, isArmor));
}

/* 耐久余量 0..1（1 = 全新）。maxDamage 与当前损伤都来自 nbt2object。 */
function _nxDurFrac(item) {
    var maxD = Number(item && item.damage) || 0;
    if (maxD <= 0) return 1;
    var curD = Number(item && item.curDamage) || 0;
    return Math.max(0, Math.min(1, 1 - curD / maxD));
}

/* 绝对质量值 = 核心分 × 耐久系数（0.85~1.0）。供诊断/外部使用；
   择优比较**不要**用它 —— 见文件头「择优判据」。 */
function _nxQuality(item, cls) {
    var core = _nxCore(item, cls);
    if (!core) return 0;
    return core * (0.85 + 0.15 * _nxDurFrac(item));
}

/* 是否该用 cand 替换 cur（i = 候选，j = 当前），入参是预计算的核心分与耐久余量 */
function _nxBetter(ci, di, cj, dj) {
    if (ci > cj + 1e-6) return true;                       /* 核心分更好 → 换 */
    if (Math.abs(ci - cj) <= 1e-6) {
        return dj < 0.25 && di > 0.75;                     /* 同类同分：快碎了才换新的 */
    }
    return false;
}

/* ---------- 3. 计划生成 ---------- */

/* 找回该槽所需的候选槽位（背包优先于其他快捷栏；找不到返回 -1）。
   袋里有多个候选时：best 取核心分最高；keep 随机取一个（用户要求「随机选一个放置」）。 */
function _nxPick(snap, k, spec, core) {
    var bag = [], hot = [], i, c;
    for (i = 9; i < 36; i++) {
        if (_nxIsAir(snap[i])) continue;
        c = _nxClassify(snap[i]);
        if (spec.accept(c)) bag.push(i);
    }
    for (i = 0; i < 9; i++) {
        if (i === k || _nxIsAir(snap[i])) continue;
        c = _nxClassify(snap[i]);
        if (spec.accept(c)) hot.push(i);
    }
    var pool = bag.length ? bag : hot;
    if (!pool.length) return -1;
    if (spec.mode === 'best') {
        var bi = pool[0], bq = (core ? core[pool[0]] : _nxCore(snap[pool[0]]));
        for (i = 1; i < pool.length; i++) {
            var q = core ? core[pool[i]] : _nxCore(snap[pool[i]]);
            if (q > bq) { bq = q; bi = pool[i]; }
        }
        return bi;
    }
    return pool.length === 1 ? pool[0] : pool[getRand(0, pool.length - 1)];
}

/* 保留类 -> 配额键（雪球单独算，不含鸡蛋/钓鱼竿） */
function _nxReserveKey(c) {
    if (c.kind === 'block') return 'block';
    if (c.kind === 'snowball') return 'snowball';
    if (c.kind === 'potion') return 'potion';
    if (c.kind === 'bucket') return 'bucket';
    return null;
}

/* 动作签名：用来在「本轮已失败」的集合里跳过某个动作 */
function _nxSig(o) {
    return o.op + ':' + (o.from !== undefined ? o.from : o.slot) + '>' + (o.to !== undefined ? o.to : o.idx);
}

/* 生成「下一步动作」。返回 {op, ...} 或 null。
   skip = 本次调用里已经失败过的动作签名集合（避免一个失败动作把后面的动作饿死）。
   关键顺序：**先丢多余（腾空位），再搬运/换装** —— 见文件头。 */
function _nxPlanStep(id, snap, armorSnap, skip) {
    var keep = {}, moves = [], equips = [], k, i, s;
    var names = ['helmet', 'chestplate', 'leggings', 'boots'];

    /* 快照只算一次核心分与耐久（每步 36 次），供全部比较复用 */
    var core = [], dur = [];
    for (i = 0; i < 36; i++) {
        core[i] = _nxCore(snap[i]);
        dur[i] = _nxDurFrac(snap[i]);
    }
    var acore = [], adur = [];
    for (s = 0; s < 4; s++) {
        acore[s] = _nxCore(armorSnap[s]);
        adur[s] = _nxDurFrac(armorSnap[s]);
    }

    /* (1) 快捷栏规划 */
    if (da_move) {
        for (k = 0; k < 9; k++) {
            var spec = _NX_HOTBAR[k];
            var cur = snap[k], cc = _nxClassify(cur);
            if (!_nxIsAir(cur) && spec.accept(cc)) {
                keep[k] = true;                       /* 该格已就绪，默认不动 */
                if (spec.mode === 'best' && da_weapon) {
                    var cand = _nxPick(snap, k, spec, core);
                    if (cand >= 0 && cand !== k && _nxBetter(core[cand], dur[cand], core[k], dur[k])) {
                        keep[cand] = true;            /* 即使暂时推不动，也不能被当多余丢掉 */
                        var mv1 = { op: 'move', from: cand, to: k, why: '升级' + spec.label };
                        if (!(skip && skip[_nxSig(mv1)])) moves.push(mv1);
                    }
                }
            } else {
                var pick = _nxPick(snap, k, spec, core);
                if (pick >= 0) {
                    keep[pick] = true;
                    var mv2 = { op: 'move', from: pick, to: k, why: '补' + spec.label };
                    if (!(skip && skip[_nxSig(mv2)])) moves.push(mv2);
                }
                /* 没候选：该槽留空；原物品若不合规会在清理阶段被丢掉 */
            }
        }
    }

    /* (2) 装备栏择优替换（含待装备栏为空/类型不符 → 直接找全局最优） */
    if (da_move && da_armor) {
        for (s = 0; s < 4; s++) {
            var kind = names[s];
            var best = -1;
            for (i = 9; i < 36; i++) {
                if (_nxIsAir(snap[i])) continue;
                if (_nxClassify(snap[i]).kind !== kind) continue;
                if (best < 0 || core[i] > core[best]) best = i;
            }
            if (best >= 0 && _nxBetter(core[best], dur[best], acore[s], adur[s])) {
                keep[best] = true;                     /* 同上：不能被当多余丢掉 */
                var eq = { op: 'equip', from: best, idx: s, why: '换' + kind };
                if (!(skip && skip[_nxSig(eq)])) equips.push(eq);
            }
        }
    }

    if (!da_move) return null;

    /* (3) 背包储备配额：只数还未被征用的背包格（快捷栏与装备候选已在 keep 里） */
    var quotaLeft = { block: _NX_QUOTA.block, snowball: _NX_QUOTA.snowball, potion: _NX_QUOTA.potion, bucket: _NX_QUOTA.bucket };
    for (i = 9; i < 36; i++) {
        if (_nxIsAir(snap[i]) || keep[i]) continue;
        var key = _nxReserveKey(_nxClassify(snap[i]));
        if (key && quotaLeft[key] > 0) { keep[i] = true; quotaLeft[key]--; }
    }
    /* 盾牌要留给第 (6) 步上副手，先保住一把 —— 否则会在这之后的清理里被当多余丢掉。
       副手已经是盾牌时不再保（多余的照常丢）。 */
    /* 有未结的穿戴：快捷栏那一格（target）要先保住 —— 装备正临时停在那儿等引擎穿，
       不能在这一轮被当「多余物品」丢掉（验证时实测到 L/O 场景头盔就是这么没的）。 */
    if (_nxEquipPending) keep[_nxEquipPending.target] = true;

    if (_NX_OFFHAND_SHIELD) {
        var _needShield = true;
        try { _needShield = (getOffhand(id).namespace !== 'minecraft:shield'); } catch (e) { }
        if (_needShield) {
            for (i = 0; i < 36; i++) {
                if (snap[i] && snap[i].namespace === 'minecraft:shield') { keep[i] = true; break; }
            }
        }
    }

    /* (4) **先换装**：equipArmor 不占背包空间（它自己把被换下的放回原槽），
       而且必须排在清理之前 —— 否则「背包里那件更好的」会先被当多余丢掉，永远穿不上。
       （用户 2026-09-18 实机反馈的时序问题：更好的装备直接被扔掉了） */
    if (equips.length) return equips[0];

    /* (5) 再丢多余（腾空间）：背包 9–35 倒序，再处理快捷栏里不合规的 */
    var dp;
    for (i = 35; i >= 9; i--) {
        if (_nxIsAir(snap[i]) || keep[i]) continue;
        dp = { op: 'drop', slot: i, why: '背包多余' };
        if (skip && skip[_nxSig(dp)]) continue;
        return dp;
    }
    for (k = 8; k >= 0; k--) {
        if (_nxIsAir(snap[k]) || keep[k]) continue;
        dp = { op: 'drop', slot: k, why: '快捷栏多余' };
        if (skip && skip[_nxSig(dp)]) continue;
        return dp;
    }

    /* (6) 最后搬运（它需要背包有空位，所以必须排在丢弃之后） */
    if (moves.length) return moves[0];

    /* (6) 盾牌常驻副手 —— **放在最后**：副手不是背包槽，只能 setOffhandItem，
       而这条路上有 native 层调用（_nbtToItem → setNBT/reinit），万一对某些物品
       不友好，也不至于把前面的搬运/换装带停。可用 SmartInv.json 的 offhand_shield 关掉。 */
    if (da_move && _NX_OFFHAND_SHIELD) {
        try {
            if (getOffhand(id).namespace !== 'minecraft:shield') {
                for (i = 0; i < 36; i++) {
                    if (snap[i] && snap[i].namespace === 'minecraft:shield') {
                        return { op: 'offhand', from: i, why: '盾牌上副手' };
                    }
                }
            }
        } catch (e) { }
    }
    return null;
}

/* ---------- 4. 动作落地 ---------- */

/* 搬运：先腾空目标槽，再按「引擎级 moveInventoryItem → setInventoryItem 直接写」的顺序试。

   **不做任何「记住失败」的状态** —— 这是第 4 批的教训：一次偶然失败就把整类界面
   标成不可搬，连原本正常的「打开背包」也被锁死。现在每次都从头试，代价只是一次空调用。

   实测（2026-09-18）：打开背包时引擎级这条路正常；HUD 下它不生效（同一时刻丢弃却正常）。
   官方 v2 文档里这些 API 平级、都没写界面前置条件，所以是引擎实现差异，不是反作弊。 */
var _NX_LAST_MOVE = '';

function _nxMoveViaApi(id, from, to) {
    try {
        if (from === to) return false;
        if (_nxIsAir(getInventory(id, from))) return false;
        if (!_nxIsAir(getInventory(id, to))) return false;
        var want = getInventory(id, from).namespace;
        moveInventoryItem(from, to);
        return getInventory(id, to).namespace === want;
    } catch (e) { return false; }
}

/* 直接写：写入目标 → 校验 → 清空来源 → 校验；清空来源失败就把目标回滚掉。
   宁可不搬，也不能变成复制物品。 */
function _nxMoveViaSet(id, from, to) {
    try {
        if (from === to) return false;
        var lp = _player.getLocalPlayer();
        if (!lp) return false;
        var want = getInventory(id, from).namespace;
        if (!want || want === 'minecraft:air') return false;
        if (!_nxIsAir(getInventory(id, to))) return false;
        var stack = lp.getInventoryItem(from);
        if (!stack || (stack.isNull && stack.isNull())) return false;
        var empty = _nbtToItem("");
        lp.setInventoryItem(to, stack);
        if (getInventory(id, to).namespace !== want) return false;
        lp.setInventoryItem(from, empty);
        if (!_nxIsAir(getInventory(id, from))) {
            lp.setInventoryItem(to, empty);
            return false;
        }
        return true;
    } catch (e) { return false; }
}

/* 把 from 的东西放进**已经空着的** to */
function _nxMoveOnce(id, from, to) {
    if (_nxMoveViaApi(id, from, to)) { _NX_LAST_MOVE = 'api'; return true; }
    if (_nxMoveViaSet(id, from, to)) { _NX_LAST_MOVE = 'set'; return true; }
    _NX_LAST_MOVE = 'none';
    return false;
}

function _nxMove(id, from, to) {
    try {
        if (from === to) return false;
        var t0 = getInventory(id, to);
        if (to < 9 && !_nxIsAir(t0)) {
            var spare = -1;
            for (var i = 35; i > 8; i--) { if (_nxIsAir(getInventory(id, i))) { spare = i; break; } }
            if (spare < 0) return false;                 /* 背包满，搬不动 */
            if (!_nxMoveOnce(id, to, spare)) return false;
        }
        return _nxMoveOnce(id, from, to);
    } catch (e) { return false; }
}

/* =====================================================================================
 *  穿装备
 *
 *  ---- 老路（打开背包时可用，用户实机验证过）----
 *  equipArmor =「搬进快捷栏 → 选中 → useItem()」，由游戏引擎自己完成穿装
 *  （v2 里 buildBlock(face=6) 就是「使用手持物品」）。三个坑：
 *     ① 它第一步用的是**脚本的 moveItem**，那个函数自带
 *        `getScreenName() !== 'inventory_screen'` 检查 —— 静默模式下 screen 恒为 hud_screen，
 *        会被挡死。所以要先用引擎级 _nxMove 把装备挪到快捷栏。
 *     ② 用户的布局要求 9 格快捷栏排满，于是每次都先要腾位；背包一紧就死锁 ——
 *        2026-09-18 实机日志就是反复「搬不到快捷栏 8」。
 *     ③ **穿装备要等 tick**，同一 tick 里读装备栏读不到（早先版本因此「搬过去→校验失败→
 *        挪回」，表现为快捷栏最后一格反复出现又消失）。所以是跨轮等待 + 登记 pending。
 *
 *  ---- 新路（静默模式的正路）：容器级直传，完全不碰快捷栏 ----
 *  「把装备从背包槽放进装备槽」在协议层就是一次**容器移动** —— 玩家手动拖拽发的就是它，
 *  跟「手持右键」（useItem）是两回事。引擎把它封装成 moveContainerItem / swapContainerItem
 *  （v2 文档 API/v2/LocalPlayer.md）。于是：
 *     目标装备槽空   → moveContainerItem([{ …目标 netId=0, count }])
 *     目标装备槽有物 → swapContainerItem([{ … }])   （被换下的自动回到来源槽）
 *  requestId 由引擎自己维护 —— 我们自己造 147 包会与引擎序列撞号、直接把客户端搞崩
 *  （2026-09-18 踩过，产物已挪到 work/_unsafe_silent2_probe.js）。
 *
 *  参照实现：KuSug 的 TimeUnity（同一台服务器上在跑的脚本）的静默整理就是这么穿装备的
 *  —— ref/kusug/script/TimeUnity.js:8641 `EquipLocalPlayerArmor`（transfer/swap）+ 8526
 *  `getContainerId` 的容器表。容器编号 armor=6 / hotbar=29 / inventory=30 取自它。
 * ===================================================================================== */

/* 网易的容器编号（仅供容器直传用；**没有实机证据**，是一组候选） */
var _NX_CID_ARMOR = 6;
var _NX_CID_HOTBAR = 29;
var _NX_CID_INV = 30;
var _NX_EQ_ERR = '';                       /* 直传抛出的异常（诊断用） */

/* 装备槽在「引擎背包槽空间」里的编号：0-35 是背包，36-39 依次是头盔/胸甲/护腿/靴子。
   这条同于用户 2026-09-18 提醒的「Shift+左键快速移动」：装备在主背包、快捷栏已满时，
   快速移动会把装备落进装备栏 —— 说明引擎自己知道该把它放哪。
   我们直接把这个编号交给 **moveInventoryItem**（静默态下已被实机验证可用的那条 API）。
   待实机确认的就是这个 36 到底对不对（探针 T6 在扫 36-40）。 */
var _NX_SLOT_ARMOR0 = 36;

function _nxCidOf(slot) { return (slot >= 0 && slot <= 8) ? _NX_CID_HOTBAR : _NX_CID_INV; }

/* 路径 A：把背包装备「移」到装备槽编号（引擎自带的 moveInventoryItem，静默态下已实测可用）。
   返回 'sent' / 'unavailable' / 'nosrc'。成败由等待窗口读 getArmorItem 判定。 */
function _nxEquipViaSlot(id, idx, from) {
    var lp = null;
    try { lp = _player.getLocalPlayer(); } catch (e) { lp = null; }
    if (!lp || typeof lp.moveInventoryItem !== 'function') return 'unavailable';
    var src = getInventory(id, from);
    if (!src || !src.namespace || src.namespace === 'minecraft:air') return 'nosrc';
    try {
        lp.moveInventoryItem(from, _NX_SLOT_ARMOR0 + idx);
        _NX_EQ_ERR = '';
        return 'sent';
    } catch (e) {
        _NX_EQ_ERR = String((e && e.message) || e).slice(0, 48);
        return 'unavailable';
    }
}

/* 把背包槽 from 的装备放进装备槽 idx（容器级直传）。
   返回 'sent'（已发起，进等待窗口确认）/ 'unavailable'（引擎没这两个方法或抛异常）/ 'nosrc'（来源为空）。 */
function _nxEquipViaContainer(id, idx, from) {
    var lp = null;
    try { lp = _player.getLocalPlayer(); } catch (e) { lp = null; }
    if (!lp || typeof lp.moveContainerItem !== 'function' || typeof lp.swapContainerItem !== 'function') return 'unavailable';

    var src = getInventory(id, from);
    if (!src || !src.namespace || src.namespace === 'minecraft:air') return 'nosrc';
    var dstNs = _nxArmorNs(id, idx);
    var dstNet = 0;
    try { dstNet = Number(nbt2object(getPlayerArmorItem(id, idx)).id) || 0; } catch (e) { }

    var act = {
        fromSlot: from, fromNetId: Number(src.id) || 0, fromContainerId: _nxCidOf(from),
        toSlot: idx, toNetId: dstNet, toContainerId: _NX_CID_ARMOR
    };
    try {
        if (!dstNs || dstNs === 'minecraft:air') {      /* 目标空 → 单纯移动 */
            act.count = Number(src.count) || 1;
            lp.moveContainerItem([act]);
        } else {                                        /* 目标有物 → 交换 */
            lp.swapContainerItem([act]);
        }
        _NX_EQ_ERR = '';
        return 'sent';
    } catch (e) {
        _NX_EQ_ERR = String((e && e.message) || e).slice(0, 48);
        return 'unavailable';
    }
}

/* ---- 穿戴日志：把「试了什么、成没成」写到游戏目录，供事后定位 ----------------
   症状（用户 2026-09-18）：用着好好的忽然就不穿装备了，别的整理照常，重载脚本又恢复。
   这种「概率性状态卡死」不能复现时，唯一有效的手段是**让它自己留下证据**：
   文件 GBRC/NoveXare/NXEquipLog.txt（最多 200 行），每行带 tick 号 ——
   如果失效时 tick 号停止增长，那就直接锁定了「_nxLastTicks 冻结」这一类卡死。 */
function _nxEqLog(s) {
    try {
        var f = _app.getResource() + "/GBRC/NoveXare/NXEquipLog.txt";
        var old = '';
        try { old = _fs.read(f) || ''; } catch (e) { old = ''; }
        var lines = String(old).split("\n");
        lines.push('[' + _nxLastTicks + '] ' + s);
        if (lines.length > 200) lines = lines.slice(lines.length - 200);
        _fs.write(f, lines.join("\n"));
    } catch (e) { }
}

/* ---- 看门狗：把「卡死的穿戴状态」自己清回来 ----------------------------------
   「重载脚本就恢复正常」说明坏掉的是**脚本里的几个模块变量**，不是引擎。
   那就不去猜具体是哪一次调用把它弄脏的 —— 只要它长时间推不动，就整组重置
   （等价于重载脚本对这几个变量的效果），并在日志里留一笔。
   正常情况永远不会触发：无 pending 无冷却时计数归零；冷却最多 60 轮。 */
var _nxEquipStall = 0;
var _NX_EQ_STALL_LIMIT = 120;          /* 约 6 秒（静默下借态那轮不计数，实际约 12 秒） */
function _nxEquipWatchdog(id) {
    var cooling = _nxEquipCooldown && _nxLastTicks < _nxEquipCooldown;
    if (!_nxEquipPending && !cooling) { _nxEquipStall = 0; return; }
    _nxEquipStall++;
    if (_nxEquipStall < _NX_EQ_STALL_LIMIT) return;
    _nxEqLog('WATCHDOG reset  stall=' + _nxEquipStall
        + ' pending=' + (_nxEquipPending ? _nxEquipPending.via : '-')
        + ' cooldownUntil=' + _nxEquipCooldown + ' now=' + _nxLastTicks);
    _nxEquipPending = null;
    _nxEquipCooldown = 0;
    _nxEquipFails = 0;
    _nxEquipStall = 0;
    _NX_INV_DIAG.equip = 'watchdog-reset';
}

var _nxEquipPending = null;
var _NX_EQ_NEXT = 'slot';      /* 下次发起穿戴时优先试哪条路：'slot' | 'container' */var _nxLastTicks = 0;          /* 由 _nxInvBrain 每轮刷新，供等待窗口判断 */
var _nxEquipFails = 0;         /* 连续失败次数 */
var _nxEquipCooldown = 0;      /* 冷却到哪个 tick 之前不再尝试穿装备（防反复闪烁） */

function _nxArmorNs(id, idx) {
    try { return nbt2object(getPlayerArmorItem(id, idx)).namespace || ''; } catch (e) { return ''; }
}

/* 结算「未完成的穿戴」：读一眼装备槽就够了 ——
   成了就清 pending；超时也清（并执行必要的回滚）。
   **必须能在没有 equip 动作的轮次里被调用**：装备一旦穿上，计划里就不再生成 equip 动作，
   若只在 _nxEquipDirect 里结算，pending 会永远悬着 —— 而它又挡着静默会话的释放，
   结果就是「背包控制权再也还不回去」（用户 2026-09-18 实测过的同类现象）。 */
function _nxEquipSettle(id) {
    var p = _nxEquipPending;
    if (!p) return;
    /* 等待窗口用**轮次**而不是 tick 差：tick 若跳变/回绕，tick 差会失真
       （那正是「忽然不穿装备、重载才恢复」的一个可能形态）。 */
    p.age = (p.age || 0) + 1;
    if (_nxArmorNs(id, p.idx) === p.want) {
        _nxEquipPending = null;
        _nxEquipFails = 0;
        _nxEquipStall = 0;
        _NX_INV_DIAG.equip = 'ok:' + (p.via || '?');
        _nxEqLog('OK ' + p.via + ' from=' + p.from + ' idx=' + p.idx + ' age=' + p.age);
        return;
    }
    if (p.age < 8) return;                     /* 服务端往返要时间，给足 8 轮 */
    /* 超时仍没穿上。三条路的收尾各不相同：
       · hotbar：装备正停在快捷栏等右键 → 必须挪回原处，否则会被清理阶段当多余丢掉
       · container：什么都没动过，不用管
       · slot：正常失败时物品也留在原地；但若源槽空了，说明引擎把 36 解释成了别的槽 → 报出来 */
    var _via = p.via || 'hotbar';
    if (_via === 'hotbar' && p.target !== p.from) {
        try { _nxMove(id, p.target, p.from); } catch (e) { }
    } else if (_via === 'slot') {
        try { if (_nxIsAir(getInventory(id, p.from))) _NX_EQ_ERR = 'slot-went-elsewhere'; } catch (e) { }
    }
    _nxEquipPending = null;
    _nxEquipFails++;
    _NX_INV_DIAG.equip = 'fail:' + _via + '×' + _nxEquipFails;
    _nxEqLog('FAIL ' + _via + ' from=' + p.from + ' idx=' + p.idx + ' age=' + p.age + ' err=' + _NX_EQ_ERR);
    if (_nxEquipFails >= 6) {                  /* 连着六次穿不上（两条路各试过几轮）→ 歇 60 tick */
        _nxEquipCooldown = _nxLastTicks + 60;
        _nxEquipFails = 0;
        _NX_INV_DIAG.equip = 'cooldown:' + _via;
        _nxEqLog('COOLDOWN until tick ' + _nxEquipCooldown + ' (now ' + _nxLastTicks + ')');
    }
}

function _nxEquipDirect(id, idx, from) {
    /* (0) 冷却中：连续失败过几次就别再折腾了，免得快捷栏那一格反复出现又消失 */
    if (_nxEquipCooldown && _nxLastTicks < _nxEquipCooldown) return false;

    /* (1) 上一次还没结 —— settle 由 _nxInvBrain 每轮调一次，这里不重复调
       （重复调会让 age 一轮走两次，等待窗口对不上） */
    if (_nxEquipPending) return false;

    /* (2) 发起一次穿戴 */
    var want = getInventory(id, from).namespace;
    if (!want || want === 'minecraft:air') return false;

    /* 分界：**非静默（打开了背包）直接用被实机验证过的老路 equipArmor** ——
       下面那两条新路都是「发出去了但当场不知道成没成」，摆在前面会把老路饿死。 */
    if (!_NX_SILENT) {
        var target0 = from;
        if (from > 8) {
            if (!_nxMove(id, from, 8)) return false;
            if (getInventory(id, 8).namespace !== want) return false;
            target0 = 8;
        }
        try { equipArmor(target0); } catch (e) { return false; }
        _nxEquipPending = { idx: idx, want: want, from: from, target: target0, via: 'hotbar', age: 0 };
        _NX_INV_DIAG.equip = 'pending:hotbar';
        _nxEqLog('try hotbar from=' + from + ' idx=' + idx + ' want=' + want);
        return true;
    }

    /* 静默模式：两条候选（**轮换优先**，都不是「一次失败就永久禁用」）：
         A = 把装备「移」到装备槽编号（moveInventoryItem，静默下已实测可用）
         B = 容器级直传（containerId，没有任何实机证据）
       哪条先返回 sent 就先发哪条；超时后下一轮换另一条优先。 */
    var first = _NX_EQ_NEXT, second = (first === 'slot') ? 'container' : 'slot';
    var via = '';
    var r1 = (first === 'slot') ? _nxEquipViaSlot(id, idx, from) : _nxEquipViaContainer(id, idx, from);
    if (r1 === 'sent') via = first;
    else if (r1 === 'nosrc') return false;
    else {
        var r2 = (second === 'slot') ? _nxEquipViaSlot(id, idx, from) : _nxEquipViaContainer(id, idx, from);
        if (r2 === 'sent') via = second;
        else if (r2 === 'nosrc') return false;
    }
    if (via) {
        _NX_EQ_NEXT = (via === 'slot') ? 'container' : 'slot';   /* 下次换另一条优先 */
        _nxEquipPending = { idx: idx, want: want, from: from, target: from, via: via, age: 0 };
        _NX_INV_DIAG.equip = 'pending:' + via;
        _nxEqLog('try ' + via + ' from=' + from + ' idx=' + idx + ' want=' + want);
        return true;
    }

    /* 两条路都不可用（引擎没有对应的 API）*/
    _NX_INV_DIAG.equip = _NX_EQ_ERR ? ('no-api:' + _NX_EQ_ERR) : 'no-container-api';
    return false;
}

/* 落地一个动作，并**校验它真的生效** */
function _nxDo(id, act, hud) {
    if (!act) return false;
    try {
        if (act.op === 'move') {
            if (act.from === act.to) return false;
            var want = getInventory(id, act.from).namespace;
            if (!want || want === 'minecraft:air') return false;
            _nxMove(id, act.from, act.to);
            return getInventory(id, act.to).namespace === want;
        }
        if (act.op === 'equip') {
            return _nxEquipDirect(id, act.idx, act.from);
        }
        if (act.op === 'offhand') {
            var wantO = getInventory(id, act.from).namespace;
            if (!wantO || wantO === 'minecraft:air') return false;
            if (!setEntityOffhandItem(id, getPlayerInventoryItem(id, act.from))) return false;
            dropPlayerInventorySlot(id, act.from, false, true);
            return getOffhand(id).namespace === wantO;
        }
        if (act.op === 'drop') {
            if (_nxIsAir(getInventory(id, act.slot))) return false;
            dropPlayerInventorySlot(id, act.slot, false, da_all);
            return _nxIsAir(getInventory(id, act.slot));
        }
    } catch (e) { }
    return false;
}

/* ---------- 5. 入口：由 onTick 每 da_delay tick 调一次 ---------- */

let _NX_INV_LAST = '';        /* 最近一次动作，供诊断脚本读取 */
let _NX_INV_DIAG = { run: 0, act: 0, fail: 0, last: '', hud: '', move: '', silent: '', equip: '', eqst: '' };

/* UI 语义：三个复选框各自生效，都不勾 = 任何时候都触发。
   两个都勾时取「或」（开箱或开背包都算），比「与」更符合直觉。 */
function _nxHudAllowed(hud, pitch) {
    if (da_bow && !(pitch > 80)) return false;
    var h = String(hud || '');
    var wantInv = !!da_inv, wantChest = !!da_chest;
    if (!wantInv && !wantChest) return true;
    var inInv = (h === 'inventory_screen');
    var inChest = (h.indexOf('chest_screen') !== -1);
    if (wantInv && wantChest) return inInv || inChest;
    if (wantInv) return inInv;
    return inChest;
}

function _nxInvBrain(id, hud, pitch, ticks) {
    /* ---- 静默会话的生命周期管理：**必须放在最前面** ----
       放在后面的话，任何提前 return（开关被关、条件不满足、节流、借态中…）
       都会漏掉释放，结果就是「背包控制权一直被占着，关掉功能也不还」
       —— 用户 2026-09-18 实测到了这个。 */
    if (_NX_SILENT && _nxSilentState.active) {
        if (!_nxSilentState.lastAct) _nxSilentState.lastAct = ticks;
        var _nxIdle = ticks - _nxSilentState.lastAct;
        if (!SmartInv || _nxIdle > 60) {          /* 关掉开关，或约 3 秒没动作 */
            _nxSilentRelease();
            _NX_INV_DIAG.silent = 'auto-release';
        }
    }
    if (!SmartInv) return;
    var delay = Math.max(1, Number(da_delay) || 1);
    if (ticks % delay !== 0) return;
    if (!_nxHudAllowed(hud, pitch)) return;

    _nxLastTicks = ticks;
    _NX_INV_DIAG.run++;
    _NX_INV_DIAG.hud = String(hud || '');

    /* ---- 静默模式：自己借容器态，不要求玩家手动打开背包 ----
       引擎的 moveInventoryItem 只看「有没有容器态」，不看界面是否显示（见 nx_silent.js 头部）。
       静默时界面永远不显示，所以「仅打开背包 / 仅开箱」不适用，只保留「仅低头」。 */
    if (_NX_SILENT) {
        if (da_bow && !(pitch > 80)) return;
        if (!_nxSilentState.active) {
            if (!_nxSilentBorrow()) return;
            _NX_INV_DIAG.silent = 'borrow';
            return;                              /* 下一轮容器态就绪再干活 */
        }
        if (!_nxSilentReady()) {
            _nxSilentState.borrowTicks = (_nxSilentState.borrowTicks || 0) + 1;
            if (_nxSilentState.borrowTicks > 20) {
                _nxSilentRelease();
                _NX_INV_DIAG.silent = 'timeout';
            }
            return;
        }
    } else {
        /* 非静默：需要有「容器态」—— 自己的背包界面，或者箱子界面。
           不能放宽到 HUD：那时引擎没有容器态，moveInventoryItem 必然失败（实测），
           放开只会白试。 */
        var _scr = getScreenName();
        if (_scr !== 'inventory_screen' && _scr.indexOf('chest') === -1) return;
    }

    _NX_INV_DIAG.move = _NX_LAST_MOVE;
    /* 每轮先结掉上一轮未完成的穿戴，再看门狗 —— 即使这一轮已经没有 equip 动作了也要跑，
       否则 pending 会永久悬着并卡住静默会话的释放（见 _nxEquipSettle 注释）。 */
    _nxEquipSettle(id);
    _nxEquipWatchdog(id);
    _NX_INV_DIAG.eqst = (_nxEquipPending ? ('P.' + _nxEquipPending.via + '/' + (_nxEquipPending.age || 0)) : '-')
        + ' next=' + _NX_EQ_NEXT + ' fails=' + _nxEquipFails
        + ' cd=' + Math.max(0, (_nxEquipCooldown || 0) - _nxLastTicks) + ' stall=' + _nxEquipStall;
    var budget = Math.max(1, Number(da_max) || 1);
    var skip = {};                 /* 本次调用里失败过的动作：不让它把后面的动作饿死 */
    var acted = false;             /* 这一轮是否真做成了动作（静默会话靠它判断收尾） */
    var guard = budget + 6;        /* 上限：最多连试这么多次就收工 */
    while (guard-- > 0) {
        var snap = [], armorSnap = [];
        for (var i = 0; i < 36; i++) snap[i] = getInventory(id, i);
        for (var s = 0; s < 4; s++) {
            try { armorSnap[s] = nbt2object(getPlayerArmorItem(id, s)); } catch (e) { armorSnap[s] = { namespace: 'minecraft:air' }; }
        }
        var act = _nxPlanStep(id, snap, armorSnap, skip);
        if (!act) break;
        _NX_INV_LAST = act.op + ':' + (act.from !== undefined ? act.from : act.slot) + '->' + (act.to !== undefined ? act.to : act.idx) + ' ' + (act.why || '');
        if (_nxDo(id, act, hud)) {
            acted = true;
            _nxSilentState.lastAct = ticks;
            _NX_INV_DIAG.act++;
            _NX_INV_DIAG.last = _NX_INV_LAST;
            budget--;
            if (budget <= 0) break;
        } else {
            skip[_nxSig(act)] = 1;     /* 这类界面下做不了，换下一个动作试 */
            _NX_INV_DIAG.fail++;
            _NX_INV_DIAG.last = 'FAIL ' + _NX_INV_LAST;
        }
    }
    /* 静默会话：这一轮一件事都没做成 → 认为整理完了，还掉容器态。
       但**有未结的穿戴时不能还** —— 容器移动是服务端操作，要等它回来才算数
       （还了态等于告诉服务端容器关了，请求可能被丢）。 */
    if (_NX_SILENT && _nxSilentState.active && !acted && !_nxEquipPending) {
        _nxSilentRelease();
        _NX_INV_DIAG.silent = 'done';
    }
}

try { globalThis._NX_INV_DIAG = _NX_INV_DIAG; } catch (e) { }

/* v2 适配：同上，加载后打开自己的入口面板。 */
try { _menu.show("NoveXare/NoveXare"); } catch (e) { }
