const app = require("app");
const gui = require("gui");
const fs = require("fs");

const CORE_PY = `# -*- coding: utf-8 -*-
import os
import re
import sys

try:
    _UNI = unicode
except NameError:
    _UNI = str


def _kapi():
    import mod.client.extraClientApi as c
    return c


def _knotify():
    try:
        import _notify as n
        if hasattr(n, 'add_mod_mcp'):
            return n
    except Exception:
        pass
    import minecraft.notify as n
    return n


def _keu():
    try:
        import mod.common.eventUtil as e
    except Exception:
        from common import eventUtil as e
    return e.instance


def _kreg():
    try:
        from common.system.systemRegister import client as r
        return r
    except Exception:
        pass
    try:
        import common.system.systemRegister as sr
        return getattr(sr, 'client', None)
    except Exception:
        return None


def _kep(p):
    if sys.version_info[0] >= 3:
        return p
    if isinstance(p, _UNI):
        return p.encode('utf-8', 'replace')
    return p


def _ku(s):
    if sys.version_info[0] >= 3:
        return s
    if isinstance(s, str):
        return s.decode('utf-8', 'replace')
    return s


def _kerr(e):
    try:
        return _ku(str(e))
    except Exception:
        return repr(e)


def _kstate():
    import __main__
    s = getattr(__main__, '_KUSUG_MCP_STATE', None)
    if s is None:
        s = {'loaded': {}, 'bound': set(), 'tick': None}
        __main__._KUSUG_MCP_STATE = s
    return s


def _ktakes_arg(func):
    code = getattr(func, '__code__', None)
    if code is None:
        im = getattr(func, 'im_func', None)
        if im is not None:
            code = getattr(im, 'func_code', None)
    if code is None:
        return True
    n = getattr(code, 'co_argcount', 1)
    if getattr(func, '__self__', None) is not None or getattr(func, 'im_self', None) is not None:
        n = max(0, n - 1)
    return n > 0


def _kcall(func, args):
    if _ktakes_arg(func):
        func(args if args is not None else {})
    else:
        func()


def _kdispatch(ev, args):
    s = _kstate()
    for p in list(s['loaded'].keys()):
        ent = s['loaded'].get(p)
        if not ent:
            continue
        for e2, f2 in list(ent['recs']):
            if e2 != ev:
                continue
            try:
                _kcall(f2, args)
            except Exception:
                pass


def _kdrain():
    s = _kstate()
    q = s.get('chatqueue')
    if not q:
        return 0
    s['chatqueue'] = []
    n = 0
    for fn, arg, rp in q:
        try:
            res = fn(arg)
        except Exception as e:
            try:
                res = 'err:' + _kerr(e)
            except Exception:
                res = 'err:?'
        n += 1
        try:
            import io
            fq = io.open(rp, 'w', encoding='utf-8')
            fq.write(_UNI(res))
            fq.close()
        except Exception:
            pass
    return n


class _KTick(object):
    def on_tick(self, args=None):
        _kdispatch('OnScriptTickClient', {})
        _kdrain()


class _KListener(object):
    def __init__(self, ev):
        self.ev = ev

    def on_event(self, args=None):
        _kdispatch(self.ev, args)


class _KCapture(object):
    def __init__(self):
        self.recs = []
        self.systems = []
        self.patched = []
        self.base_cls = None
        self.base_orig = None
        self.reg_orig = None

    def make_listen(self):
        def _cap(system, namespace, system_name, event_name, instance, func):
            self.recs.append((event_name, func))
        return _cap

    def patch_cls(self, cls_path):
        mp, _, cn = cls_path.rpartition('.')
        if not mp or not cn:
            return
        try:
            mod = __import__(mp, fromlist=[''])
            cls = getattr(mod, cn, None)
        except Exception:
            return
        if cls is None:
            return
        for c0, _o in self.patched:
            if c0 is cls:
                return
        orig = getattr(cls, 'ListenForEvent', None)
        if orig is None:
            return
        cls.ListenForEvent = self.make_listen()
        self.patched.append((cls, orig))

    def begin(self):
        try:
            api = _kapi()
        except Exception:
            return
        try:
            cls = api.GetClientSystemCls()
            orig = getattr(cls, 'ListenForEvent', None)
            if orig is not None:
                cls.ListenForEvent = self.make_listen()
                self.base_cls = cls
                self.base_orig = orig
        except Exception:
            pass
        reg = getattr(api, 'RegisterSystem', None)
        if reg is not None:
            self.reg_orig = reg
            cap = self

            def _rec_register(namespace, system_name, cls_path):
                cap.systems.append((namespace, system_name))
                cap.patch_cls(cls_path)
                return cap.reg_orig(namespace, system_name, cls_path)
            try:
                api.RegisterSystem = _rec_register
            except Exception:
                self.reg_orig = None

    def end(self):
        if self.base_cls is not None:
            try:
                self.base_cls.ListenForEvent = self.base_orig
            except Exception:
                pass
            self.base_cls = None
            self.base_orig = None
        for c0, o0 in self.patched:
            try:
                c0.ListenForEvent = o0
            except Exception:
                pass
        self.patched = []
        if self.reg_orig is not None:
            try:
                _kapi().RegisterSystem = self.reg_orig
            except Exception:
                pass
            self.reg_orig = None


def _kpost_load(systems, instances):
    called = []
    objs = list(instances)
    try:
        api = _kapi()
    except Exception:
        api = None
    for ns, sn in systems:
        so = None
        if api is not None:
            try:
                so = api.GetSystem(ns, sn)
            except Exception:
                so = None
        if so is None:
            reg = _kreg()
            if reg is not None:
                key = ns + ':' + sn
                so = getattr(reg, 'systemInstances', {}).get(key)
                if so is None:
                    so = getattr(reg, 'newSystemInstances', {}).get(key)
        if so is not None:
            objs.append(so)
            try:
                _kstate().setdefault('sysmap', {})[ns + ':' + sn] = so
            except Exception:
                pass
    names = ('uiinitfinished', 'loadclientaddonscriptsafter')
    keys = ('uiinit', 'loadclientaddonscriptsafter')
    for so in objs:
        try:
            nl = getattr(so, 'nameToListenEvents', {})
            for ev, el in list(nl.items()):
                if str(ev).lower() not in names:
                    continue
                for e in list(el):
                    try:
                        f = getattr(e, 'funcName', None)
                        if f is None:
                            continue
                        if getattr(f, '__self__', None) is None and getattr(f, 'im_self', None) is None:
                            inst = getattr(e, 'instance', None)
                            if inst is not None:
                                f = getattr(inst, getattr(f, '__name__', ''), f)
                        if f in called:
                            continue
                        _kcall(f, {})
                        called.append(f)
                    except Exception:
                        pass
        except Exception:
            pass
        for k in dir(so):
            lk = k.lower()
            hit = False
            for m in keys:
                if m in lk:
                    hit = True
                    break
            if not hit:
                continue
            f = getattr(so, k)
            if not callable(f) or f in called:
                continue
            try:
                _kcall(f, {})
                called.append(f)
            except Exception:
                pass


def _kattach():
    s = _kstate()
    try:
        eu = _keu()
    except Exception:
        return
    if s['tick'] is None:
        t = _KTick()
        try:
            eu.ListenForEngineClient('OnScriptTickClient', t, t.on_tick, 10)
            s['tick'] = t
        except Exception:
            return
    skip = ('UiInitFinished', 'LoadClientAddonScriptsAfter', 'OnScriptTickClient')
    seen = {}
    for p in list(s['loaded'].keys()):
        ent = s['loaded'].get(p)
        if not ent:
            continue
        for ev, f in ent['recs']:
            if ev in skip or ev in s['bound'] or ev in seen:
                continue
            seen[ev] = True
            l = _KListener(ev)
            try:
                eu.ListenForEngineClient(ev, l, l.on_event, 10)
                s['bound'].add(ev)
            except Exception:
                pass


def _knorm(p):
    return os.path.normcase(os.path.normpath(p))


def _kunreg(ns, sn):
    reg = _kreg()
    if reg is None:
        return
    try:
        reg.UnRegisterSystem(ns, sn)
    except Exception:
        pass
    key = ns + ':' + sn
    try:
        _kstate().get('sysmap', {}).pop(key, None)
    except Exception:
        pass
    try:
        reg.systemInstances.pop(key, None)
    except Exception:
        pass
    inst = None
    try:
        inst = reg.newSystemInstances.pop(key, None)
    except Exception:
        pass
    if inst is not None:
        for m in ('DestroyEvents', 'Destroy'):
            try:
                getattr(inst, m)()
            except Exception:
                pass
    try:
        reg.deleteSystemInstances.discard(key)
    except Exception:
        pass


def _kunload(path):
    s = _kstate()
    ent = s['loaded'].pop(path, None)
    if ent is None:
        return
    for ns, sn in ent['systems']:
        _kunreg(ns, sn)
    name = ent['name']
    for mn in ent.get('aliases', []):
        try:
            v = sys.modules.get(mn)
            if v is not None and (getattr(v, '__name__', '') or '').startswith(name + '.'):
                del sys.modules[mn]
        except Exception:
            pass
    for mn in [m for m in list(sys.modules) if m == name or m.startswith(name + '.')]:
        try:
            del sys.modules[mn]
        except Exception:
            pass
    np = _knorm(path)
    for p in list(sys.path):
        try:
            if _knorm(p) == np:
                sys.path.remove(p)
        except Exception:
            pass
    try:
        _knotify().remove_mod_mcp(_kep(path))
    except Exception:
        pass
    cache = getattr(sys, 'path_importer_cache', None)
    if cache is not None:
        for k in list(cache):
            try:
                if _knorm(k) == np:
                    del cache[k]
            except Exception:
                pass
    try:
        sys.module_paths.clear()
    except Exception:
        pass


def _kload(path):
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        raise Exception(_kep(u'文件不存在'))
    base = os.path.basename(path)
    name = base[:-4] if base.lower().endswith('.mcp') else os.path.splitext(base)[0]
    if not re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', name):
        raise Exception(_kep(u'文件名需为英文数字下划线'))
    s = _kstate()
    if path in s['loaded']:
        _kunload(path)
    notify = _knotify()
    notify.add_mod_mcp(_kep(path))
    np = _knorm(path)
    for p in list(sys.path):
        try:
            if _knorm(p) == np:
                sys.path.remove(p)
        except Exception:
            pass
    sys.path.insert(0, path)
    cap = _KCapture()
    cap.begin()
    instances = []
    errors = []
    try:
        try:
            mod = __import__(name + '.modMain', fromlist=[''])
        except Exception:
            low = name.lower()
            if low == name:
                raise
            name = low
            mod = __import__(name + '.modMain', fromlist=[''])
        for mk in dir(mod):
            cls = getattr(mod, mk)
            if not hasattr(cls, 'MOD_NAME'):
                continue
            try:
                inst = cls()
            except Exception as e:
                errors.append(mk + '(): ' + _kerr(e))
                continue
            instances.append(inst)
            for ck in dir(inst):
                f = getattr(inst, ck)
                if not hasattr(f, 'InitClient'):
                    continue
                try:
                    f()
                except Exception as e:
                    errors.append(mk + '.' + ck + ': ' + _kerr(e))
        # 包内顶层绝对 import 兼容(如 z1yr 的 from module.config import ...):
        # 把内层模块映射到顶层, 与原生环境一致(不覆盖已存在的同名模块)
        aliases = []
        for mn in list(sys.modules):
            if mn.startswith(name + '.'):
                alias = mn[len(name) + 1:]
                if alias and alias not in sys.modules:
                    try:
                        sys.modules[alias] = sys.modules[mn]
                        aliases.append(alias)
                    except Exception:
                        pass
    except Exception as e:
        cap.end()
        try:
            notify.remove_mod_mcp(_kep(path))
        except Exception:
            pass
        for p in list(sys.path):
            try:
                if _knorm(p) == np:
                    sys.path.remove(p)
            except Exception:
                pass
        raise Exception(_kep(u'导入失败: ' + _kerr(e)))
    cap.end()
    s['loaded'][path] = {'name': name, 'systems': cap.systems, 'recs': cap.recs, 'aliases': aliases}
    _kpost_load(cap.systems, instances)
    _kattach()
    msg = _ku(name) + u' 事件' + _ku(str(len(cap.recs))) + u'个'
    if errors:
        msg += u' 警告:' + errors[0][:24]
    return msg


def _klist():
    s = _kstate()
    out = []
    for p, ent in s['loaded'].items():
        out.append(_ku(ent['name']))
    return '|'.join(out)


def _kunload_all():
    s = _kstate()
    for p in list(s['loaded'].keys()):
        _kunload(p)


import __main__
__main__.KUSUG_MCP = {'load': _kload, 'unload': _kunload, 'unload_all': _kunload_all, 'list': _klist, 'drain': _kdrain}
`;

