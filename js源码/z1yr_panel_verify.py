# -*- coding: utf-8 -*-
"""z1yr_panel_verify.py: 假环境真执行 z1yr 面板运行期载荷(gen_z1yr_panel.py 调用)

用法: python 工具/z1yr_panel_verify.py <cores.json>
cores.json = {"core": 加载器原核心, "merged": 合并后核心, "topup": 顶补片段}
回执全部走真实文件(设备实证 evalPython 只回 true 不回值)。
控制一律 tick 队列: 入队(不写回执) -> _KTick.on_tick 排空(写回执)。
任何一步失败即退出码 1 并打印原因。
"""
import io
import json
import os
import sys
import types

RET = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '临时', 'z1yr_panel', 'ret.txt')
RET = os.path.normpath(RET)


def build_wraps(core, merged, topup):
    def panel(expr):
        c = ''.join('\n    ' + l for l in merged.split('\n'))
        t = ''.join('\n    ' + l for l in topup.split('\n'))
        return ("import __main__\nif not hasattr(__main__, 'KUSUG_MCP'):" + c +
                "\nelif 'z1setq' not in __main__.KUSUG_MCP:" + t +
                "\n" + expr)

    def loader(expr):
        c = ''.join('\n    ' + l for l in core.split('\n'))
        return "import __main__\nif not hasattr(__main__, 'KUSUG_MCP'):" + c + "\n" + expr
    return panel, loader


class FakeMod(object):
    def __init__(self, name):
        self.name = name
        self.enabled = False
        self.range = 5.0
        self.fov = 360.0
        self.cps = 15.0
        self.aim_range = 5.0
        self.distance = 10.0
        self.mult_x = 0.0
        self.speed = 1.0
        self.interval = 5.0
        self.text = 'hello'

    def enable(self):
        self.enabled = True

    def disable(self):
        self.enabled = False

    def toggle(self):
        self.enabled = not self.enabled


class FakeManager(object):
    def __init__(self, mods):
        self._modules = mods

    def get(self, n):
        return self._modules.get(n.lower())


class FakeSystem(object):
    pass


class FakeReg(object):
    def __init__(self):
        self.systemInstances = {}
        self.newSystemInstances = {}


def install_fakes(getsystem):
    fake_sys = FakeSystem()
    fake_sys._manager = FakeManager({
        'killaura': FakeMod('KillAura'),
        'spammer': FakeMod('Spammer'),
        'debug': FakeMod('Debug'),
    })
    reg = FakeReg()

    api = types.ModuleType('mod.client.extraClientApi')
    api.GetPlayerList = lambda: ['me', 'p2', 'p3']
    api.GetLocalPlayerId = lambda: 'me'
    class _Comp(object):
        def __init__(self, pid):
            self.pid = pid
        def GetName(self):
            return {'me': 'Steve', 'p2': 'Alex', 'p3': 'Bob'}.get(self.pid, self.pid)
        def GetPos(self):
            return (10.4, 66.9, -3.2)
    class _Fac(object):
        def CreateName(self, pid):
            return _Comp(pid)
        def CreatePos(self, pid):
            return _Comp(pid)
    api.GetEngineCompFactory = lambda: _Fac()
    if getsystem == 'ok':
        api.GetSystem = lambda ns, sn: fake_sys
    elif getsystem == 'raise':
        def _raise(ns, sn):
            raise Exception('no system')
        api.GetSystem = _raise
    else:
        api.GetSystem = lambda ns, sn: None
        reg.newSystemInstances['z1yr:Z1yrClientSystem'] = fake_sys
    if getsystem == 'raise':
        reg.systemInstances['z1yr:Z1yrClientSystem'] = fake_sys

    mod = types.ModuleType('mod')
    mod_client = types.ModuleType('mod.client')
    mod_common = types.ModuleType('mod.common')
    eu = types.ModuleType('mod.common.eventUtil')
    eu.instance = object()
    common = types.ModuleType('common')
    common_system = types.ModuleType('common.system')
    sr = types.ModuleType('common.system.systemRegister')
    sr.client = reg
    notify = types.ModuleType('_notify')
    notify.add_mod_mcp = lambda p: None
    notify.remove_mod_mcp = lambda p: None

    mod.client = mod_client
    mod.common = mod_common
    mod_client.extraClientApi = api
    common.system = common_system
    common_system.systemRegister = sr
    for n, m in (('mod', mod), ('mod.client', mod_client), ('mod.client.extraClientApi', api),
                 ('mod.common', mod_common), ('mod.common.eventUtil', eu),
                 ('common', common), ('common.system', common_system),
                 ('common.system.systemRegister', sr), ('_notify', notify)):
        sys.modules[n] = m
    return fake_sys, reg


def fresh_main():
    m = types.ModuleType('__main__')
    sys.modules['__main__'] = m
    return m


def run_payload(payload, g):
    compile(payload, 'payload', 'exec')
    exec(payload, g)


