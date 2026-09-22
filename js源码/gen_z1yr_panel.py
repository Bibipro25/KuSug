# -*- coding: utf-8 -*-
"""gen_z1yr_panel.py: 生成 z1yr 面板代码块并融合进 工具/src/KuSug_main.js

来源单一可信:
  - 加载核心 = 工具/MCP加载器.js 的 CORE_PY 原文(设备验证可用)
  - z1 驱动 = 本文件 Z1_PY(纯 ASCII Py2.7, 无中文串, 从根上消除转义坑)
  - 菜单标签 = 工具/z1yr类.json(单一事实源, 交叉校验)

防历史事故的三道闸:
  1) node 求值模板字面量 -> 回读字节必须与 Python 原文逐字节一致(杀单反斜杠坑)
  2) 假环境真执行运行期载荷(含"独立加载器已注入核心"的 elif 顶补分支)(杀 NameError 坑)
  3) 菜单 tag/key 与 Z1_MODS/Z1_PARAMS/z1yr 真实模块键三方交叉校验零缺口

用法: python 工具/gen_z1yr_panel.py        (全部校验通过才会改主 JS)
"""
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOADER_JS = os.path.join(ROOT, '工具', 'MCP加载器.js')
MENU_JSON = os.path.join(ROOT, '工具', 'z1yr类.json')
MAIN_JS = os.path.join(ROOT, '工具', 'src', 'KuSug_main.js')
BACKUP_DIR = os.path.join(ROOT, '备份', 'z1yr重新适配前备份')
TMP = os.path.join(ROOT, '临时', 'z1yr_panel')

# z1yr 驱动: 纯 ASCII, 完全自包含(不引用核心的 _kapi/_kreg/_kerr) ——
# 设备实证: 引擎可能给每次 evalPython 载荷独立命名空间, 顶补注入的函数看不到核心注入时的名字
Z1_PY = '''try:
    _ZU = unicode
except NameError:
    _ZU = str


def _zapi():
    try:
        import mod.client.extraClientApi as c
        return c
    except Exception:
        return None


def _zreg():
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


def _zsys():
    import __main__ as m2
    st = getattr(m2, '_KUSUG_MCP_STATE', None)
    if st:
        so = st.get('sysmap', {}).get('z1yr:Z1yrClientSystem')
        if so is not None:
            return so
    try:
        a = _zapi()
        if a is not None:
            so = a.GetSystem('z1yr', 'Z1yrClientSystem')
            if so is not None:
                return so
    except Exception:
        pass
    r = _zreg()
    if r is None:
        return None
    try:
        so = getattr(r, 'systemInstances', {}).get('z1yr:Z1yrClientSystem')
        if so is None:
            so = getattr(r, 'newSystemInstances', {}).get('z1yr:Z1yrClientSystem')
        if so is not None:
            return so
        for d in (getattr(r, 'systemInstances', {}), getattr(r, 'newSystemInstances', {})):
            for k, v in list(d.items()):
                if hasattr(v, '_manager') and hasattr(v, 'thisPlayer'):
                    return v
    except Exception:
        pass
    return None


def _zmod(n):
    s = _zsys()
    if s is None:
        return None
    try:
        m = getattr(s, '_manager', None)
        if m is None:
            return None
        try:
            return m.get(n)
        except Exception:
            return getattr(m, '_modules', {}).get(n)
    except Exception:
        return None


def _zerr(e):
    try:
        return str(e)[:60]
    except Exception:
        return '?'


def _zwrite(rp, s):
    try:
        import io
        if not isinstance(s, _ZU):
            try:
                s = s.decode('utf-8', 'replace')
            except Exception:
                s = _ZU(s)
        f = io.open(rp, 'w', encoding='utf-8')
        f.write(s)
        f.close()
    except Exception:
        pass


def _zstateall(rp):
    s = _zsys()
    out = []
    if s is not None:
        m = getattr(s, '_manager', None)
        d = getattr(m, '_modules', {}) if m is not None else {}
        for k in sorted(d):
            out.append(k + '=' + ('1' if getattr(d[k], 'enabled', False) else '0'))
        out.append('notification=' + ('1' if getattr(s, 'notification', False) else '0'))
    _zwrite(rp, ';'.join(out) if out else 'none')


# tick queue: evalPython context swallows engine calls, so all control runs in the game tick.
# item = (fn, arg, rp); core _KTick.on_tick drains in main loop and writes receipts.

def _zchatfire(cmd):
    n = 0
    err = ''
    import __main__ as m2
    s = getattr(m2, '_KUSUG_MCP_STATE', None)
    if s:
        for p, ent in list(s.get('loaded', {}).items()):
            for e2, f2 in list(ent.get('recs', [])):
                if e2 != 'ClickChatSendClientEvent':
                    continue
                try:
                    f2({'message': cmd})
                    n += 1
                except TypeError:
                    try:
                        f2()
                        n += 1
                    except Exception as e:
                        if not err:
                            err = _zerr(e)
                except Exception as e:
                    if not err:
                        err = _zerr(e)
    return str(n) + ('|err:' + err if err else '')


def _zsetfire(nw):
    n, want = nw
    o = _zmod(n)
    if o is None:
        return 'missing'
    try:
        if want:
            o.enable()
        else:
            o.disable()
        return '1' if getattr(o, 'enabled', False) else '0'
    except Exception as e:
        return 'err:' + _zerr(e)


def _ztogfire(n):
    o = _zmod(n)
    if o is None:
        return 'missing'
    try:
        o.toggle()
        return '1' if getattr(o, 'enabled', False) else '0'
    except Exception as e:
        return 'err:' + _zerr(e)


def _zqueue(item):
    import __main__ as m2
    s = getattr(m2, '_KUSUG_MCP_STATE', None)
    if s is None:
        s = {'loaded': {}, 'bound': set(), 'tick': None}
        m2._KUSUG_MCP_STATE = s
    if s.get('tick') is None:
        for fn in (globals().get('_kattach'), getattr(m2, '_kattach', None)):
            if fn is None:
                continue
            try:
                fn()
                break
            except Exception:
                pass
    s.setdefault('chatqueue', []).append(item)


def _zchatq(cmd, rp):
    _zqueue((_zchatfire, cmd, rp))


def _zsetq(n, want, rp):
    _zqueue((_zsetfire, (n, want), rp))


def _ztogq(n, rp):
    _zqueue((_ztogfire, n, rp))


def _zcfgfire(nkv):
    n, k, vs = nkv
    o = _zmod(n)
    if o is None:
        return 'missing'
    fn = getattr(o, 'apply_config', None)
    if fn is None:
        return 'err:noapply'
    try:
        fn(k, vs)
        return 'ok'
    except Exception as e:
        return 'err:' + _zerr(e)


def _zcfgq(n, k, vs, rp):
    _zqueue((_zcfgfire, (n, k, vs), rp))


_ZCFGS = (
__Z1_CFGLINES__
)


def _zcfgall(rp):
    s = _zsys()
    out = []
    if s is not None:
        m = getattr(s, '_manager', None)
        for ln in _ZCFGS:
            p5 = ln.split('|')
            if len(p5) != 5:
                continue
            ctl, n, k, at, ty = p5
            o = None
            if m is not None:
                try:
                    o = m.get(n)
                except Exception:
                    o = None
            if o is None:
                continue
            try:
                if at[:4] == 'ore:':
                    v = o.get_ore(at[4:])
                else:
                    v = getattr(o, at, None)
                if v is None:
                    vs = 'inf'
                elif ty == 'bool':
                    vs = 'true' if v else 'false'
                elif ty == 'enum':
                    vs = str(v)
                elif isinstance(v, float):
                    vs = '%g' % v
                else:
                    vs = str(v)
                out.append(ctl + '=' + vs)
            except Exception:
                pass
    _zwrite(rp, ';'.join(out) if out else 'none')


def _zloadfire(path):
    import __main__ as m2
    try:
        msg = m2.KUSUG_MCP['load'](path)
        return 'ok:' + str(msg)[:60]
    except Exception as e:
        return 'err:' + _zerr(e)


def _zload(path, rp):
    _zqueue((_zloadfire, path, rp))


def _zexitfire(unused):
    import __main__ as m2
    try:
        m2.KUSUG_MCP['unload_all']()
        return 'ok'
    except Exception as e:
        return 'err:' + _zerr(e)


def _zexit(rp):
    _zqueue((_zexitfire, None, rp))'''

Z1_ENTRIES = "'z1stateall': _zstateall, 'z1chatq': _zchatq, 'z1setq': _zsetq, 'ztogq': _ztogq, 'z1cfgq': _zcfgq, 'z1cfgall': _zcfgall, 'z1load': _zload, 'z1exit': _zexit"

DICT_OLD = "__main__.KUSUG_MCP = {'load': _kload, 'unload': _kunload, 'unload_all': _kunload_all, 'list': _klist, 'drain': _kdrain}"
DICT_NEW = "__main__.KUSUG_MCP = {'load': _kload, 'unload': _kunload, 'unload_all': _kunload_all, 'list': _klist, 'drain': _kdrain, " + Z1_ENTRIES + "}"
UPDATE_LINE = "__main__.KUSUG_MCP.update({" + Z1_ENTRIES + "})"

