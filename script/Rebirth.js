/* =====================================================================================
 *  本文件由 migration/migrate.py 从 v1(全局 API) 源自动生成，请勿手工编辑。
 *  源: src/rebirth/script/Rebirth.js
 *  规则: IDENT 表 + File.* 映射；适配层见文件头部 shim 段。
 * ===================================================================================== */

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
const _sp = _safeRequire("sp");
const _nbt = _safeRequire("nbt");
const _block = _safeRequire("block");
const _item = _safeRequire("item");
/* v2 的 Shape 是 world 模块上的类：const {Shape} = require("world") */
const _Shape = (function () { try { return _world ? _world.Shape : null; } catch (e) { return null; } })();

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
       所以先查 getPlayers()（它返回的是玩家 Actor 数组），再退到 getActors()。 */
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
            /* getPlayers() 里没有，再从 actors 里按名字找一遍 */
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
    /* v2 实测（诊断 A/B/C 三段结果一致，与线程无关）：
       level.getDimension(0) / getDimension("overworld") 一律抛 "Invalid dimension"。
       能真正拿到维度对象的是「本地玩家自己的 getDimension()」——
       KuSug 里在跑的 NoteBot3.9.js 正是用它取维度、再 dim.getBlock() 扫方块的。
       所以先走这条，level 那两种写法仅作为旧版兼容保留。 */
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

/* 同一个实体的 id，在「实体列表」和「玩家列表」里必须是**同一种类型** ——
   NoveXare 的 getTargets() 用 `target === self_id` 严格相等来排除自己，
   一旦两边一个是 string、一个是 number/BigInt，比较就永远为 false，
   表现就是「攻击类功能偶尔把自己当目标」。
   实测：level.getPlayerList() 的 p.id 文档写明是 string，而 actor.getUniqueID()
   不一定；所以这里统一成 String（BigInt 也靠 String 归一）。 */
function _idStr(v) {
    try { return (v === undefined || v === null) ? "" : String(v); } catch (e) { return ""; }
}

function getEntityList() {
    const w = _level();
    if (!w) return [];
    try { return w.getActors().map(function (a) { return _idStr(a.getUniqueID()); }); }
    catch (e) { return []; }
}

function getPlayerList(type) {
    const w = _level();
    if (!w) return [];
    // ① level.getPlayerList()（对象形式，与可运行的 玩家传送[坐骑].js 一致）
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
    // ② level.getPlayers()
    try {
        const r = w.getPlayers().map(function (p) {
            return type === "RuntimeId" ? p.getRuntimeID() : _idStr(p.getUniqueID());
        });
        if (r.length) return r;
    } catch (e) { }
    /* ③ 兜底：个别服务器（实测布吉岛）前两条都返回空，却能看到实体。
       改从 getActors() 里按玩家类型 id 筛（319 = minecraft:player，已实测）。
       注意 getActors() 本身不包含本地玩家，所以这只能找回「其他玩家」——
       而索敌要的正是其他玩家，正好够用。 */
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
        /* v2 的 getIdentifier() 返回的是一个 Identifier 对象，实测（玩家实体）：
             { namespace:"minecraft", identifier:"player",
               fullName:"minecraft:player<>", canonicalName:"minecraft:player" }
           fullName 带 <...> 后缀，而 v1 的 getEntityNamespace 返回的是不带后缀的
           "minecraft:player"。下游（NoveXare 的 getTargets）用的是严格相等
             if (type === 'minecraft:player') { ... target === self_id ... }
           一旦回传带 <> 的值，这个分支整段被跳过，就会出现「索敌锁到自己」。
           所以优先取 canonicalName；拿不到再自己拼 namespace:identifier；
           fullName 只作最后兼底，并剥掉 <...>。 */
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
   面编号与 TBCUI.js 的 scaffold 一致：下=1 西=5 东=4 北=3 南=2 上=0 */
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
   脚本主体传的都是目标格，这里统一换算成相邻支撑方块 + 面后再交给引擎
   （与 TBCUI.js 的 scaffold 做法一致）。 */
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


/* =====================================================================================
 *  v2 适配层 —— 通用补充桥接（Rebirth / NoveXare 共用）
 *  ------------------------------------------------------------------------------------
 *  TimeUnity 的 shim 未覆盖、但 Rebirth 与 NoveXare 用到的 v1 全局 API，按 v2 语义补齐。
 *  约定同主 shim：模块别名统一 "_" 前缀；每个函数都容错，失败时返回 v1 的同型空值，
 *  不向上抛异常（tick 级异常会被引擎吞掉，表现为「不相干的功能一起坏」）。
 * ===================================================================================== */

/* ---------- 命令（v1 World.executeCommand / requestExecuteCommand） ---------- */

/* v1 语义：「队列执行命令」→ v2 queueExecuteCommand */
function executeCommand(cmd) {
    try { return _minecraft.queueExecuteCommand(String(cmd)); } catch (e) { return false; }
}

/* v1 语义：「请求执行命令（带回调）」→ v2 requestExecuteCommand(cmd, callback) */
function requestExecuteCommand(cmd, callback) {
    try { return _minecraft.requestExecuteCommand(String(cmd), callback); } catch (e) { return false; }
}

/* ---------- 全局键值存储（v1 System.setData / getData） ----------
   v2 已无 System 模块，改用 sp。v1 的语义是「按默认值类型存取基本类型」，
   而 sp 是强类型接口，直接用会因类型不符抛异常；这里统一以「类型标记 + 文本」
   存成字符串，读回时按标记还原，保持 v1 的类型语义。 */
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

/* ---------- 相机（v1 全局函数 → v2 camera 模块） ---------- */

/* v1: getCameraRotation() -> { pitch, yaw, roll } */
function getCameraRotation() {
    try {
        const r = _camera.getRotation() || {};
        const pitch = (r.x !== undefined) ? r.x : (r.pitch || 0);
        const yaw = (r.y !== undefined) ? r.y : (r.yaw || 0);
        const roll = (r.z !== undefined) ? r.z : (r.roll || 0);
        return { pitch: pitch, yaw: yaw, roll: roll };
    } catch (e) { return { pitch: 0, yaw: 0, roll: 0 }; }
}

/* v1: setCameraRotation(pitch, yaw, roll)；v2 收 {x,y,z} = {pitch,yaw,roll} */
function setCameraRotation(pitch, yaw, roll) {
    try { return _camera.setRotation({ x: Number(pitch) || 0, y: Number(yaw) || 0, z: Number(roll) || 0 }); }
    catch (e) { return false; }
}

/* v1: setCameraPitchLimit(min, max)；v2 setPitchLimit({x:min,y:max}) */
function setCameraPitchLimit(min, max) {
    try { return _camera.setPitchLimit({ x: Number(min) || 0, y: Number(max) || 0 }); }
    catch (e) { return false; }
}

/* ---------- 方块 NBT / 方块实体（v1 Block、BlockEntity → v2 block 模块） ---------- */

function _blockAt(x, y, z) {
    try {
        const d = _dimension();
        if (!d) return null;
        return d.getBlock({ x: x, y: y, z: z });
    } catch (e) { return null; }
}

/* v1: getBlockNBT(x,y,z) -> string */
function getBlockNBT(x, y, z) {
    const b = _blockAt(x, y, z);
    if (!b) return "";
    try {
        const s = b.getNBT();
        return (s === undefined || s === null) ? "" : String(s);
    } catch (e) { return ""; }
}

/* v1: getBlockEntityNBT(x,y,z) -> string；v2 只提供 block.getNBT()，
   方块实体数据与方块 NBT 走同一入口（v1 两者在实测中返回同一份文本）。 */
function getBlockEntityNBT(x, y, z) {
    return getBlockNBT(x, y, z);
}

/* v1: getBlockEntityData(x,y,z) -> string —— NoveXare 用它读标签再写回 */
function getBlockEntityData(x, y, z) {
    return getBlockNBT(x, y, z);
}

/* v1: setBlockEntityData(x,y,z,nbt) -> boolean */
function setBlockEntityData(x, y, z, nbt) {
    try {
        if (!_block || !_block.setBlockEntityData) return false;
        return _block.setBlockEntityData({ x: x, y: y, z: z }, String(nbt));
    } catch (e) { return false; }
}

/* v1: setCommandBlockData(x,y,z,data) -> boolean
   data: { mode, isRedStoneMode, isConditional, command, lastOutput, name,
           tickDelay, shouldTrackOutput, executeOnFirstTick }
   v2 合并为 block.setCommandBlock({pos, mode, redstoneMode, isConditional,
   command, lastOutput, tickDelay, trackOutput, ...})，字段名有出入，做别名透传。 */
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

/* ---------- 实体（v1 Entity → v2 actor） ---------- */

/* v1: findEntity(id) -> boolean（实体是否存在，不是「查找并返回实体」） */
function findEntity(id) {
    if (id === undefined || id === null || id === "") return false;
    return !!_actor(id);
}

/* v1: setEntityNBT(id, mojangson) -> boolean */
function setEntityNBT(id, mojangson) {
    const a = _actor(id);
    if (!a || !a.setNBT) return false;
    try { a.setNBT(String(mojangson)); return true; } catch (e) { return false; }
}

/* v1: getEntityNBT(id) -> string */
function getEntityNBT(id) {
    const a = _actor(id);
    if (!a || !a.getNBT) return "";
    try {
        const s = a.getNBT();
        return (s === undefined || s === null) ? "" : String(s);
    } catch (e) { return ""; }
}

/* v1: setEntityTarget(id, target) -> boolean（仅服务端） */
function setEntityTarget(id, target) {
    const a = _actor(id);
    if (!a || !a.setTarget) return false;
    try {
        const t = _actor(target);
        a.setTarget(t || target);
        return true;
    } catch (e) { return false; }
}

/* v1: getEntityTarget(id) -> string（目标实体的唯一 ID，无目标返回空串） */
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

/* v1: startRidingEntity(id) —— 让「本地玩家」开始骑乘指定实体。
   v2 是 actor.startRiding(vehicle)，方向与 v1 相反，这里按 v1 语义取本地玩家为骑乘者。 */
function startRidingEntity(id) {
    const veh = _actor(id);
    if (!veh) return false;
    const me = _localPlayer();
    try { if (me && me.startRiding) { me.startRiding(veh); return true; } } catch (e) { }
    try { if (veh.getVehicle && veh.startRiding) { veh.startRiding(me); return true; } } catch (e) { }
    return false;
}

/* v1: stopRidingEntity(id) */
function stopRidingEntity(id) {
    const a = _actor(id) || _localPlayer();
    if (!a || !a.stopRiding) return false;
    try { a.stopRiding(); return true; } catch (e) { return false; }
}

/* ---------- 物品 NBT → v2 ItemStack ---------- */

/* v1 的物品 API 一律收发「物品 NBT 文本」；v2 收发 ItemStack 实例。
   这里做两个方向的转换，是本次适配最关键的一处类型桥接。 */
function _nbtToItem(nbtOrItem) {
    try {
        if (nbtOrItem && typeof nbtOrItem === "object") return nbtOrItem;   // 已经是 ItemStack
        const it = new _item.ItemStack();
        const text = (nbtOrItem === undefined || nbtOrItem === null) ? "" : String(nbtOrItem);
        if (!text.trim()) return it;
        try { it.setNBT(text); return it; } catch (e) { }
        /* setNBT 不接受 v1 文本时，退回「解析 Name/Count/Damage 后 reinit」 */
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


var Config = {
    ENABLE: true,
    SET_POS: false,
    CLICK_COPY: false,
    SCOREBOARD: true,
    CONFIRM_CMD: true,
    LARGE_MODE: false,
    LM_MULTIPLE: 1,
    LM_MIN: 50,
    LM_MAX: 50,
    CHUNK_RANGE: 128,
    IMPORT_CHUNK: true,
    DUMP_JS: false,
    AUTO_TP: false,
    SAVE_STATES: false,
    SAVE_CONTAINER: true,
    SHOW_DIRECTION: true,
    HTTP: false,
    INFO_BLOCKS: true,
    TP_FOLLOW: false,
    PACKET_FOLLOW: false,
    RETRY: false,
    FAKE_MODE: false,
    KICK_ALL: false,
    SIGN_TP: true,
    FIX_SIGN: false,
    FIX_CMD: false,
    CMD_OUTPUT: false,
    CMD_FIRST: false,
    CLICK_GET: false,
    IMPORT_TP: false,
    DUMP_TP: false,
    SURVIVAL_CHECK: false,
    SURVIVAL_NOAUX: false,
    IMPORT_TP_DIST: 24,
    POSTPOS_DIST: 0,
    DUMP_TP_DIST: 64,
    IMPORT_TP_OFFSET: 3,
    SERVER_ERROR: 1,
    SHOW_INFO: true,
    DUMP_CONFIRM: false,
    EXCLUDE_LIST: ['air'],
    EXCLUDE_IMPORT: [],
    DUMP_POSTPONE: false,
    SERVER_ANTI: false,
    SERVER_ABSOLUTE: false,
    KILL_LIST: ['item', 'falling_block'],
    ERROR: false,
    FORCE_ZERO: true,
    SERVER: true,
    SERVER_TP: false,
    NO_BEAT: true,
    CONVERT: true,
    SAVE_CMD: true,
    SAVE_SIGN: true,
    LOAD_SIGN: true,
    ROTATE_BUILD: false,
    SHOW_PROGRESS: true,
    LOAD_CMD: true,
    LOAD_CONTAINER: true,
    LOAD_MOB: true,
    BETTER_MODE: false,
    TP_FIRST: true,
    RANDOM_TONE: false,
    RANDOM_BLOCKS: false,
    SAVE_MOB: true,
    ERROR_FIX: false,
    REPLACE_AIR: false,
    X_MIRROR: false,
    Y_MIRROR: false,
    Z_MIRROR: false,
    ROTATION_YAW: 0,
    ROTATION_PITCH: 0,
    AUTO_DENY: false,
    INTERCEPT_OUTPUT: true,
    INTERCEPT_SETCMD: true,
    STOP: false,
    TONE_COLOUR: 'note.chime',
    TP_TARGET: '@s',
    SOUND_TARGET: '@s',
    SERVER_MOB: 'armor_stand',
    EXECUTE_CMD: '',
    SHOW_SIZE: false,
    FILLMODE: 'Z-AXIS-FILL',
    POSMODE: 'CLICK',
    LANG_MODE: 'zh_CN',
    CMD_MODE: 'PACKET1',
    TP_MODE: 'COMMAND',
    TIP_MODE: 'Game',
    TIP_X: 20,
    TIP_Y: 20,
    TIP_A: 0,
    TIP_R: 0,
    TIP_G: 0,
    TIP_B: 0,
    TIP_SIZE: 0,
    INFO_RGB: false,
    INFO_SPEED: true,
    INFO_NAME: true,
    INFO_PROGRESS: true,
    PROGRESS_TEXT: '▌',
    INFO_TASK: true,
    INFO_COMPLETE: true,
    INFO_DIST: true,
    DUMP_MODE: 'MIN',
    POSMODE_3: [],
    CMD_AFTER: [],
    CMD_BEFORE: [],
    POSTPOSITION_LIST: [],
    BUILD_TASKS_CMD: 20,
    BUILD_SPEED_MIN: 45,
    BUILD_SPEED_MAX: 55,
    CAMERA_MODE: false,
    CAMERA_RANGE: 4,
    CAMERA_ZOOM: 0,
    CAMERA_Y: 0,
    FASTCOPY_Y: 25,
    FASTCOPY_XZ: 50,
    BUILD_TASKS_MULTIPLE: 1,
    BUILD_DELAY: 1,
    AUTO_TICKING: false,
    SMART_DUMP: false,
    SURVIVAL_TP: false,
    NO_LIQUID: true,
    DUMP_SPEED: 1,
    DUMP_DISTANCE: 100,
    DUMP_NUM: 100000,
    SLEEP_DELAY: 30,
    IMPORT_TP_DELAY: 2,
    EXPORT_TP_DELAY: 5,
    BUILD_TASKS_SIGN: 5,
    AUTO_SLEEP: 0,
    THRESHOLD_TP: 0,
    THRESHOLD_DELAY: 2,
    THRESHOLD_OFFSET: 3,
    SURVIVAL_MODE: false,
    SURVIVAL_DISTANCE: 7,
    SURVIVAL_HEIGHT: 2,
    SURVIVAL_SELECT: false,
    CHECK_IMPORT: false,
    CHECK_IMPORT_RANGE: 48,
    CHECK_Y: true,
    DUMPLING_NAMESPACE: ['air', 'dirt', 'grass'],
    TAG_KEYWORD: ['黑', '禁', '踢', 'ban'],
    AUTO_TAG: true,
    EXPORT_CHUNK: true,
    EXPORT_TP: false,
    EXPORT_MAKE_SURE: true,
    EXPORT_MID_TP: true,
    EXPORT_TP_DIST: 128,
    INFO_ERROR: false,
    INFO_IMPORT_BOOST: true,
    INFO_DUMP_BOOST: true,
    EXPORT_CHUNK_RANGE: 16,
    TASK_ANALYSE: false,
    DUMP_CONVERT: false,
    BUILD_ASSIST: false,
    SURVIVAL_EXCLUDE: false,
    SURVIVAL_DESTROY: false,
    ASSIST_FILL: false,
    ASSIST_REPLACE: false,
    ASSIST_SPEED: 1,
    ASSIST_DISTANCE: 100,
    FILL_XZ: 1,
    FILL_Y: 1,
    FILL_LENGTH: 100,
    ENTITY_TP_RANGE: 0,
    ASSIST_NUM: 100000,
    FAST_BUILD: false,
    FILL_IMPORT: true,
    BDX_ANALYSE: false,
    CRASH_HUNTER: false,
    FILL_MODE: 'FILL_UP',
    SERVER_NAME: 'Rebirth_Bot',
    COMPRESS: true,
    PASTE_CMD: false,
    COPY_CMD: false,
    COPY_POS: false,
    COPY_SIGN: false,
    PASTE_POS: false,
    PASTE_SIGN: false,
    FB_AIR: false,
};

var Vars = {
    PATHS: {
        main: _app.getResource() + '/GBRC/建筑工具Rebirth',
        data: _app.getResource() + '/GBRC/建筑工具Rebirth/建筑文件',
        sound: _app.getResource() + '/GBRC/建筑工具Rebirth/音乐文件',
        analyse: _app.getResource() + '/GBRC/建筑工具Rebirth/分析',
        cfg: _app.getResource() + '/GBRC/建筑工具Rebirth/配置',
        world: _app.getResource() + '/GBRC/建筑工具Rebirth/存档文件',
    },
    POS_DATA: {
        x: 0,
        y: 0,
        z: 0
    },
    TIP_IP: createText('', 'Center', 0, 0),
    BUILD_TASKS: [],
    HAS_CMD: [],
    EXECUTE_CMDS: [],
    IS_CMD: false,
    SOUND_DATA: [],
    ENTITY_POS: {
        x: 0,
        y: 0,
        z: 0
    },
    CHUNK_POS: {
        x: 0,
        y: 0,
        z: 0
    },
    CAMERA_POS: {
        x: 0,
        y: 0,
        z: 0
    },
    ENTITY_POS_OFFSET: {
        x: 0,
        y: 0,
        z: 0
    },
    RECORD_SIGN: null,
    RECORD_POS: null,
    RECORD_CMD: null,
    LAST_SOUND_TICK: 0,
    SOUND_POS: {
        x: 0,
        y: 0,
        z: 0,
        progress: 0
    },
    ZERO_POS: {
        x: 0,
        y: 0,
        z: 0
    },
    SOUND_BOOL: [false, false],
    IS_FIRST_CMD: false,
    RECORD_TICK: 0,
    DUMP_LIST: [],
    SIGN_LIST: [],
    DUMP_OUTPUT: [],
    HAS_SCORE: [],
    HAS_TAG: [],
    DUMP_PARMAS: [],
    DUMP_DISPLAYS: [],
    DUMP_HAS: [],
    POS_DUMP: {
        x: 0,
        y: 0,
        z: 0
    },
    IS_DUMP: false,
    IS_ASSIST: false,
    EXPORT_TMP: [0, 0, 0],
    EXPORT_SP: [0, 0, 0],
    EXPORT_CP: [0, 0, 0],
    EXPORT_INFO: {
        length: 0,
        current: 0
    },
    EXPORT_EP: [],
    EXPORT_PARMAS: [],
    EXPORT_DISPLAYS: [],
    EXPORT_BACKPOS: {
        x: 0,
        y: 0,
        z: 0
    },
    EXPORT_LIST: [],
    EXPORT_NAME: '',
    IS_EXPORT: false,
    CURRENT_ASSIST_NUM: 0,
    ASSIST_BLOCK: {},
    ASSIST_ITEM: {},
    CUBE_EDGE_LENGTH: 0,
    TICKS: 0,
    TOTAL_TICKS: 0,
    CURRENT_PAMARS: [],
    CURRENT_DISPLAYS: [],
    CMD_LIST: [],
    BACKUP_LIST: [],
    BACKUP_POS: [0, 0, 0],
    ALREADY_LIST: [],
    CMD_COUNT: {
        success: 0,
        failed: 0
    },
    CMD_TYPE: {
        error: [],
        type: []
    },
    TASK_INFO: {
        name: "",
        length: 0,
        task_length: 0,
        ep: [],
        time: Date.now(),
        offset_pos: [0, 0, 0]
    },
    LAST_TASK: {
        start: [Infinity, Infinity, Infinity],
        end: [-Infinity, -Infinity, -Infinity]
    },
    BACKUP_DATA: {},
    BACKUP_OFFSET: [0, 0, 0],
    ASSIST_LIST: [],
    ASSIST_HAS: [],
    BLOCKS_NUM: {},
    OUTPUT_INFO: '',
    BDX_INFO: '',
    CURRENT_DUMP_NUM: 0,
    ASSIST_FIRST: false,
    STARTING: false,
}

const TONES = [
    "note.banjo",
    "note.bass",
    "note.bassattack",
    "note.bd",
    "note.bell",
    "note.bit",
    "note.cow_bell",
    "note.didgeridoo",
    "note.flute",
    "note.guitar",
    "note.harp",
    "note.hat",
    "note.chime",
    "note.iron_xylophone",
    "note.pling",
    "note.snare",
    "note.xylophone"
]
const CommandTypeEnum = {
    'command_block': 0,
    'repeating_command_block': 1,
    'chain_command_block': 2,
}
const getMultipleText = (string, strA, strB) => {
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
const analysisNBT = (nbt) => {
    const namespace = getText(nbt, ',Name:"', '",WasPickedUp')
    if (namespace == '') return {
        aux: 0,
        namespace: "minecraft:air"
    }
    const aux = Number(getText(nbt, ',aux:', ','))
    const count = Number(getText(nbt, 'Count:', 'b,D'))
    const name = nbt.includes(',name:"') ? getText(nbt, ',name:"', '",') : namespace.replace("minecraft:", "")
    return {
        namespace,
        aux,
        name,
        count
    }
} // 解析NBT
const readFile = (path, mode = 0) => {
    try {
        if (!_fs.exists(path)) return '[]'
        if (mode === 0) return _fs.read(path)
        if (mode === 1) return _fsReadBinary(path)
    } catch (e) {
        _minecraft.clientMessage('文件读取失败，请尝试新建一个文件，然后把旧文件的内容复制进去\nError Message: §c' + e.message)
    }
}
const defaultConfig = JSON.parse(readFile(_app.getResource() + '/GBRC/建筑工具Rebirth/启动配置.json'))
const schematicBlocks = JSON.parse(readFile(_app.getResource() + '/GBRC/建筑工具Rebirth/schematic.json'))
const setCmdBlock = (x, y, z, data) => {
    const block = getBlock(x, y, z)
    if (!block.namespace.includes('command_block')) return false
    else return setCommandBlockData(x, y, z, data)
}
const getPlayerBlockPos = (id) => {
    const pos = getEntityPos(id)
    let y = (id == getLocalPlayerUniqueID()) ? Math.floor(pos.y) - 1 : Math.floor(pos.y)
    return {
        x: Math.floor(pos.x),
        y,
        z: Math.floor(pos.z)
    }
} // 获取玩家方块坐标

const setCmdMenu = () => {
    if (Vars.CMD_LIST.length === 0) return
    const menu = `{"type":"custom_form","title":"导入命令确认","content":[{"type":"label","text":"§b注意: §b请先确认方块已经全部导入完成"},{"type":"label","text":"命令数量: §b${Vars.CMD_LIST.length}"},{"type":"label","text":"导入命令速度: §b${Config.BUILD_TASKS_CMD*20}"},{"type":"label","text":"预计用时: §b${Vars.CMD_LIST.length/Config.BUILD_TASKS_CMD/20}秒"}]}`;
    addForm(menu, function() {
        const {
            x,
            y,
            z
        } = Vars.CMD_LIST[0]
        const firstBlock = getBlock(x, y, z)
        if (firstBlock.namespace.includes('command_block')) Vars.IS_CMD = true
        else {
            handleTP(x, y, z)
            if (Vars.CMD_LIST[0].aux != undefined) execCmd(`setblock ${x} ${y} ${z} command_block ${Vars.CMD_LIST[0].aux}`)
            _app.showToast('检测到第一个命令方块未放置，请耐心等待方块加载')
            setCmdMenu()
        }
    }, function() {})
}

const getPlayerAngle = (pos1, pos2) => {
    let target_pos = pos2
    let self_pos = pos1
    let length_x = target_pos.x - self_pos.x
    let length_y = self_pos.y - target_pos.y
    let length_z = target_pos.z - self_pos.z
    let angle_h = Math.atan2(length_z, length_x) * 180 / Math.PI
    let level = Math.sqrt(length_x * length_x + length_z * length_z)
    let angle_v = Math.atan2(length_y, level) * 180 / Math.PI
    return {
        yaw: ((angle_h > -180 && angle_h <= 90) ? (angle_h + 90) : (angle_h - 270)),
        pitch: angle_v
    }
} // 计算相对角度
function execBypassCmd(cmd) {
    sendRpc(98247598, string2arraybuffer('ār\tĭMinecraft:aiCommand:ExecuteUsefulCommandEvent\u0000'))
    sendRpc(98247598, string2arraybuffer(`āc\tĈplayerIdċ${getLocalPlayerUniqueID()}ćcommandė${cmd}\u0000`))
    sendRpc(98247598, string2arraybuffer(`āc\bĈplayerIdċ${getLocalPlayerUniqueID()}ĆnotifyÀ`))
}

function arraybuffer2string(arrayBuffer) {
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
            str += String.fromCodePoint(codePoint);
        }
    }
    return str;
}
const execCmd = (cmd) => {
    if (Config.CMD_MODE === 'EXECUTE') return executeCommand(cmd)
    if (Config.CMD_MODE === 'PACKET1') return sendCommandRequest(cmd)
    if (Config.CMD_MODE === 'PACKET2') return requestExecuteCommand(cmd, function() {})
    if (Config.TASK_ANALYSE) {
        const fcmd = cmd.split(' ')[0]
        if (!Vars.CMD_TYPE.type.includes(fcmd)) Vars.CMD_TYPE.type.push(fcmd)
    }
}
const handleTP = (x, y, z) => {
    if (Config.TP_MODE == 'PACKET') sendPlayerAuthInput({
        inputMode: 2,
        playMode: 0,
        pos: {
            x,
            y,
            z
        },
    })
    if (Config.TP_MODE == 'LOCAL') setEntityPos(getLocalPlayerUniqueID(), x, y, z)
    if (Config.TP_MODE == 'COMMAND') execCmd(`tp ${Config.TP_TARGET} ${x} ${y} ${z}`)
    return true
}
const old2New = cmd => {
    if (!cmd.includes('execute') || cmd.includes('run') || !Config.CONVERT) return cmd
    let every_exec = cmd.split('execute')
    every_exec.forEach((parma, i) => {
        if (parma == '' || parma == '/') return
        let parmas = parma.split(' ')
        if (parmas[3] == 'detect') {
            parmas[3] = 'if block'
            if (parmas[4].split('~').length >= 3 || parmas[4].split('^').length >= 3) parmas.splice(7, 0, 'run')
            else parmas.splice(9, 0, 'run')
        } else if (parmas[2].split('~').length >= 3) parmas.splice(3, 0, 'run')
        else if (parmas[5] == 'detect') {
            parmas[5] = 'if block'
            if (parmas[6].split('~').length >= 3 || parmas[6].split('^').length >= 3) parmas.splice(9, 0, 'run')
            else parmas.splice(11, 0, 'run')
        } else parmas.splice(5, 0, 'run')
        parmas[1] = 'as ' + parmas[1] + ' at @s'
        parmas.splice(2, 0, 'positioned')
        every_exec[i] = parmas.join(' ')
    })
    return every_exec.join('execute')
}
const drawParticle = (type, x, y, z, num, offset = false, end_pos = {}) => {
    for (let i = 0; i < num; i++) addParticle(Number(type), x, y, z, offset ? end_pos.x : x, offset ? end_pos.y : y, offset ? end_pos.z : z, 1, offset)
}

function string2arraybuffer(str) {
    const utf8Bytes = [];
    for (let i = 0; i < str.length; i++) {
        const codePoint = str.codePointAt(i);
        if (codePoint <= 0x7f) utf8Bytes.push(codePoint);
        else if (codePoint <= 0x7ff) {
            utf8Bytes.push(0xc0 | (codePoint >> 6));
            utf8Bytes.push(0x80 | (codePoint & 0x3f));
        } else if (codePoint <= 0xffff) {
            utf8Bytes.push(0xe0 | (codePoint >> 12));
            utf8Bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
            utf8Bytes.push(0x80 | (codePoint & 0x3f));
        } else {
            utf8Bytes.push(0xf0 | (codePoint >> 18));
            utf8Bytes.push(0x80 | ((codePoint >> 12) & 0x3f));
            utf8Bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
            utf8Bytes.push(0x80 | (codePoint & 0x3f));
        }
    }
    const uint8Array = new Uint8Array(utf8Bytes);
    return uint8Array.buffer;
}

function updateTmpAndCp(tmp0, tmp2) {
    Vars.EXPORT_TMP[0] = tmp0;
    Vars.EXPORT_TMP[2] = tmp2;
    Vars.EXPORT_CP[0] = Vars.EXPORT_TMP[0];
    Vars.EXPORT_CP[2] = Vars.EXPORT_TMP[2];
}
const getDisplacement = (length, pos, rot, offset_y, offset_p) => {
    let isLow = (length < 0) ? true : false
    let {
        yaw,
        pitch
    } = rot
    yaw += offset_y
    pitch += offset_p
    yaw -= 180
    if (pitch > 90) pitch -= 90
    if (pitch < -90) pitch += 90
    if (yaw > 180) yaw = yaw - 360
    if (yaw < -180) yaw = 360 + yaw
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
        x: Math.round(pos.x + x),
        y: Math.round(pos.y - y),
        z: Math.round(pos.z + z)
    };
}; // 获取相对坐标
const getRandomNum = (min, max) => {
    const range = max - min + 1;
    return Math.floor(Math.random() * range) + min;
} // 随机数
const CommandTypeNumberEnum = ['Tick', 'Repeating', 'Chain']
const clientMsg = m => _minecraft.clientMessage('○ §b§lBuildToolRebirth §r§7>>> §r' + m)
const tipMessage = m => _minecraft.showTipMessage('○ §b§lBuildToolRebirth §r§7>>> §r' + m)
// 状态转字符串
const getDistance = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2) + Math.pow(p1.z - p2.z, 2)) // 计算距离
const bool2str = (bool) => bool ? '§2已打开' : '§c已关闭';
const b2s = (bool) => bool ? 'true' : 'false';
// 移除区块数据

