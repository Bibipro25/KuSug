# -*- coding: utf-8 -*-
# 坐骑飞行.py —— 利用坐骑移动豁免服务端移动校验：骑乘状态下直接把 motion 写到坐骑身上，
#       服务端的移动反作弊只校验玩家移动包，不管实体移动，因此坐骑在已加载区块内不受限。
#       冲出已加载区块会被拉回，脚本用自适应调速应对：检测到回弹就降速，平顺后逐步恢复。
# 用法：局内骑上坐骑后运行 = 开启；再运行一次 = 关闭。
#       方向跟随视角（抬头飞高、低头俯冲），无输入时悬停。
import mod.client.extraClientApi as clientApi

SPEED_MAX = 50.0    # 最高速度（格/秒）
SPEED_MIN = 2.0
SPEED_INIT = 15.0
HOVER_Y = 0.0       # 悬停时的 Y 分量，坐骑缓慢下沉就调大到 0.02~0.05
STRAFE_SIGN = 1.0   # 左右平移反了就改成 -1.0


def chat(msg):
    try:
        import clientlevel
        m = msg
        if isinstance(m, unicode):
            m = m.encode('utf-8')
        clientlevel.display_message(1, m, '', '')
    except Exception:
        pass


ClientSystem = clientApi.GetClientSystemCls()


def _anchor():
    import client.ui.uiManager as uiManager
    return uiManager.instance()


def _dead():
    try:
        return getattr(_anchor(), '_kusug_mfly_dead', False)
    except Exception:
        return False


class MountFlySystem(ClientSystem):
    def __init__(self, namespace, systemName):
        super(MountFlySystem, self).__init__(namespace, systemName)
        self.playerId = None
        self.mountId = None
        self.motionComp = None
        self.mountPosComp = None
        self.rotComp = None
        self.inputComp = None
        self.speed = SPEED_INIT
        self.moving = False
        self.lastPos = None
        self.active = True
        try:
            _anchor()._kusug_mfly_dead = False
            _anchor()._kusug_mfly_inst = self
        except Exception:
            pass
        ns = clientApi.GetEngineNamespace()
        sn = clientApi.GetEngineSystemName()
        try:
            self.ListenForEvent(ns, sn, 'StartRidingClientEvent', self, self.on_ride)
            self.ListenForEvent(ns, sn, 'EntityStopRidingEvent', self, self.on_stop_ride)
        except Exception:
            pass
        ok = self.repeat(0.05, self.tick)
        ok = self.repeat(0.4, self.snap_check) and ok
        if not ok:
            chat(u'§c[坐骑飞行] 定时器挂载失败，请确认在局内运行')
            return
        chat(u'§a[坐骑飞行] 已开启 §7| 骑上坐骑即飞，方向跟视角 | 再运行一次关闭')

    def repeat(self, interval, fn):
        try:
            game = clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId())
            game.AddRepeatedTimer(interval, fn)
            return True
        except Exception:
            return False

    def on_ride(self, args):
        try:
            pid = clientApi.GetLocalPlayerId()
            if args.get('actorId') != pid:
                return
            self.playerId = pid
            self.mountId = args.get('victimId')
            factory = clientApi.GetEngineCompFactory()
            self.motionComp = factory.CreateActorMotion(self.mountId)
            self.mountPosComp = factory.CreatePos(self.mountId)
            self.rotComp = factory.CreateRot(pid)
            self.inputComp = factory.CreateActorMotion(pid)
            self.lastPos = None
            chat(u'§a[坐骑飞行] 已接管坐骑，当前速度 %.1f 格/秒' % self.speed)
        except Exception:
            pass

    def on_stop_ride(self, args):
        try:
            if args.get('rideId') != self.mountId and args.get('id') != self.playerId:
                return
            if self.motionComp is not None:
                try:
                    self.motionComp.SetMotion((0.0, 0.0, 0.0))
                except Exception:
                    pass
            self.mountId = None
            self.motionComp = None
            self.mountPosComp = None
            self.lastPos = None
        except Exception:
            pass

    def tick(self):
        if not self.active or _dead():
            return
        if self.mountId is None or self.motionComp is None:
            return
        try:
            left, up = self.inputComp.GetInputVector()
        except Exception:
            return
        try:
            if abs(left) < 0.01 and abs(up) < 0.01:
                self.moving = False
                self.motionComp.SetMotion((0.0, HOVER_Y, 0.0))
                return
            self.moving = True
            rot = self.rotComp.GetRot()
            fx, fy, fz = clientApi.GetDirFromRot(rot)
            m = self.speed / 20.0
            rx, rz = fz * STRAFE_SIGN, -fx * STRAFE_SIGN
            mx = (fx * up + rx * left) * m
            my = fy * up * m + HOVER_Y
            mz = (fz * up + rz * left) * m
            self.motionComp.SetMotion((mx, my, mz))
        except Exception:
            pass

    def snap_check(self):
        if not self.active or _dead():
            return
        if self.mountId is None or self.mountPosComp is None:
            return
        try:
            pos = self.mountPosComp.GetFootPos()
        except Exception:
            return
        if not pos:
            return
        if self.lastPos is not None and self.moving:
            dx = pos[0] - self.lastPos[0]
            dz = pos[2] - self.lastPos[2]
            gained = (dx * dx + dz * dz) ** 0.5
            expect = self.speed * 0.4
            if expect > 0.5 and gained < expect * 0.25:
                self.speed = max(SPEED_MIN, self.speed * 0.5)
                chat(u'§e[坐骑飞行] 检测到拉回，降速至 %.1f' % self.speed)
            elif self.speed < SPEED_MAX:
                self.speed = min(SPEED_MAX, self.speed + 2.0)
        self.lastPos = pos

    def shutdown(self):
        self.active = False
        try:
            _anchor()._kusug_mfly_dead = True
        except Exception:
            pass
        try:
            if self.motionComp is not None:
                self.motionComp.SetMotion((0.0, 0.0, 0.0))
        except Exception:
            pass
        self.mountId = None
        self.motionComp = None
        try:
            self.UnListenAllEvents()
        except Exception:
            pass
        try:
            if getattr(_anchor(), '_kusug_mfly_inst', None) is self:
                _anchor()._kusug_mfly_inst = None
        except Exception:
            pass


try:
    _old = getattr(_anchor(), '_kusug_mfly_inst', None)
except Exception:
    _old = None
if _old is None:
    _old = globals().get('_mfly_inst')
try:
    if _old is not None:
        def _kill(o=_old):
            try:
                o.shutdown()
            except Exception:
                pass
        try:
            _g = clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId())
            _g.AddTimer(0.01, _kill)
        except Exception:
            _kill()
        globals()['_mfly_inst'] = None
        chat(u'§c[坐骑飞行] 已关闭')
    else:
        _inst = MountFlySystem('KuSugMountFly', 'KuSugMountFly')
        globals()['_mfly_inst'] = _inst
except Exception as e:
    chat(u'§c[坐骑飞行] 启动失败: ' + str(e)[:100])