# 参数 key -> (模块, 显示标签) —— 全部走 z1yr 原生聊天命令(拼写源码实证)
PARAM_META = {
    'z1_killaura_range': ('killaura', 'range'),
    'z1_killaura_fov': ('killaura', 'fov'),
    'z1_killaura_cps': ('killaura', 'cps'),
    'z1_killaura_switchdelay': ('killaura', 'switchdelay'),
    'z1_autoclicker_reach': ('autoclicker', 'reach'),
    'z1_aimbot_range': ('aimbot', 'range'),
    'z1_aimbot_fov': ('aimbot', 'fov'),
    'z1_reach_dist': ('reach', 'dist'),
    'z1_velocity_x': ('velocity', 'x'),
    'z1_velocity_y': ('velocity', 'y'),
    'z1_velocity_z': ('velocity', 'z'),
    'z1_fly_speed': ('fly', 'speed'),
    'z1_ridefly_speed': ('ridefly', 'speed'),
    'z1_freecam_speed': ('freecam', 'speed'),
    'z1_autorod_roddelay': ('autorod', 'roddelay'),
    'z1_respawn_delay': ('respawn', 'delay'),
    'z1_fastanchor_delay': ('fastanchor', 'delay'),
    'z1_fastanchor_stepdelay': ('fastanchor', 'stepdelay'),
    'z1_xray_range': ('xray', 'range'),
    'z1_xray_ylimit': ('xray', 'ylimit'),
    'z1_xray_budget': ('xray', 'budget'),
    'z1_xray_refresh': ('xray', 'refresh'),
    'z1_xray_max': ('xray', 'max'),
    'z1_xray_render': ('xray', 'render'),
    'z1_invisible_int': ('invisible', 'interval'),
    'z1_spammer_text': ('spammer', 'text'),
    'z1_spammer_delay': ('spammer', 'delay'),
    'z1_spammer_rand': ('spammer', 'rand'),
}