function getContainerItems(x, y, z) {
    const nbt = getBlockEntityNBT(x, y, z)
    if (!nbt.includes('Items')) return []
    if (nbt.includes('Items:[]')) {
        clientMsg(`因游戏限制，无法读取[${x}, ${y}, ${z}]处的容器数据，重进世界后即可解决(也有可能容器本来就是空的)`)
        return []
    }
    const items = getText(nbt, 'Items:[', '],')
    const item_list = items.split('},{')
    let output = []
    item_list.forEach(item => {
        output.push({
            ns: getText(item, 'Name:"minecraft:', '",S'),
            aux: Number(getText(item, 'Damage:', 's,N')),
            num: Number(getText(item, 'Count:', 'b,D')),
            slot: Number(getText(item, 'Slot:', 'b,W')),
        })
    })
    return output
}

function saveBlocksData(name, blocks, enable = true, confirm = false) {
    const worldName = getWorldData().levelName
    let realName = `${name} - ${worldName} - ${blocks.length}方块`
    const menu = `{"type":"custom_form","title":"导出建筑确认","content":[{"type":"label","text":"§b名称: §r${name}"},{"type":"label","text":"§b方块数量: §r${blocks.length}块"}]}`;
    const json = JSON.stringify(blocks);
    if (confirm) addForm(menu, function() {
        if (Config.COMPRESS && enable) _fs.write(`${Vars.PATHS.data}/${realName}.reb`, _crypto.compress(string2arraybuffer(json)));
        else _fs.write(`${Vars.PATHS.data}/${realName}.json`, json);
    })
    else {
        if (Config.COMPRESS && enable) _fs.write(`${Vars.PATHS.data}/${realName}.reb`, _crypto.compress(string2arraybuffer(json)));
        else _fs.write(`${Vars.PATHS.data}/${realName}.json`, json);
    }
}

function schematic2object(input) {
    const Blocks = JSON.parse('[' + getText(input, 'Blocks:[B;', '],').replaceAll('b', '') + ']')
    const Data = JSON.parse('[' + getText(input, 'Data:[B;', '],').replaceAll('b', '') + ']')
    const Width = Number(getText(input, 'Width:', 's'))
    const Height = Number(getText(input, 'Height:', 's'))
    const Length = Number(getText(input, 'Length:', 's'))
    return JSON.stringify({
        Width,
        Height,
        Length,
        Blocks,
        Data
    })
}

function getBlockData(block, x, y, z, last_pos = Vars.ZERO_POS, pos_data = {}, blockParmas = [], sp = Vars.ZERO_POS) {
    let pos_mode = Object.keys(pos_data).length === 0 ? false : true
    let Nbt = getBlockNBT(x, y, z)
    let aux = block.aux
    let items = getContainerItems(x, y, z)
    let offset_x = x - (pos_mode ? pos_data.x : sp.x)
    let offset_y = y - (pos_mode ? pos_data.y : sp.y)
    let offset_z = z - (pos_mode ? pos_data.z : sp.z)
    let output = []
    if (Config.SAVE_CONTAINER && items.length > 0) output = [offset_x - last_pos.x, offset_y - last_pos.y, offset_z - last_pos.z, blockParmas.indexOf(block.namespace.replace('minecraft:', '')), aux, items]
    else if (block.namespace.includes('command_block') && Config.SAVE_CMD) {
        let NBT = getBlockEntityNBT(x, y, z)
        output = [offset_x - last_pos.x, offset_y - last_pos.y, offset_z - last_pos.z, aux, CommandTypeEnum[block.namespace.replace('minecraft:', '')], {
            auto: getText(NBT, "auto:", "b,c") == '1',
            condition: getText(Nbt, "conditional_bit:", "b,f") == '1',
            cmd: getText(NBT, "Command:\"", "\",Cu"),
            name: getText(NBT, "CustomName:\"", "\",E"),
            delay: Number(getText(NBT, "TickDelay:", ",Tr"))
        }]
    } else if (block.namespace.includes('_sign') && Config.SAVE_SIGN) {
        let NBT = getBlockEntityNBT(x, y, z)
        let sign_text = getMultipleText(NBT, ',Text:"', '",')
        if (typeof sign_text == 'object') sign_text = sign_text.filter(text => text != '')[0]
        output = [offset_x - last_pos.x, offset_y - last_pos.y, offset_z - last_pos.z, blockParmas.indexOf(block.namespace.replace('minecraft:', '')), aux, sign_text]
    } else output = [offset_x - last_pos.x, offset_y - last_pos.y, offset_z - last_pos.z, blockParmas.indexOf(block.namespace.replace('minecraft:', '')), aux]
    return {
        task: output,
        pos: {
            x: offset_x,
            y: offset_y,
            z: offset_z
        }
    }
}
const createTickingArea = (x, y, z) => {
    const offset_y = y - 5
    let data = {
        mode: 'Repeating',
        isRedStoneMode: false,
        isConditional: false,
        command: `execute as @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] at @s run tp ~ ~ ~`,
        name: 'Rebirth导入命令方块',
        tickDelay: 0,
        executeOnFirstTick: true,
        shouldTrackOutput: false,
        lastOutput: "BuildToolRebirth"
    }
    execCmd(`tickingarea remove IMPORT_CMD`)
    execCmd(`tickingarea add ${x} ${Math.max(-63,offset_y)} ${z} ${x} ${Math.max(-63,offset_y)} ${z} IMPORT_CMD true`)
    execCmd(`setblock ${x} ${Math.max(-63,offset_y)} ${z} command_block`)
    setTimeout(() => setCmdBlock(x, Math.max(-63, offset_y), z, data), 500)
}
const summonServerMob = (x, y, z) => {
    Vars.ENTITY_POS = {
        x,
        y,
        z
    }
    const offset_y = y - 5
    if (defaultConfig.导入命令方块生成时间 === '导入时') createTickingArea(x, y, x)
    execCmd(`kill @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"]`)
    setTimeout(() => execCmd(`summon ${Config.SERVER_MOB} ${Config.SERVER_NAME} ${x} ${y} ${z}`), 350)
    setTimeout(() => {
        execCmd(`tellraw @a {"rawtext":[{"text":"§eRebirth_Bot 加入了游戏"}]}`)
        execCmd(`effect @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] fire_resistance 114514 255 true`)
        execCmd(`effect @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] instant_health 114514 255 true`)
        execCmd(`effect @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] resistance 114514 255 true`)
        execCmd(`effect @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] slow_falling 114514 255 true`)
        execCmd(`effect @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] invisibility 114514 255 true`)
        execCmd(`effect @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] absorption 114514 255 true`)
        execCmd(`effect @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] regulation 114514 255 true`)
        execCmd(`replaceitem entity @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] slot.armor.head 0 skull 1 3`)
        execCmd(`replaceitem entity @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] slot.armor.chest 0 diamond_chestplate 1`)
        execCmd(`replaceitem entity @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] slot.armor.legs 0 diamond_leggings 1`)
        execCmd(`replaceitem entity @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] slot.armor.feet 0 diamond_boots 1`)
    }, 600)
}