function dirPath() { return app.getResource("kusug/mcp"); }

function esc(s) {
	return "u'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/[^\x20-\x7e]/g, function (c) {
		const h = c.charCodeAt(0).toString(16);
		return "\\u" + "0000".slice(h.length) + h;
	}) + "'";
}

function buildPy(expr) {
	let indented = "";
	const lines = CORE_PY.split("\n");
	for (const l of lines) indented += "\n    " + l;
	return "import __main__\nif not hasattr(__main__, 'KUSUG_MCP'):" + indented + "\n__main__._KUSUG_MCP_RET = " + expr;
}

function pyOp(expr) {
	app.evalPython(buildPy(expr));
	return String(app.evalPython("__main__._KUSUG_MCP_RET") || "");
}

function listFiles() {
	const out = [];
	let es = [];
	try { es = fs.list(dirPath()) || []; } catch (e) {}
	for (const f of es) {
		const n = String((f && f.name) || f || "");
		if (/\.mcp$/i.test(n)) out.push(n);
	}
	out.sort();
	return out;
}

function queryLoaded() {
	try {
		const r = pyOp("__main__.KUSUG_MCP['list']()");
		return r ? r.split("|") : [];
	} catch (e) {
		return [];
	}
}

function toast(m) { try { app.showToast(m); } catch (e) {} }