# ===== 子参数(走原生 apply_config 验证通道, ClickGUI FEATURE_PARAMS/TOGGLES 对齐) =====
# 相比 ClickGUI 裸 setattr 更完整: apply_config 自带夹紧/枚举白名单/副作用(crasher 换模式自动重启等)
# 排除: _notify*/Shortcut/键绑定行(z1yr 内部偏好与它的快捷键系统, 不归我们)
# (控件key, 模块, apply_config键, 回读attr, 类型, 中文标签, 默认, min, max, 格式)
# 类型: num=浮点SeekBar int=整型SeekBar bool=CheckBox enum=RadioGroup; attr 'ore:x' 走 get_ore
SUBP = [
    ('z1n_killaura_multi_limit', 'killaura', 'multi_limit', 'multi_limit', 'int', '目标上限', 3, 1, 20, '%.0f'),
    ('z1n_aimbot_speed', 'aimbot', 'speed', 'speed', 'num', '速度', 5.0, 1.0, 10.0, '%.1f'),
    ('z1n_aimbot_yoffset', 'aimbot', 'yoffset', 'y_offset', 'num', '垂直偏移', 1.65, 0.5, 10.0, '%.2f'),
    ('z1n_triggerbot_range', 'triggerbot', 'range', 'range', 'num', '范围', 4.5, 1.0, 10.0, '%.1f'),
    ('z1n_triggerbot_fov', 'triggerbot', 'fov', 'fov', 'int', 'FOV', 5, 1.0, 180.0, '%.0f'),
    ('z1n_triggerbot_cps', 'triggerbot', 'cps', 'cps', 'int', 'CPS', 12, 1.0, 20.0, '%.0f'),
    ('z1n_criticals_sneakdelay', 'criticals', 'sneakdelay', 'sneak_delay', 'num', '潜行延迟', 0.0, 0.0, 0.5, '%.2f'),
    ('z1n_criticals_clickspan', 'criticals', 'clickspan', 'click_span', 'num', '点击间隔', 0.05, 0.0, 0.5, '%.2f'),
    ('z1n_autoclicker_cpsmin', 'autoclicker', 'cps_min', 'cps_min', 'int', '最小CPS', 15, 0.0, 30.0, '%.0f'),
    ('z1n_autoclicker_cpsmax', 'autoclicker', 'cps_max', 'cps_max', 'int', '最大CPS', 15, 0.0, 30.0, '%.0f'),
    ('z1n_autorod_switchdelay', 'autorod', 'switchdelay', 'switch_delay', 'int', '切换延迟', 3, 0.0, 20.0, '%.0f'),
    ('z1n_autorod_range', 'autorod', 'range', 'range', 'int', '范围', 10, 1.0, 20.0, '%.0f'),
    ('z1n_autosoup_health', 'autosoup', 'health', 'health', 'int', '血量', 10, 1.0, 20.0, '%.0f'),
    ('z1n_autosoup_delay', 'autosoup', 'delay', 'delay', 'int', '延迟', 6, 0.0, 20.0, '%.0f'),
    ('z1n_combatbot_trackrange', 'combatbot', 'track_range', 'track_range', 'int', '追踪范围', 20, 5.0, 50.0, '%.0f'),
    ('z1n_combatbot_attackrange', 'combatbot', 'attack_range', 'attack_range', 'num', '攻击距离', 3.0, 1.0, 10.0, '%.1f'),
    ('z1n_combatbot_keepdist', 'combatbot', 'keep_distance', 'keep_distance', 'num', '保持距离', 3.0, 1.0, 10.0, '%.1f'),
    ('z1n_combatbot_healhp', 'combatbot', 'heal_hp', 'heal_hp', 'int', '回血阈值', 10, 1.0, 20.0, '%.0f'),
    ('z1n_combatbot_healkeep', 'combatbot', 'heal_keep_distance', 'heal_keep_distance', 'int', '回血距离', 10, 5.0, 30.0, '%.0f'),
    ('z1n_kbchange_yaw', 'kbchange', 'yaw', 'yaw', 'int', '转向角', 90, 1.0, 360.0, '%.0f'),
    ('z1n_kbchange_range', 'kbchange', 'range', 'range', 'num', '范围', 3.0, 1.0, 10.0, '%.1f'),
    ('z1n_ridetpaura_range', 'ridetpaura', 'range', 'range', 'int', '范围', 100, 1.0, 200.0, '%.0f'),
    ('z1n_bhop_fallspeed', 'bhop', 'fallspeed', 'fall_speed', 'num', '下落速度', -5.0, -10.0, 0.0, '%.1f'),
    ('z1n_bhop_speed', 'bhop', 'speed', 'speed', 'num', '速度', 1.0, 0.1, 10.0, '%.1f'),
    ('z1n_ridebhop_speed', 'ridebhop', 'speed', 'speed', 'num', '速度', 1.0, 0.1, 10.0, '%.1f'),
    ('z1n_ridebhop_ymotion', 'ridebhop', 'ymotion', 'ymotion', 'num', '垂直速度', 0.42, 0.0, 1.0, '%.2f'),
    ('z1n_scaffold_radius', 'scaffold', 'radius', 'radius', 'int', '半径', 6, 1.0, 6.0, '%.0f'),
    ('z1n_autotool_switchtick', 'autotool', 'switchtick', 'switch_tick', 'int', '切换延迟', 0, 0.0, 20.0, '%.0f'),
    ('z1n_autotool_restoretick', 'autotool', 'restoretick', 'restore_tick', 'int', '恢复延迟', 0, 0.0, 20.0, '%.0f'),
    ('z1n_blockin_speed', 'blockin', 'speed', 'speed', 'int', '速度', 30, 1.0, 30.0, '%.0f'),
    ('z1n_autotrap_range', 'autotrap', 'range', 'range', 'num', '范围', 5.0, 1.0, 20.0, '%.1f'),
    ('z1n_autoweb_delay', 'autoweb', 'delay', 'delay', 'num', '延迟', 3.0, 0.0, 5.0, '%.1f'),
    ('z1n_nobreakdelay_restarttick', 'nobreakdelay', 'restarttick', 'restart_tick', 'int', '重挖延迟', 1, 0.0, 5.0, '%.0f'),
    ('z1n_nobreakdelay_aimconfirmticks', 'nobreakdelay', 'aimconfirmticks', 'aim_confirm_ticks', 'int', '瞄准确认', 3, 1.0, 6.0, '%.0f'),
    ('z1n_fucker_range', 'fucker', 'range', 'range', 'num', '范围', 5.0, 1.0, 12.0, '%.1f'),
    ('z1n_fucker_scaninterval', 'fucker', 'scan_interval', 'scan_interval', 'int', '扫描间隔', 3, 1.0, 20.0, '%.0f'),
    ('z1n_zoom_fov', 'zoom', 'fov', 'fov', 'int', '视野', 30, 30.0, 110.0, '%.0f'),
    ('z1n_zoom_smooth', 'zoom', 'speed', 'smooth_speed', 'num', '平滑', 0.3, 0.01, 1.0, '%.2f'),
    ('z1n_gaussblur_intensity', 'gaussblur', 'intensity', 'intensity', 'num', '模糊强度', 0.6, 0.0, 5.0, '%.1f'),
    ('z1n_fogchange_density', 'fogchange', 'density', 'density', 'int', '雾浓度', 42, 1.0, 100.0, '%.0f'),
    ('z1n_fogchange_r', 'fogchange', 'color_r', 'color_r', 'num', '红色', 0.56, 0.0, 1.0, '%.2f'),
    ('z1n_fogchange_g', 'fogchange', 'color_g', 'color_g', 'num', '绿色', 0.63, 0.0, 1.0, '%.2f'),
    ('z1n_fogchange_b', 'fogchange', 'color_b', 'color_b', 'num', '蓝色', 0.74, 0.0, 1.0, '%.2f'),
    ('z1n_esp_smooth', 'esp', 'smooth_factor', 'smooth_factor', 'num', '平滑', 0.3, 0.1, 1.0, '%.2f'),
    ('z1n_esp_predict', 'esp', 'predict_ticks', 'predict_ticks', 'num', '预测', 2.0, 0.0, 5.0, '%.1f'),
    ('z1n_esp_chestradius', 'esp', 'chest_scan_radius', 'chest_scan_radius', 'int', '箱子半径', 8, 5.0, 50.0, '%.0f'),
    ('z1n_esp_r', 'esp', 'color_r', 'color_r', 'num', '红色', 1.0, 0.0, 1.0, '%.2f'),
    ('z1n_esp_g', 'esp', 'color_g', 'color_g', 'num', '绿色', 1.0, 0.0, 1.0, '%.2f'),
    ('z1n_esp_b', 'esp', 'color_b', 'color_b', 'num', '蓝色', 1.0, 0.0, 1.0, '%.2f'),
    ('z1n_hud_range', 'hud', 'range', 'range', 'num', '范围', 5.0, 1.0, 50.0, '%.1f'),
    ('z1n_hud_fov', 'hud', 'fov', 'fov', 'int', 'FOV', 180, 5.0, 360.0, '%.0f'),
    ('z1n_pyrpc_maxdisplay', 'pyrpc', 'maxdisplay', 'maxDisplay', 'int', '显示上限', 2000, 80.0, 2000.0, '%.0f'),
    ('z1n_whitelist_range', 'whitelist', 'range', 'range', 'num', '范围', 5.0, 1.0, 50.0, '%.1f'),
    ('z1n_invisible_restoredelay', 'invisible', 'restoredelay', 'restore_delay', 'num', '恢复延迟', 0.05, 0.0, 0.5, '%.2f'),
    ('z1n_rodaim_range', 'rodaim', 'range', 'aim_range', 'num', '范围', 9.5, 1.0, 50.0, '%.1f'),
    ('z1n_rodaim_fov', 'rodaim', 'fov', 'fov', 'int', 'FOV', 91, 1.0, 360.0, '%.0f'),
    ('z1n_noclip_speed', 'noclip', 'speed', 'speed', 'num', '速度', 0.5, 0.1, 5.0, '%.1f'),
    # 布尔 CheckBox
    ('z1c_killaura_onweapon', 'killaura', 'onweapon', 'onweapon', 'bool', '持武器', False, 0, 0, ''),
    ('z1c_killaura_onhold', 'killaura', 'onhold', 'onhold', 'bool', '按住触发', False, 0, 0, ''),
    ('z1c_killaura_onholdattack', 'killaura', 'onholdattack', 'onholdattack', 'bool', '按住攻击', False, 0, 0, ''),
    ('z1c_killaura_ecbypass', 'killaura', 'ecbypass', 'ecbypass', 'bool', 'ECBypass', False, 0, 0, ''),
    ('z1c_aimbot_onclick', 'aimbot', 'onclick', 'onclick', 'bool', '点击触发', False, 0, 0, ''),
    ('z1c_aimbot_onhold', 'aimbot', 'onhold', 'onhold', 'bool', '按住触发', False, 0, 0, ''),
    ('z1c_aimbot_onweapon', 'aimbot', 'onweapon', 'onweapon', 'bool', '持武器', False, 0, 0, ''),
    ('z1c_aimbot_leftclick', 'aimbot', 'leftclick', 'leftclick', 'bool', '按住锁定', False, 0, 0, ''),
    ('z1c_aimbot_sticky', 'aimbot', 'sticky', 'sticky', 'bool', '粘滞锁定', True, 0, 0, ''),
    ('z1c_triggerbot_onweapon', 'triggerbot', 'onweapon', 'onweapon', 'bool', '持武器', False, 0, 0, ''),
    ('z1c_triggerbot_ignoreteammates', 'triggerbot', 'ignoreteammates', 'ignore_teammates', 'bool', '忽略队友', True, 0, 0, ''),
    ('z1c_triggerbot_throughwalls', 'triggerbot', 'throughwalls', 'through_walls', 'bool', '隔墙攻击', False, 0, 0, ''),
    ('z1c_triggerbot_leftclick', 'triggerbot', 'leftclick', 'leftclick', 'bool', '按住锁定', False, 0, 0, ''),
    ('z1c_criticals_onclick', 'criticals', 'onclick', 'onclick', 'bool', '点击触发', False, 0, 0, ''),
    ('z1c_criticals_onweapon', 'criticals', 'onweapon', 'onweapon', 'bool', '持武器', True, 0, 0, ''),
    ('z1c_criticals_onsneak', 'criticals', 'onsneak', 'onsneak', 'bool', '潜行触发', False, 0, 0, ''),
    ('z1c_criticals_onhold', 'criticals', 'onhold', 'onhold', 'bool', '按住触发', False, 0, 0, ''),
    ('z1c_autoclicker_swingair', 'autoclicker', 'swingair', 'swing_air', 'bool', '空挥', True, 0, 0, ''),
    ('z1c_autoclicker_ecbypass', 'autoclicker', 'ecbypass', 'ecbypass', 'bool', 'ECBypass', False, 0, 0, ''),
    ('z1c_autorod_canattack', 'autorod', 'canattack', 'can_attack', 'bool', '可攻击', True, 0, 0, ''),
    ('z1c_autorod_silentswitch', 'autorod', 'silentswitch', 'silent_switch', 'bool', '静默切换', False, 0, 0, ''),
    ('z1c_combatbot_criticals', 'combatbot', 'criticals', 'criticals', 'bool', '暴击', False, 0, 0, ''),
    ('z1c_combatbot_sprint', 'combatbot', 'sprint', 'sprint', 'bool', '疾跑', False, 0, 0, ''),
    ('z1c_kbchange_ecbypass', 'kbchange', 'ecbypass', 'ecbypass', 'bool', 'ECBypass', False, 0, 0, ''),
    ('z1c_kbchange_movefix', 'kbchange', 'movefix', 'movefix', 'bool', '移动修正', False, 0, 0, ''),
    ('z1c_ridetpaura_onweapon', 'ridetpaura', 'onweapon', 'onweapon', 'bool', '持武器', False, 0, 0, ''),
    ('z1c_scaffold_airplace', 'scaffold', 'airplace', 'airplace', 'bool', '空放自救', True, 0, 0, ''),
    ('z1c_fucker_onholdbreak', 'fucker', 'onholdbreak', 'onholdbreak', 'bool', '按住挖掘', False, 0, 0, ''),
    ('z1c_esp_teambox', 'esp', 'teambox', 'teambox', 'bool', '队友框', True, 0, 0, ''),
    ('z1c_esp_chestesp', 'esp', 'chest_esp', 'chest_esp', 'bool', '箱子透视', False, 0, 0, ''),
    ('z1c_esp_chestfov', 'esp', 'chest_fov', 'chest_fov', 'bool', '箱子视野', True, 0, 0, ''),
    ('z1c_hud_targethud', 'hud', 'targethud', 'targethud', 'bool', '目标面板', True, 0, 0, ''),
    ('z1c_hud_bjd', 'hud', 'bjd', 'bjd', 'bool', '布吉岛', False, 0, 0, ''),
    ('z1c_pyrpc_decode', 'pyrpc', 'decode', 'decode', 'bool', '解码', True, 0, 0, ''),
    ('z1c_pyrpc_showmessage', 'pyrpc', 'showmessage', 'showMessage', 'bool', '显示消息', True, 0, 0, ''),
    ('z1c_whitelist_midclick', 'whitelist', 'midclick', 'midclick', 'bool', '中键', True, 0, 0, ''),
    ('z1c_list_send', 'list', 'send', 'send', 'bool', '发送', False, 0, 0, ''),
    ('z1c_rodaim_onhold', 'rodaim', 'onhold', 'onhold', 'bool', '按住触发', False, 0, 0, ''),
    # Xray 矿种(apply_config 内置 ore 键 -> set_ore, 默认值 ORE_DEFAULTS 实证)
    ('z1c_xray_ore_diamond', 'xray', 'diamond', 'ore:diamond', 'bool', '钻石', True, 0, 0, ''),
    ('z1c_xray_ore_iron', 'xray', 'iron', 'ore:iron', 'bool', '铁矿', True, 0, 0, ''),
    ('z1c_xray_ore_gold', 'xray', 'gold', 'ore:gold', 'bool', '金矿', True, 0, 0, ''),
    ('z1c_xray_ore_emerald', 'xray', 'emerald', 'ore:emerald', 'bool', '绿宝石', True, 0, 0, ''),
    ('z1c_xray_ore_debris', 'xray', 'debris', 'ore:debris', 'bool', '远古残骸', True, 0, 0, ''),
    ('z1c_xray_ore_redstone', 'xray', 'redstone', 'ore:redstone', 'bool', '红石', False, 0, 0, ''),
    ('z1c_xray_ore_lapis', 'xray', 'lapis', 'ore:lapis', 'bool', '青金石', False, 0, 0, ''),
    ('z1c_xray_ore_coal', 'xray', 'coal', 'ore:coal', 'bool', '煤矿', False, 0, 0, ''),
    ('z1c_xray_ore_copper', 'xray', 'copper', 'ore:copper', 'bool', '铜矿', False, 0, 0, ''),
    ('z1c_xray_ore_quartz', 'xray', 'quartz', 'ore:quartz', 'bool', '石英', False, 0, 0, ''),
    # 枚举 RadioGroup(选项见 SUBP_OPTS, checked 标默认项)
    ('z1r_killaura_weaponmode', 'killaura', 'weaponmode', 'weapon_mode', 'enum', '武器选择', 'default', 0, 0, ''),
    ('z1r_killaura_attackmode', 'killaura', 'attack_mode', 'attack_mode', 'enum', '攻击模式', 'single', 0, 0, ''),
    ('z1r_killaura_priority', 'killaura', 'priority', 'priority', 'enum', '优先级', 'distance', 0, 0, ''),
    ('z1r_aimbot_mode', 'aimbot', 'mode', 'mode', 'enum', '模式', 'dynamic', 0, 0, ''),
    ('z1r_rodaim_mode', 'rodaim', 'mode', 'mode', 'enum', '模式', 'static', 0, 0, ''),
    ('z1r_antibot_mode', 'antibot', 'mode', 'mode', 'enum', '模式', 'bjd', 0, 0, ''),
    ('z1r_kbchange_mode', 'kbchange', 'mode', 'mode', 'enum', '模式', 'right', 0, 0, ''),
    ('z1r_kbchange_cameramode', 'kbchange', 'camera_mode', 'camera_mode', 'enum', '相机模式', 'static', 0, 0, ''),
    ('z1r_bhop_mode', 'bhop', 'mode', 'mode', 'enum', '模式', 'lowhop', 0, 0, ''),
    ('z1r_inventorywalk_mode', 'inventorywalk', 'mode', 'mode', 'enum', '模式', 'motion', 0, 0, ''),
    ('z1r_scaffold_switchmode', 'scaffold', 'switchmode', 'switchmode', 'enum', '切换模式', 'auto', 0, 0, ''),
    ('z1r_fucker_mode', 'fucker', 'mode', 'mode', 'enum', '模式', 'bed', 0, 0, ''),
    ('z1r_fucker_rotation', 'fucker', 'rotation', 'rotation', 'enum', '转头模式', 'static', 0, 0, ''),
    ('z1r_esp_espmode', 'esp', 'esp_mode', 'esp_mode', 'enum', '模式', '2d', 0, 0, ''),
    ('z1r_team_mode', 'team', 'mode', 'mode', 'enum', '模式', 'all', 0, 0, ''),
    ('z1r_crasher_mode', 'crasher', 'mode', 'mode', 'enum', '模式', 'pyrpc', 0, 0, ''),
    ('z1r_ridetpaura_attackmode', 'ridetpaura', 'attack_mode', 'attack_mode', 'enum', '攻击模式', 'single', 0, 0, ''),
    ('z1r_ridetpaura_priority', 'ridetpaura', 'priority', 'priority', 'enum', '优先级', 'distance', 0, 0, ''),
    ('z1r_autorod_restoremode', 'autorod', 'restoremode', 'restore_mode', 'enum', '切回武器', 'default', 0, 0, ''),
]