function getProgress(current, max, graph = Config.PROGRESS_TEXT, length = 40) { //获取任务进度
    let percentage = Math.min(current / max, 1)
    const rgb_color = "4c6e2a3b195d591b3a2e6c4".split("")
    let color = rgb_color[Math.min(Math.floor(percentage * rgb_color.length), rgb_color.length - 1)]
    let progress_bar = graph.repeat(length).split("")
    let insert = Math.min(Math.floor(percentage * progress_bar.length), progress_bar.length)
    progress_bar[Math.min(insert, progress_bar.length - 1)] = graph + '§r§o§l'
    return (`§r『§o§l§${color}${progress_bar.join("")}§r』`)
}
// 加载区块数据
function loadBlocksData(name, offset = 0) {
    if (['.bdx', '.json', '.schematic', '.reb', '.building', '.fhbuild'].every(file => !name.toLowerCase().endsWith(file))) {
        clientMsg('不支持的文件格式，请等待适配')
        return []
    }
    let blocks = []
    let isBdx = false
    let isSchematic = false
    let file_data = readFile(`${Vars.PATHS.data}/${name}`)
    if (name.endsWith('.bdx')) {
        Vars.BDX_INFO += `解析BDx: ${name}\n\n`
        _app.showToast('正在解析BDx 如果闪退则为跑路不适配')
        isBdx = true
        file_data = loadNbtFromFile(`${Vars.PATHS.data}/${name}`)
        if (file_data == '') {
            _app.showToast('不支持的BDX文件，请等待跑路适配')
            return []
        } else _app.showToast('解析成功')
    }
    if (name.endsWith('.schematic')) {
        _app.showToast('正在解析Schematic 如果闪退则为跑路不适配')
        file_data = loadNbtFromFile(`${Vars.PATHS.data}/${name}`)
        if (file_data == '') {
            _app.showToast('不支持的Schematic文件，请等待跑路适配')
            return []
        } else _app.showToast('解析成功')
        isSchematic = true
        file_data = schematic2object(file_data)
    }
    if (name.endsWith('.reb') || name.endsWith('.building') || name.endsWith('.fhbuild')) file_data = arraybuffer2string(_crypto.uncompress(readFile(`${Vars.PATHS.data}/${name}`, 1)))
    blocks = JSON.parse(file_data)
    if (Config.DUMP_CONVERT && name.endsWith('.reb')) {
        saveBlocksData('Uncompress-' + name.replace('.reb', '.json'), blocks, false)
        clientMsg('已导出转换后的文件')
    }
    if (isSchematic) {
        const {
            Width,
            Height,
            Length,
            Blocks,
            Data
        } = blocks
        const blockArray = [];
        if (!Width || !Height || !Length || !Blocks || !Data) clientMsg('Schematic数据不完整');
        const totalBlocks = Width * Height * Length;
        if (Blocks.length !== totalBlocks || Data.length !== totalBlocks) clientMsg('Blocks或Data数组长度与尺寸不匹配');
        let backpos = [0, 0, 0]
        let blockParmas = []
        let blockIndex = 0
        let tmpList = Array.from({
                length: Width
            }, () =>
            Array.from({
                    length: Height
                }, () =>
                Array.from({
                    length: Length
                }, () => null)
            )
        );
        for (let y = 0; y < Height; y++) {
            for (let z = 0; z < Length; z++) {
                for (let x = 0; x < Width; x++) {
                    let index = Blocks[blockIndex];
                    let aux = Data[blockIndex]
                    let block = schematicBlocks[index]
                    tmpList[x][y][z] = {
                        namespace: block,
                        aux
                    }
                    blockIndex++
                }
            }
        }

        for (let a = 0; a < Width; a += (Config.EXPORT_CHUNK ? Math.min(Width - a + 1, Config.EXPORT_CHUNK_RANGE) : (Width + 1))) {
            for (let b = 0; b < Length; b += (Config.EXPORT_CHUNK ? Math.min(Length - b + 1, Config.EXPORT_CHUNK_RANGE) : (Length + 1))) {
                for (let hy = 0; hy < Height; hy++) {
                    for (let hx = a; hx < (Config.EXPORT_CHUNK ? (a + Math.min(Width - a, Config.EXPORT_CHUNK_RANGE)) : Width); hx++) {
                        for (let hz = b; hz < (Config.EXPORT_CHUNK ? (b + Math.min(Length - b, Config.EXPORT_CHUNK_RANGE)) : Length); hz++) {
                            const block = tmpList[hx] && tmpList[hx][hy] && tmpList[hx][hy][hz]
                            if (block === undefined) continue;
                            let {
                                namespace,
                                aux
                            } = block
                            if (aux === undefined || namespace === undefined) continue;
                            if (Config.EXCLUDE_LIST.includes(namespace)) continue;
                            if (!blockParmas.includes(namespace)) blockParmas.push(namespace)
                            let offset_x = hx - backpos[0]
                            let offset_y = hy - backpos[1]
                            let offset_z = hz - backpos[2]
                            backpos = [hx, hy, hz]
                            blockArray.push([
                                offset_x,
                                offset_y,
                                offset_z,
                                blockParmas.indexOf(namespace),
                                aux,
                            ]);
                        }
                    }
                }
            }
        }
        blockArray.push({
            displayName: blockParmas
        })
        blockArray.push(blockParmas)
        if (blockArray.length == 2) return []
        blocks = blockArray
        if (Config.DUMP_CONVERT) {
            saveBlocksData('Schematic-' + name, blockArray, false)
            clientMsg('已导出转换后的文件')
        }
    }
    if (isBdx) {
        let tasks = []
        let parmas = []
        let x = 0
        let y = 0
        let z = 0
        let index = 0
        let aux = 0
        const cmds = ['CreateConstantString', 'AddXValue', 'AddYValue', 'AddZValue', 'AddInt32XValue', 'AddInt32YValue', 'AddInt32ZValue', 'AddInt8XValue', 'AddInt8YValue', 'AddInt8ZValue', 'AddInt16XValue', 'AddInt16YValue', 'AddInt16ZValue', 'PlaceBlock', 'PlaceBlockWithBlockStates', 'PlaceBlockWithNBTData', 'PlaceBlockWithCommandBlockData', 'SetCommandBlockData', 'SubtractXValue', 'SubtractYValue', 'SubtractZValue']
        const unsupport = ['PlaceRuntimeBlock', 'PlaceRuntimeBlockWithCommandBlockData', 'UseRuntimeIDPool', 'PlaceRuntimeBlockWithChestData']
        let error_num = 0
        let unsupport_num = 0
        let cmd_num = 0
        let all_cmd = {}
        let hasError = false
        let ErrorList = []
        for (let task of blocks) {
            let {
                cmd,
                data
            } = task
            if (unsupport.includes(cmd)) {
                unsupport_num++
                clientMsg('不支持的BDX指令\n Unsupport Cmd: ' + cmd)
                x = y = z = 0
            }
            if (!cmds.includes(cmd) && !unsupport.includes(cmd)) {
                unsupport_num++
                clientMsg('不支持的BDX指令，请截图这条消息并发送在群内\n Unsupport Cmd: ' + cmd)
                hasError = true
                x = y = z = 0
                ErrorList.push(task)
            }
            if (cmd == undefined) {
                error_num++
                clientMsg('指令异常\n Error Cmd: ' + JSON.stringify(task))
                hasError = true
                x = y = z = 0
                ErrorList.push(task)
            }
            if (all_cmd[cmd] == undefined) all_cmd[cmd] = 0
            if (cmd == 'PlaceBlock') {
                index = data.blockStringId / 256
                aux = data.blockData / 256
                tasks.push([x, y, z, index, aux])
                x = y = z = 0
            }
            if (cmd == 'SetCommandBlockData') {
                let mode = 0
                let block = parmas[tasks[tasks.length - 1][3]]
                if (block.includes('repeat')) mode = 1
                if (block.includes('chain')) mode = 2
                tasks[tasks.length - 1][3] = tasks[tasks.length - 1][4]
                tasks[tasks.length - 1][4] = mode
                tasks[tasks.length - 1][5] = {
                    auto: !data.needsRedstone,
                    condition: data.conditional,
                    cmd: data.command,
                    name: data.customName,
                    delay: Math.round(((data.tickDelay > 0) ? data.tickDelay : (data.tickDelay + 1)) / 16777216)
                }
            }
            if (cmd == 'PlaceBlockWithBlockStates') {
                index = data.mBlockStringId / 256
                aux = parmas[data.mBlockStates / 256]
                tasks.push([x, y, z, index, aux])
                x = y = z = 0
            }
            if (cmd == 'PlaceBlockWithNBTData') {
                index = data.blockConstantStringID / 256
                aux = parmas[data.blockStatesConstantStringID / 256]
                tasks.push([x, y, z, index, aux])
                x = y = z = 0
            }
            if (cmd == 'PlaceBlockWithCommandBlockData') {
                index = data.blockStringId / 256
                aux = data.blockData / 256
                let mode = 0
                if (parmas[index].includes('repeat')) mode = 1
                if (parmas[index].includes('chain')) mode = 2
                tasks.push([x, y, z, aux, mode, {
                    auto: !data.needsRedstone,
                    condition: data.conditional,
                    cmd: data.command,
                    name: data.customName,
                    delay: Math.round(((data.tickDelay > 0) ? data.tickDelay : (data.tickDelay + 1)) / 16777216)
                }])
                x = y = z = 0
            }
            if (cmd == 'CreateConstantString') parmas.push(data)
            if (cmd == 'SubtractXValue') x = -1
            if (cmd == 'SubtractYValue') y = -1
            if (cmd == 'SubtractZValue') z = -1
            if (cmd == 'AddXValue') x = 1
            if (cmd == 'AddYValue') y = 1
            if (cmd == 'AddZValue') z = 1
            if (cmd == 'AddInt8XValue') x = data
            if (cmd == 'AddInt8YValue') y = data
            if (cmd == 'AddInt8ZValue') z = data
            if (typeof data == 'number' && data < 0) data += 1
            if (cmd == 'AddInt32XValue') x = (data / 16777216 - ((data > 0) ? 0 : 1))
            if (cmd == 'AddInt32YValue') y = (data / 16777216 - ((data > 0) ? 0 : 1))
            if (cmd == 'AddInt32ZValue') z = (data / 16777216 - ((data > 0) ? 0 : 1))
            if (cmd == 'AddInt16XValue') x = (data / 256 - ((data > 0) ? 0 : 1))
            if (cmd == 'AddInt16YValue') y = (data / 256 - ((data > 0) ? 0 : 1))
            if (cmd == 'AddInt16ZValue') z = (data / 256 - ((data > 0) ? 0 : 1))
            cmd_num++
            all_cmd[cmd]++
            if (Config.BDX_ANALYSE) Vars.BDX_INFO += `${cmd_num}. 坐标: [${x}, ${y}, ${z}], 方块索引:${index}, 特殊值:${aux}\n原始数据: ${JSON.stringify(task)}\n解析数据: ${JSON.stringify(tasks[tasks.length-1])}\n`
        }
        tasks.push({
            displayName: parmas
        })
        tasks.push(parmas)
        if (Config.BDX_ANALYSE) {
            Vars.BDX_INFO += `\n方块列表: ${parmas}, 命令总数: ${cmd_num}, 错误数量: ${error_num}, 不支持的命令数量: ${unsupport_num}, 详细命令数量: ${JSON.stringify(all_cmd,null,2)}`
            _fs.write(`${Vars.PATHS.analyse}/分析 - ${name}.txt`, Vars.BDX_INFO);
            Vars.BDX_INFO = ''
            clientMsg('已导出BDX分析文件')
        }
        if (hasError || Config.BDX_ANALYSE) {
            saveBlocksData('BDx文件A-' + name, ErrorList, false)
            saveBlocksData('BDx文件B-' + name, blocks, false)
            clientMsg('已导出转换过程文件，请将导出的文件发给开发者')
        }
        if (tasks.length == 1) return []
        if (Config.DUMP_CONVERT) {
            saveBlocksData('BDx-' + name, tasks, false)
            clientMsg('已导出转换后的文件')
        }
        blocks = tasks
    } else if (blocks.length === undefined || blocks[0].length === undefined) {
        let output = []
        let offset_pos = [0, 0, 0]
        if (!Object.keys(blocks).includes('length') && (blocks.totalBlocks || blocks.totB)) {
            _app.showToast('自动分析成功, 格式为: 绵阳')
            var {
                namespaces,
                chunkedBlocks
            } = blocks
            chunkedBlocks.sort((a, b) => {
                var offset = a.startX - b.startX
                if (offset == 0) offset = a.startZ - b.startZ
                return offset
            })
            chunkedBlocks.forEach(data => {
                let sx = data.startX
                let sz = data.startZ
                data.blocks.forEach(block => {
                    const cmd = block[5]
                    let x = block[2] + sx
                    let y = block[3]
                    let z = block[4] + sz
                    let index = block[0],
                        aux = block[1]
                    if (cmd) {
                        if (typeof cmd == 'string') {
                            let nbts = JSON.parse(block[5])
                            let Nbt = decodeURIComponent(nbts.blockNBT)
                            let NBT = decodeURIComponent(nbts.blockCompleteNBT)
                            let mode = 0
                            if (Nbt.includes('repeat')) mode = 1
                            if (Nbt.includes('chain')) mode = 2
                            output.push([x - offset_pos[0], y - offset_pos[1], z - offset_pos[2], aux, mode, {
                                auto: getText(NBT, "auto:", "b,c") == '1',
                                condition: getText(Nbt, "conditional_bit:", "b,f") == '1',
                                cmd: getText(NBT, "Command:\"", "\",Cu"),
                                name: getText(NBT, "CustomName:\"", "\",E"),
                                delay: Number(getText(NBT, "TickDelay:", ",Tr"))
                            }])
                        } else {
                            let mode = 0
                            if (cmd.mode.includes('Repeat')) mode = 1
                            if (cmd.mode.includes('Chain')) mode = 2
                            output.push([x - offset_pos[0], y - offset_pos[1], z - offset_pos[2], aux, mode, {
                                auto: !cmd.isRedStoneMode,
                                condition: cmd.isConditional,
                                cmd: cmd.command,
                                name: cmd.name,
                                delay: cmd.tickDelay
                            }])
                        }
                    } else output.push([x - offset_pos[0], y - offset_pos[1], z - offset_pos[2], index, aux])
                    offset_pos = [x, y, z]
                })
            })
            output.push(namespaces.map(namespace => namespace.replace('minecraft:', '')))
        }
        if (typeof blocks[0] === 'object' && Object.keys(blocks[0]).includes('name') && Object.keys(blocks[0]).includes('aux')) {
            _app.showToast('自动分析成功, 格式为: 原版')
            let parmas = []
            blocks.forEach(block => {
                const name = block.name.replace('minecraft:', '')
                if (!parmas.includes(name)) parmas.push(name)
                output.push([block.x - offset_pos[0], block.y - offset_pos[1], block.z - offset_pos[2], parmas.indexOf(name), block.aux])
                offset_pos = [block.x, block.y, block.z]
            })
            output.push(parmas)
        }
        if (!Object.keys(blocks).includes('length') && blocks.FuHongBuild) {
            _app.showToast('自动分析成功, 格式为: 浮鸿')
            const {
                FuHongBuild,
                BlocksList
            } = blocks
            FuHongBuild.forEach(data => {
                let sx = data.startX
                let sz = data.startZ
                for (let block of data.block) {
                    for (let j = 0; j < block[2].length; j++) {
                        if (typeof block[2][j] === 'number') {
                            let x = data.startX + block[2][j]
                            let y = block[3][j]
                            let z = data.startZ + block[4][j]
                            let aux = block[1] ? block[1] : 0
                            output.push([x - offset_pos[0], y - offset_pos[1], z - offset_pos[2], block[0], aux])
                            offset_pos = [x, y, z]
                            if (block[5] && block[5][j] && typeof block[5][j][3] === 'number') output[output.length - 1][5] = block[5][j].map(arr => ({
                                ns: arr[0],
                                num: arr[2],
                                slot: arr[3],
                                aux: arr[1]
                            }))
                            if (block[5] && block[5][j] && typeof block[5][j][3] === 'string') {
                                let block = BlocksList[block[0]]
                                let mode = 0
                                if (block.includes('repeat')) mode = 1
                                if (block.includes('chain')) mode = 2
                                output[output.length - 1][3] = aux
                                output[output.length - 1][4] = mode
                                output[output.length - 1][5] = {
                                    auto: block[5][j][1] == 0,
                                    condition: block[5][j][2] == 1,
                                    cmd: block[5][j][0],
                                    name: block[5][j][3],
                                    delay: 0
                                }
                            }
                        } else output.push([block[2], block[3], block[4], block[0], block[1]])
                    }
                }
            })
            output.push({
                displayName: BlocksList
            })
            output.push(BlocksList)
        }
        if (Config.DUMP_CONVERT) {
            saveBlocksData('RunAway-' + name, output, false)
            clientMsg('已导出转换后的文件')
        }
        blocks = output
    }
    let datas = blocks.slice(offset, blocks.length)
    if (Config.FORCE_ZERO && datas[0]) {
        datas[0][0] = 0
        datas[0][1] = 0
        datas[0][2] = 0
    }
    Config.KILL_LIST.forEach(type => '/kill @e[type=' + type + ']')
    Vars.OUTPUT_INFO = ''
    Vars.CURRENT_PAMARS = datas.pop()
    Vars.TASK_INFO = {
        length: datas.length,
        task_length: 0,
        name,
        ep: [0, 0, 0],
        time: Date.now(),
        offset_pos: [0, 0, 0]
    }
    Vars.BACKUP_DATA = {
        task: null,
        pos: Vars.POS_DATA
    }
    Vars.HAS_SCORE = []
    Vars.LAST_TASK.start = [Vars.POS_DATA.x, Vars.POS_DATA.y, Vars.POS_DATA.z]
    Vars.BACKUP_POS = [Vars.POS_DATA.x, Vars.POS_DATA.y, Vars.POS_DATA.z]
    Vars.LAST_TASK.end = [0, 0, 0]
    let end = (typeof datas[datas.length - 1] === 'object' && datas[datas.length - 1].length == undefined) ? (datas.pop()) : ({
        displayName: Vars.CURRENT_PAMARS
    })
    if (end && typeof end.ep === 'object') Vars.TASK_INFO.ep = end.ep
    if (end && typeof end.displayName === 'object') Vars.CURRENT_DISPLAYS = end.displayName
    if (Config.AUTO_DENY) execCmd(`/fill ${Vars.POS_DATA.x} ${Vars.POS_DATA.y-1} ${Vars.POS_DATA.z} ${Vars.POS_DATA.x+Vars.TASK_INFO.ep[0]} ${Vars.POS_DATA.y-1} ${Vars.POS_DATA.z+Vars.TASK_INFO.ep[2]} deny`)
    if (Config.AUTO_TICKING) execCmd(`/tickingarea add ${Vars.POS_DATA.x} ${Vars.POS_DATA.y} ${Vars.POS_DATA.z} ${Vars.POS_DATA.x+Vars.TASK_INFO.ep[0]} ${Vars.POS_DATA.y+Vars.TASK_INFO.ep[1]} ${Vars.POS_DATA.z+Vars.TASK_INFO.ep[2]} ${name.slice(0,5)} true`)
    if (Config.AUTO_TP && Vars.TASK_INFO.ep.some(p => p != 0)) execCmd(`tp @s ${Vars.POS_DATA.x+Vars.TASK_INFO.ep[0]/2} ${Vars.POS_DATA.y+Vars.TASK_INFO.ep[1]/2} ${Vars.POS_DATA.z+Vars.TASK_INFO.ep[2]/2}`)
    if (Config.TP_FIRST) execCmd(`tp @s ${Vars.POS_DATA.x+datas[0][0]} ${Vars.POS_DATA.y+datas[0][1]} ${Vars.POS_DATA.z+datas[0][2]}`)
    if (Config.INFO_IMPORT_BOOST) {
        _minecraft.setTitle('§d§l§o开始导入: \n§r' + name)
        _minecraft.setSubtitle('§a§o预计用时: §r' + (datas.length / (Config.BUILD_TASKS_MULTIPLE * (Config.BUILD_SPEED_MIN + Config.BUILD_SPEED_MAX) / 2) / 20) + '秒')
    }
    if (Config.KICK_ALL) getWorldPlayerList().forEach(player => {
        if (player.id !== getLocalPlayerUniqueID()) execCmd('kick ' + player.name)
    })
    Config.CMD_BEFORE.forEach(cmd => execCmd(cmd))
    if (Config.TASK_ANALYSE) Vars.OUTPUT_INFO += `文件名称: ${name}, 大小: ${datas.length}, 开始时间: ${Vars.TASK_INFO.time}\n方块列表: ${Vars.CURRENT_DISPLAYS}, 起点:${JSON.stringify(Vars.POS_DATA)}\n\n`
    return datas;
}

function getText(string, strA, strB) {
    let start = string.indexOf(strA) + strA.length
    let finish = string.indexOf(strB, start)
    return string.substring(start, finish)
} // 切割字符串

// 获取区块数据
function getChunkBlocks(x1, y1, z1, x2, y2, z2, pos_data = {}) {
    const sx = Math.min(x1, x2);
    const sy = Math.min(y1, y2);
    const sz = Math.min(z1, z2);
    const ex = Math.max(x1, x2) + 1;
    const ey = Math.max(y1, y2);
    const ez = Math.max(z1, z2) + 1;
    const blocks = [];
    const blockParmas = [];
    const displayName = [];
    let pos_back = {
        x: 0,
        y: 0,
        z: 0
    }
    if (Config.AUTO_TP) execCmd(`tp @s ${(sx+ex)/2} ${(sy+ey)/2} ${(sz+ez)/2}`)
    for (let a = sx; a <= ex; a += (Config.EXPORT_CHUNK ? Math.min(ex - a + 1, Config.EXPORT_CHUNK_RANGE) : (ex - sx + 1))) {
        for (let b = sz; b <= ez; b += (Config.EXPORT_CHUNK ? Math.min(ez - b + 1, Config.EXPORT_CHUNK_RANGE) : (ez - sz + 1))) {
            for (let hy = sy; hy <= ey; hy++) {
                for (let hx = a; hx < (Config.EXPORT_CHUNK ? (a + Math.min(ex - a, Config.EXPORT_CHUNK_RANGE)) : ex); hx++) {
                    for (let hz = b; hz < (Config.EXPORT_CHUNK ? (b + Math.min(ez - b, Config.EXPORT_CHUNK_RANGE)) : ez); hz++) {
                        const block = getBlock(hx, hy, hz);
                        const name = block.namespace.replace('minecraft:', '')
                        if (Config.EXCLUDE_LIST.includes(name)) continue;
                        if (!blockParmas.includes(name)) {
                            blockParmas.push(name)
                            displayName.push((Config.LANG_MODE === 'zh_CN') ? block.descriptionName : name)
                        }
                        const data = getBlockData(block, hx, hy, hz, pos_back, pos_data, blockParmas, {
                            x: sx,
                            y: sy,
                            z: sz
                        })
                        blocks.push(data.task)
                        pos_back = data.pos
                    }
                }
            }
        }
    }
    if (Config.SAVE_MOB) {
        getEntityList().forEach(id => {
            if (!findEntity(id)) return
            const {
                x,
                y,
                z
            } = getEntityPos(id)
            if (x > sx && x < ex && y > sy && y < ey && z > sz && z < ez) blocks.push([Math.floor(x) - sx, Math.round(y) - sy, Math.floor(z) - sz, getEntityName(id), getEntityNamespace(id).replace('minecraft:', '')])
        })
    }
    if (Config.INFO_DUMP_BOOST) {
        _minecraft.setTitle('§d§l§o导出完成 共计: §r' + blocks.length + '方块')
        _minecraft.setSubtitle('§a§l§o范围: §r' + ((ex - sx + 1) * (ey - sy + 1) * (ez - sz + 1)) + '立方米')
    }
    blocks.push({
        ep: [ex - sx, ey - sy, ez - sz],
        displayName
    })
    blocks.push(blockParmas)
    return blocks;
}