def read_ret():
    if not os.path.exists(RET):
        return ''
    return io.open(RET, 'r', encoding='utf-8').read().strip()


def clear_ret():
    io.open(RET, 'w', encoding='utf-8').write('')


def check(cond, msg):
    if not cond:
        print('[VERIFY-FAIL] ' + msg)
        sys.exit(1)
    print('  ok: ' + msg)


def call(fm, g, panel, expr, label):
    """同步操作: 清空回执文件 -> 跑载荷 -> 读文件"""
    clear_ret()
    run_payload(panel(expr), g)
    r = read_ret()
    print('    [%s] %s -> %r' % (label, expr[:60], r))
    return r


def call_q(fm, g, panel, expr, label):
    """tick 队列操作: 清空 -> 入队(不写回执) -> drain 排空 -> 读回执"""
    clear_ret()
    run_payload(panel(expr), g)
    r0 = read_ret()
    if r0 != '':
        print('[VERIFY-FAIL] 入队不应写回执, 读到 %r' % r0)
        sys.exit(1)
    run_payload(panel("__main__.KUSUG_MCP['drain']()"), g)
    r = read_ret()
    print('    [%s] %s -> %r' % (label, expr[:60], r))
    return r


def full_state(**kw):
    s = {'loaded': {}, 'bound': set(), 'tick': None}
    s.update(kw)
    return s