SUBP_OPTS = {
    'z1r_killaura_weaponmode': [('default', '默认'), ('sword', '剑'), ('axe', '斧头'), ('mace', '重锤')],
    'z1r_killaura_attackmode': [('single', '单体'), ('switch', '多体'), ('multi', '群体')],
    'z1r_killaura_priority': [('distance', '最近距离'), ('health', '最少血量'), ('angle', '准星最近')],
    'z1r_aimbot_mode': [('dynamic', '动态'), ('static', '静态')],
    'z1r_rodaim_mode': [('dynamic', '动态'), ('static', '静态')],
    'z1r_antibot_mode': [('bjd', '布吉岛'), ('default', '默认')],
    'z1r_kbchange_mode': [('right', '右'), ('left', '左')],
    'z1r_kbchange_cameramode': [('static', '静态'), ('dynamic', '动态')],
    'z1r_bhop_mode': [('lowhop', '低跳'), ('motion', '兔子跳')],
    'z1r_inventorywalk_mode': [('motion', '动态'), ('vanilla', '原版')],
    'z1r_scaffold_switchmode': [('default', '默认'), ('auto', '自动'), ('silent', '静默')],
    'z1r_fucker_mode': [('bed', '床'), ('surround', '围堵')],
    'z1r_fucker_rotation': [('off', '关闭'), ('dynamic', '动态'), ('static', '静态')],
    'z1r_esp_espmode': [('2d', '2D'), ('3d', '3D'), ('both', '两者')],
    'z1r_team_mode': [('armor', '护甲颜色'), ('namecolor', '名字颜色'), ('prefix', '名字前缀'), ('all', '全部')],
    'z1r_crasher_mode': [('pyrpc', 'PyRpc'), ('4dskin', '4D皮肤')],
    'z1r_ridetpaura_attackmode': [('single', '单体'), ('switch', '多体')],
    'z1r_ridetpaura_priority': [('distance', '最近距离'), ('health', '最少血量'), ('angle', '准星最近')],
    'z1r_autorod_restoremode': [('default', '默认'), ('sword', '剑'), ('axe', '斧头')],
}

# 每个模块内子控件的菜单顺序(ClickGUI 行序: 滑条在前, 开关/枚举随后)
SUBP_ORDER = {
    'killaura': ['z1n_killaura_multi_limit', 'z1r_killaura_weaponmode', 'z1r_killaura_attackmode', 'z1r_killaura_priority',
                 'z1c_killaura_onweapon', 'z1c_killaura_onhold', 'z1c_killaura_onholdattack', 'z1c_killaura_ecbypass'],
    'aimbot': ['z1n_aimbot_speed', 'z1n_aimbot_yoffset', 'z1r_aimbot_mode', 'z1c_aimbot_onclick', 'z1c_aimbot_onhold',
               'z1c_aimbot_onweapon', 'z1c_aimbot_leftclick', 'z1c_aimbot_sticky'],
    'triggerbot': ['z1n_triggerbot_range', 'z1n_triggerbot_fov', 'z1n_triggerbot_cps', 'z1c_triggerbot_onweapon',
                   'z1c_triggerbot_ignoreteammates', 'z1c_triggerbot_throughwalls', 'z1c_triggerbot_leftclick'],
    'criticals': ['z1n_criticals_sneakdelay', 'z1n_criticals_clickspan', 'z1c_criticals_onclick', 'z1c_criticals_onweapon',
                  'z1c_criticals_onsneak', 'z1c_criticals_onhold'],
    'autoclicker': ['z1n_autoclicker_cpsmin', 'z1n_autoclicker_cpsmax', 'z1c_autoclicker_swingair', 'z1c_autoclicker_ecbypass'],
    'autorod': ['z1n_autorod_switchdelay', 'z1n_autorod_range', 'z1r_autorod_restoremode', 'z1c_autorod_silentswitch', 'z1c_autorod_canattack'],
    'autosoup': ['z1n_autosoup_health', 'z1n_autosoup_delay'],
    'combatbot': ['z1n_combatbot_trackrange', 'z1n_combatbot_attackrange', 'z1n_combatbot_keepdist',
                  'z1n_combatbot_healhp', 'z1n_combatbot_healkeep', 'z1c_combatbot_criticals', 'z1c_combatbot_sprint'],
    'kbchange': ['z1n_kbchange_yaw', 'z1n_kbchange_range', 'z1r_kbchange_mode', 'z1r_kbchange_cameramode',
                 'z1c_kbchange_ecbypass', 'z1c_kbchange_movefix'],
    'ridetpaura': ['z1n_ridetpaura_range', 'z1r_ridetpaura_attackmode', 'z1r_ridetpaura_priority', 'z1c_ridetpaura_onweapon'],
    'bhop': ['z1n_bhop_fallspeed', 'z1n_bhop_speed', 'z1r_bhop_mode'],
    'ridebhop': ['z1n_ridebhop_speed', 'z1n_ridebhop_ymotion'],
    'inventorywalk': ['z1r_inventorywalk_mode'],
    'scaffold': ['z1n_scaffold_radius', 'z1c_scaffold_airplace', 'z1r_scaffold_switchmode'],
    'autotool': ['z1n_autotool_switchtick', 'z1n_autotool_restoretick'],
    'blockin': ['z1n_blockin_speed'],
    'autotrap': ['z1n_autotrap_range'],
    'autoweb': ['z1n_autoweb_delay'],
    'nobreakdelay': ['z1n_nobreakdelay_restarttick', 'z1n_nobreakdelay_aimconfirmticks'],
    'fucker': ['z1n_fucker_range', 'z1n_fucker_scaninterval', 'z1r_fucker_mode', 'z1r_fucker_rotation', 'z1c_fucker_onholdbreak'],
    'xray': ['z1c_xray_ore_diamond', 'z1c_xray_ore_iron', 'z1c_xray_ore_gold', 'z1c_xray_ore_emerald', 'z1c_xray_ore_debris',
             'z1c_xray_ore_redstone', 'z1c_xray_ore_lapis', 'z1c_xray_ore_coal', 'z1c_xray_ore_copper', 'z1c_xray_ore_quartz'],
    'esp': ['z1n_esp_smooth', 'z1n_esp_predict', 'z1n_esp_chestradius', 'z1n_esp_r', 'z1n_esp_g', 'z1n_esp_b',
            'z1r_esp_espmode', 'z1c_esp_teambox', 'z1c_esp_chestesp', 'z1c_esp_chestfov'],
    'zoom': ['z1n_zoom_fov', 'z1n_zoom_smooth'],
    'gaussblur': ['z1n_gaussblur_intensity'],
    'fogchange': ['z1n_fogchange_density', 'z1n_fogchange_r', 'z1n_fogchange_g', 'z1n_fogchange_b'],
    'hud': ['z1n_hud_range', 'z1n_hud_fov', 'z1c_hud_targethud', 'z1c_hud_bjd'],
    'pyrpc': ['z1n_pyrpc_maxdisplay', 'z1c_pyrpc_decode', 'z1c_pyrpc_showmessage'],
    'whitelist': ['z1n_whitelist_range', 'z1c_whitelist_midclick'],
    'list': ['z1c_list_send'],
    'crasher': ['z1r_crasher_mode'],
    'team': ['z1r_team_mode'],
    'antibot': ['z1r_antibot_mode'],
    'rodaim': ['z1n_rodaim_range', 'z1n_rodaim_fov', 'z1r_rodaim_mode', 'z1c_rodaim_onhold'],
    'noclip': ['z1n_noclip_speed'],
    'invisible': ['z1n_invisible_restoredelay'],
}