// 显示建筑菜单
function showListMenu(custom_list = _fs.list(Vars.PATHS.data)) {
    const menu = {
        type: 'form',
        title: '§b建筑列表',
        content: '§b请选择需要粘贴的建筑',
        buttons: []
    };
    if (Config.POSMODE === 'SELF') Vars.POS_DATA = getPlayerBlockPos(getLocalPlayerUniqueID())
    if (Config.POSMODE === 'CUSTOM') Vars.POS_DATA = {
        x: Number(Config.POSMODE_3[0]),
        y: Number(Config.POSMODE_3[1]),
        z: Number(Config.POSMODE_3[2])
    }
    let files = custom_list;
    files.sort((a, b) => a.name.localeCompare(b.name));
    files = files.filter(file => {
        return ['.bdx', '.json', '.schematic', '.reb', '.building'].some(n => file.name.toLowerCase().endsWith(n))
    })
    if (!files || files.length === 0) {
        menu.buttons.push({
            text: '§b暂无数据'
        });
    } else {
        files.forEach(file => {
            menu.buttons.push({
                text: (`[§b文件§r] - ${file.name}\n` + (Config.SHOW_SIZE ? `\n§b大小: §r${(file.length/1024).toFixed(2)}kb` : '')),
                image: {
                    type: 'path',
                    data: 'textures/items/brick.png'
                }
            });
        });
    }
    addForm(JSON.stringify(menu), function(index) {
        if (index >= 0 && files && files.length > index) {
            const blocks = loadBlocksData(files[index].name);
            if (blocks.length == 0) {
                clientMsg('文件为空 或无法解析')
                return;
            }
            const {
                x,
                y,
                z
            } = Vars.POS_DATA
            Vars.CHUNK_POS = {
                x,
                y,
                z
            }
            if (Config.IMPORT_CHUNK) execCmd(`tickingarea add ${x-Math.round(Config.CHUNK_RANGE/2)} 0 ${z-Math.round(Config.CHUNK_RANGE/2)} ${x+Math.round(Config.CHUNK_RANGE/2)} 0 ${z+Math.round(Config.CHUNK_RANGE/2)} Rebirth_tmp true`)
            if (Config.SERVER && !Config.SURVIVAL_MODE) summonServerMob(x, y, z)
            const menu = `{"type":"custom_form","title":"确认","content":[{"type":"label","text":"选择建筑: §b${files[index].name}"},{"type":"label","text":"导入起始坐标: §b[${Vars.POS_DATA.x}, ${Vars.POS_DATA.y}, ${Vars.POS_DATA.z}]"},{"type":"label","text":"速度: §b(${Config.BUILD_SPEED_MIN*Config.BUILD_TASKS_MULTIPLE*20}-${Config.BUILD_SPEED_MAX*Config.BUILD_TASKS_MULTIPLE*20}) 块/秒"},{"type":"label","text":"多人模式: §b${Config.SERVER?'启用':'禁用'}"},{"type":"label","text":"实体名称: §b${Config.SERVER_NAME}"},{"type":"label","text":"实体类型: §b${Config.SERVER_MOB}"},{"type":"label","text":"自动常加载: §b${Config.IMPORT_CHUNK?'启用':'禁用'}"},{"type":"label","text":"强制修改零点: §b${Config.FORCE_ZERO?'启用':'禁用'}"},{"type":"label","text":"投影模式: §b${Config.FAKE_MODE?'启用':'禁用'}"},{"type":"label","text":"修复模式: §b${Config.ERROR_FIX?'启用':'禁用'}"},{"type":"label","text":"导入类型: §b建筑"},{"type":"label","text":"文件大小: §b${blocks.length}"},{"type":"label","text":"预计时间: §b${blocks.length/((Config.BUILD_SPEED_MIN+Config.BUILD_SPEED_MAX)/2*Config.BUILD_TASKS_MULTIPLE*20)}秒"},{"type":"label","text":"导入命令方块: §b${Config.LOAD_CMD?'启用':'禁用'}"},{"type":"label","text":"导入告示牌: §b${Config.LOAD_SIGN?'启用':'禁用'}"},{"type":"label","text":"导入生物: §b${Config.LOAD_MOB?'启用':'禁用'}"},{"type":"label","text":"导入容器: §b${Config.LOAD_CONTAINER?'启用':'禁用'}"}]}`;
            addForm(menu, function() {
                clientMsg(blocks ? '读取成功' : '读取失败');
                if (blocks) Vars.BUILD_TASKS = blocks;
                Vars.STARTING = true
            })
        }
    });
}

function aux2parameter(aux, name) {
    if (typeof name != 'string') return aux
    if (typeof aux == 'number' && name.includes('stairs')) return '["weirdo_direction"=' + (aux % 4) + ',"upside_down_bit"=' + bool2jsonValue(aux >= 4) + ']'
    if (typeof aux == 'string') return aux
    return aux
}

function loadSoundsData(name) {
    let sounds = JSON.parse(readFile(`${Vars.PATHS.sound}/${name}`));
    let output = []
    sounds.forEach(list => list.sounds.forEach(sound => {
        if (!Config.NO_BEAT || (sound.sound != 'item.use.on' && sound.sound != 0)) output.push({
            ...sound,
            tick: list.tick
        })
    }))
    Vars.TASK_INFO = {
        length: output.length,
        name,
        ep: [0, 0, 0],
        task_length: 0,
        time: Date.now(),
        offset_pos: [0, 0, 0]
    }
    Config.KILL_LIST.forEach(type => '/kill @e[type=' + type + ']')
    if (Config.INFO_IMPORT_BOOST) {
        _minecraft.setTitle('§d§l§o开始导入: \n§r' + name)
        _minecraft.setSubtitle('§a§o预计用时: \n§r' + (output.length / (Config.BUILD_TASKS_MULTIPLE * (Config.BUILD_SPEED_MIN + Config.BUILD_SPEED_MAX) / 2) / 20) + '秒')
    }
    Config.CMD_BEFORE.forEach(cmd => execCmd(cmd))
    if (Config.TASK_ANALYSE) Vars.OUTPUT_INFO += `文件名称: ${name}, 大小: ${output.length}, 开始时间: ${Vars.TASK_INFO.time}, 起点:${JSON.stringify(Vars.POS_DATA)}\n\n`
    Vars.CUBE_EDGE_LENGTH = Math.ceil(Math.cbrt(output.length))
    Vars.CUBE_EDGE_LENGTH += (Vars.CUBE_EDGE_LENGTH % 2 === 1) ? 0 : 1
    Config.CMD_BEFORE.forEach(cmd => execCmd(cmd))
    return output
}

function showSoundMenu(custom_list = _fs.list(Vars.PATHS.sound)) {
    const menu = {
        type: 'form',
        title: '§音乐列表',
        content: '§b请选择需要粘贴的建筑',
        buttons: []
    };
    if (Config.POSMODE === 'SELF') Vars.POS_DATA = getPlayerBlockPos(getLocalPlayerUniqueID())
    if (Config.POSMODE === 'CUSTOM') Vars.POS_DATA = {
        x: Number(Config.POSMODE_3[0]),
        y: Number(Config.POSMODE_3[1]),
        z: Number(Config.POSMODE_3[2])
    }

    const files = custom_list;

    if (!files || files.length === 0) {
        menu.buttons.push({
            text: '§b暂无数据'
        });
    } else {
        files.forEach(file => {
            menu.buttons.push({
                text: (`[§b音乐§r] - ${file.name}`),
                image: {
                    type: 'path',
                    data: 'textures/items/brick.png'
                }
            });
        });
    }
    addForm(JSON.stringify(menu), function(index) {
        if (index >= 0 && files && files.length > index) {
            Vars.SOUND_DATA = []
            Vars.SOUND_BOOL = [false, false]
            Vars.IS_FIRST_CMD = false
            Vars.LAST_SOUND_TICK = 0
            Vars.SOUND_POS = {
                x: 0,
                y: 0,
                z: 0,
                progress: 0
            }
            const sounds = loadSoundsData(files[index].name)
            const menu = `{"type":"custom_form","title":"确认","content":[{"type":"label","text":"选择建筑: §b${files[index].name}"},{"type":"label","text":"导入起始坐标: §b[${Vars.POS_DATA.x}, ${Vars.POS_DATA.y}, ${Vars.POS_DATA.z}]"},{"type":"label","text":"速度: §b(${Config.BUILD_SPEED_MIN*Config.BUILD_TASKS_MULTIPLE*20}-${Config.BUILD_SPEED_MAX*Config.BUILD_TASKS_MULTIPLE*20}) 块/秒"},{"type":"label","text":"导入类型: §b音乐"},{"type":"label","text":"文件大小: §b${sounds.length}"},{"type":"label","text":"预计时间: §b${sounds.length/((Config.BUILD_SPEED_MIN+Config.BUILD_SPEED_MAX)/2*Config.BUILD_TASKS_MULTIPLE*20)}秒"}]}`;
            addForm(menu, function(offset) {
                clientMsg(sounds ? '读取成功' : '读取失败');
                Vars.SOUND_DATA = sounds
                Vars.STARTING = true
            })
        }
    });
}

// 显示坐标菜单
function showPosMenu(start = {
    x: 0,
    y: 0,
    z: 0
}, end = {
    x: 0,
    y: 0,
    z: 0
}) {
    const menu = {
        type: "custom_form",
        title: "§b建筑导出",
        content: [{
                type: "label",
                text: (`§b大建筑导出模式: §r${Config.LARGE_MODE?'启用':'禁用'}`)
            }, {
                type: "label",
                text: (`§b压缩导出: §r${Config.COMPRESS?'启用':'禁用'}`)
            }, {
                type: "label",
                text: (`§b导出速度: §r${Config.LM_MIN*Config.LM_MULTIPLE*20}-${Config.LM_MIN*Config.LM_MULTIPLE*20}`)
            }, {
                type: "input",
                text: "§b保存名称",
                default: `${getEntityName(getLocalPlayerUniqueID())} - ${Date.now()}`
            },
            {
                type: "input",
                text: "§b起点坐标",
                default: `${start.x},${start.y},${start.z}`,
                placeholder: "例如 0,0,0"
            },
            {
                type: "input",
                text: "§b终点坐标",
                default: `${end.x},${end.y},${end.z}`,
                placeholder: "例如 0,0,0"
            },
            {
                type: "toggle",
                text: `§b输入的是相对坐标[基准见下方点击坐标；要填绝对坐标请关闭此项]\n导出点击坐标: [${Vars.POS_DATA.x},${Vars.POS_DATA.y},${Vars.POS_DATA.z}]`,
                default: false
            }
        ]
    };
    addForm(JSON.stringify(menu), function(a, b, c, name, start_pos, end_pos, relative) {
        if (name && start_pos && end_pos) {
            const s = start_pos.split(',').map(n => Number(n));
            const e = end_pos.split(',').map(n => Number(n));
            if (name.trim().length > 0 && s.length === 3 && e.length === 3 && s.every(num => !isNaN(num)) && e.every(num => !isNaN(num))) {
                if (Config.EXPORT_MID_TP) handleTP((s[0] + e[0]) / 2, (s[1] + e[1]) / 2, (s[2] + e[2]) / 2)
                if (Config.LARGE_MODE) {
                    Vars.EXPORT_SP = [Math.min(s[0], e[0]), Math.min(s[1], e[1]), Math.min(s[2], e[2])]
                    Vars.EXPORT_TMP = [Math.min(s[0], e[0]), Math.min(s[1], e[1]), Math.min(s[2], e[2])]
                    Vars.EXPORT_CP = [Math.min(s[0], e[0]), Math.min(s[1], e[1]), Math.min(s[2], e[2])]
                    Vars.EXPORT_BACKPOS = {
                        x: Vars.EXPORT_SP[0],
                        y: Vars.EXPORT_SP[1],
                        z: Vars.EXPORT_SP[2]
                    }
                    Vars.EXPORT_NAME = ''
                    Vars.EXPORT_LIST = []
                    Vars.EXPORT_PARMAS = []
                    Vars.EXPORT_DISPLAYS = []
                    Vars.EXPORT_EP = [Math.max(s[0], e[0]), Math.max(s[1], e[1]), Math.max(s[2], e[2])]
                    Vars.EXPORT_INFO = {
                        length: (Math.abs((s[0] - e[0] + 1) * (s[1] - e[1] + 1) * (s[2] - e[2] + 1))),
                        current: 0
                    }
                    Vars.IS_EXPORT = true
                    Vars.EXPORT_NAME = name
                    clientMsg('已创建导出任务');
                } else {
                    clientMsg('开始保存建筑');
                    const blocks = getChunkBlocks(s[0] + (relative ? Vars.POS_DATA.x : 0), s[1] + (relative ? Vars.POS_DATA.y : 0), s[2] + (relative ? Vars.POS_DATA.z : 0), e[0] + (relative ? Vars.POS_DATA.x : 0), e[1] + (relative ? Vars.POS_DATA.y : 0), e[2] + (relative ? Vars.POS_DATA.z : 0), Config.DUMP_MODE === 'CLICK' ? Vars.POS_DATA : {});
                    saveBlocksData(name, blocks);
                    clientMsg('保存成功');
                }
            } else clientMsg('输入错误，请输入有效的坐标格式');
        } else clientMsg('所有字段均为必填');
    });
}

const bool2jsonValue = bool => bool ? 'true' : 'false';

function onPlayerBuildBlockEvent(playerId, x, y, z, side) {
    if (!Config.ENABLE) return;
    const block = getBlock(x, y, z)
    if (Config.COPY_CMD) {
        if (block.namespace.includes('command_block')) {
            let NBT = getBlockEntityNBT(x, y, z)
            let Nbt = getBlockNBT(x, y, z)
            Vars.RECORD_CMD = {
                mode: CommandTypeNumberEnum[CommandTypeEnum[block.namespace.replace('minecraft:', '')]],
                isRedStoneMode: !(getText(NBT, "auto:", "b,c") == '1'),
                isConditional: (getText(Nbt, "conditional_bit:", "b,f") == '1'),
                command: getText(NBT, "Command:\"", "\",Cu"),
                name: getText(NBT, "CustomName:\"", "\",E"),
                tickDelay: Number(getText(NBT, "TickDelay:", ",Tr")),
                executeOnFirstTick: (Config.CMD_FIRST || false),
                shouldTrackOutput: (Config.CMD_OUTPUT || false),
                lastOutput: "BuildToolRebirth"
            }
            clientMsg('命令方块数据复制成功')
        } else clientMsg('请点击命令方块')
        return true
    }
    if (Config.COPY_SIGN) {
        if (block.namespace.includes('_sign')) {
            let NBT = getBlockEntityNBT(x, y, z)
            let sign_text = getMultipleText(NBT, ',Text:"', '",')
            Vars.RECORD_SIGN = sign_text
            clientMsg('告示牌数据复制成功')
        } else clientMsg('请点击告示牌')
        return true
    }
    if (Config.PASTE_CMD) {
        if (!Vars.RECORD_CMD) {
            clientMsg('请先复制命令方块数据')
            return true
        }
        if (!block.namespace.includes('command_block')) {
            clientMsg('请先点击命令方块')
            return true
        }
        setCmdBlock(x, y, z, Vars.RECORD_CMD)
        return true
    }
    if (Config.PASTE_SIGN) {
        if (!Vars.RECORD_SIGN) {
            clientMsg('请先复制告示牌数据')
            return true
        }
        if (!block.namespace.includes('_sign')) {
            clientMsg('请先点击告示牌')
            return true
        }
        setBlockEntityData(x, y, z, `{BackText:{HideGlowOutline:0b,IgnoreLighting:0b,PersistFormatting:1b,SignTextColor:-16777216,Text:"${Vars.RECORD_SIGN}",TextOwner:""},FrontText:{HideGlowOutline:0b,IgnoreLighting:0b,PersistFormatting:1b,SignTextColor:-16777216,Text:"${Vars.RECORD_SIGN}",TextOwner:""},IsWaxed:0b,LockedForEditingBy:-1l,id:"HangingSign",isMovable:1b,x:${x},y:${y},z:${z}}`)
        return true
    }
    if (Config.COPY_POS) {
        Vars.RECORD_POS = `${x} ${y} ${z}`
        clientMsg('坐标数据复制成功 => ' + Vars.RECORD_POS)
        return true
    }
    if (Config.PASTE_POS) {
        if (!Vars.RECORD_POS) {
            clientMsg('请先复制坐标数据')
            return true
        }
        if (!block.namespace.includes('command_block')) {
            clientMsg('请先点击命令方块')
            return true
        }
        let NBT = getBlockEntityNBT(x, y, z)
        let Nbt = getBlockNBT(x, y, z)
        let cmd = getText(NBT, "Command:\"", "\",Cu")
        if (!cmd.includes('[坐标]')) {
            clientMsg('命令方块未包含坐标参数')
            return true
        }
        let data = {
            mode: CommandTypeNumberEnum[CommandTypeEnum[block.namespace.replace('minecraft:', '')]],
            isRedStoneMode: !(getText(NBT, "auto:", "b,c") == '1'),
            isConditional: (getText(Nbt, "conditional_bit:", "b,f") == '1'),
            command: cmd.replaceAll('[坐标]', Vars.RECORD_POS),
            name: getText(NBT, "CustomName:\"", "\",E"),
            tickDelay: Number(getText(NBT, "TickDelay:", ",Tr")),
            executeOnFirstTick: (Config.CMD_FIRST || false),
            shouldTrackOutput: (Config.CMD_OUTPUT || false),
            lastOutput: "BuildToolRebirth"
        }
        clientMsg('坐标数据粘贴成功')
        setCmdBlock(x, y, z, data)
        return true
    }
    if (Config.CLICK_COPY) {
        if (Vars.POS_DATA.x === 0 && Vars.POS_DATA.y === 0 && Vars.POS_DATA.z === 0) {
            Vars.POS_DATA.x = x;
            Vars.POS_DATA.y = y;
            Vars.POS_DATA.z = z;
            tipMessage('已经选择起点，请选择终点')
            return true;
        } else if (Vars.POS_DATA.x !== x || Vars.POS_DATA.y !== y || Vars.POS_DATA.z !== z) {
            showPosMenu(Vars.POS_DATA, {
                x,
                y,
                z
            })
            Vars.POS_DATA.x = 0;
            Vars.POS_DATA.y = 0;
            Vars.POS_DATA.z = 0;
        }
        return true;
    }
    if (Config.FAST_BUILD) {
        if (Vars.POS_DATA.x === 0 && Vars.POS_DATA.y === 0 && Vars.POS_DATA.z === 0) {
            Vars.POS_DATA.x = x;
            Vars.POS_DATA.y = y;
            Vars.POS_DATA.z = z;
            tipMessage('已经选择起点，请选择终点')
            return true;
        } else if (Vars.POS_DATA.x !== x || Vars.POS_DATA.y !== y || Vars.POS_DATA.z !== z) {
            const carried = analysisNBT(getEntityCarriedItem(getLocalPlayerUniqueID()))
            if (Config.FILL_MODE === 'FILL_UP') execCmd(`fill ${Vars.POS_DATA.x} ${Vars.POS_DATA.y} ${Vars.POS_DATA.z} ${x} ${y} ${z} ${carried.namespace} ${carried.aux} ${Config.FB_AIR?'keep':''}`)
            if (Config.FILL_MODE === 'SURFACE') {
                execCmd(`fill ${Vars.POS_DATA.x} ${y} ${Vars.POS_DATA.z} ${x} ${y} ${z} ${carried.namespace} ${carried.aux} ${Config.FB_AIR?'keep':''}`)
                execCmd(`fill ${Vars.POS_DATA.x} ${Vars.POS_DATA.y} ${Vars.POS_DATA.z} ${x} ${Vars.POS_DATA.y} ${z} ${carried.namespace} ${carried.aux} ${Config.FB_AIR?'keep':''}`)
                execCmd(`fill ${x} ${Vars.POS_DATA.y} ${Vars.POS_DATA.z} ${x} ${y} ${z} ${carried.namespace} ${carried.aux} ${Config.FB_AIR?'keep':''}`)
                execCmd(`fill ${Vars.POS_DATA.x} ${Vars.POS_DATA.y} ${Vars.POS_DATA.z} ${Vars.POS_DATA.x} ${y} ${z} ${carried.namespace} ${carried.aux} ${Config.FB_AIR?'keep':''}`)
                execCmd(`fill ${Vars.POS_DATA.x} ${Vars.POS_DATA.y} ${z} ${x} ${y} ${z} ${carried.namespace} ${carried.aux} ${Config.FB_AIR?'keep':''}`)
                execCmd(`fill ${Vars.POS_DATA.x} ${Vars.POS_DATA.y} ${Vars.POS_DATA.z} ${x} ${y} ${Vars.POS_DATA.z} ${carried.namespace} ${carried.aux} ${Config.FB_AIR?'keep':''}`)
            }
            if (Config.FILL_MODE === 'FRAMEWORK') {
                const fillEdge = (startX, startY, startZ, endX, endY, endZ) => execCmd(`fill ${startX} ${startY} ${startZ} ${endX} ${endY} ${endZ} ${carried.namespace} ${carried.aux} ${Config.FB_AIR?'keep':''}`);
                fillEdge(Vars.POS_DATA.x, Vars.POS_DATA.y, Vars.POS_DATA.z, Vars.POS_DATA.x, y, Vars.POS_DATA.z);
                fillEdge(x, Vars.POS_DATA.y, Vars.POS_DATA.z, x, y, Vars.POS_DATA.z);
                fillEdge(Vars.POS_DATA.x, Vars.POS_DATA.y, z, Vars.POS_DATA.x, y, z);
                fillEdge(x, Vars.POS_DATA.y, z, x, y, z);
                fillEdge(Vars.POS_DATA.x, Vars.POS_DATA.y, Vars.POS_DATA.z, x, Vars.POS_DATA.y, Vars.POS_DATA.z);
                fillEdge(Vars.POS_DATA.x, y, Vars.POS_DATA.z, x, y, Vars.POS_DATA.z);
                fillEdge(Vars.POS_DATA.x, Vars.POS_DATA.y, z, x, Vars.POS_DATA.y, z);
                fillEdge(Vars.POS_DATA.x, y, z, x, y, z);
                fillEdge(Vars.POS_DATA.x, Vars.POS_DATA.y, Vars.POS_DATA.z, Vars.POS_DATA.x, Vars.POS_DATA.y, z);
                fillEdge(x, Vars.POS_DATA.y, Vars.POS_DATA.z, x, Vars.POS_DATA.y, z);
                fillEdge(Vars.POS_DATA.x, y, Vars.POS_DATA.z, Vars.POS_DATA.x, y, z);
                fillEdge(x, y, Vars.POS_DATA.z, x, y, z);
            }
            if (Config.FILL_MODE === 'REMOVE') execCmd(`fill ${Vars.POS_DATA.x} ${Vars.POS_DATA.y} ${Vars.POS_DATA.z} ${x} ${y} ${z} air`)
            Vars.POS_DATA.x = 0;
            Vars.POS_DATA.y = 0;
            Vars.POS_DATA.z = 0;
        }
        return true;
    }
    if (Config.SET_POS && Vars.BUILD_TASKS.length === 0 && Vars.SOUND_DATA.length == 0 && Config.POSMODE == 'CLICK') {
        Vars.POS_DATA.x = x;
        Vars.POS_DATA.y = y;
        Vars.POS_DATA.z = z;
        clientMsg('已设置导入坐标 -> ' + `[${x}, ${y}, ${z}]`)
        return true;
    }
    if (Config.SMART_DUMP) {
        if (Vars.IS_DUMP) return;
        Vars.IS_DUMP = true
        Vars.POS_DUMP = [x, y, z]
        Vars.DUMP_LIST.push([x, y, z])
        clientMsg('开始搜索方块')
        return true
    }
    if (Config.BUILD_ASSIST && (Config.ASSIST_FILL || Config.ASSIST_REPLACE)) {
        if (Vars.IS_ASSIST) return;
        Vars.IS_ASSIST = true
        Vars.ASSIST_LIST.push([x, y, z])
        Config.ASSIST_ITEM = analysisNBT(getEntityCarriedItem(getLocalPlayerUniqueID()))
        Config.ASSIST_BLOCK = getBlock(x, y, z)
        clientMsg('开始修补方块')
        return true
    }
}