function checkPath(path) {
	const base = String(path).split("/").pop();
	if (!/\.mcp$/i.test(base)) return "不是 .mcp 文件: " + base;
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(base.replace(/\.mcp$/i, ""))) return "文件名需为英文数字下划线: " + base;
	if (!fs.exists(path)) return "文件不存在: " + path;
	return "";
}

function doLoad(path, back) {
	const bad = checkPath(path);
	if (bad) { toast(bad); (back || openForm)(); return; }
	let msg = "";
	try {
		msg = pyOp("__main__.KUSUG_MCP['load'](" + esc(path) + ")") || path;
	} catch (e) {
		toast("加载失败: " + String(e && e.message ? e.message : e).slice(0, 80));
		openForm();
		return;
	}
	toast("已加载: " + msg);
}

function unloadAll() {
	try {
		pyOp("__main__.KUSUG_MCP['unload_all']()");
		toast("已卸载全部组件");
	} catch (e) {
		toast("卸载失败: " + String(e && e.message ? e.message : e).slice(0, 80));
	}
}

function openManualForm() {
	const form = JSON.stringify({
		type: "custom_form",
		title: "手动输入路径",
		content: [{ type: "input", text: "mcp完整路径", placeholder: "/storage/emulated/0/.../xxx.mcp", default: "" }]
	});
	try {
		gui.addForm(form, function (v) {
			const p = String(v || "").trim().replace(/^["']|["']$/g, "");
			if (!p) { openForm(); return; }
			doLoad(p, openManualForm);
		}, function () { openForm(); });
	} catch (e) { openForm(); }
}

function openForm() {
	const files = listFiles();
	const loaded = queryLoaded();
	const low = {};
	for (const n of loaded) low[String(n).toLowerCase()] = 1;
	const acts = [];
	const buttons = [];
	for (const n of files) {
		const on = low[n.replace(/\.mcp$/i, "").toLowerCase()] === 1;
		acts.push({ t: "file", name: n });
		buttons.push({ text: (on ? "§a" : "§f") + n });
	}
	acts.push({ t: "manual" });
	buttons.push({ text: "手动输入路径" });
	acts.push({ t: "refresh" });
	buttons.push({ text: "刷新列表" });
	if (loaded.length) {
		acts.push({ t: "clear" });
		buttons.push({ text: "§c卸载全部(" + loaded.length + ")" });
	}
	const form = JSON.stringify({
		type: "form",
		title: "MCP加载(" + files.length + ")",
		content: files.length ? ("已加载: " + (loaded.length ? loaded.join(", ") : "无")) : "把.mcp组件放到 资源目录/kusug/mcp 后点刷新列表",
		buttons: buttons
	});
	try {
		gui.addForm(form, function (idx) {
			const a = acts[typeof idx === "number" ? idx : parseInt(idx, 10)];
			if (!a) return;
			if (a.t === "file") doLoad(dirPath() + "/" + a.name);
			else if (a.t === "manual") openManualForm();
			else if (a.t === "clear") { unloadAll(); openForm(); }
			else openForm();
		}, function () {});
	} catch (e) {}
}

openForm();