# Z1_PY 里的 _ZCFGS 占位行在此回填(SUBP 定义之后): ctl|mod|key|attr|type
Z1_PY = Z1_PY.replace('__Z1_CFGLINES__', '\n'.join(
    "    '%s|%s|%s|%s|%s'," % (r[0], r[1], r[2], r[3], r[4]) for r in SUBP))

# z1yr CHAT_CMD_MAP 覆盖的模块(41, constants.py 实证) + 两个有专属分支的聊天开关 + notification(settings.py cmd_notification 实证)
CHAT_OK = set('''aimbot antibot autoclicker autorod autosoup autotool autoweb bhop cebridge clicktp
combatbot crasher criticals esp fastanchor fly fogchange freecam gaussblur inventorywalk invisible jumpreset
killaura killeffect motioncamera nobreakdelay noclip nohurtcam nojumpdelay pyrpc reach respawn ridebhop
ridefly rodaim scaffold spammer sprint triggerbot velocity xray team fashionunlock notification'''.split())
# 一次性动作(点了发命令, 不进状态表): 模块 -> 命令
ONESHOT = {'mount': 'mount', 'gmpanel': 'gm', 'debug': 'debug', 'list': 'list'}
# 聊天不可控, 走 Python 直控(z1set/ztog)
DIRECT = set('whitelist kbchange ridetpaura hud autotrap blockin fucker zoom'.split())
# 聊天命令名与模块名不同的映射
CMD_ALIAS = {'noclip': 'clip'}

# z1yr manager 真实键(Module.__init__ 的 name.lower(), 55 个, 源码实证)
Z1_REAL_KEYS = set('''aimbot antibot autoclicker autorod autosoup autotool autotrap autoweb bhop blockin
cebridge clicktp combatbot crasher criticals debug esp fashionunlock fastanchor fly fogchange freecam fucker
gaussblur gmpanel hud inventorywalk invisible jumpreset kbchange killaura killeffect list motioncamera mount
nobreakdelay noclip nohurtcam nojumpdelay pyrpc reach respawn ridebhop ridefly ridetpaura rodaim scaffold
spammer sprint team triggerbot velocity whitelist xray zoom'''.split())
# 菜单里允许的非 manager 开关: notification 是 sys 属性(ClickGui 的"通知", .notification 聊天可控)
MENU_EXTRA = {'notification'}