function onTickEvent() {
    const self = getLocalPlayerUniqueID()
    const screen = getScreenSizeData()
    var msglist = []
    if (!Config.ENABLE) return;
    Vars.TOTAL_TICKS++
    addCustomArrayList('build_tool_rebirth', `建筑工具Rebirth | 用户: ${getEntityName(self)} | 玩家/实体数量: ${getWorldPlayerList().length}个/${getEntityList().length}个 | 运行时间: ${Math.floor(Vars.TOTAL_TICKS/20)}秒`, `建筑工具Rebirth | 用户: ${getEntityName(self)} | 玩家/实体数量: ${getWorldPlayerList().length}个/${getEntityList().length}个 | 运行时间: ${Math.floor(Vars.TOTAL_TICKS/20)}秒`, Config.ENABLE);
    if (Vars.BUILD_TASKS.length > 0) {
        if (Vars.TOTAL_TICKS % Config.BUILD_DELAY !== 0 && Config.BUILD_DELAY > 50) {
            tipMessage('等待' + (Config.BUILD_DELAY / 20) + '秒...')
            return
        };
        if (Vars.TOTAL_TICKS < Vars.RECORD_TICK) {
            tipMessage('等待' + ((Vars.RECORD_TICK - Vars.TOTAL_TICKS) / 20) + '秒...')
            return
        }
    }

    if (Config.SET_POS && Config.SHOW_DIRECTION) {
        for (let i = 0.1; i < 2; i += 0.3) {
            drawParticle(55, Vars.POS_DATA.x + i + 0.5, Vars.POS_DATA.y + 0.5, Vars.POS_DATA.z + 0.5, 1)
            drawParticle(55, Vars.POS_DATA.x + 0.5, Vars.POS_DATA.y + i + 0.5, Vars.POS_DATA.z + 0.5, 1)
            drawParticle(55, Vars.POS_DATA.x + 0.5, Vars.POS_DATA.y + 0.5, Vars.POS_DATA.z + i + 0.5, 1)
        }
    }
    if (Vars.SIGN_LIST.length > 0 && Vars.BUILD_TASKS.length === 0 && Vars.CMD_LIST.length === 0 && Vars.TOTAL_TICKS % Config.BUILD_TASKS_SIGN === 0) {
        let sign_data = Vars.SIGN_LIST[0]
        const {
            x,
            y,
            z,
            text
        } = sign_data
        if (text == '') Vars.SIGN_LIST.shift()
        if (Config.FIX_SIGN) {
            const block = getBlock(sign_data.x, sign_data.y, sign_data.z)
            if (!block.namespace.includes('_sign') && sign_data.aux) execCmd(`setblock ${sign_data.x} ${sign_data.y} ${sign_data.z} ${sign_data.name} ${sign_data.aux}`)
            else Vars.CMD_LIST.shift()
        } else Vars.CMD_LIST.shift()
        if (Config.SIGN_TP && getDistance({
                x,
                y,
                z
            }, getEntityPos(self)) > 7) {
            handleTP(x, y, z)
            tipMessage('距离较远，自动传送')
            return;
        }
        if (Config.SET_POS) {
            tipMessage('请关闭设置导入坐标')
            return;
        }
        let block = getBlock(x, y, z)
        if (block.namespace.includes('_sign')) {
            buildBlock(self, x, y, z, 0)
            setBlockEntityData(x, y, z, `{BackText:{HideGlowOutline:0b,IgnoreLighting:0b,PersistFormatting:1b,SignTextColor:-16777216,Text:"${text}",TextOwner:""},FrontText:{HideGlowOutline:0b,IgnoreLighting:0b,PersistFormatting:1b,SignTextColor:-16777216,Text:"${text}",TextOwner:""},IsWaxed:0b,LockedForEditingBy:-1l,id:"HangingSign",isMovable:1b,x:${x},y:${y},z:${z}}`)
            tipMessage(`设置告示牌: [${x}, ${y}, ${z}], 文字: ${text}`)
            let NBT = getBlockEntityNBT(x, y, z)
            if (getText(NBT, ',Text:"', '",TextOwner') == text) Vars.SIGN_LIST.shift()
            deleteContainer()
        }
    }
    if (Vars.IS_ASSIST && (Vars.ASSIST_LIST.length === 0 || Vars.CURRENT_ASSIST_NUM > Config.ASSIST_NUM)) {
        Vars.IS_ASSIST = false
        Config.ASSIST_FIRST = false
        Vars.CURRENT_ASSIST_NUM = 0
        Vars.ASSIST_HAS = []
        clientMsg('替换完毕')
    }

    if (Config.BUILD_ASSIST && Vars.ASSIST_LIST.length > 0 && Vars.IS_ASSIST) {
        for (let i = 0; i < Config.ASSIST_SPEED; i++) {
            let p = Vars.ASSIST_LIST.shift()
            if (typeof p != "object" || p.length < 3) continue;
            const block = getBlock(p[0], p[1], p[2])
            const dist = getDistance(getEntityPos(self), {
                x: p[0],
                y: p[1],
                z: p[2]
            })
            if (Vars.ASSIST_HAS.includes(JSON.stringify(p)) || dist > Config.ASSIST_DISTANCE) continue;
            let block_pos = [
                [p[0] + 1, p[1], p[2]],
                [p[0] - 1, p[1], p[2]],
                [p[0], p[1], p[2] + 1],
                [p[0], p[1], p[2] - 1],
            ]
            if (Config.ASSIST_FILL && block.namespace != 'minecraft:air' && Config.ASSIST_FIRST) continue
            if (Config.ASSIST_REPLACE && block.namespace != Config.ASSIST_BLOCK.namespace) continue
            if (Config.ASSIST_REPLACE) block_pos.push([p[0], p[1] + 1, p[2]], [p[0], p[1] - 1, p[2]])
            if (Config.ASSIST_FILL && block.namespace != 'minecraft:air' && !Config.ASSIST_FIRST) Config.ASSIST_FIRST = true
            execCmd(`/setblock ${p[0]} ${p[1]} ${p[2]} ${Config.ASSIST_ITEM.namespace} ${Config.ASSIST_ITEM.aux}`)
            Vars.ASSIST_HAS.push(JSON.stringify(p))
            Vars.ASSIST_LIST.push(...block_pos)
            Vars.CURRENT_ASSIST_NUM++
        }
        tipMessage('替换方块中...')
    }

    if (Vars.IS_DUMP && (Vars.DUMP_LIST.length === 0 || Vars.CURRENT_DUMP_NUM > Config.DUMP_NUM)) {
        Vars.IS_DUMP = false
        Vars.CURRENT_DUMP_NUM = 0
        Vars.DUMP_OUTPUT.push({
            displayName: Vars.DUMP_DISPLAYS
        })
        Vars.DUMP_OUTPUT.push(Vars.DUMP_PARMAS)
        Vars.DUMP_PARMAS = []
        Vars.DUMP_DISPLAYS = []
        Vars.DUMP_HAS = []
        clientMsg('智能导出完毕')
        saveBlocksData(`Rebirth_智能导出_${Date.now()}`, Vars.DUMP_OUTPUT, true, Config.DUMP_CONFIRM);
        Vars.DUMP_OUTPUT = []
    }
    if (Config.SMART_DUMP && Vars.DUMP_LIST.length > 0 && Vars.IS_DUMP) {
        for (let i = 0; i < Config.DUMP_SPEED; i++) {
            let p = Vars.DUMP_LIST.shift()
            if (typeof p != "object" || p.length < 3) continue;
            const block = getBlock(p[0], p[1], p[2])
            const dist = getDistance(getEntityPos(self), {
                x: p[0],
                y: p[1],
                z: p[2]
            })
            if (Vars.DUMP_HAS.includes(JSON.stringify(p)) || Config.DUMPLING_NAMESPACE.includes(block.namespace.replace('minecraft:', '')) || dist > Config.DUMP_DISTANCE) continue;
            if (Config.DUMP_TP && dist > Config.DUMP_TP_DIST) handleTP(p[0], p[1], p[2])
            const name = block.namespace.replace('minecraft:', '')
            if (!Vars.DUMP_PARMAS.includes(name)) {
                Vars.DUMP_PARMAS.push(name)
                Vars.DUMP_DISPLAYS.push((Config.LANG_MODE === 'zh_CN') ? block.descriptionName : name)
            }
            const data = getBlockData(block, p[0], p[1], p[2], Vars.POS_DUMP, {}, Vars.DUMP_PARMAS, Vars.POS_DATA)
            Vars.DUMP_OUTPUT.push(data.task)
            Vars.POS_DUMP = data.pos
            let block_pos = [
                [p[0] + 1, p[1], p[2]],
                [p[0] - 1, p[1], p[2]],
                [p[0], p[1], p[2] + 1],
                [p[0], p[1], p[2] - 1],
                [p[0], p[1] + 1, p[2]],
                [p[0], p[1] - 1, p[2]]
            ]
            Vars.DUMP_HAS.push(JSON.stringify(p))
            Vars.DUMP_LIST.push(...block_pos)
            Vars.CURRENT_DUMP_NUM++;
            tipMessage('扫描方块中... 已扫描: ' + Vars.CURRENT_DUMP_NUM + `个方块\n正在扫描: [${p[0]}, ${p[1]}, ${p[2]}] - ${name}`)
        }
    }
    const exportSpeed = (Config.LM_MULTIPLE * getRandomNum(Config.LM_MIN, Config.LM_MAX))
    if (Vars.IS_EXPORT && (Vars.EXPORT_CP[1] > Vars.EXPORT_EP[1] || Vars.EXPORT_INFO.current >= Vars.EXPORT_INFO.length)) {
        Vars.IS_EXPORT = false
        Vars.EXPORT_LIST.push({
            ep: Vars.EXPORT_EP
        })
        Vars.EXPORT_LIST.push({
            displayName: Vars.EXPORT_DISPLAYS
        })
        Vars.EXPORT_LIST.push(Vars.EXPORT_PARMAS)
        Vars.EXPORT_PARMAS = []
        Vars.EXPORT_DISPLAYS = []
        Vars.EXPORT_SP = []
        Vars.EXPORT_CP = []
        Vars.EXPORT_EP = []
        Vars.EXPORT_INFO = {
            length: 0,
            current: 0
        }
        clientMsg('建筑导出完毕')
        saveBlocksData(Vars.EXPORT_NAME, Vars.EXPORT_LIST);
        Vars.EXPORT_NAME = ''
        Vars.EXPORT_LIST = []
        if (Config.CRASH_HUNTER) setData('crash_reason', 'null')
    }
    if (Config.LARGE_MODE && Vars.IS_EXPORT) {
        for (let i = 0; i < Math.min(exportSpeed, Vars.EXPORT_INFO.length - Vars.EXPORT_INFO.current); i++) {
            var x = Vars.EXPORT_CP[0]
            var y = Vars.EXPORT_CP[1]
            var z = Vars.EXPORT_CP[2]
            if (x === undefined || y === undefined || z === undefined) continue;
            var block = getBlock(x, y, z)
            if (!block) continue
            var name = block.namespace.replace('minecraft:', '')
            if (Config.CRASH_HUNTER) setData('crash_reason', JSON.stringify({
                x,
                y,
                z,
                block
            }))
            let dist = getDistance(getEntityPos(self), {
                x,
                y,
                z
            })
            if (Config.EXPORT_TP && dist > Config.EXPORT_TP_DIST) {
                if (Config.TP_MODE != 'PACKET') {
                    Config.STOP = true
                    setTimeout(() => Config.STOP = false, exportSpeed * 5 * Config.EXPORT_TP_DELAY)
                }
                tipMessage('等待传送中...')
                handleTP(x, y, z)
                return;
            }
            if (Config.EXPORT_MAKE_SURE && name == 'client_request_placeholder_block') {
                tipMessage('等待区块加载中...')
                handleTP(x, y, z)
                return;
            }
            if (!Config.EXCLUDE_LIST.includes(name)) {
                if (!Vars.EXPORT_PARMAS.includes(name)) {
                    Vars.EXPORT_PARMAS.push(name)
                    Vars.EXPORT_DISPLAYS.push((Config.LANG_MODE === 'zh_CN') ? block.descriptionName : name)
                }
                var data = getBlockData(block, x, y, z, Vars.EXPORT_BACKPOS, {}, Vars.EXPORT_PARMAS, Vars.POS_DATA)
                Vars.EXPORT_LIST.push(data.task)
                Vars.EXPORT_BACKPOS = data.pos
            }
            if (Config.EXPORT_CHUNK && (Vars.EXPORT_EP[2] - Vars.EXPORT_SP[2] > Config.EXPORT_CHUNK_RANGE) && (Vars.EXPORT_EP[0] - Vars.EXPORT_SP[0] > Config.EXPORT_CHUNK_RANGE)) {
                if (Vars.EXPORT_CP[2] > Vars.EXPORT_EP[2] && Vars.EXPORT_CP[0] > Vars.EXPORT_EP[0]) {
                    Vars.EXPORT_CP[1]++;
                    updateTmpAndCp(Vars.EXPORT_SP[0], Vars.EXPORT_SP[0]);
                } else if (Vars.EXPORT_CP[0] > Vars.EXPORT_EP[0] && Vars.EXPORT_CP[2] > (Vars.EXPORT_TMP[2] + Config.EXPORT_CHUNK_RANGE)) {
                    Vars.EXPORT_TMP[2] += Config.EXPORT_CHUNK_RANGE;
                    updateTmpAndCp(Vars.EXPORT_SP[0], Vars.EXPORT_TMP[2]);
                    Vars.EXPORT_CP[2]++;
                } else if (Vars.EXPORT_CP[0] > (Vars.EXPORT_TMP[0] + Config.EXPORT_CHUNK_RANGE) && Vars.EXPORT_CP[2] > (Vars.EXPORT_TMP[2] + Config.EXPORT_CHUNK_RANGE)) {
                    Vars.EXPORT_TMP[0] += Config.EXPORT_CHUNK_RANGE;
                    updateTmpAndCp(Vars.EXPORT_TMP[0], Vars.EXPORT_TMP[2]);
                } else if (Vars.EXPORT_CP[0] > (Vars.EXPORT_TMP[0] + Config.EXPORT_CHUNK_RANGE)) {
                    Vars.EXPORT_CP[0] = Vars.EXPORT_TMP[0];
                    Vars.EXPORT_CP[2]++;
                }
            } else {
                if (Vars.EXPORT_CP[2] > Vars.EXPORT_EP[2]) {
                    Vars.EXPORT_CP[2] = Vars.EXPORT_SP[2];
                    Vars.EXPORT_CP[1]++;
                } else if (Vars.EXPORT_CP[0] > Vars.EXPORT_EP[0]) {
                    Vars.EXPORT_CP[0] = Vars.EXPORT_SP[0];
                    Vars.EXPORT_CP[2]++;
                }
            }
            if (Config.SHOW_INFO) {
                if (Config.INFO_NAME) msglist.push('任务昵称: ' + Vars.EXPORT_NAME)
                if (Config.INFO_COMPLETE) msglist.push(`进度: [${Vars.EXPORT_INFO.current}/${Vars.EXPORT_INFO.length}] - ${((Vars.EXPORT_INFO.current/Vars.EXPORT_INFO.length)*100).toFixed(2)}%%`)
                if (Config.INFO_SPEED) msglist.push(`速度: ${exportSpeed*20}块/秒 预计剩余: ${((Vars.EXPORT_INFO.length-Vars.EXPORT_INFO.current)/(exportSpeed*20)).toFixed(2)}秒`)
                if (Config.INFO_TASK) msglist.push(`正在扫描: ${(Config.LANG_MODE === 'zh_CN') ? block.descriptionName : name} - [${x}, ${y}, ${z}]`)
                if (Config.INFO_DIST) msglist.push(`扫描距离: ${dist.toFixed(2)}格`)
                if (Config.INFO_PROGRESS) msglist.push(`${getProgress(Vars.EXPORT_INFO.current,Vars.EXPORT_INFO.length)}`)
                if (msglist.length > 0) {
                    let color = 'r'
                    if (Config.INFO_RGB) color = "4c6e2a3b195d591b3a2e6c".split("")[Vars.TOTAL_TICKS % 22]
                    if (Config.TIP_MODE === "Game") _minecraft.showTipMessage("§f <<<§r §b建筑工具 - INFO §f>>>§r\n§" + color + msglist.join("\n§" + color))
                    if (Config.TIP_MODE === "Script") updateTextContent(Vars.TIP_ID, "§f <<<§r §b建筑工具 - INFO §f>>>§r\n§" + color + msglist.join('\n§' + color))
                    msglist = []
                }
            }
            // _minecraft.showTipMessage(`§e进度: [§a${Vars.EXPORT_INFO.current}/${Vars.EXPORT_INFO.length}§e]-[§a${((Vars.EXPORT_INFO.current/Vars.EXPORT_INFO.length)*100).toFixed(2)}%%§e] §e预计剩余: §r§l${((Vars.EXPORT_INFO.length-Vars.EXPORT_INFO.current)/(exportSpeed*20)).toFixed(2)}秒§r\n§b当前导出: §r${Vars.EXPORT_NAME}\n${getProgress(Vars.EXPORT_INFO.current,Vars.EXPORT_INFO.length)}\n§e正在扫描: §a${name} [${x} ${y} ${z}] §e速度: §r${exportSpeed*20} 块/秒`);
            Vars.EXPORT_CP[0]++
            Vars.EXPORT_INFO.current++;
        }
    }
    if (Vars.BUILD_TASKS.length === 0 && Vars.CMD_LIST.length === 0 && Vars.SOUND_DATA.length === 0 && Vars.EXECUTE_CMDS.length === 0 && Vars.SIGN_LIST.length === 0) {
        if (Config.SET_POS) tipMessage(`导入坐标: [${Vars.POS_DATA.x} ${Vars.POS_DATA.y} ${Vars.POS_DATA.z}] 距离: ${getDistance(Vars.POS_DATA,getEntityPos(self)).toFixed(2)}m`)
        if (Config.CLICK_COPY && Vars.POS_DATA.x != 0 && Vars.POS_DATA.y != 0 && Vars.POS_DATA.z != 0) tipMessage(`导出起点: [${Vars.POS_DATA.x} ${Vars.POS_DATA.y} ${Vars.POS_DATA.z}] 距离: ${getDistance(Vars.POS_DATA,getEntityPos(self)).toFixed(2)}m`)

        if (Config.FAST_BUILD && Vars.POS_DATA.x != 0 && Vars.POS_DATA.y != 0 && Vars.POS_DATA.z != 0) tipMessage(`填充起点: [${Vars.POS_DATA.x} ${Vars.POS_DATA.y} ${Vars.POS_DATA.z}] 距离: ${getDistance(Vars.POS_DATA,getEntityPos(self)).toFixed(2)}m`)
    };
    if (Vars.BUILD_TASKS.length > 0 && Config.SERVER && Config.SERVER_TP) executeCommand(`execute as @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] at @s run tp @s ~ ~ ~ ~5`)
    if (Config.SURVIVAL_MODE && Vars.BUILD_TASKS.length > 0) {
        const task = Vars.BUILD_TASKS[0];
        if (task.length == 5) {
            let pos = {
                x: (Config.X_MIRROR ? (Vars.TASK_INFO.ep[0] - task[0]) : task[0]) + Vars.TASK_INFO.offset_pos[0],
                y: (Config.Y_MIRROR ? (Vars.TASK_INFO.ep[1] - task[1]) : task[1]) + Vars.TASK_INFO.offset_pos[1],
                z: (Config.Z_MIRROR ? (Vars.TASK_INFO.ep[2] - task[2]) : task[2]) + Vars.TASK_INFO.offset_pos[2]
            }
            let Distance = getDistance(pos, Vars.ZERO_POS)
            let delta_pos = getDisplacement(Distance, Vars.ZERO_POS, getPlayerAngle(Vars.ZERO_POS, pos), Config.ROTATION_YAW, Config.ROTATION_PITCH)
            let x = Math.round(Vars.POS_DATA.x + delta_pos.x),
                y = Math.round(Vars.POS_DATA.y + delta_pos.y),
                z = Math.round(Vars.POS_DATA.z + delta_pos.z),
                index = task[3],
                aux = task[4]
            const aimBlock = getBlock(x, y, z)
            let dp = getDistance({
                x,
                y,
                z
            }, getEntityPos(self))
            if (dp >= Config.SURVIVAL_DISTANCE && !Config.SURVIVAL_TP) {
                tipMessage(`请靠近: §r${x} ${y} ${z}, §e距离: §r${(dp-Config.SURVIVAL_DISTANCE).toFixed(2)}格`)
                return;
            };
            if (dp >= Config.SURVIVAL_DISTANCE && Config.SURVIVAL_TP) handleTP(x, y + Config.SURVIVAL_HEIGHT, z)
            const carried = analysisNBT(getEntityCarriedItem(self))
            if (aimBlock.namespace !== 'minecraft:air' && aimBlock.namespace !== ('minecraft:' + Vars.CURRENT_PAMARS[index])) {
                if (Config.SURVIVAL_EXCLUDE) {
                    tipMessage('已跳过无法放置的方块')
                    Vars.BUILD_TASKS.shift()
                    return;
                }
                if (Config.SURVIVAL_DESTROY) {
                    tipMessage('已破坏无法放置的方块')
                    destroyBlock(self, x, y, z, 0)
                    return;
                }
            } else if (aimBlock.namespace === ('minecraft:' + Vars.CURRENT_PAMARS[index])) {
                tipMessage('已跳过相同的方块')
                Vars.BUILD_TASKS.shift()
                return;
            }
            if (carried.namespace === 'minecraft:' + Vars.CURRENT_PAMARS[index] && (Config.SURVIVAL_NOAUX || carried.aux === aux)) {
                if (Config.SHOW_INFO) {
                    if (Config.INFO_NAME) msglist.push('任务昵称: ' + Vars.TASK_INFO.name)
                    if (Config.INFO_COMPLETE) msglist.push(`进度: [${Vars.TASK_INFO.length-Vars.BUILD_TASKS.length}/${Vars.TASK_INFO.length}] - ${((1-(Vars.BUILD_TASKS.length/Vars.TASK_INFO.length))*100).toFixed(2)}%%`)
                    if (Config.INFO_SPEED) msglist.push(`速度: ${20}块/秒 预计剩余: ${(Vars.BUILD_TASKS.length/20).toFixed(2)}秒`)
                    if (Config.INFO_TASK) msglist.push(`正在建造: ${Vars.CURRENT_DISPLAYS[task[3]]} - [${x}, ${y}, ${z}]`)
                    if (Config.INFO_DIST) msglist.push(`建造距离: ${dp.toFixed(2)}格`)
                    if (Config.INFO_TASK) msglist.push(`方块列表: ${Vars.CURRENT_DISPLAYS.join(' | ')}`)
                    if (Config.INFO_PROGRESS) msglist.push(`${getProgress(Vars.TASK_INFO.length-Vars.BUILD_TASKS.length,Vars.TASK_INFO.length)}`)
                    if (msglist.length > 0) {
                        let color = 'r'
                        if (Config.INFO_RGB) color = "4c6e2a3b195d591b3a2e6c".split("")[Vars.TOTAL_TICKS % 22]
                        if (Config.TIP_MODE === "Game") _minecraft.showTipMessage("§f <<<§r §b建筑工具 - INFO §f>>>§r\n§" + color + msglist.join("\n§" + color))
                        if (Config.TIP_MODE === "Script") updateTextContent(Vars.TIP_ID, "§f <<<§r §b建筑工具 - INFO §f>>>§r\n§" + color + msglist.join('\n§' + color))
                        msglist = []
                    }
                }
                if ((Config.ERROR && getRandomNum(0, 100) > (100 - (Vars.BUILD_TASKS.length / Vars.TASK_INFO.length) * 100)) || !Config.ERROR) Vars.TASK_INFO.offset_pos = [pos.x, pos.y, pos.z]
                let states = buildBlock(self, x, y, z, 0)
                let isTrueBuild = (getBlock(x, y, z).namespace === 'minecraft:' + Vars.CURRENT_PAMARS[index])
                if (!Config.SURVIVAL_CHECK || (isTrueBuild && states)) Vars.BUILD_TASKS.shift()
            } else if (Config.SURVIVAL_SELECT) {
                let hasFound = false
                for (let i = 0; i < 9; i++) {
                    let item = analysisNBT(getPlayerInventoryItem(self, i))
                    if (item.namespace == 'minecraft:' + Vars.CURRENT_PAMARS[index] && (item.aux == aux || Config.SURVIVAL_NOAUX)) {
                        hasFound = selectPlayerInventorySlot(self, i)
                        break
                    }
                }
                if (!hasFound) tipMessage(`未找到物品, 请手持 特殊值为${aux}的${Vars.CURRENT_DISPLAYS[index]}`)
            } else tipMessage(`请手持 特殊值为${aux}的${Vars.CURRENT_DISPLAYS[index]}`)
        } else Vars.BUILD_TASKS.shift()
        return;
    }
    let realSpeed = (Config.BUILD_TASKS_MULTIPLE * getRandomNum(Config.BUILD_SPEED_MIN, Config.BUILD_SPEED_MAX))
    if (Config.STOP) {
        tipMessage('暂停导入中...')
        return
    };
    for (let i = 0; i < Math.min(realSpeed, Vars.BUILD_TASKS.length); i++) {
        if (Vars.BUILD_TASKS.length > 0) {
            let task = Vars.BUILD_TASKS[0];
            if (typeof task != 'object' || task.length == undefined || task.length == 0) {
                Vars.BUILD_TASKS.shift()
                continue
            };
            if (Config.CRASH_HUNTER) setData('crash_reason', JSON.stringify({
                task,
                duration: (Vars.TASK_INFO.length - Vars.BUILD_TASKS.length)
            }))
            let pos = {
                x: (Config.X_MIRROR ? (Vars.TASK_INFO.ep[0] - task[0]) : task[0]) + Vars.TASK_INFO.offset_pos[0],
                y: (Config.Y_MIRROR ? (Vars.TASK_INFO.ep[1] - task[1]) : task[1]) + Vars.TASK_INFO.offset_pos[1],
                z: (Config.Z_MIRROR ? (Vars.TASK_INFO.ep[2] - task[2]) : task[2]) + Vars.TASK_INFO.offset_pos[2]
            }
            let Distance = getDistance(pos, Vars.ZERO_POS)
            let delta_pos = Config.ROTATE_BUILD ? (getDisplacement(Distance, Vars.ZERO_POS, getPlayerAngle(Vars.ZERO_POS, pos), Config.ROTATION_YAW, Config.ROTATION_PITCH)) : pos
            let x = Vars.POS_DATA.x + delta_pos.x,
                y = Vars.POS_DATA.y + delta_pos.y,
                z = Vars.POS_DATA.z + delta_pos.z
            if (Config.TP_FOLLOW) setEntityPos(self, x, y + 5, z)
            if (Config.PACKET_FOLLOW) sendPlayerAuthInput({
                inputMode: 2,
                playMode: 0,
                pos: {
                    x,
                    y,
                    z
                },
            })
            const distToCamera = getDistance(Vars.CAMERA_POS, {
                x,
                y,
                z
            })
            if (Config.CAMERA_MODE && distToCamera > Config.CAMERA_RANGE) {
                Vars.CAMERA_POS = {
                    x,
                    y,
                    z
                }
                let self_pos = getEntityPos(self)
                setCameraAnchor(Vars.CAMERA_POS.x - self_pos.x, Vars.CAMERA_POS.y - self_pos.y + Config.CAMERA_Y, -Vars.CAMERA_POS.z + self_pos.z)
                setCameraOffset(0, 0, -Config.CAMERA_ZOOM / 2)
            }
            if (Config.IMPORT_CHUNK) {
                const distToChunk = getDistance(Vars.CHUNK_POS, {
                    x,
                    y,
                    z
                })
                if (distToChunk > Config.CHUNK_RANGE) {
                    execCmd(`tickingarea remove Rebirth_tmp`)
                    execCmd(`tickingarea add ${x-Math.round(Config.CHUNK_RANGE/2)} 0 ${z-Math.round(Config.CHUNK_RANGE/2)} ${x+Math.round(Config.CHUNK_RANGE/2)} 0 ${z+Math.round(Config.CHUNK_RANGE/2)} Rebirth_tmp true`)
                    Vars.CHUNK_POS = {
                        x,
                        y,
                        z
                    }
                }
            }
            if (x > Vars.LAST_TASK.end[0]) Vars.LAST_TASK.end[0] = x
            if (y > Vars.LAST_TASK.end[1]) Vars.LAST_TASK.end[1] = y
            if (z > Vars.LAST_TASK.end[2]) Vars.LAST_TASK.end[2] = z
            const dist = getDistance(getEntityPos(self), {
                x,
                y,
                z
            })
            let current_block = getBlock(x, y, z)
            if (Config.CHECK_IMPORT && dist > Config.CHECK_IMPORT_RANGE) {
                tipMessage(`请前往[${x} ${y} ${z}], 距离:${dist.toFixed(2)}格`)
                break;
            }
            if (Config.THRESHOLD_TP > 0 && Vars.TASK_INFO.task_length % Config.THRESHOLD_TP === 0) {
                handleTP(x, y + Config.THRESHOLD_OFFSET, z)
                if (!Config.STOP && Config.TP_MODE != 'PACKET') {
                    Config.STOP = true
                    setTimeout(() => Config.STOP = false, realSpeed * 5 * Config.THRESHOLD_DELAY)
                }
                break;
            } else if (Config.IMPORT_TP && dist > Config.IMPORT_TP_DIST) {
                handleTP(x, y + Config.IMPORT_TP_OFFSET, z)
                if (!Config.STOP && Config.TP_MODE != 'PACKET') {
                    Config.STOP = true
                    setTimeout(() => Config.STOP = false, realSpeed * 5 * Config.IMPORT_TP_DELAY)
                }
                break;
            } else if (!Config.IMPORT_TP || (Config.IMPORT_TP && dist <= Config.IMPORT_TP_DIST)) Vars.BUILD_TASKS.shift()
            if (Config.CHECK_Y && (y > 320 || y < -64)) {
                tipMessage(`建筑超过高度限制: Y=${y}，请手动修改起点`)
                Vars.BUILD_TASKS.shift()
                break;
            };
            let index = -1,
                aux = 0,
                type = 0,
                cmds = [],
                cmd_data = [],
                mob_data = {}
            if (task.length == 5 || (typeof task[5] == 'object' && task[5] && task[5] != undefined) || (typeof task[5] == 'string')) {
                index = task[3]
                if (Config.RANDOM_BLOCKS) index = getRandomNum(0, Vars.CURRENT_PAMARS.length - 1)
                aux = task[4]
                if (typeof task[5] == 'object' && task[5].length != undefined && Config.LOAD_CONTAINER) {
                    cmd_data = task[5]
                    cmd_data.forEach(item => Vars.EXECUTE_CMDS.push(`/replaceitem block ${x} ${y} ${z} slot.container ${item.slot} ${item.ns} ${item.num} ${item.aux}`))
                }
                if (typeof task[5] == 'string' && Config.LOAD_SIGN) {
                    let text = task[5]
                    Vars.SIGN_LIST.push({
                        x,
                        y,
                        z,
                        text,
                        name: Vars.CURRENT_PAMARS[index],
                        aux
                    })
                }
                if (Config.POSTPOS_DIST > 0 && getDistance(getEntityPos(self), {
                        x,
                        y,
                        z
                    }) > Config.POSTPOS_DIST) {
                    Vars.BACKUP_LIST.push([x - Vars.BACKUP_POS[0], y - Vars.BACKUP_POS[1], z - Vars.BACKUP_POS[2], index, aux])
                    Vars.BACKUP_POS = [x, y, z]
                    tipMessage('已置后 共' + Vars.BACKUP_LIST.length + '条数据')
                    Vars.TASK_INFO.offset_pos = [pos.x, pos.y, pos.z]
                    continue;
                }
                if (Config.POSTPOSITION_LIST.includes(Vars.CURRENT_PAMARS[index]) && !Vars.ALREADY_LIST.includes(JSON.stringify([x, y, z]))) {
                    Vars.ALREADY_LIST.push(JSON.stringify([x, y, z]))
                    Vars.BACKUP_LIST.push([x - Vars.BACKUP_POS[0], y - Vars.BACKUP_POS[1], z - Vars.BACKUP_POS[2], index, aux])
                    Vars.BACKUP_POS = [x, y, z]
                    tipMessage('已置后 共' + Vars.BACKUP_LIST.length + '条数据')
                    Vars.TASK_INFO.offset_pos = [pos.x, pos.y, pos.z]
                    continue;
                }
            }
            if (task.length === 5 && typeof task[3] == 'string' && Config.LOAD_MOB) {
                mob_data = {
                    name: task[3],
                    namespace: task[4]
                }
                execCmd(`summon ${mob_data.namespace} ${mob_data.name} ${x} ${y} ${z}`)
                continue;
            }
            let block = Vars.CURRENT_PAMARS[index]
            if (Config.NO_LIQUID && typeof block == 'string') block = block.replace('following_', '')
            if (Config.EXCLUDE_IMPORT.includes(block)) continue;
            if (task.length === 6 && (typeof task[5] == 'object' && task[5] && task[5].length == undefined)) {
                aux = task[3]
                type = CommandTypeNumberEnum[task[4]]
                block = 'command_block'
                if (Config.LOAD_CMD) {
                    cmds = task[5]
                    Vars.CMD_LIST.push({
                        x,
                        y,
                        z,
                        aux,
                        type,
                        cmds
                    })
                }
            }
            if (Config.HTTP) setData('http', JSON.stringify({
                name: Vars.TASK_INFO.name,
                start: (Vars.TASK_INFO.length - Vars.BUILD_TASKS.length),
                pos: {
                    x,
                    y,
                    z
                }
            }))
            const distToEntity = getDistance(Vars.ENTITY_POS, {
                x,
                y,
                z
            })
            if (Config.AUTO_SLEEP > 0 && Vars.TASK_INFO.task_length > 0 && Vars.TASK_INFO.task_length % Config.AUTO_SLEEP === 0 && Vars.RECORD_TICK < Vars.TOTAL_TICKS) Vars.RECORD_TICK = Vars.TOTAL_TICKS + Config.SLEEP_DELAY;
            if (Config.SHOW_INFO) {
                if (Config.INFO_NAME) msglist.push('任务昵称: ' + Vars.TASK_INFO.name)
                if (Config.INFO_COMPLETE) msglist.push(`进度: [${Vars.TASK_INFO.length-Vars.BUILD_TASKS.length}/${Vars.TASK_INFO.length}] - ${((1-(Vars.BUILD_TASKS.length/Vars.TASK_INFO.length))*100).toFixed(2)}%%`)
                if (Config.INFO_SPEED) msglist.push(`速度: ${(realSpeed*20/Config.BUILD_DELAY).toFixed(2)}块/秒 预计剩余: ${(Vars.BUILD_TASKS.length/(realSpeed*20)).toFixed(2)}秒`)
                if (Config.INFO_TASK) msglist.push(`正在建造: ${Vars.CURRENT_DISPLAYS[index]} - [${x}, ${y}, ${z}]`)
                if (Config.INFO_DIST) msglist.push(`玩家距离: ${dist.toFixed(2)}格 导入实体距离: ${distToEntity.toFixed(2)}格`)
                if (Config.INFO_PROGRESS) msglist.push(`${getProgress(Vars.TASK_INFO.length-Vars.BUILD_TASKS.length,Vars.TASK_INFO.length)}`)
                if (msglist.length > 0) {
                    let color = 'r'
                    if (Config.INFO_RGB) color = "4c6e2a3b195d591b3a2e6c".split("")[Vars.TOTAL_TICKS % 22]
                    if (Config.TIP_MODE === "Game") _minecraft.showTipMessage("§f <<<§r §b建筑工具 - INFO §f>>>§r\n§" + color + msglist.join("\n§" + color))
                    if (Config.TIP_MODE === "Script") updateTextContent(Vars.TIP_ID, "§f <<<§r §b建筑工具 - INFO §f>>>§r\n§" + color + msglist.join('\n§' + color))
                    msglist = []
                }
            }
            if (Config.TASK_ANALYSE) {
                Vars.OUTPUT_INFO += `类型:${task.length} - ${Vars.TASK_INFO.length-Vars.BUILD_TASKS.length}, 坐标:${x} ${y} ${z}, 坐标偏移:${task.slice(0,3)}, 上一坐标:${Vars.TASK_INFO.offset_pos}\n任务进度:${Vars.TASK_INFO.length-Vars.BUILD_TASKS.length}, 方块:${block} - ${aux} 方块索引:${index}\n命令方块数据:${type}, ${JSON.stringify(cmds)}  生物数据:${JSON.stringify(mob_data)} 容器数据:${JSON.stringify(cmd_data)}\n`
                if (!Vars.BLOCKS_NUM[block + '_' + aux]) Vars.BLOCKS_NUM[block + '_' + aux] = 1
                Vars.BLOCKS_NUM[block + '_' + aux]++
            }
            const condition = ((!Config.ERROR_FIX && (!Config.FILL_IMPORT || (Config.FILLMODE != 'BOOST' || Config.FILLMODE != 'PREDICT'))) || current_block.namespace != ('minecraft:' + block))
            if ((Config.FILLMODE != 'Z-AXIS-FILL' || !Config.FILL_IMPORT) && ((Config.ERROR && getRandomNum(0, 100) > (100 - (Vars.BUILD_TASKS.length / Vars.TASK_INFO.length) * 100)) || !Config.ERROR)) Vars.TASK_INFO.offset_pos = [pos.x, pos.y, pos.z]
            if (!condition) continue
            Vars.TASK_INFO.task_length++
            if (Config.DUMP_JS) Vars.HAS_CMD.push(`setblock ${x} ${y} ${z} ${block} ${aux2parameter(aux,block)} ${Config.REPLACE_AIR?'keep':''}`)
            if (Config.SERVER && !Config.FAKE_MODE) {
                if (distToEntity > Config.ENTITY_TP_RANGE || Config.FILL_IMPORT) {
                    Vars.ENTITY_POS = {
                        x,
                        y,
                        z
                    }
                    if (Config.SERVER_ABSOLUTE) execCmd(`tp @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] ${x} ${y} ${z}`)
                    else execCmd(`execute as @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] at @s run tp ~${x-Vars.BACKUP_DATA.pos.x+Vars.ENTITY_POS_OFFSET.x} ~${y-Vars.BACKUP_DATA.pos.y+Vars.ENTITY_POS_OFFSET.y} ~${z-Vars.BACKUP_DATA.pos.z+Vars.ENTITY_POS_OFFSET.z}`)
                }
                if (Config.SERVER_ANTI) {
                    let entity = getEntityList().filter(id => {
                        if (getEntityNamespace(id) === 'minecraft:' + Config.SERVER_MOB && getEntityName(id) === Config.SERVER_NAME) return true
                    })[0]
                    let distToEntity2 = getDistance(getEntityPos(entity), {
                        x,
                        y,
                        z
                    })
                    if (entity && distToEntity2 > Config.SERVER_ERROR) {
                        execCmd(`tp @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] ${x} ${y} ${z}`)
                        clientMsg('检测到坐标偏移 已自动修补 距离: ' + distToEntity2.toFixed(2))
                    }
                }
                Vars.ENTITY_POS_OFFSET = {
                    x: x - Vars.ENTITY_POS.x,
                    y: y - Vars.ENTITY_POS.y,
                    z: z - Vars.ENTITY_POS.z,
                }
                if (Config.FILL_IMPORT && Config.FILLMODE == 'BOOST') execCmd(`execute as @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] at @srun fill ~${Vars.ENTITY_POS_OFFSET.x}~${Vars.ENTITY_POS_OFFSET.y}~${Vars.ENTITY_POS_OFFSET.z} ~${Config.FILL_XZ+Vars.ENTITY_POS_OFFSET.x}~${Config.FILL_Y-1+Vars.ENTITY_POS_OFFSET.y}~${Config.FILL_XZ+Vars.ENTITY_POS_OFFSET.z} ${block} ${aux2parameter(aux,block)}`)
                else if (Config.FILL_IMPORT && Config.FILLMODE == 'Z-AXIS-FILL') {
                    if (!task.length || task.length !== 5 || task[2] !== 1 || task[0] !== 0 || task[1] !== 0 || (Vars.BUILD_TASKS[0].length !== 5 || Vars.BUILD_TASKS[0][2] !== 1 || Vars.BUILD_TASKS[0][0] !== 0 || Vars.BUILD_TASKS[0][1] !== 0) || index !== Vars.BUILD_TASKS[0][3] || aux !== Vars.BUILD_TASKS[0][4]) {
                        execCmd(`execute as @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] at @s run setblock ~${Vars.ENTITY_POS_OFFSET.x}~${Vars.ENTITY_POS_OFFSET.y}~${Vars.ENTITY_POS_OFFSET.z} ${block} ${aux2parameter(aux,block)}`)
                        Vars.TASK_INFO.offset_pos = [pos.x, pos.y, pos.z]
                        Vars.BACKUP_DATA = {
                            task,
                            pos: {
                                x,
                                y,
                                z
                            }
                        }
                        continue;
                    }
                    var fillProgress = 0
                    inner: for (let i = 0; i < Config.FILL_LENGTH; i++) {
                        if (Vars.BUILD_TASKS[i].length === 5 && Vars.BUILD_TASKS[i] != undefined && Vars.BUILD_TASKS[i][2] == 1 && Vars.BUILD_TASKS[i][3] === index && Vars.BUILD_TASKS[i][0] == 0 && Vars.BUILD_TASKS[i][1] == 0) fillProgress++;
                        else {
                            if (fillProgress === 0) break inner;
                            execCmd(`execute as @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] at @s run fill ~${Vars.ENTITY_POS_OFFSET.x}~${Vars.ENTITY_POS_OFFSET.y}~${Vars.ENTITY_POS_OFFSET.z} ~${Vars.ENTITY_POS_OFFSET.x}~${Vars.ENTITY_POS_OFFSET.y}~${fillProgress+Vars.ENTITY_POS_OFFSET.z} ${block} ${aux2parameter(aux,block)}`)
                            if (Config.SERVER_ABSOLUTE) execCmd(`tp @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] ${x} ${y} ${z+fillProgress}`)
                            else execCmd(`execute as @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] at @s run tp ~~~${fillProgress+Vars.ENTITY_POS_OFFSET.z}`)
                            Vars.TASK_INFO.offset_pos = [pos.x, pos.y, pos.z + fillProgress]
                            Vars.BACKUP_DATA = {
                                task: Vars.BUILD_TASKS[fillProgress],
                                pos: {
                                    x,
                                    y,
                                    z: z + fillProgress
                                }
                            }
                            Vars.BUILD_TASKS.splice(0, Math.min(fillProgress, Vars.BUILD_TASKS.length))
                            fillProgress = 0
                            break inner;
                        }
                    }
                } else execCmd(`execute as @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] at @s run setblock ~${Vars.ENTITY_POS_OFFSET.x}~${Vars.ENTITY_POS_OFFSET.y}~${Vars.ENTITY_POS_OFFSET.z} ${block} ${aux2parameter(aux,block)}`)
            } else if (Config.FAKE_MODE) setBlock(x, y, z, 'minecraft:' + block, aux)
            else if (Config.FILL_IMPORT && Config.FILLMODE == 'BOOST') execCmd(`fill ${x} ${y} ${z} ${x+Config.FILL_XZ} ${y+Config.FILL_Y-1} ${z+Config.FILL_XZ} ${block} ${aux2parameter(aux,block)}`)
            else if (Config.FILL_IMPORT && Config.FILLMODE == 'Z-AXIS-FILL') {
                if (!task.length || task.length !== 5 || task[2] !== 1 || task[0] !== 0 || task[1] !== 0 || (Vars.BUILD_TASKS[0].length !== 5 || Vars.BUILD_TASKS[0][2] !== 1 || Vars.BUILD_TASKS[0][0] !== 0 || Vars.BUILD_TASKS[0][1] !== 0) || index !== Vars.BUILD_TASKS[0][3] || aux !== Vars.BUILD_TASKS[0][4]) {
                    execCmd(`setblock ${x} ${y} ${z} ${block} ${aux2parameter(aux,block)} ${Config.REPLACE_AIR?'keep':''}`)
                    Vars.TASK_INFO.offset_pos = [pos.x, pos.y, pos.z]
                    Vars.BACKUP_DATA = {
                        task,
                        pos: {
                            x,
                            y,
                            z
                        }
                    }
                    continue;
                }
                var fillProgress = 0
                inner: for (let i = 0; i < Config.FILL_LENGTH; i++) {
                    if (Vars.BUILD_TASKS[i].length === 5 && Vars.BUILD_TASKS[i] != undefined && Vars.BUILD_TASKS[i][2] == 1 && Vars.BUILD_TASKS[i][3] === index && Vars.BUILD_TASKS[i][0] == 0 && Vars.BUILD_TASKS[i][1] == 0) fillProgress++;
                    else {
                        if (fillProgress === 0) break inner;
                        execCmd(`fill ${x} ${y} ${z+1} ${x} ${y} ${z + fillProgress} ${block} ${aux2parameter(aux,block)}`)
                        Vars.TASK_INFO.offset_pos = [pos.x, pos.y, pos.z + fillProgress]
                        Vars.BACKUP_DATA = {
                            task: Vars.BUILD_TASKS[fillProgress],
                            pos: {
                                x,
                                y,
                                z: z + fillProgress
                            }
                        }
                        Vars.BUILD_TASKS.splice(0, Math.min(fillProgress, Vars.BUILD_TASKS.length))
                        fillProgress = 0
                        break inner;
                    }
                }
            } else execCmd(`setblock ${x} ${y} ${z} ${block} ${aux2parameter(aux,block)} ${Config.REPLACE_AIR?'keep':''}`)
            if (!Config.FILLMODE == 'Z-AXIS-FILL' || !Config.FILL_IMPORT) Vars.BACKUP_DATA = {
                task,
                pos: {
                    x,
                    y,
                    z
                }
            }
            if (!Vars.BACKUP_DATA) continue;
            Vars.BACKUP_DATA.task.x = x - Vars.BACKUP_OFFSET[0]
            Vars.BACKUP_DATA.task.y = y - Vars.BACKUP_OFFSET[1]
            Vars.BACKUP_DATA.task.z = z - Vars.BACKUP_OFFSET[2]
            Vars.BACKUP_OFFSET = [x, y, z]
        }
    }
    for (let i = 0; i < Math.min(realSpeed, Vars.SOUND_DATA.length); i++) {
        if (Vars.SOUND_DATA.length > 0) {
            const task = Vars.SOUND_DATA.shift();
            let name = task.sound,
                level = task.level
            let x = Vars.POS_DATA.x + Vars.SOUND_POS.x,
                y = Vars.POS_DATA.y + Vars.SOUND_POS.y,
                z = Vars.POS_DATA.z + Vars.SOUND_POS.z
            if (Vars.IS_FIRST_CMD) {
                if (Vars.SOUND_POS.x === (Vars.SOUND_BOOL[0] ? 0 : Vars.CUBE_EDGE_LENGTH)) {
                    if (Vars.SOUND_POS.z === (Vars.SOUND_BOOL[1] ? 0 : Vars.CUBE_EDGE_LENGTH)) execCmd(`setblock ${x} ${y} ${z} command_block 1`)
                    else execCmd(`setblock ${x} ${y} ${z} command_block ${Vars.SOUND_BOOL[1]?2:3}`)
                } else execCmd(`setblock ${x} ${y} ${z} command_block ${Vars.SOUND_BOOL[0]?4:5}`)
            } else execCmd(`setblock ${x} ${y} ${z} command_block 5`)

            Vars.CMD_LIST.push({
                x,
                y,
                z,
                type: Vars.IS_FIRST_CMD ? 'Chain' : 'Tick',
                cmds: {
                    auto: Vars.IS_FIRST_CMD,
                    condition: false,
                    cmd: `execute as ${Config.SOUND_TARGET} run playsound ${((name+'').replace('81','note').replace('note',Config.RANDOM_TONE?TONES[getRandomNum(0,TONES.length-1)]:Config.TONE_COLOUR))} @s ~ ~ ~ 1.0 ${Math.pow(2,(level%256-12)/12).toFixed(4)} 1.0`,
                    name: (name + ''),
                    delay: (task.tick - Vars.LAST_SOUND_TICK)
                }
            })

            if (Config.SHOW_PROGRESS) {
                execCmd(`setblock ${Vars.POS_DATA.x+Vars.SOUND_POS.progress} ${Vars.POS_DATA.y} ${Vars.POS_DATA.z-2} command_block 5`)
                Vars.CMD_LIST.push({
                    x: Vars.POS_DATA.x + Vars.SOUND_POS.progress,
                    y: Vars.POS_DATA.y,
                    z: Vars.POS_DATA.z - 2,
                    type: (Vars.IS_FIRST_CMD ? 'Chain' : 'Tick'),
                    cmds: {
                        auto: Vars.IS_FIRST_CMD,
                        condition: false,
                        cmd: `title ${Config.SOUND_TARGET} actionbar "<== §a正在播放: §r${Vars.TASK_INFO.name.replace('.json','')} §r== §e进度: §a${Vars.TASK_INFO.length-Vars.SOUND_DATA.length}/${Vars.TASK_INFO.length} §r- §a${((1-(Vars.SOUND_DATA.length/Vars.TASK_INFO.length))*100).toFixed(2)}% §r- ${Math.round(task.tick/20)}秒 §r==>"`,
                        name: (Math.round(task.tick / 20) + ''),
                        delay: (task.tick - Vars.LAST_SOUND_TICK)
                    }
                })
                Vars.SOUND_POS.progress++;
            }
            if (Vars.SOUND_BOOL[0]) {
                if (Vars.SOUND_POS.x > 0) Vars.SOUND_POS.x--
                else {
                    Vars.SOUND_POS.z++
                    Vars.SOUND_BOOL[0] = false
                }
            } else {
                if (Vars.SOUND_POS.x < Vars.CUBE_EDGE_LENGTH) Vars.SOUND_POS.x++
                else {
                    Vars.SOUND_POS.z++
                    Vars.SOUND_BOOL[0] = true
                }
            }
            if (Vars.SOUND_POS.z > Vars.CUBE_EDGE_LENGTH) {
                Vars.SOUND_POS.y++
                Vars.SOUND_BOOL[1] = !Vars.SOUND_BOOL[1]
                Vars.SOUND_POS.z = 0
                Vars.SOUND_POS.x = Vars.SOUND_BOOL[0] ? 0 : Vars.CUBE_EDGE_LENGTH
                Vars.SOUND_BOOL[0] = !Vars.SOUND_BOOL[0]
            }
            Vars.IS_FIRST_CMD = true
            if (Config.SHOW_INFO) {
                if (Config.INFO_NAME) msglist.push('任务昵称: ' + Vars.TASK_INFO.name)
                if (Config.INFO_COMPLETE) msglist.push(`进度: [${Vars.TASK_INFO.length-Vars.SOUND_DATA.length}/${Vars.TASK_INFO.length}] - ${((1-(Vars.SOUND_DATA.length/Vars.TASK_INFO.length))*100).toFixed(2)}%%`)
                if (Config.INFO_SPEED) msglist.push(`速度: ${(realSpeed*20/Config.BUILD_DELAY).toFixed(2)}块/秒 预计剩余: ${(Vars.SOUND_DATA.length/(realSpeed*20)).toFixed(2)}秒`)
                if (Config.INFO_TASK) msglist.push(`正在设置: ${name} - [${x}, ${y}, ${z}]`)
                if (Config.INFO_PROGRESS) msglist.push(`${getProgress(Vars.TASK_INFO.length-Vars.SOUND_DATA.length,Vars.TASK_INFO.length)}`)
                if (msglist.length > 0) {
                    let color = 'r'
                    if (Config.INFO_RGB) color = "4c6e2a3b195d591b3a2e6c".split("")[Vars.TOTAL_TICKS % 22]
                    if (Config.TIP_MODE === "Game") _minecraft.showTipMessage("§f <<<§r §b建筑工具 - INFO §f>>>§r\n§" + color + msglist.join("\n§" + color))
                    if (Config.TIP_MODE === "Script") updateTextContent(Vars.TIP_ID, "§f <<<§r §b建筑工具 - INFO §f>>>§r\n§" + color + msglist.join('\n§' + color))
                    msglist = []
                }
            }
            Vars.LAST_SOUND_TICK = task.tick
            Vars.TASK_INFO.task_length++
        }
    }
    if (Vars.STARTING && Vars.BUILD_TASKS.length === 0 && Vars.SOUND_DATA.length === 0 && !Config.SURVIVAL_MODE) {
        Config.CMD_AFTER.forEach(cmd => execCmd(cmd))
        if (Vars.BACKUP_LIST.length > 0) {
            execCmd(`tp @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"] ${Vars.POS_DATA.x} ${Vars.POS_DATA.y} ${Vars.POS_DATA.z}`)
            Vars.BUILD_TASKS = Vars.BACKUP_LIST
            Vars.TASK_INFO.length = Vars.BACKUP_LIST.length
            Vars.BACKUP_LIST = []
            if (Config.DUMP_POSTPONE) {
                saveBlocksData('PostPone-' + Vars.TASK_INFO.name, false)
                clientMsg('已导出置后的文件')
            }
            return
        } else Vars.STARTING = false
        if (Config.INFO_IMPORT_BOOST) {
            _minecraft.setTitle('§a§l§o导入完成 共计: §r' + Vars.TASK_INFO.task_length + '个方块')
            _minecraft.setSubtitle('§b§l§o用时: §r' + ((Date.now() - Vars.TASK_INFO.time) / 1000) + '秒')
        }
        if (Config.CAMERA_MODE) {
            setCameraOffset(0, 0, 0)
            setCameraAnchor(0, 0, 0)
        }
        if (Vars.CMD_LIST.length > 0) {
            if (Config.CONFIRM_CMD) setCmdMenu()
            else setTimeout(() => Vars.IS_CMD = true, realSpeed * 5)
        }
        if (Config.TASK_ANALYSE) {
            Vars.OUTPUT_INFO += `\n执行命令总数: ${Vars.CMD_COUNT.failed+Vars.CMD_COUNT.success}，失败-成功数量: ${Vars.CMD_COUNT.failed} - ${Vars.CMD_COUNT.success}\n失败原因:${Vars.CMD_TYPE.error.join('\n')}\n执行命令类型: ${Vars.CMD_TYPE.type.join('\n')}`
            Vars.OUTPUT_INFO += `\n导入用时:${((Date.now() - Vars.TASK_INFO.time) / 1000)}秒 方块总数:${Vars.TASK_INFO.task_length}个\n`
            if (Object.keys(Vars.BLOCKS_NUM).length > 0) {
                Vars.OUTPUT_INFO += '\n'
                for (let key in Vars.BLOCKS_NUM) Vars.OUTPUT_INFO += `方块_特殊值:${key}，数量:${Vars.BLOCKS_NUM[key]}个\n`
            }
            _fs.write(`${Vars.PATHS.analyse}/分析 - ${Vars.TASK_INFO.name}.txt`, Vars.OUTPUT_INFO);
            Vars.BLOCKS_NUM = {}
            clientMsg('已导出建筑分析文件')
        }
        if (Config.DUMP_JS) {
            var js_data = ""
            Vars.HAS_CMD.forEach(cmd => js_data += (`executeCommand("${cmd}")\n`))
            _fs.write(`${_app.getResource()}/script/${Vars.TASK_INFO.name}.js`, js_data);
            Vars.HAS_CMD = []
            clientMsg('已导出建筑JS文件')
        }
        execCmd(`tickingarea remove Rebirth_tmp`)
        if (Config.SERVER) {
            execCmd(`kill @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"]`)
            if (defaultConfig.导入命令方块生成时间 === '导入时') execCmd(`tickingarea remove IMPORT_CMD`)
            execCmd(`tellraw @a {"rawtext":[{"text":"§eRebirth_Bot 退出了游戏"}]}`)
        }
        if (Config.CRASH_HUNTER) setData('crash_reason', 'null')
        Config.KILL_LIST.forEach(type => '/kill @e[type=' + type + ']')
        if (Config.TIP_MODE >= 1) updateTextContent(Vars.TIP_ID, '')
    }
    if (Config.TIP_MODE === 'Script') {
        updateTextPosition(Vars.TIP_ID, screen.screenWidth * Config.TIP_X / 100, screen.screenHeight * Config.TIP_Y / 100)
        updateTextColor(Vars.TIP_ID, Config.TIP_R / 100, Config.TIP_G / 100, Config.TIP_B / 100, Config.TIP_A / 100)
        updateTextScale(Vars.TIP_ID, Config.TIP_SIZE)
    } else updateTextContent(Vars.TIP_ID, '')
    if ((Vars.CMD_LIST.length === 0 && Vars.EXECUTE_CMDS.length === 0) || Vars.BUILD_TASKS.length > 0 || Vars.SOUND_DATA.length > 0) return;

    if (!Vars.IS_CMD && Vars.EXECUTE_CMDS.length === 0) return;
    for (let j = 0; j < Math.min(Config.BUILD_TASKS_CMD, Math.max(Vars.CMD_LIST.length, Vars.EXECUTE_CMDS.length)); j++) {
        if (Vars.EXECUTE_CMDS.length > 0) {
            const cmd = Vars.EXECUTE_CMDS.shift();
            if (cmd != undefined) execCmd(cmd)
            continue;
        }
        if (Vars.CMD_LIST.length === 0) break;
        const task = Vars.CMD_LIST[0]
        if (Config.CRASH_HUNTER) setData('crash_reason', JSON.stringify(task))
        if (Vars.CMD_LIST.length === 1) setData('crash_reason', 'null')
        if (task.cmds == undefined || task.x == undefined || task.y == undefined || task.z == undefined) {
            clientMsg(`任务解析失败\n Cannot analysis command: ${JSON.stringify(task)}`)
            continue;
        }
        if (task.cmds.auto == undefined && task.cmds.condition == undefined && task.cmds.cmd == undefined && task.cmds.name == undefined && task.cmds.delay == undefined) {
            clientMsg(`指令解析失败\n Cannot analysis command: ${JSON.stringify(task.cmds)}`)
            continue;
        }
        let cmd = old2New(task.cmds.cmd)
        let data = {
            mode: task.type,
            isRedStoneMode: !task.cmds.auto,
            isConditional: task.cmds.condition,
            command: cmd,
            name: task.cmds.name,
            tickDelay: task.cmds.delay,
            executeOnFirstTick: (Config.CMD_FIRST || false),
            shouldTrackOutput: (Config.CMD_OUTPUT || false),
            lastOutput: "BuildToolRebirth"
        }
        if (Config.FIX_CMD && task.aux != undefined) {
            const block = getBlock(task.x, task.y, task.z)
            if (!block.namespace.includes('command_block') && task.aux) execCmd(`setblock ${task.x} ${task.y} ${task.z} command_block ${task.aux}`)
            else Vars.CMD_LIST.shift()
        } else Vars.CMD_LIST.shift()
        setCmdBlock(task.x, task.y, task.z, data)
        tipMessage(`正在设置命令: ${Vars.CMD_LIST.length}, 坐标: [${task.x}, ${task.y}, ${task.z}]\n指令: ${cmd}`)
        if (Config.AUTO_TAG && cmd.includes('tag=')) {
            let tags = getText(cmd, 'tag=', ',')
            let tags_b = getText(cmd, 'tag=', ']')
            let reals = (tags_b.length > tags.length) ? tags : tags_b
            reals = reals.replace('!', '')
            if (Vars.HAS_TAG.includes(reals)) continue
            else Vars.HAS_TAG.push(reals)
        }
        if (Vars.CMD_LIST.length === 0 && Vars.HAS_TAG.length > 0) {
            let forms = {
                type: "custom_form",
                title: "§b自动TAG标签",
                content: Vars.HAS_TAG.map(tag => ({
                    type: "toggle",
                    text: ('§b' + tag),
                    'default': !Config.TAG_KEYWORD.some(key => tag.includes(key))
                }))
            }
            addForm(JSON.stringify(forms), (...args) => {
                for (let i in args) {
                    if (args[i]) execCmd(`/tag @s add ${Vars.HAS_TAG[i]}`)
                }
                Vars.HAS_TAG = []
            })
        }
        if (!Config.SCOREBOARD || !cmd.includes('scoreboard')) continue

        let scores_a = getText(cmd, 'scores={', '=')
        if (Vars.HAS_SCORE.includes(scores_a)) continue;
        if (scores_a !== '') execCmd("scoreboard objectives add " + scores_a + " dummy " + scores_a)
        if (!Vars.HAS_SCORE.includes(scores_a)) Vars.HAS_SCORE.push(scores_a)

        let scores = cmd.split(' ')
        if (Vars.HAS_SCORE.includes(scores)) continue;
        if (scores.length < 5) continue
        if (!Vars.HAS_SCORE.includes(scores)) Vars.HAS_SCORE.push(scores)
        if (scores[1] == "players" && (scores[2] == "add" || scores[2] == "set")) execCmd("scoreboard objectives add " + scores[4] + " dummy " + scores[4])
    }

    if (Vars.CMD_LIST.length === 0 && Vars.EXECUTE_CMDS.length === 0) Vars.IS_CMD = false
}