def main():
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        cores = json.load(f)
    panel, loader = build_wraps(cores['core'], cores['merged'], cores['topup'])
    saved_main = sys.modules['__main__']
    rp_lit = "u'" + RET.replace('\\', '\\\\').replace("'", "\\'") + "'"

    try:
        # A0: sysmap 优先(加载期钉住的系统对象, 设备上 GetSystem 不可靠的解药)
        print('[A0] sysmap 优先(GetSystem 抛异常也照走)')
        fake_sys0, _ = install_fakes('raise')
        fm0 = fresh_main()
        g0 = {}
        fm0._KUSUG_MCP_STATE = full_state(sysmap={'z1yr:Z1yrClientSystem': fake_sys0})
        check(call_q(fm0, g0, panel, "__main__.KUSUG_MCP['z1setq']('killaura',True," + rp_lit + ")", 'setq') == '1', 'sysmap 命中, 不走注册表')
        fm0._KUSUG_MCP_STATE = full_state(sysmap={})
        check(call_q(fm0, g0, panel, "__main__.KUSUG_MCP['z1setq']('killaura',True," + rp_lit + ")", 'setq2') == '1', 'sysmap 空 -> 回退注册表')

        # A1: 全功能矩阵
        print('[A1] GetSystem 正常路径(队列 + tick 排空)')
        fake_sys, reg = install_fakes('ok')
        fm = fresh_main()
        g = {}
        check(call_q(fm, g, panel, "__main__.KUSUG_MCP['z1setq']('killaura',True," + rp_lit + ")", 'setq') == '1', 'z1setq 开 -> 1')
        check(fake_sys._manager.get('killaura').enabled, '模块已开')
        check(call_q(fm, g, panel, "__main__.KUSUG_MCP['ztogq']('killaura'," + rp_lit + ")", 'togq') == '0', 'ztogq -> 0')
        check(call_q(fm, g, panel, "__main__.KUSUG_MCP['z1setq']('nosuch',True," + rp_lit + ")", 'miss') == 'missing', '未知模块 -> missing')
        r = call(fm, g, panel, "__main__.KUSUG_MCP['z1stateall'](" + rp_lit + ")", 'seed')
        check('killaura=0' in r and 'debug=0' in r and 'spammer=0' in r, 'z1stateall 播种串: ' + r)
        fake_sys._manager.get('killaura').enabled = True
        r = call(fm, g, panel, "__main__.KUSUG_MCP['z1stateall'](" + rp_lit + ")", 'seed2')
        check('killaura=1' in r, '播种反映真实状态')

        # A2/A3: 回退
        print('[A2] GetSystem 抛异常回退')
        install_fakes('raise')
        fm2 = fresh_main()
        g2 = {}
        check(call_q(fm2, g2, panel, "__main__.KUSUG_MCP['z1setq']('killaura',True," + rp_lit + ")", 'setq') == '1', '回退后 z1setq -> 1')
        print('[A3] GetSystem 返回 None 回退')
        install_fakes('none')
        fm3 = fresh_main()
        g3 = {}
        check(call_q(fm3, g3, panel, "__main__.KUSUG_MCP['ztogq']('killaura'," + rp_lit + ")", 'togq') == '1', '回退后 ztogq -> 1')

        # E: z1chatq 事件分发(tick 排空)
        print('[E] z1chatq 入队, tick 排空分发到 ClickChatSendClientEvent 监听器')
        install_fakes('ok')
        fm4 = fresh_main()
        g4 = {}
        got = []
        def fake_on_chat(args):
            got.append(args.get('message'))
        run_payload(loader("'noop'"), g4)
        fm4._KUSUG_MCP_STATE = full_state(loaded={'p': {'recs': [('ClickChatSendClientEvent', fake_on_chat)]}})
        check(call_q(fm4, g4, panel, "__main__.KUSUG_MCP['z1chatq'](u'.killaura'," + rp_lit + ")", 'chatq') == '1', '排空投递 1 个监听器')
        check(got == ['.killaura'], '监听器收到原始命令: %r' % got)
        fm4._KUSUG_MCP_STATE = full_state()
        check(call_q(fm4, g4, panel, "__main__.KUSUG_MCP['z1chatq'](u'.esp'," + rp_lit + ")", 'chatq0') == '0', '无监听器 -> 0(未加载信号)')
        def bad_on_chat(args):
            raise Exception('boom')
        fm4._KUSUG_MCP_STATE = full_state(loaded={'p': {'recs': [('ClickChatSendClientEvent', bad_on_chat)]}})
        check(call_q(fm4, g4, panel, "__main__.KUSUG_MCP['z1chatq'](u'.list'," + rp_lit + ")", 'chatqerr') == '0|err:boom', '监听器异常 -> 0|err:原因')
        fm4._KUSUG_MCP_STATE = full_state(loaded={'p': {'recs': [('ClickChatSendClientEvent', fake_on_chat), ('ClickChatSendClientEvent', bad_on_chat)]}})
        check(call_q(fm4, g4, panel, "__main__.KUSUG_MCP['z1chatq'](u'.gm'," + rp_lit + ")", 'chatqmix') == '1|err:boom', '一成一败 -> 1|err:原因')

        # F: z1load / z1exit 包装(与聊天/直控同制: 入队 -> tick 排空执行注册 -> 回执)
        print('[F] z1load/z1exit')
        fm0x = fresh_main()
        g0x = {}
        run_payload(panel("'noop'"), g0x)
        fm0x.KUSUG_MCP['load'] = lambda p: 'fake 事件3个'
        check(call_q(fm0x, g0x, panel, "__main__.KUSUG_MCP['z1load'](u'/x/y.mcp'," + rp_lit + ")", 'load0') == 'ok:fake 事件3个', '首载无 state: _zqueue 自建+挂tick入队成功')
        check(hasattr(fm0x, '_KUSUG_MCP_STATE'), '首载后 state 已自动创建')
        sys.modules['__main__'] = fm4
        fm4._KUSUG_MCP_STATE = full_state()
        fm4.KUSUG_MCP['load'] = lambda p: 'fake 事件3个'
        check(call_q(fm4, g4, panel, "__main__.KUSUG_MCP['z1load'](u'/x/y.mcp'," + rp_lit + ")", 'load') == 'ok:fake 事件3个', 'z1load ok 包装')
        fm4.KUSUG_MCP['load'] = None
        check(call_q(fm4, g4, panel, "__main__.KUSUG_MCP['z1load'](u'/x/y.mcp'," + rp_lit + ")", 'loaderr').startswith('err:'), 'z1load 异常 -> err 回执')
        check(call_q(fm4, g4, panel, "__main__.KUSUG_MCP['z1exit'](" + rp_lit + ")", 'exit') == 'ok', 'z1exit -> ok')

        # B2: 独立命名空间顶补(设备静默根因场景, 全部新函数)
        print('[B2] 独立命名空间顶补')
        install_fakes('ok')
        fm5 = fresh_main()
        gA, gB = {}, {}
        run_payload(loader("'noop'"), gA)
        fm5._KUSUG_MCP_STATE = full_state(loaded={'p': {'recs': [('ClickChatSendClientEvent', fake_on_chat)]}})
        check('_kapi' in gA and '_kapi' not in gB, '命名空间隔离就位')
        check(call_q(fm5, gB, panel, "__main__.KUSUG_MCP['z1setq']('killaura',True," + rp_lit + ")", 'setq') == '1', '独立命名空间 z1setq -> 1')
        check(call_q(fm5, gB, panel, "__main__.KUSUG_MCP['z1chatq'](u'.fly speed 2'," + rp_lit + ")", 'chatq') == '1', '独立命名空间 z1chatq -> 1')
        check(call(fm5, gB, panel, "__main__.KUSUG_MCP['z1stateall'](" + rp_lit + ")", 'seed').find('killaura=1') >= 0, '独立命名空间 z1stateall')

        # G: 载荷引擎级失败 -> 回执文件保持空(JS 报"无回执")
        print('[G] 载荷异常 -> 空回执')
        clear_ret()
        try:
            run_payload(panel("__main__.KUSUG_MCP['nosuchfn'](" + rp_lit + ")"), gB)
            raised = False
        except Exception:
            raised = True
        check(raised and read_ret() == '', 'KeyError 载荷抛出且回执为空')
    finally:
        sys.modules['__main__'] = saved_main

    print('[VERIFY-PASS] 全部通过')
    sys.exit(0)


if __name__ == '__main__':
    main()