FRAG = r'''const Z1_MCP_FILE = "z1yrScripts.mcp";
const MCP_PY = `__MCP_PY__`;
const Z1_TOPUP_PY = `__Z1_TOPUP_PY__`;

// 与加载器同形的载荷: 核心缺失则整芯注入; 核心在但缺 z1 驱动(独立加载器注入过)则顶补
function z1Wrap(expr) {
	let core = "";
	for (const l of MCP_PY.split("\n")) core += "\n    " + l;
	let top = "";
	for (const l2 of Z1_TOPUP_PY.split("\n")) top += "\n    " + l2;
	return "import __main__\nif not hasattr(__main__, 'KUSUG_MCP'):" + core +
		"\nelif 'z1setq' not in __main__.KUSUG_MCP:" + top +
		"\n" + expr;
}

function z1Toast(m) { try { app.showToast(m); } catch (e) {} }

// Python 字符串字面量: 非 ASCII 转 \uXXXX(与 工具/MCP加载器.js 同法)
function z1Lit(s) {
	return "u'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/[^\x20-\x7e]/g, function (c) {
		const h = c.charCodeAt(0).toString(16);
		return "\\u" + "0000".slice(h.length) + h;
	}) + "'";
}

// 回执走文件(设备实证 evalPython 只回 true 不回值): 每次调用先清空回执文件, Python 写, JS 读
function z1RetFile() {
	let d = "";
	try { d = app.getResource("kusug"); } catch (e) {}
	return d + "/z1_ret.txt";
}

// 回执乱码救援: 引擎 fs.read 不按 UTF-8 解码, 非 ASCII 会变 latin-1 展开; 纯 ASCII 与真 unicode 不受影响
function z1ReadFile(p) {
	let rr = "";
	try { rr = String(fs.read(p) || "").trim(); } catch (e) {}
	if (/[\x80-\xff]/.test(rr)) { try { rr = decodeURIComponent(escape(rr)); } catch (e) {} }
	return rr;
}

function z1Op(expr) {
	const rp = z1RetFile();
	try { fs.write(rp, ""); } catch (e) {}
	try { app.evalPython(z1Wrap(expr)); } catch (e) { return ""; }
	return z1ReadFile(rp);
}

function z1Cmd(fn, args) {
	return z1Op("__main__.KUSUG_MCP['" + fn + "'](" + (args ? args + "," : "") + z1Lit(z1RetFile()) + ")");
}

// ===== 一切控制都进游戏刻(设备实证: evalPython 上下文里引擎调用会被吞, mount/clickgui 均如此) =====
// 入队 -> 核心 _KTick 下一游戏刻在主循环排空执行并写序号回执 -> JS 延迟 200ms 读
const Z1_SEQ = { n: 0 };

function z1TickOp(buildExpr, label, after, fail) {
	const rp = z1RetFile() + "." + (Z1_SEQ.n++);
	try { fs.write(rp, ""); } catch (e) {}
	try { app.evalPython(z1Wrap(buildExpr(rp))); } catch (e) { z1Toast(label + " 投递异常"); if (fail) fail(); return; }
	setTimeout(function () {
		const r = z1ReadFile(rp);
		try { fs.remove(rp); } catch (e) {}
		if (r === "") { z1Toast(label + " 无回执(tick 未跑?)"); if (fail) fail(); return; }
		if (r.indexOf("err:") === 0) { z1Toast(label + " 异常: " + r.slice(4, 44)); if (fail) fail(); return; }
		if (after) after(r);
	}, 200);
}

// 聊天分发回执: n 或 n|err:...; n=0 即未加载
function z1ChatTick(cmd, label, ok, fail) {
	z1TickOp(function (rp) {
		return "__main__.KUSUG_MCP['z1chatq'](" + z1Lit(cmd) + "," + z1Lit(rp) + ")";
	}, label, function (r) {
		if (r === "0") { z1Toast("z1yr 未加载"); if (fail) fail(); return; }
		if (r.indexOf("|err:") > 0) { z1Toast(label + " 异常: " + r.split("|err:")[1].slice(0, 40)); if (fail) fail(); return; }
		if (ok) ok(r);
	}, fail);
}

// 直控回执: 1/0(真实开关态) / missing(未加载) / err:...
function z1DirectTick(name, want, label) {
	z1TickOp(function (rp) {
		return want === null
			? "__main__.KUSUG_MCP['ztogq'](" + z1Lit(name) + "," + z1Lit(rp) + ")"
			: "__main__.KUSUG_MCP['z1setq'](" + z1Lit(name) + "," + (want ? "True" : "False") + "," + z1Lit(rp) + ")";
	}, label, function (r) {
		if (r === "missing") { z1Toast("z1yr 未加载"); if (want !== null) Z1_STATE[name] = !want; return; }
		if (r === "0" || r === "1") { Z1_STATE[name] = r === "1"; notifyToggle(label, r === "1"); }
		else z1Toast("切换回执异常: " + r.slice(0, 40));
	}, function () { if (want !== null) Z1_STATE[name] = !want; });
}

const Z1_MODS = {
__Z1_MODS__
};

const Z1_PARAMS = {
__Z1_PARAMS__
};

// 聊天命令名与模块名不同的映射; 一次性动作(点了就发, 不进状态); 聊天不可控走 Python 直控
const Z1_CMD = { noclip: "clip" };
const Z1_ONESHOT = { mount: "mount", gmpanel: "gm", debug: "debug", list: "list" };
const Z1_DIRECT = { whitelist: 1, kbchange: 1, ridetpaura: 1, hud: 1, autotrap: 1, blockin: 1, fucker: 1, zoom: 1 };
const Z1_PARAMVALS = {};
// 复合命令组: 同一组只发主 key(从 Z1_PARAMVALS 取全组当前值拼一条)
const Z1_COMPOUND_LEAD = { z1_velocity_y: "z1_velocity_x", z1_velocity_z: "z1_velocity_x", z1_spammer_delay: "z1_spammer_text", z1_spammer_rand: "z1_spammer_text" };
const Z1_PARAM_AUTOEN = { z1_killaura_range: 1, z1_killaura_fov: 1, z1_killaura_cps: 1, z1_killaura_switchdelay: 1, z1_autoclicker_reach: 1, z1_reach_dist: 1, z1_velocity_x: 1, z1_velocity_y: 1, z1_velocity_z: 1, z1_spammer_text: 1, z1_spammer_delay: 1, z1_spammer_rand: 1 };
const Z1_STATE = {};

// ===== 子参数直控(原生 apply_config 通道): key -> [模块, cfg键, 类型, 标签]; 枚举选项在 Z1_CFG_OPTS =====
const Z1_CFG = {
__Z1_CFG__
};
const Z1_CFG_OPTS = {
__Z1_CFG_OPTS__
};
const Z1_CFGVALS = {};
let Z1_CFGSEEDED = false;

function z1CfgSame(ck, ty, val) {
	const old = Z1_CFGVALS[ck];
	if (old === undefined) return false;
	if (old === val) return true;
	if (ty === "bool" || ty === "enum") return false;
	return Number(old) === Number(val);
}

// 子参数回执: ok / missing(未加载) / err:...(原生 apply_config 自己吞错时仍会 ok)
function z1CfgTick(ck, val) {
	const spec = Z1_CFG[ck];
	const label = Z1_MODS[spec[0]] + " " + spec[3];
	z1TickOp(function (rp) {
		return "__main__.KUSUG_MCP['z1cfgq'](" + z1Lit(spec[0]) + "," + z1Lit(spec[1]) + "," + z1Lit(val) + "," + z1Lit(rp) + ")";
	}, label, function (r) {
		if (r === "ok") {
			Z1_CFGVALS[ck] = val;
			let disp = val;
			if (spec[2] === "bool") disp = val === "true" ? "开" : "关";
			else if (spec[2] === "enum") { const os = Z1_CFG_OPTS[ck] || []; for (let i = 0; i < os.length; i++) if (os[i][0] === val) { disp = os[i][1]; break; } }
			else if (val === "inf") disp = "无限";
			z1Toast(label + ": " + disp);
			return;
		}
		if (r === "missing") { z1Toast("z1yr 未加载"); return; }
		if (r.indexOf("err:") === 0) { z1Toast(label + " 异常: " + r.slice(4, 44)); return; }
		z1Toast(label + " 回执异常: " + r.slice(0, 40));
	});
}

// 加载成功后播种子参数真实值(读模块 attr): 开菜单洪水上报的静态默认值与真值相同即静默, 不同才下发
function z1CfgSeed() {
	const st = z1Cmd("z1cfgall", "");
	Z1_CFGSEEDED = false;
	for (const k in Z1_CFGVALS) delete Z1_CFGVALS[k];
	if (!st || st === "none") return;
	for (const p of st.split(";")) {
		const i = p.indexOf("=");
		if (i > 0) Z1_CFGVALS[p.slice(0, i)] = p.slice(i + 1);
	}
	Z1_CFGSEEDED = true;
}


// 状态串同步进 Z1_STATE; 返回是否拿到有效串
function z1SyncFrom(st) {
	if (!st || st === "none") return false;
	for (const p of st.split(";")) {
		const i = p.indexOf("=");
		if (i > 0) Z1_STATE[p.slice(0, i)] = p.slice(i + 1) === "1";
	}
	return true;
}

// 读单个模块的真实开关态(切换后校正方向用); 同步失败时退回意图值
function z1Actual(name, want) {
	const st = z1Cmd("z1stateall", "");
	if (!st || st === "none") return want;
	for (const p of st.split(";")) {
		const i = p.indexOf("=");
		if (i > 0 && p.slice(0, i) === name) return p.slice(i + 1) === "1";
	}
	return want;
}

// 加载/退出专用长轮询: 加载要在游戏刻内跑完整个注册(数秒), 400ms 步进最多 10s
let Z1_LOADING = false;

function z1Poll(buildExpr, label, after, fail) {
	const rp = z1RetFile() + "." + (Z1_SEQ.n++);
	try { fs.write(rp, ""); } catch (e) {}
	try { app.evalPython(z1Wrap(buildExpr(rp))); } catch (e) { z1Toast(label + " 投递异常"); if (fail) fail(); return; }
	let tries = 0;
	const step = function () {
		const r = z1ReadFile(rp);
		if (r !== "") { try { fs.remove(rp); } catch (e) {} if (after) after(r); return; }
		if (++tries > 25) { try { fs.remove(rp); } catch (e) {} z1Toast(label + " 无回执(tick 未跑?)"); if (fail) fail(); return; }
		setTimeout(step, 400);
	};
	setTimeout(step, 400);
}

function z1Load() {
	let dir = "";
	try { dir = app.getResource("kusug/mcp"); } catch (e) {}
	if (!dir) { z1Toast("取不到资源目录"); return; }
	const path = dir + "/" + Z1_MCP_FILE;
	try { if (!fs.exists(path)) { z1Toast("未找到 " + path); return; } } catch (e) {}
	if (Z1_LOADING) { z1Toast("正在加载中, 请稍候"); return; }
	Z1_LOADING = true;
	z1Toast("z1yr 加载中…");
	const done = function () { Z1_LOADING = false; };
	z1Poll(function (rp) {
		return "__main__.KUSUG_MCP['z1load'](" + z1Lit(path) + "," + z1Lit(rp) + ")";
	}, "加载", function (r) {
		done();
		if (r.indexOf("ok:") === 0) {
			z1Toast("已加载: " + r.slice(3));
			if (!z1SyncFrom(z1Cmd("z1stateall", ""))) z1Toast("状态同步失败: 开关方向可能不准");
			z1CfgSeed();
		} else if (r.indexOf("err") === 0) z1Toast("加载失败: " + r.slice(4, 64));
		else z1Toast("加载失败: " + (r || "无回执"));
	}, done);
}

function z1Exit() {
	z1Poll(function (rp) {
		return "__main__.KUSUG_MCP['z1exit'](" + z1Lit(rp) + ")";
	}, "退出", function (r) {
		for (const k in Z1_STATE) delete Z1_STATE[k];
		Z1_CFGSEEDED = false;
		for (const k2 in Z1_CFGVALS) delete Z1_CFGVALS[k2];
		z1Toast(r === "ok" ? "已退出 z1yr 组件" : ("退出异常: " + (r || "无回执")));
	}, null);
}

// z1yr 原生 ClickGUI(.clickgui 专属分支: close_chat + open_clickgui)
function z1ClickGui() {
	z1ChatTick(".clickgui", "ClickGUI");
}

function z1ParamCmd(pk, v) {
	const num = String(Number(v));
	// spammer 三个参数是一条复合命令: .spammer <文本> <延迟> <随机长度>(取记下的全组值)
	if (pk === "z1_spammer_text" || pk === "z1_spammer_delay" || pk === "z1_spammer_rand") {
		const tx = Z1_PARAMVALS["z1_spammer_text"] !== undefined ? String(Z1_PARAMVALS["z1_spammer_text"]) : "";
		if (!tx) return "";
		const dl = Z1_PARAMVALS["z1_spammer_delay"] !== undefined ? String(Number(Z1_PARAMVALS["z1_spammer_delay"])) : "5";
		const rd = Z1_PARAMVALS["z1_spammer_rand"] !== undefined ? String(Math.round(Number(Z1_PARAMVALS["z1_spammer_rand"]))) : "0";
		return ".spammer " + tx + " " + dl + " " + rd;
	}
	// velocity 三轴一条命令
	if (pk === "z1_velocity_x" || pk === "z1_velocity_y" || pk === "z1_velocity_z") {
		const vx = Z1_PARAMVALS["z1_velocity_x"] !== undefined ? String(Number(Z1_PARAMVALS["z1_velocity_x"])) : "0";
		const vy = Z1_PARAMVALS["z1_velocity_y"] !== undefined ? String(Number(Z1_PARAMVALS["z1_velocity_y"])) : "0";
		const vz = Z1_PARAMVALS["z1_velocity_z"] !== undefined ? String(Number(Z1_PARAMVALS["z1_velocity_z"])) : "0";
		return ".velocity " + vx + " " + vy + " " + vz;
	}
	switch (pk) {
		case "z1_killaura_range": return ".killaura range " + num;
		case "z1_killaura_fov": return ".killaura fov " + num;
		case "z1_killaura_cps": return ".killaura cps " + num;
		case "z1_killaura_switchdelay": return ".killaura switchdelay " + Math.round(Number(v));
		case "z1_autoclicker_reach": return ".autoclicker reach " + num;
		case "z1_aimbot_range": return ".aimbot range " + num;
		case "z1_aimbot_fov": return ".aimbot fov " + num;
		case "z1_reach_dist": return ".reach " + num;
		case "z1_fly_speed": return ".fly speed " + num;
		case "z1_ridefly_speed": return ".ridefly speed " + num;
		case "z1_freecam_speed": return ".freecam speed " + num;
		case "z1_autorod_roddelay": return ".autorod roddelay " + num;
		case "z1_respawn_delay": return ".respawn delay " + Math.round(Number(v));
		case "z1_fastanchor_delay": return ".fastanchor delay " + num;
		case "z1_fastanchor_stepdelay": return ".fastanchor stepdelay " + num;
		case "z1_xray_range": return ".xray range " + num;
		case "z1_xray_ylimit": return ".xray ylimit " + Math.round(Number(v));
		case "z1_xray_budget": return ".xray budget " + num;
		case "z1_xray_refresh": return ".xray refresh " + num;
		case "z1_xray_max": return ".xray max " + Math.round(Number(v));
		case "z1_xray_render": return ".xray render " + Math.round(Number(v));
		case "z1_invisible_int": return ".invisible interval " + num;
	}
	return "";
}

// 参数跟随开关: 模块没开就只记值不下发(滑条/文本控件上报与开关无关, 直发会被顺带 enable 误开功能);
// 同值重复(菜单打开上报等)直接忽略; 开关打开时把记下的值补发下去
function z1ParamSend(pk, quiet) {
	const spec = Z1_PARAMS[pk];
	const v = Z1_PARAMVALS[pk];
	const cmd = z1ParamCmd(pk, v);
	if (!cmd) { if (!quiet && pk.indexOf("z1_spammer") === 0) z1Toast("先在文本框输入刷屏内容"); return; }
	z1ChatTick(cmd, Z1_MODS[spec[0]], function () {
		// 原生提示已出(tick 上下文), 这里只静默同步顺带开启的真实状态
		if (Z1_PARAM_AUTOEN[pk]) Z1_STATE[spec[0]] = z1Actual(spec[0], Z1_STATE[spec[0]] === true);
	});
}

function z1ParamSet(pk, args) {
	const spec = Z1_PARAMS[pk];
	const v = argPick(args, pk);
	if (v === undefined || typeof v === "boolean") return;
	if (Z1_PARAMVALS[pk] === v) return;
	Z1_PARAMVALS[pk] = v;
	if (Z1_STATE[spec[0]] !== true) return;
	z1ParamSend(pk, false);
}

const z1yrPanel = {
	tag: "z1yr",
	onModuleEvent(args) {
		if (!args) return;
		const fun = args.fun;
		if (fun === "z1_load") { z1Load(); return; }
		if (fun === "z1_exit") { z1Exit(); return; }
		if (fun === "z1_clickgui") { z1ClickGui(); return; }
		// 子参数事件最优先: 框架只带值字段(pascal 形), fun 甚至是父开关 tag
		let chit = false;
		for (const ck in Z1_CFG) {
			const spec = Z1_CFG[ck];
			let val;
			if (spec[2] === "enum") {
				const mv = argPick(args, ck);
				if (typeof mv === "string" && mv.indexOf(ck + "_") === 0) val = mv.slice(ck.length + 1);
				else {
					const eos = Z1_CFG_OPTS[ck] || [];
					for (let oi = 0; oi < eos.length; oi++) {
						if (args[ck + "_" + eos[oi][0]] === true || argPick(args, ck + "_" + eos[oi][0]) === true) { val = eos[oi][0]; break; }
					}
				}
				if (val === undefined) continue;
			} else if (spec[2] === "bool") {
				const bv = argPick(args, ck);
				if (typeof bv !== "boolean") continue;
				val = bv ? "true" : "false";
			} else {
				const nv = argPick(args, ck);
				if (nv === undefined || typeof nv === "boolean") continue;
				const nn = Number(nv);
				if (isNaN(nn)) { chit = true; continue; }
				val = spec[2] === "int" ? String(Math.round(nn)) : String(nn);
				if (ck === "z1n_killaura_multi_limit" && nn >= 20) val = "inf";
			}
			chit = true;
			if (!Z1_CFGSEEDED) { Z1_CFGVALS[ck] = val; continue; }
			if (z1CfgSame(ck, spec[2], val)) continue;
			Z1_CFGVALS[ck] = val;
			z1CfgTick(ck, val);
		}
		if (chit) return;
		// 参数事件优先: 框架可能只带值字段(形如 Z1_Spammer_Text)而不带 key, fun 甚至是父开关 tag
		// (设备实证: 改文本不生效反而 toggle 了模块 —— 就是掉进下面开关分支导致的)
		let hit = false;
		for (const k2 in Z1_PARAMS) {
			if (argPick(args, k2) !== undefined) { z1ParamSet(k2, args); hit = true; }
		}
		if (hit) return;
		const pk = (args.key && Z1_PARAMS[args.key]) ? args.key : (Z1_PARAMS[fun] ? fun : "");
		if (pk) { z1ParamSet(pk, args); return; }
		if (typeof fun === "string" && fun.indexOf("z1_") === 0) {
			const name = fun.slice(3);
			if (!Z1_MODS[name]) return;
			if (Z1_ONESHOT[name]) {
				if (args.value === false) return; // 开菜单上报 false 不触发, 只有真点(开/无值)才发
				z1ChatTick("." + Z1_ONESHOT[name], Z1_MODS[name]);
				return;
			}
			if (typeof args.value === "boolean" && (Z1_STATE[name] === true) === args.value) return; // 同值跳过(原生无提示我们也不加)
			const want = typeof args.value === "boolean" ? args.value : null;
			if (want !== null) Z1_STATE[name] = want; // 乐观更新; 失败回滚, 回执/读回再校正
			if (Z1_DIRECT[name]) { z1DirectTick(name, want, Z1_MODS[name]); return; } // 直控模块原生多数静默, 保留我们的提示
			z1ChatTick("." + (Z1_CMD[name] || name), Z1_MODS[name], want === null ? null : function () {
				// 聊天分发的原生开关提示在 tick 上下文已正常出, 这里只校正状态不再重复提示
				Z1_STATE[name] = z1Actual(name, want);
				// 开关打开后, 把之前(未启用时)记下的参数补发下去(复合命令组只发主 key 一条)
				if (Z1_STATE[name] === true) {
					const done = {};
					for (const pk2 in Z1_PARAMS) {
						if (Z1_PARAMS[pk2][0] !== name || Z1_PARAMVALS[pk2] === undefined) continue;
						const lead = Z1_COMPOUND_LEAD[pk2] || pk2;
						if (done[lead]) continue;
					done[lead] = true;
					z1ParamSend(lead, true);
				}
			}
		}, want === null ? null : function () { Z1_STATE[name] = !want; });
		return;
		}
	}
};

const Z1_TAGS = [];
for (const k in Z1_MODS) Z1_TAGS.push("z1_" + k);
for (const k2 in Z1_PARAMS) Z1_TAGS.push(k2);
for (const k3 in Z1_CFG) Z1_TAGS.push(k3);
Z1_TAGS.push("z1_load", "z1_exit", "z1_clickgui");
for (const t of Z1_TAGS) safeRegFun(t);
'''