function onCommandOutputEvent(type, args, value) {
    if (!args || typeof args[1] != 'object') return true
    if (!value && (Vars.BUILD_TASKS.length > 0 || Vars.SOUND_DATA.length > 0) && args[1].key === 'commands.generic.noTargetMatch') {
        Vars.BUILD_TASKS = []
        Vars.CMD_LIST = []
        Vars.SOUND_DATA = []
        Vars.SIGN_LIST = []
        Vars.IS_CMD = false
        Vars.STARTING = false
        execCmd(`setblock ${Vars.POS_DATA.x} -64 ${Vars.POS_DATA.z} air`)
        execCmd(`kill @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"]`)
        if (defaultConfig.导入命令方块生成时间 === '导入时') execCmd(`tickingarea remove IMPORT_CMD`)
        execCmd(`tickingarea remove Rebirth_tmp`)
        clientMsg('无法匹配到导入实体目标，自动取消任务\n请检查是否存在清除实体的命令方块')
    }
    if (Config.TASK_ANALYSE) {
        if (value) Vars.CMD_COUNT.success++;
        else Vars.CMD_COUNT.failed++
        if (!value && !Vars.CMD_TYPE.error.includes(args[1].key)) Vars.CMD_TYPE.error.push(args[1].key)
    }
    if (Config.INFO_ERROR && !value) clientMsg(`§c§o出现错误: §r${args[1].key}\n§r任务数据:${JSON.stringify(Vars.BACKUP_DATA.task)}`)
    if (Config.RETRY && !value && args[1].key == 'commands.setblock.outOfWorld') {
        const {
            task,
            pos
        } = Vars.BACKUP_DATA
        handleTP(pos.x, pos.y, pos.z)
        Vars.BACKUP_LIST.push(task)
        tipMessage('已添加至重试列表 共' + Vars.BACKUP_LIST.length + '条数据')
    }
    return ((Config.INTERCEPT_OUTPUT && (Vars.BUILD_TASKS.length > 0 || Vars.ASSIST_LIST.length > 0)) || !value);
}

function onReceiveServerPacketEvent(id, name) {
    if (Config.BETTER_MODE) return true
    return (id == 9 && Vars.CMD_LIST.length > 0 && Config.INTERCEPT_SETCMD) || (id == 79 && Config.INTERCEPT_OUTPUT && (Vars.ASSIST_LIST.length > 0 || Vars.BUILD_TASKS.length > 0));
}

function onSendServerPacketEvent(id, name) {
    if ((Vars.BUILD_TASKS.length > 0 || Vars.CMD_LIST.length > 0 || Vars.ASSIST_LIST.length > 0) && Config.BETTER_MODE && ![77, 78, 303].includes(id)) return true
}

function onCallModuleEvent(fun) {
    if (fun.fun != 'build_tool_rebirth') return
    if (Object.keys(fun).length === 3 && fun.value !== Config.ENABLE) {
        let value = fun.value
        Config.ENABLE = value;
        addCustomArrayList('build_tool_rebirth', '', '', value);
        clientMsg('建筑工具Rebirth 已' + (value ? '启用' : '禁用'));
        return;
    }
    if (!Config.ENABLE) return;
    if (fun.key != undefined) {
        const {
            key
        } = fun
        if (key == 'EXIT') {
            clientMsg('§c已退出脚本')
            addCustomArrayList('build_tool_rebirth', '建筑工具 - 加载成功', '建筑工具 - 加载成功', false);
            _safeExit()
        }
        if (key == 'SEARCH') {
            const menu = `{"type":"custom_form","title":"§b搜索","content":[{"type":"input","text":"§b名称:","default":""},{"type": "dropdown","text": "§b搜索类型","options": ["§b建筑文件", "§b音乐文件"]}]}`;
            addForm(menu, function(name, index) {
                const path = (index == 0) ? Vars.PATHS.data : Vars.PATHS.sound
                let files = _fs.list(path).filter(file => file.name.includes(name))
                if (index == 0) showListMenu(files)
                if (index == 1) showSoundMenu(files)
            })
        }
        if (key == 'DUMP_BUILDINGS') showPosMenu()
        if (key == 'LEAVE') _world.leaveWorld()
        if (key == 'COPY_POS') {
            _input.buttonDown('button.copy_current_coordinates')
            _app.showToast('已复制当前坐标至粘贴板')
        }
        if (key.includes('TP_MAP_S')) {
            const pos = getEntityPos(getLocalPlayerUniqueID())
            execCmd(`tp ${Math.floor(pos.x/128)*128-64} ~ ${Math.floor(pos.z/128)*128-64}`)
        }
        if (key == 'UNDO') {
            if (Vars.LAST_TASK.start.every(pos => pos == 0) && Vars.LAST_TASK.end.every(pos => pos == 0)) return clientMsg('没有上次导入记录')
            for (let dy = Vars.LAST_TASK.start[1]; dy <= Vars.LAST_TASK.end[1]; dy += 30) {
                for (let dx = Vars.LAST_TASK.start[0]; dx <= Vars.LAST_TASK.end[0]; dx += 30) {
                    for (let dz = Vars.LAST_TASK.start[2]; dz <= Vars.LAST_TASK.end[2]; dz += 30) execCmd(`/fill ${dx} ${dy} ${dz} ${dx+Math.min(Vars.LAST_TASK.end[0] - dx, 30)} ${dy+Math.min(Vars.LAST_TASK.end[1] - dy, 30)} ${dz+Math.min(Vars.LAST_TASK.end[2] - dz, 30)} air`)
                }
            }
            Vars.LAST_TASK.start = [0, 0, 0]
            Vars.LAST_TASK.end = [0, 0, 0]
            clientMsg('已撤销导入')
        }
        if (key == 'SELECT_BUILDINGS') showListMenu()
        if (key == 'SELECT_SOUND') showSoundMenu()
        if (key == 'CANCEL') {
            Vars.BUILD_TASKS = []
            Vars.CMD_LIST = []
            Vars.SOUND_DATA = []
            Vars.SIGN_LIST = []
            Vars.IS_CMD = false
            Vars.STARTING = false
            execCmd(`setblock ${Vars.POS_DATA.x} -64 ${Vars.POS_DATA.z} air`)
            execCmd(`kill @e[type=${Config.SERVER_MOB},name="${Config.SERVER_NAME}"]`)
            if (defaultConfig.导入命令方块生成时间 === '导入时') execCmd(`tickingarea remove IMPORT_CMD`)
            execCmd(`tickingarea remove Rebirth_tmp`)
            clientMsg('已取消任务')
        }
        if (key == 'CANCEL_EXPORT') {
            Vars.IS_EXPORT = false
            Vars.EXPORT_LIST.push({
                ep: Vars.EXPORT_EP
            })
            Vars.EXPORT_LIST.push(Vars.EXPORT_PARMAS)
            Vars.EXPORT_PARMAS = []
            Vars.EXPORT_SP = []
            Vars.EXPORT_CP = []
            Vars.EXPORT_EP = []
            Vars.EXPORT_INFO = {
                length: 0,
                current: 0
            }
            Vars.EXPORT_NAME = ''
            Vars.EXPORT_LIST = []
            if (Config.CRASH_HUNTER) setData('crash_reason', 'null')
            clientMsg('已取消导出任务')
        }
        if (key == 'END_TASK') {
            Vars.BUILD_TASKS = []
            clientMsg('已结束任务')
        }
        if (key == 'CANCEL_ASSIST') {
            Vars.IS_ASSIST = false
            Config.ASSIST_FIRST = false
            Vars.CURRENT_ASSIST_NUM = 0
            Vars.ASSIST_HAS = []
            Vars.ASSIST_LIST = []
            clientMsg('已取消助手任务')
        }
        if (key == 'CANCEL_SMART') {
            Vars.IS_DUMP = false
            Vars.CURRENT_DUMP_NUM = 0
            Vars.DUMP_OUTPUT.push(Vars.DUMP_PARMAS)
            Vars.DUMP_PARMAS = []
            Vars.DUMP_DISPLAYS = []
            Vars.DUMP_HAS = []
            Vars.DUMP_OUTPUT = []
            clientMsg('已取消导出任务')
        }
        if (key == 'LOAD') {
            const menu = {
                type: 'form',
                title: '配置文件',
                content: '选择要加载的配置',
                buttons: [{
                    text: '没有配置'
                }]
            };
            const files = _fs.list(Vars.PATHS.cfg);
            for (let j = 0; j < files.length; j++) {
                menu.buttons[j] = {
                    text: files[j].name,
                    image: {
                        type: 'path',
                        data: 'textures/ui/gear.png'
                    }
                }
            }
            const json = JSON.stringify(menu);
            addForm(json, function(index) {
                if (files.length > 0 && index >= 0) {
                    let c = JSON.parse(readFile(files[index].path))
                    for (let i in c) {
                        if (Config[i]) Config[i] = c[i]
                    }
                    clientMsg(`加载配置${files[index].name}成功`)
                }
            });
        }
        if (key == 'IMPORT_WORLD') {
            const menu = {
                type: 'form',
                title: '§b1.存档文件',
                content: '§b选择要导入的存档',
                buttons: [{
                    text: '§b没有存档'
                }]
            };
            const files = _fs.list(Vars.PATHS.world);
            for (let j = 0; j < files.length; j++) {
                if (files[j].isFile) continue;
                const name = readFile(files[j].path + '/levelname.txt')
                menu.buttons[j] = {
                    text: ('§b' + name),
                    image: {
                        type: 'path',
                        data: 'textures/ui/default_world.png'
                    }
                }
            }
            const json = JSON.stringify(menu);
            addForm(json, function(index) {
                if (files.length > 0 && index >= 0) {
                    const menu2 = {
                        type: 'form',
                        title: '§b2.世界列表',
                        content: '§b选择被替换的世界',
                        buttons: [{
                            text: '§b没有世界'
                        }]
                    };
                    const files2 = _fs.list('/storage/emulated/0/Android/data/com.netease.x19/files/minecraftWorlds');
                    for (let i = 0; i < files2.length; i++) {
                        if (files2[i].isFile) continue;
                        const name = readFile(files2[i].path + '/levelname.txt')
                        menu2.buttons[i] = {
                            text: ('§b' + name),
                            image: {
                                type: 'path',
                                data: 'textures/ui/default_world.png'
                            }
                        }
                    }
                    const json = JSON.stringify(menu2);
                    addForm(json, function(index2) {
                        if (files2.length > 0 && index2 >= 0) {
                            const db_list_new = _fs.list(files[index].path + '/db')
                            db_list_new.forEach(file => {
                                _fs.remove(files2[index2].path + '/db/' + file.name)
                                file_copy(file.path, files2[index2].path + '/db/' + file.name)
                            })
                            _fs.remove(files2[index2].path + '/levelname.txt')
                            _fs.remove(files2[index2].path + '/level.dat')
                            file_copy(files[index].path + '/db', files2[index2].path + '/db')
                            file_copy(files[index].path + '/levelname.txt', files2[index2].path + '/levelname.txt')
                            file_copy(files[index].path + '/level.dat', files2[index2].path + '/level.dat')
                            clientMsg('导入成功')
                        }
                    });
                }
            });
        }
        if (key === "SAVE") {
            const menu = `{"type":"custom_form","title":"§b导出配置","content":[{"type":"input","text":"§b名称:","default":"建筑工具Rebirth_配置_${Date.now()}"}]}`;
            addForm(menu, function(name) {
                _fs.write(Vars.PATHS.cfg + '/' + name + '.json', JSON.stringify(Config, null, 4))
                clientMsg("保存成功")
            })
        } // 保存配置
        if (key == 'EXECUTE' && Config.EXECUTE_CMD) {
            execBypassCmd(Config.EXECUTE_CMD)
            clientMsg('已发送执行指令请求')
        }
        if (key == 'IMPORT_HTTP') {
            const http_data = getData('http', '')
            if (http_data === '') {
                clientMsg('没有断点续传记录')
                return;
            }
            clientMsg('已恢复上次导入的进度')
            setData('http', '')
            const info = JSON.parse(http_data)
            Vars.POS_DATA = info.pos;
            Vars.BACKUP_DATA.pos = info.pos;
            Vars.BUILD_TASKS = loadBlocksData(info.name, Number(info.start));
        }
        if (key == 'PLACE_CMD') {
            const {
                x,
                y,
                z
            } = getPlayerBlockPos(getLocalPlayerUniqueID())
            createTickingArea(x, y, z)
            clientMsg('已放置导入命令方块')
        }
        if (key == 'POINT_COPY') {
            const {
                x,
                y,
                z
            } = getPlayerBlockPos(getLocalPlayerUniqueID())
            if (Vars.POS_DATA.x === 0 && Vars.POS_DATA.y === 0 && Vars.POS_DATA.z === 0) {
                Vars.POS_DATA.x = x;
                Vars.POS_DATA.y = y;
                Vars.POS_DATA.z = z;
                clientMsg('已经选择起点，请选择终点')
            } else if (Vars.POS_DATA.x !== x || Vars.POS_DATA.y !== y || Vars.POS_DATA.z !== z) {
                showPosMenu(Vars.POS_DATA, {
                    x,
                    y,
                    z
                })
                Vars.POS_DATA.x = 0;
                Vars.POS_DATA.y = 0;
                Vars.POS_DATA.z = 0;
            }
        }
        if (key == 'FAST_COPY') {
            const {
                x,
                y,
                z
            } = getPlayerBlockPos(getLocalPlayerUniqueID())
            showPosMenu({
                x: x - Math.round(Config.FASTCOPY_XZ / 2),
                y: y,
                z: z - Math.round(Config.FASTCOPY_XZ / 2)
            }, {
                x: x + Math.round(Config.FASTCOPY_XZ / 2),
                y: y + Config.FASTCOPY_Y,
                z: z + Math.round(Config.FASTCOPY_XZ / 2)
            })
        }
        return;
    }
    if (fun.SLEEP_DELAY) Config.SLEEP_DELAY = Number(fun.SLEEP_DELAY)
    if (fun.AUTO_SLEEP) Config.AUTO_SLEEP = Number(fun.AUTO_SLEEP)
    if (fun.THRESHOLD_TP) Config.THRESHOLD_TP = Number(fun.THRESHOLD_TP)
    if (fun.CHECK_IMPORT_RANGE) Config.CHECK_IMPORT_RANGE = Number(fun.CHECK_IMPORT_RANGE)
    if (fun.POSTPOS_DIST) Config.POSTPOS_DIST = Number(fun.POSTPOS_DIST)
    if (fun.EXPORT_CHUNK_RANGE) Config.EXPORT_CHUNK_RANGE = Number(fun.EXPORT_CHUNK_RANGE)
    if (fun.IMPORT_TP_DIST) Config.IMPORT_TP_DIST = Number(fun.IMPORT_TP_DIST)
    if (fun.EXPORT_TP_DIST) Config.EXPORT_TP_DIST = Number(fun.EXPORT_TP_DIST)
    if (fun.DUMP_TP_DIST) Config.DUMP_TP_DIST = Number(fun.DUMP_TP_DIST)
    if (fun.TONE_COLOUR) Config.TONE_COLOUR = fun.TONE_COLOUR
    if (fun.PROGRESS_TEXT) Config.PROGRESS_TEXT = fun.PROGRESS_TEXT
    if (fun.CMD_AFTER) Config.CMD_AFTER = fun.CMD_AFTER.split('\n')
    if (fun.POSTPOSITION_LIST) Config.POSTPOSITION_LIST = fun.POSTPOSITION_LIST.split(',')
    if (fun.CMD_BEFORE) Config.CMD_BEFORE = fun.CMD_BEFORE.split('\n')
    if (fun.DUMPLING_NAMESPACE) Config.DUMPLING_NAMESPACE = fun.DUMPLING_NAMESPACE.split(',')
    if (fun.POSMODE_3) Config.POSMODE_3 = fun.POSMODE_3.split(',').map(pos => Number(pos))
    if (fun.KILL_LIST) Config.KILL_LIST = fun.KILL_LIST.split(',')
    if (fun.EXCLUDE_LIST) Config.EXCLUDE_LIST = fun.EXCLUDE_LIST.split(',')
    if (fun.EXCLUDE_IMPORT) Config.EXCLUDE_IMPORT = fun.EXCLUDE_IMPORT.split(',')
    if (fun.TP_TARGET) Config.TP_TARGET = fun.TP_TARGET
    if (fun.SOUND_TARGET) Config.SOUND_TARGET = fun.SOUND_TARGET
    if (fun.TP_MODE) Config.TP_MODE = fun.TP_MODE
    if (fun.TIP_MODE) Config.TIP_MODE = fun.TIP_MODE
    if (fun.SERVER_MOB) Config.SERVER_MOB = fun.SERVER_MOB
    if (fun.EXECUTE_CMD) Config.EXECUTE_CMD = fun.EXECUTE_CMD
    if (fun.SERVER_NAME) Config.SERVER_NAME = fun.SERVER_NAME || getEntityName(getLocalPlayerUniqueID())
    for (let key in fun) {
        if (["value", "fun", "name", "index", "shortcut"].includes(key)) continue;
        if (Config[key] === fun[key]) return
        if (typeof fun[key] == 'number' || typeof fun[key] == 'boolean') {
            if (key == 'SHOW_CHUNK') _options.setBoolean(327, {
                value: fun[key],
                defaultValue: false
            })
            if (['CLICK_COPY', 'FAST_BUILD', 'BUILD_ASSIST'].includes(key)) Vars.POS_DATA = {
                x: 0,
                y: 0,
                z: 0
            }
            if (key == 'NO_OUTPUT') executeCommand(`gamerule commandblockoutput ${b2s(!fun[key])}`)
            if (key == 'NO_TIP') executeCommand(`gamerule sendcommandfeedback ${b2s(!fun[key])}`)
            if (key == 'CLICK_GET') callModule(63, JSON.stringify({
                pick: true,
                value: fun[key]
            }));
            if (typeof fun[key] == 'boolean') clientMsg(key + ' > ' + (fun[key] ? '启用' : '禁用'))
            if (key == "FLY_SPEED") setPlayerAbilities(getLocalPlayerUniqueID(), {
                flySpeed: (fun[key] / 20)
            })
            if (!Object.keys(Config).includes(key)) return
            Config[key] = fun[key]
        }
        if (fun.index && fun.index === 0) return
        if (key == 'POSMODE') {
            Config.POSMODE = fun[key]
            if (fun[key] == 'CLICK') Config.POSMODE = fun[key]
            clientMsg('已设置坐标模式-> ' + fun[key])
        }
        if (key == 'DUMP_MODE') {
            Config.DUMP_MODE = fun[key]
            clientMsg('已设置导出模式-> ' + fun[key])
        }
        if (key == 'CMD_MODE') {
            Config.CMD_MODE = fun[key]
            clientMsg('已设置命令模式-> ' + fun[key])
        }
        if (key == 'GAME_MODE') {
            if (fun[key] == 'CREATE') setLocalPlayerGameType(1)
            if (fun[key] == 'SURVIVAL') setLocalPlayerGameType(0)
            if (fun[key] == 'SPECTATOR') setLocalPlayerGameType(6)
            clientMsg('已设置游戏模式-> ' + fun[key])
        }
        if (key == 'TP_MODE') {
            Config.TP_MODE = fun[key]
            clientMsg('已设置传送模式-> ' + fun[key])
        }
        if (key == 'FILLMODE') {
            Config.FILLMODE = fun[key]
            clientMsg('已设置合并模式-> ' + fun[key])
        }
        if (key == 'FILL_MODE') {
            Config.FILL_MODE = fun[key]
            clientMsg('已设置填充模式-> ' + fun[key])
        }
    }
}