BEGIN_MARK = "// >>> Z1YR_PANEL_BEGIN"
END_MARK = "// >>> Z1YR_PANEL_END"


def fail(msg):
    print('[FAIL] ' + msg)
    sys.exit(1)


def ts_escape(s):
    return s.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')


def read(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def extract_core(loader_text):
    m = re.search(r'const CORE_PY = `(.*?)`;\n', loader_text, re.S)
    if not m:
        fail('MCP加载器.js 里找不到 CORE_PY 模板字面量')
    return m.group(1)


def build_cores(core):
    head, sep, tail = core.rpartition('import __main__\n' + DICT_OLD)
    if not sep:
        fail('核心末尾字典行与预期不符, 加载器可能改过了')
    merged = head + Z1_PY + '\n\n\n' + 'import __main__\n' + DICT_NEW + tail
    topup = Z1_PY + '\n\n\n' + UPDATE_LINE
    return merged, topup


def js_wrap(expr, merged, topup):
    core = ''.join('\n    ' + l for l in merged.split('\n'))
    top = ''.join('\n    ' + l for l in topup.split('\n'))
    return ("import __main__\nif not hasattr(__main__, 'KUSUG_MCP'):" + core +
            "\nelif 'z1setq' not in __main__.KUSUG_MCP:" + top +
            "\n" + expr)


def walk_menu(node, mods, keys):
    if isinstance(node, dict):
        t = node.get('type')
        if t == 'Switch' and isinstance(node.get('tag'), str) and node['tag'].startswith('z1_'):
            mods.append((node['tag'][3:], node.get('name', node['tag'])))
        for fld in ('key',):
            k = node.get(fld)
            if isinstance(k, str) and k.startswith(('z1_', 'z1n_', 'z1c_', 'z1r_')):
                keys.append(k)
        for v in node.values():
            if isinstance(v, (dict, list)):
                walk_menu(v, mods, keys)
    elif isinstance(node, list):
        for it in node:
            walk_menu(it, mods, keys)


def main():
    core = extract_core(read(LOADER_JS))
    merged, topup = build_cores(core)
    print('[1/6] 核心合并: 原核心 %d 字符 -> 合并 %d 字符, 顶补 %d 字符' % (len(core), len(merged), len(topup)))

    # 原核心自带的报错串是中文(设备验证可用, 不动它); 要求: 新增代码不引入任何额外非 ASCII
    core_nonascii = set(c for c in core if ord(c) > 127)
    for name, src in (('z1驱动', Z1_PY), ('topup', topup)):
        compile(src, name, 'exec')
        if not src.isascii():
            fail(name + ' 含非 ASCII(驱动必须纯 ASCII)')
    compile(merged, 'merged', 'exec')
    extra = set(c for c in merged if ord(c) > 127) - core_nonascii
    if extra:
        fail('合并核心引入了原核心之外的非 ASCII: %r' % extra)
    for expr in ("__main__.KUSUG_MCP['z1chatq'](u'.killaura',u'/tmp/z1_ret.txt')",
                 "__main__.KUSUG_MCP['z1setq'](u'whitelist',True,u'/tmp/z1_ret.txt')",
                 "__main__.KUSUG_MCP['ztogq'](u'zoom',u'/tmp/z1_ret.txt')",
                 "__main__.KUSUG_MCP['z1cfgq'](u'crasher',u'mode',u'4dskin',u'/tmp/z1_ret.txt')",
                 "__main__.KUSUG_MCP['z1cfgall'](u'/tmp/z1_ret.txt')",
                 "__main__.KUSUG_MCP['z1load'](u'/storage/emulated/0/kusug/mcp/z1yrScripts.mcp',u'/tmp/z1_ret.txt')",
                 "__main__.KUSUG_MCP['z1stateall'](u'/tmp/z1_ret.txt')"):
        p = js_wrap(expr, merged, topup)
        compile(p, 'payload', 'exec')
        extra = set(c for c in p if ord(c) > 127) - core_nonascii
        if extra:
            fail('载荷引入了原核心之外的非 ASCII: %r' % extra)
    print('[2/6] Python compile 全过; 新增代码纯 ASCII(原核心自带 %d 个中文报错字符, 保持原样)' % len(core_nonascii))

    # SUBP 自洽: 每行都在 SUBP_ORDER 出现且仅一次; enum 必有 OPTS 且默认在选项内; 模块必真实
    subp_keys = [r[0] for r in SUBP]
    if len(subp_keys) != len(set(subp_keys)):
        fail('SUBP 控件 key 有重复')
    ordered = [k for ks in SUBP_ORDER.values() for k in ks]
    if sorted(ordered) != sorted(subp_keys):
        fail('SUBP 与 SUBP_ORDER 不一致: 未排%s 多余%s' % (sorted(set(subp_keys) - set(ordered)), sorted(set(ordered) - set(subp_keys))))
    for r in SUBP:
        if r[1] not in Z1_REAL_KEYS:
            fail('SUBP ' + r[0] + ' 指向不存在模块 ' + r[1])
        if r[4] == 'enum':
            opts = SUBP_OPTS.get(r[0])
            if not opts:
                fail('SUBP 枚举缺选项: ' + r[0])
            if r[6] not in [o[0] for o in opts]:
                fail('SUBP 枚举默认不在选项内: ' + r[0])
        elif r[4] == 'bool':
            if not isinstance(r[6], bool):
                fail('SUBP 布尔默认非布尔: ' + r[0])
        elif r[4] not in ('num', 'int'):
            fail('SUBP 未知类型: %r' % (r,))

    # 菜单交叉校验
    menu = json.loads(read(MENU_JSON))
    mods, keys = [], []
    walk_menu(menu, mods, keys)
    mod_names = [m[0] for m in mods]
    if len(mod_names) != len(set(mod_names)):
        fail('菜单 Switch tag 有重复')
    if set(mod_names) != Z1_REAL_KEYS | MENU_EXTRA:
        fail('菜单模块与 z1yr 真实键不符: 多%s 缺%s' % (sorted(set(mod_names) - Z1_REAL_KEYS - MENU_EXTRA), sorted((Z1_REAL_KEYS | MENU_EXTRA) - set(mod_names))))
    # key 分类: 旧参数(z1_) / 子参数控件(z1n_/z1c_/z1r_) / RadioGroup 选项项(z1r_控件_选项值)
    menu_param = [k for k in keys if k.startswith('z1_')]
    menu_sub = [k for k in keys if k.startswith(('z1n_', 'z1c_', 'z1r_'))]
    if sorted(menu_param) != sorted(PARAM_META.keys()):
        fail('菜单参数 key 与 PARAM_META 不符: 多%s 缺%s' % (sorted(set(menu_param) - set(PARAM_META)), sorted(set(PARAM_META) - set(menu_param))))
    item_keys = set()
    for ck, opts in SUBP_OPTS.items():
        for ov, _ in opts:
            item_keys.add(ck + '_' + ov)
    menu_ctl = [k for k in menu_sub if k not in item_keys]
    if sorted(menu_ctl) != sorted(subp_keys):
        fail('菜单子参数控件与 SUBP 不符: 多%s 缺%s' % (sorted(set(menu_ctl) - set(subp_keys)), sorted(set(subp_keys) - set(menu_ctl))))
    menu_items = [k for k in menu_sub if k in item_keys]
    if set(menu_items) != item_keys:
        fail('菜单 RadioGroup 选项项不符: 多%s 缺%s' % (sorted(set(menu_items) - item_keys), sorted(item_keys - set(menu_items))))
    for k, (mn, _) in PARAM_META.items():
        if mn not in Z1_REAL_KEYS:
            fail('PARAM_META ' + k + ' 指向不存在模块 ' + mn)
    # 55 个模块 + 1 个 sys 属性开关每个都必须有且仅有一条控制路径: 聊天开关 / 一次性 / 直控
    seen = {}
    for mn in Z1_REAL_KEYS | MENU_EXTRA:
        paths = (1 if mn in CHAT_OK else 0) + (1 if mn in ONESHOT else 0) + (1 if mn in DIRECT else 0)
        if paths != 1:
            seen[mn] = paths
    if seen:
        fail('模块控制路径不唯一或缺失: %r' % seen)
    if CHAT_OK & set(ONESHOT) or CHAT_OK & DIRECT or set(ONESHOT) & DIRECT:
        fail('控制路径集合相交')
    print('[3/6] 菜单交叉校验: %d 开关 == z1yr 真实键+sys属性, %d 旧参数+%d 子参数(%d 枚举项), 控制路径覆盖 %d/%d(聊天%d+一次性%d+直控%d)' % (
        len(mod_names), len(menu_param), len(menu_ctl), len(menu_items), len(Z1_REAL_KEYS | MENU_EXTRA), len(Z1_REAL_KEYS | MENU_EXTRA),
        len(CHAT_OK & (Z1_REAL_KEYS | MENU_EXTRA)), len(set(ONESHOT) & Z1_REAL_KEYS), len(DIRECT & Z1_REAL_KEYS)))

    # 拼装片段
    mods_js = '\n'.join('\t%s: %s,' % (k, json.dumps(n, ensure_ascii=False)) for k, n in mods)
    params_js = '\n'.join('\t%s: ["%s", "%s"],' % (k, v[0], v[1]) for k, v in PARAM_META.items())
    cfg_js = '\n'.join('\t%s: ["%s", "%s", "%s", %s],' % (r[0], r[1], r[2], r[4], json.dumps(r[5], ensure_ascii=False)) for r in SUBP)
    cfgopts_js = '\n'.join('\t%s: [%s],' % (k, ', '.join('["%s", %s]' % (v, json.dumps(d, ensure_ascii=False)) for v, d in opts)) for k, opts in SUBP_OPTS.items())
    frag = FRAG.replace('__MCP_PY__', ts_escape(merged)).replace('__Z1_TOPUP_PY__', ts_escape(topup))
    frag = frag.replace('__Z1_MODS__', mods_js).replace('__Z1_PARAMS__', params_js)
    frag = frag.replace('__Z1_CFG__', cfg_js).replace('__Z1_CFG_OPTS__', cfgopts_js)

    if not os.path.isdir(TMP):
        os.makedirs(TMP)
    rt_js = os.path.join(TMP, 'roundtrip.js')
    with open(rt_js, 'w', encoding='utf-8', newline='\n') as f:
        f.write(frag.split('\n')[0] + '\n')  # Z1_MCP_FILE 行(无依赖)
        f.write(frag[frag.index('const MCP_PY'):frag.index('// 与加载器同形')])
        f.write('require("fs").writeFileSync(%s, MCP_PY);\n' % json.dumps(os.path.join(TMP, 'rt_merged.py')))
        f.write('require("fs").writeFileSync(%s, Z1_TOPUP_PY);\n' % json.dumps(os.path.join(TMP, 'rt_topup.py')))
    subprocess.check_call(['node', rt_js])
    for name, expect in (('rt_merged.py', merged), ('rt_topup.py', topup)):
        with open(os.path.join(TMP, name), 'rb') as f:
            got = f.read().decode('utf-8')
        if got != expect:
            fail('node 回读 %s 与原文不一致(%d vs %d 字节) —— 转义坑复发' % (name, len(got), len(expect)))
    print('[4/6] node 求值回读: 模板字面量运行期内容 == Python 原文, 逐字节一致')

    # 假环境真执行
    meta = os.path.join(TMP, 'cores.json')
    with open(meta, 'w', encoding='utf-8', newline='\n') as f:
        json.dump({'core': core, 'merged': merged, 'topup': topup}, f)
    r = subprocess.call([sys.executable, os.path.join(ROOT, '工具', 'z1yr_panel_verify.py'), meta])
    if r != 0:
        fail('假环境实跑未通过')
    print('[5/6] 假环境实跑: 全路径通过(含 elif 顶补分支)')

    # 融合主 JS
    main_text = read(MAIN_JS)
    block = BEGIN_MARK + ' (gen_z1yr_panel.py 生成, 勿手改)\n' + frag + END_MARK + '\n\n'
    if BEGIN_MARK in main_text:
        a = main_text.index(BEGIN_MARK)
        b = main_text.index(END_MARK) + len(END_MARK) + 2
        main_text = main_text[:a] + block + main_text[b:]
        action = '替换标记段'
    else:
        anchor = 'const modules = ['
        if anchor not in main_text:
            fail('主 JS 找不到 modules 数组锚点')
        main_text = main_text.replace(anchor, block + anchor, 1)
        action = '插入标记段'
    ml = re.search(r'^const modules = \[.*\];$', main_text, re.M)
    if not ml:
        fail('主 JS modules 数组行匹配失败')
    if 'z1yrPanel' not in ml.group(0):
        main_text = main_text[:ml.start()] + ml.group(0).replace('containerBlur];', 'containerBlur, z1yrPanel];') + main_text[ml.end():]
    if 'z1yrPanel' not in re.search(r'^const modules = \[.*\];$', main_text, re.M).group(0):
        fail('modules 数组挂接 z1yrPanel 失败')

    if not os.path.isdir(BACKUP_DIR):
        os.makedirs(BACKUP_DIR)
    bak = os.path.join(BACKUP_DIR, 'KuSug_main.js')
    if not os.path.exists(bak):
        shutil.copy2(MAIN_JS, bak)
    with open(MAIN_JS, 'w', encoding='utf-8', newline='\n') as f:
        f.write(main_text)
    subprocess.check_call(['node', '--check', MAIN_JS])
    print('[6/6] 主 JS %s 完成, node --check 通过(%d 行)' % (action, main_text.count('\n') + 1))
    print('OK: 全部校验通过, 可以出包')


if __name__ == '__main__':
    main()