clientMsg("建筑工具Rebirth §a加载成功")
if (!_fs.exists(Vars.PATHS.main)) _fs.createDirectories(Vars.PATHS.main);
if (!_fs.exists(Vars.PATHS.data)) _fs.createDirectories(Vars.PATHS.data);
if (!_fs.exists(Vars.PATHS.sound)) _fs.createDirectories(Vars.PATHS.sound);
if (!_fs.exists(Vars.PATHS.analyse)) _fs.createDirectories(Vars.PATHS.analyse);
if (!_fs.exists(Vars.PATHS.cfg)) _fs.createDirectories(Vars.PATHS.cfg);
if (!_fs.exists(Vars.PATHS.world)) _fs.createDirectories(Vars.PATHS.world);
const error = getData('crash_reason', 'null')
if (error != 'null' && error != '') {
    clientMsg(`检测到建筑工具Rebirth崩溃，请截图这条消息并发送给开发者\nError Type: ${error}`)
    setData('crash_reason', 'null')
}

if (defaultConfig.默认加载的配置 != '') {
    let path = Vars.PATHS.cfg + '/' + defaultConfig.默认加载的配置
    let c = JSON.parse(readFile(path))
    for (let i in c) {
        if (Config[i]) Config[i] = c[i]
    }
    clientMsg(`加载配置${defaultConfig.默认加载的配置}成功`)
}

if (defaultConfig.导入命令方块生成时间 === '加载脚本时') {
    let pos = getPlayerBlockPos(getLocalPlayerUniqueID())
    createTickingArea(pos.x, pos.y, pos.z)
}
/* v2 适配：本脚本是面板式 UI，引擎只负责加载菜单、不负责显示，
   这里加载完就把它打开。路径与 ui_definition.json 的 ui 数组一致。 */
try { _menu.show("建筑工具Rebirth/建筑工具"); } catch (e) { }
