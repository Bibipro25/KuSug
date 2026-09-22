import math
import sys
import time
import types

import mod.client.extraClientApi as clientApi

ClientSystem = clientApi.GetClientSystemCls()

try:
    import cc
    import ccui
    CCUI_AVAILABLE = True
except Exception:
    cc = None
    ccui = None
    CCUI_AVAILABLE = False

try:
    import localplayermodule as local_player
except Exception:
    try:
        import _localplayermodule as local_player
    except Exception:
        local_player = None


# ============================================================
# 配置
# ============================================================

# 搭路与 HUD 完全使用客户端 tick 驱动。
BUILD_TICK_DIVISOR = 1
HUD_TICK_DIVISOR = 4

# 没有实际移动超过该时间后，不再沿用旧的移动方向。
MOTION_DIRECTION_TIMEOUT = 0.25

# CCUI 创建重试间隔（tick）。
QUICK_UI_TICK_INTERVAL = 10

# 同一目标最短重试间隔。
TARGET_RETRY_INTERVAL = 0.12

# 等待目标方块同步的最长时间。
PENDING_TIMEOUT = 0.80

# 已提交目标在客户端未同步时，先按“可能已放置”处理以继续向前铺设。
PENDING_RETRY_INTERVAL = 0.18

# 玩家跳跃时，道路高度最多允许与玩家脚底预测层相差几格。
MAX_ROAD_HEIGHT_DIFFERENCE = 3

# 方块查询短缓存，降低高频 GetBlock 对客户端的压力。
BLOCK_CACHE_TTL = 0.15

AIR_NAMES = (
    "minecraft:air",
    "minecraft:cave_air",
    "minecraft:void_air",
    "air",
    ""
)

FACE_DOWN = 0
FACE_UP = 1
FACE_NORTH = 2
FACE_SOUTH = 3
FACE_WEST = 4
FACE_EAST = 5


# ============================================================
# 游戏对象
# ============================================================

factory = clientApi.GetEngineCompFactory()

level_id = None
local_id = None


# ============================================================
# Python 2/3 兼容
# ============================================================

try:
    text_type = unicode
except NameError:
    text_type = str


def to_text(value):
    if value is None:
        return ""

    try:
        if isinstance(value, text_type):
            return value
    except Exception:
        pass

    try:
        return str(value)
    except Exception:
        return ""


def to_ui_text(value):
    """CCUI 的 Python 2 绑定优先接收 UTF-8 字节串。"""
    value = to_text(value)
    try:
        if isinstance(value, unicode):
            return value.encode("utf-8")
    except NameError:
        pass
    return value


# ============================================================
# 原生物品渲染控件
# ============================================================

ScreenNode = clientApi.GetScreenNodeCls()


class BridgeItemRendererUI(ScreenNode):
    """复用客户端自带的 ItemRenderer 定义显示真实物品贴图。"""

    def __init__(self, namespace, name, param):
        ScreenNode.__init__(self, namespace, name, param)
        self.panel = None
        self.item = None
        self.renderer = None

    def Create(self):
        self.panel = self.GetBaseUIControl("/infoBtn")
        if self.panel is None:
            return
        self.item = self.panel.GetChildByPath("/item")
        renderer_base = self.panel.GetChildByPath("/item/item_renderer")
        if renderer_base is not None:
            self.renderer = renderer_base.asItemRenderer()

        # 只保留物品渲染层，屏蔽原按钮的交互和状态装饰。
        for control in (self.panel, self.item, renderer_base):
            if control is not None:
                try:
                    control.SetTouchEnable(False)
                except Exception:
                    pass
        for child_path in (
            "/unLock",
            "/item/entity",
            "/item/selectFrame"
        ):
            try:
                control = self.panel.GetChildByPath(child_path)
                if control is not None:
                    control.SetVisible(False)
            except Exception:
                pass

    def Configure(self, position, size):
        if self.panel is None:
            return False
        try:
            self.panel.SetGlobalPosition(position)
            self.panel.SetSize(size, True)
            if self.item is not None:
                self.item.SetGlobalPosition(position)
                self.item.SetSize(size, True)
            if self.renderer is not None:
                self.renderer.SetGlobalPosition(position)
                self.renderer.SetSize(size, True)
            return self.renderer is not None
        except Exception:
            return False

    def SetBridgeItem(self, item_name, aux_value):
        if self.renderer is None or not item_name:
            return False
        try:
            self.renderer.SetVisible(True)
            return self.renderer.SetUiItem(
                to_text(item_name),
                int(aux_value)
            ) is not False
        except Exception:
            return False

    def SetBridgeVisible(self, visible):
        try:
            if self.panel is not None:
                self.panel.SetVisible(bool(visible))
            return True
        except Exception:
            return False


# RegisterUI 按模块路径导入类。脚本可能由 execfile/run_path 运行，因此使用
# 固定的运行时模块别名，避免依赖加载器为中文文件名创建可导入模块。
RUNTIME_UI_MODULE = "intex_auto_bridge_runtime"
NATIVE_RENDERER_CLASS = "client.ui.blockInfoButton.BlockInfoButton"
try:
    runtime_ui_module = sys.modules.get(RUNTIME_UI_MODULE)
    if runtime_ui_module is None:
        runtime_ui_module = types.ModuleType(RUNTIME_UI_MODULE)
        sys.modules[RUNTIME_UI_MODULE] = runtime_ui_module
    runtime_ui_module.BridgeItemRendererUI = BridgeItemRendererUI
except Exception:
    pass


# ============================================================
# 自动搭路控制器
# ============================================================

class AutoBridge(ClientSystem):

    def __init__(self, namespace, system_name):
        super(AutoBridge, self).__init__(namespace, system_name)
        self.factory = factory

        self.level_id = None
        self.player_id = None

        self.running = False
        self.hub_managed = bool(getattr(sys, "_intex_hub_mode", False))

        # 当前道路所在的方块 Y 层。
        self.road_y = None

        # 最后一个确定存在的道路方块。
        self.last_anchor = None

        # 最后一个有效的水平方向。
        self.last_direction = None

        # 最近一次玩家位置，用于判断实际移动方向。
        self.last_player_position = None
        self.last_position_time = 0.0

        # 玩家实际水平移动方向。
        self.motion_direction = None
        self.motion_candidate = None
        self.motion_candidate_count = 0
        self.motion_axis_ratio = 1.0
        self.motion_direction_time = 0.0
        self.last_vertical_rise_time = 0.0
        self.last_vertical_delta = 0.0
        self.jump_cycle_active = False
        self.horizontal_speed = 0.0

        # 跨查询复用客户端组件，避免每次搭路循环重复创建。
        self.block_comp = None
        self.block_comp_level = None
        self.block_name_cache = {}

        # 每个目标最后一次提交时间。
        self.target_attempt_times = {}

        # 正在等待客户端世界同步的目标。
        self.pending_targets = {}

        self.item_name = "空手"
        self.item_count = 0
        self.item_aux = 0
        self.item_display_name = "等待方块"
        self.item_comp = None
        self.item_comp_player = None
        self.selected_slot = 0
        self.original_slot = None
        self.auto_slot = None
        self.auto_switch_active = False
        self.item_texture = ""
        self.item_is_block = False
        self.item_info_cache = {}
        self.last_hotbar_scan_time = 0.0
        self.last_hotbar_slot = None

        # 独立的长条快捷键（短按开关）与设置悬浮球（短按面板）。
        self.quick_root = None
        self.float_root = None
        self.quick_title = None
        self.quick_state = None
        self.quick_size = (196, 82)
        self.float_size = (76, 76)
        self.quick_screen_size = (1920, 1080)
        self.quick_touch_id = -1
        self.quick_dragging = False
        self.quick_drag_moved = False
        self.quick_drag_offset = (0, 0)
        self.quick_touch_start_time = 0.0
        self.quick_touch_origin = None
        self.quick_accent = None
        self.quick_icon_text = None
        self.float_accent = None
        self.float_icon_text = None
        self.float_touch_id = -1
        self.float_dragging = False
        self.float_drag_moved = False
        self.float_drag_offset = (0, 0)
        self.float_touch_start_time = 0.0
        self.float_touch_origin = None
        self.config_panel = None
        self.config_panel_visible = False
        self.config_labels = {}

        # 搭路配置：自动、仅水平、仅垂直（原地搭高）。
        self.extend_distance = 3
        self.axis_mode = "auto"
        self.locked_road_y = None
        self.jump_step_placed = False

        # 顶部中央的 CCUI 方块状态条。
        self.hud_root = None
        self.hud_icon = None
        self.hud_item_renderer_ui = None
        self.hud_item_renderer_name = ""
        self.hud_item_renderer_aux = 0
        self.hud_renderer_borrowed = False
        self.hud_native_renderer_active = False
        self.hud_accent = None
        self.hud_name = None
        self.hud_count = None
        self.hud_state = None
        self.hud_texture = ""
        self.hud_size = (360, 74)
        self.hud_screen_size = (1920, 1080)
        self.hud_touch_id = -1
        self.hud_dragging = False
        self.hud_drag_moved = False
        self.hud_drag_offset = (0, 0)
        self.hud_touch_start_time = 0.0
        self.hud_touch_origin = None

        # 客户端事件循环状态。
        self.tick_count = 0
        self.ui_error = ""
        self.leaving_world = False

        engine_namespace = clientApi.GetEngineNamespace()
        engine_system = clientApi.GetEngineSystemName()
        self.ListenForEvent(
            engine_namespace,
            engine_system,
            "OnScriptTickClient",
            self,
            self.OnScriptTickClient
        )
        self.ListenForEvent(
            engine_namespace,
            engine_system,
            "LeaveGameFinishClientEvent",
            self,
            self.OnLeaveWorld
        )
        self.ListenForEvent(
            engine_namespace,
            engine_system,
            "UnLoadClientAddonScriptsAfter",
            self,
            self.OnLeaveWorld
        )
        self.ListenForEvent(
            "Minecraft",
            "chatExtension",
            "PlayerExitRoom",
            self,
            self.OnLeaveWorld
        )


    # ========================================================
    # 世界与玩家 ID
    # ========================================================

    def refresh_ids(self):
        global level_id
        global local_id

        try:
            value = clientApi.GetLevelId()

            if value:
                if self.level_id != value:
                    self.block_comp = None
                    self.block_comp_level = None
                    self.block_name_cache.clear()
                self.level_id = value
                level_id = value
        except Exception:
            pass

        try:
            value = clientApi.GetLocalPlayerId()

            if value:
                if self.player_id != value:
                    self.item_comp = None
                    self.item_comp_player = None
                self.player_id = value
                local_id = value
        except Exception:
            pass

        return bool(self.level_id and self.player_id)

    # ========================================================
    # 消息显示
    # ========================================================

    def send_msg(self, message):
        """显示左上角通知。"""
        self.refresh_ids()

        try:
            comp = self.factory.CreateTextNotifyClient(
                self.level_id
            )

            if comp:
                comp.SetLeftCornerNotify(message)
                return True
        except Exception:
            pass

        return False

    def OnLeaveWorld(self, args=None):
        """退出时只清理当前进程节点，不再实现重进房间重建。"""
        self.leaving_world = True
        self.running = False
        self.restore_original_slot()
        self.pending_targets.clear()
        self.target_attempt_times.clear()
        self.locked_road_y = None
        self.remove_quick_button()
        self.level_id = None
        self.player_id = None
        self.block_comp = None
        self.block_comp_level = None
        self.block_name_cache.clear()
        self.item_comp = None
        self.item_comp_player = None
        self.jump_cycle_active = False
        self.jump_step_placed = False
        self.last_vertical_delta = 0.0

    def _set_overlay_visible(self, visible):
        for node in (
            self.quick_root,
            self.float_root,
            self.hud_root,
            self.config_panel
        ):
            if node is not None:
                try:
                    node.setVisible(
                        bool(visible)
                        and (
                            node is not self.config_panel
                            or self.config_panel_visible
                        )
                    )
                except Exception:
                    pass
        if self.hud_item_renderer_ui is not None:
            try:
                self.hud_item_renderer_ui.SetBridgeVisible(
                    bool(visible) and self.item_count > 0
                )
            except Exception:
                pass

    def _is_hud_screen(self):
        try:
            import gui
            return gui.get_top_screen() == "hud_screen"
        except Exception:
            return True

    def OnScriptTickClient(self):
        """可靠的客户端主循环；UI、提示和搭路不再依赖启动定时器。"""
        self.tick_count += 1

        if self.leaving_world:
            return

        if not self._is_hud_screen():
            self._set_overlay_visible(False)
            return

        self._set_overlay_visible(True)

        # GUI 树通常晚于脚本系统创建，每半秒重试一次。
        if self.tick_count % QUICK_UI_TICK_INTERVAL == 0:
            self._ensure_hud()

        if (
            not self.hub_managed
            and
            (self.quick_root is None or self.float_root is None)
            and self.tick_count % QUICK_UI_TICK_INTERVAL == 0
        ):
            self._create_quick_button()
        elif self.quick_root is not None and self.tick_count % 10 == 0:
            self._update_quick_button()

        if self.tick_count % HUD_TICK_DIVISOR == 0:
            self.update_display()

        if not self.running:
            return

        if self.tick_count % BUILD_TICK_DIVISOR == 0:
            self.build_tick()

    def update_display(self):
        """低频刷新手持物品与 CCUI 状态条。"""
        try:
            self.update_held_item_status()
            self._update_hud()
        except Exception:
            pass

    # ========================================================
    # 玩家位置和方向
    # ========================================================

    def get_player_position(self):
        if not self.refresh_ids():
            return None

        try:
            comp = self.factory.CreatePos(self.player_id)

            if not comp:
                return None

            get_foot = getattr(comp, "GetFootPos", None)

            if get_foot:
                try:
                    position = get_foot()

                    if position and len(position) >= 3:
                        return (
                            float(position[0]),
                            float(position[1]),
                            float(position[2])
                        )
                except Exception:
                    pass

            position = comp.GetPos()

            if position and len(position) >= 3:
                return (
                    float(position[0]),
                    float(position[1]),
                    float(position[2])
                )
        except Exception:
            pass

        return None

    def get_view_direction(self):
        """根据玩家视角取得主要水平坐标轴方向。"""
        if not self.refresh_ids():
            return self.last_direction

        try:
            comp = self.factory.CreateRot(self.player_id)

            if not comp:
                return self.last_direction

            rotation = comp.GetRot()

            if not rotation:
                return self.last_direction

            direction = clientApi.GetDirFromRot(rotation)

            if not direction or len(direction) < 3:
                return self.last_direction

            x = float(direction[0])
            z = float(direction[2])

            if abs(x) < 0.0001 and abs(z) < 0.0001:
                return self.last_direction

            if abs(x) >= abs(z):
                result = (
                    1 if x > 0 else -1,
                    0
                )
            else:
                result = (
                    0,
                    1 if z > 0 else -1
                )

            self.last_direction = result
            return result
        except Exception:
            return self.last_direction

    def update_motion_direction(self, position):
        """
        根据玩家实际位置变化计算移动方向。

        玩家边跑边转动视角时，实际运动方向通常比视角方向
        更适合用于搭路。
        """
        now = time.time()

        if self.last_player_position is not None:
            elapsed = now - self.last_position_time

            if elapsed > 0.0001:
                move_x = (
                    position[0]
                    - self.last_player_position[0]
                )
                move_z = (
                    position[2]
                    - self.last_player_position[2]
                )
                move_y = (
                    position[1]
                    - self.last_player_position[1]
                )

                self.last_vertical_delta = move_y
                if move_y >= 0.006:
                    if not self.jump_cycle_active:
                        self.jump_cycle_active = True
                        self.jump_step_placed = False
                    self.last_vertical_rise_time = now

                self.horizontal_speed = math.sqrt(
                    move_x * move_x + move_z * move_z
                ) / max(elapsed, 0.001)

                if (
                    abs(move_x) >= 0.01
                    or abs(move_z) >= 0.01
                ):
                    abs_x = abs(move_x)
                    abs_z = abs(move_z)
                    ratio = max(abs_x, abs_z) / max(min(abs_x, abs_z), 0.001)
                    candidate = None
                    if abs(move_x) >= abs(move_z):
                        candidate = (
                            1 if move_x > 0 else -1,
                            0
                        )
                    else:
                        candidate = (
                            0,
                            1 if move_z > 0 else -1
                        )

                    self.motion_axis_ratio = ratio
                    if candidate == self.motion_direction:
                        self.motion_candidate = None
                        self.motion_candidate_count = 0
                        self.motion_direction_time = now
                    else:
                        if candidate == self.motion_candidate:
                            self.motion_candidate_count += 1
                        else:
                            self.motion_candidate = candidate
                            self.motion_candidate_count = 1
                        required = 2 if self.motion_direction is None else 3
                        if self.motion_candidate_count >= required:
                            self.motion_direction = candidate
                            self.motion_direction_time = now
                            self.motion_candidate = None
                            self.motion_candidate_count = 0

        self.last_player_position = position
        self.last_position_time = now

        # 玩家停下后清除旧方向，避免转身后仍沿旧方向铺路。
        if (
            self.motion_direction is not None
            and now - self.motion_direction_time > MOTION_DIRECTION_TIMEOUT
        ):
            self.motion_direction = None
            self.motion_candidate = None
            self.motion_candidate_count = 0
    def get_build_direction(self, position):
        view_direction = self.get_view_direction()

        # 玩家正在移动时优先采用实际移动方向。
        if (
            self.motion_direction is not None
            and time.time() - self.motion_direction_time
            <= MOTION_DIRECTION_TIMEOUT
        ):
            if view_direction is None:
                return self.motion_direction
            same_axis = (
                (view_direction[0] == 0)
                == (self.motion_direction[0] == 0)
            )
            if same_axis or self.motion_axis_ratio >= 1.80:
                return self.motion_direction

        return view_direction

    # ========================================================
    # 方块查询
    # ========================================================

    def normalize_block_name(self, block):
        if block is None:
            return None

        if isinstance(block, dict):
            for key in (
                "name",
                "blockName",
                "block_name",
                "fullName",
                "full_name"
            ):
                value = block.get(key)

                if value is not None:
                    return to_text(value).lower()

            return None

        if isinstance(block, (list, tuple)):
            if not block:
                return None

            return to_text(block[0]).lower()

        return to_text(block).lower()

    def get_block_name(self, position):
        if position is None:
            return None

        if not self.refresh_ids():
            return None

        key = (
            int(position[0]),
            int(position[1]),
            int(position[2])
        )
        cached = self.block_name_cache.get(key)
        if cached is not None:
            cached_at, cached_name = cached
            if time.time() - cached_at <= BLOCK_CACHE_TTL:
                return cached_name
            try:
                del self.block_name_cache[key]
            except Exception:
                pass

        try:
            if (
                self.block_comp is None
                or self.block_comp_level != self.level_id
            ):
                self.block_comp = self.factory.CreateBlockInfo(
                    self.level_id
                )
                self.block_comp_level = self.level_id

            comp = self.block_comp

            if not comp:
                return None

            x, y, z = key

            # 3.9 客户端规范中的正式签名；旧版本再降级尝试其他签名。
            calls = (
                lambda: comp.GetBlock((x, y, z)),
                lambda: comp.GetBlock((x, y, z), 0),
                lambda: comp.GetBlock(x, y, z),
                lambda: comp.GetBlock(x, y, z, 0)
            )

            for call in calls:
                try:
                    name = self.normalize_block_name(
                        call()
                    )

                    if name is not None:
                        self.block_name_cache[key] = (time.time(), name)
                        if len(self.block_name_cache) > 192:
                            self.block_name_cache.clear()
                        return name
                except Exception:
                    pass
        except Exception:
            pass

        return None

    def is_air(self, position):
        name = self.get_block_name(position)

        if name is None:
            return None

        return name in AIR_NAMES

    def is_solid(self, position):
        air = self.is_air(position)

        if air is None:
            return None

        return not air

    # ========================================================
    # 手持物品
    # ========================================================

    def get_held_item(self):
        if not self.refresh_ids():
            return None

        try:
            comp = self.get_item_comp()

            if not comp:
                return None

            # 3.9 正式接口优先；部分版本 GetPlayerItem 的快捷栏映射会偏移。
            method = getattr(comp, "GetCarriedItem", None)
            if method:
                for call in (
                    lambda: method(False),
                    lambda: method()
                ):
                    try:
                        item = call()
                        if item:
                            try:
                                self.selected_slot = int(comp.GetSlotId())
                            except Exception:
                                pass
                            return item
                    except Exception:
                        pass

            # 降级为当前快捷栏槽位读取。
            try:
                slot = int(comp.GetSlotId())
                self.selected_slot = slot
                enum = clientApi.GetMinecraftEnum()
                item = comp.GetPlayerItem(
                    enum.ItemPosType.INVENTORY,
                    slot
                )
                if item:
                    return item
            except Exception:
                try:
                    item = comp.GetPlayerItem(0, self.selected_slot)
                    if item:
                        return item
                except Exception:
                    pass

        except Exception:
            pass

        return None

    def get_item_comp(self):
        if not self.refresh_ids():
            return None
        if (
            self.item_comp is None
            or self.item_comp_player != self.player_id
        ):
            self.item_comp = self.factory.CreateItem(self.player_id)
            self.item_comp_player = self.player_id
        return self.item_comp

    def get_item_name(self, item):
        if not isinstance(item, dict):
            return None

        for key in (
            "newItemName",
            "itemName",
            "name",
            "fullName",
            "identifier"
        ):
            value = item.get(key)

            if value:
                return to_text(value)

        return None

    def get_item_count(self, item):
        if not isinstance(item, dict):
            return 0

        for key in (
            "count",
            "num",
            "itemCount",
            "stackSize",
            "amount",
            "itemNum"
        ):
            if key not in item:
                continue

            try:
                return int(item.get(key, 0))
            except Exception:
                pass

        return 0

    def get_item_aux(self, item):
        if not isinstance(item, dict):
            return 0
        for key in ("newAuxValue", "auxValue", "aux", "itemAux"):
            if key in item:
                try:
                    return int(item.get(key, 0))
                except Exception:
                    pass
        return 0

    def get_item_metadata(self, item):
        name = self.get_item_name(item)
        aux = self.get_item_aux(item)
        if not name:
            return None
        cache_key = (name, aux)
        if cache_key in self.item_info_cache:
            return self.item_info_cache[cache_key]
        info = None
        try:
            comp = self.get_item_comp()
            method = getattr(comp, "GetItemBasicInfo", None)
            if method:
                info = method(name, aux, False)
        except TypeError:
            try:
                info = self.get_item_comp().GetItemBasicInfo(name, aux)
            except Exception:
                pass
        except Exception:
            pass
        if info is not None:
            self.item_info_cache[cache_key] = info
        return info

    def is_block_item(self, item):
        name = self.get_item_name(item)
        if not name or name.lower() in AIR_NAMES or self.get_item_count(item) <= 0:
            return False
        lowered = name.lower()
        if (
            "spawn_egg" in lowered
            or "spawn egg" in lowered
            or lowered.endswith("_egg")
            or lowered.endswith(":egg")
        ):
            return False
        block_types = ("block", "minecraft:block", "tile")
        non_block_types = (
            "item", "tool", "weapon", "food", "armor", "spawn_egg"
        )
        known_blocks = (
            "planks", "log", "wood", "stone", "cobblestone",
            "dirt", "grass", "deepslate", "netherrack", "brick",
            "concrete", "terracotta", "wool", "sandstone", "obsidian",
            "glass", "ore", "block", "clay", "mud", "ice"
        )
        if isinstance(item, dict):
            direct_type = to_text(item.get("itemType", "")).lower()
            if direct_type in block_types:
                return True
            if direct_type in non_block_types:
                return False
            for key in ("isBlock", "is_block"):
                if key in item:
                    return bool(item.get(key))
        info = self.get_item_metadata(item)
        if isinstance(info, dict):
            item_type = to_text(info.get("itemType", "")).lower()
            if item_type in block_types:
                return True
            if item_type in non_block_types:
                return False
            for key in ("isBlock", "is_block"):
                if key in info:
                    return bool(info.get(key))
        # 无法取得物品类型时只接受明确的常见方块，未知物品默认拒绝。
        return any(word in lowered for word in known_blocks)

    def get_item_texture(self, item):
        name = self.get_item_name(item)
        if not name:
            return ""
        aux = self.get_item_aux(item)
        cache_key = ("texture", name, aux)
        if cache_key in self.item_info_cache:
            return self.item_info_cache[cache_key] or ""
        texture = ""
        # 3.9 客户端物品组件本身调用的就是低层 item 模块。
        try:
            import item as item_module
            texture = item_module.get_item_texture_path(name, aux) or ""
        except Exception:
            try:
                from minecraft import item as item_module
                texture = item_module.get_item_texture_path(name, aux) or ""
            except Exception:
                pass
        # 部分版本只对 GetItemTexture 暴露贴图路径。
        if not texture:
            try:
                comp = self.get_item_comp()
                method = getattr(comp, "GetItemTexture", None)
                if method:
                    texture = method(name) or ""
            except Exception:
                pass
        if isinstance(texture, dict):
            texture = (
                texture.get("texturePath")
                or texture.get("path")
                or texture.get("texture")
                or ""
            )
        elif isinstance(texture, (list, tuple)):
            texture = texture[0] if texture else ""
        texture = to_text(texture)
        if texture:
            self.item_info_cache[cache_key] = texture
        return texture

    def get_item_display_name(self, item):
        name = self.get_item_name(item)
        if not name:
            return "等待方块"
        aux = self.get_item_aux(item)
        cache_key = ("display", name, aux)
        if cache_key in self.item_info_cache:
            return self.item_info_cache[cache_key]
        display = ""
        try:
            method = getattr(self.get_item_comp(), "GetItemHoverName", None)
            if method:
                display = to_text(method(name, aux) or "")
        except Exception:
            pass
        if not display:
            display = name.split(":")[-1]
        self.item_info_cache[cache_key] = display
        return display

    def get_selected_slot(self):
        try:
            slot = int(self.get_item_comp().GetSlotId())
            if 0 <= slot <= 8:
                self.selected_slot = slot
                return slot
        except Exception:
            pass
        return self.selected_slot

    def get_hotbar_item(self, slot):
        try:
            comp = self.get_item_comp()
            enum = clientApi.GetMinecraftEnum()
            return comp.GetPlayerItem(enum.ItemPosType.INVENTORY, int(slot))
        except Exception:
            try:
                return self.get_item_comp().GetPlayerItem(0, int(slot))
            except Exception:
                return None

    def select_slot(self, slot):
        try:
            slot = int(slot)
        except Exception:
            return False
        if slot < 0 or slot > 8:
            return False
        try:
            method = getattr(local_player, "local_player_select_slot", None)
            if method:
                result = method(slot)
                self.selected_slot = slot
                return result is not False
        except Exception:
            pass
        try:
            import gui
            gui.simulate_keyboard_event(49 + slot, 1)
            gui.simulate_keyboard_event(49 + slot, 0)
            self.selected_slot = slot
            return True
        except Exception:
            return False

    def find_hotbar_block(self):
        now = time.time()
        if now - self.last_hotbar_scan_time < 0.50:
            return self.last_hotbar_slot
        self.last_hotbar_scan_time = now
        best_slot = None
        best_score = -1
        for slot in range(9):
            item = self.get_hotbar_item(slot)
            if self.is_block_item(item):
                count = self.get_item_count(item)
                name = (self.get_item_name(item) or "").lower()
                score = count
                preferred = (
                    "cobblestone", "stone", "dirt", "planks",
                    "deepslate", "netherrack", "terracotta"
                )
                risky = (
                    "sand", "gravel", "tnt", "torch", "ladder",
                    "carpet", "flower", "sapling", "rail", "button",
                    "pressure_plate", "door", "trapdoor", "slab",
                    "stairs", "fence", "wall"
                )
                if any(word in name for word in preferred):
                    score += 2000
                elif any(word in name for word in risky):
                    score += 0
                else:
                    score += 1000
                if score > best_score:
                    best_score = score
                    best_slot = slot
        self.last_hotbar_slot = best_slot
        return best_slot

    def ensure_placeable_item(self):
        item = self.update_held_item_status()
        if self.item_is_block:
            return True

        slot = self.find_hotbar_block()
        if slot is None:
            return False

        current = self.get_selected_slot()
        if not self.auto_switch_active:
            self.original_slot = current
        if slot != current and not self.select_slot(slot):
            return False

        self.auto_slot = slot
        self.auto_switch_active = True
        return False

    def restore_original_slot(self):
        if self.auto_switch_active and self.original_slot is not None:
            self.select_slot(self.original_slot)
        self.original_slot = None
        self.auto_slot = None
        self.auto_switch_active = False
        self.last_hotbar_slot = None
        self.last_hotbar_scan_time = 0.0

    def update_held_item_status(self):
        item = self.get_held_item()

        self.item_name = (
            self.get_item_name(item) or "空手"
        )
        self.item_count = self.get_item_count(item)
        self.item_aux = self.get_item_aux(item)
        self.item_is_block = self.is_block_item(item)
        self.item_texture = self.get_item_texture(item) if self.item_count > 0 else ""
        self.item_display_name = self.get_item_display_name(item)

        return item

    def has_placeable_item(self):
        return self.ensure_placeable_item()

    # ========================================================
    # 支撑方块和点击面
    # ========================================================

    def face_between(self, support, target):
        if support is None or target is None:
            return None

        offset = (
            int(target[0]) - int(support[0]),
            int(target[1]) - int(support[1]),
            int(target[2]) - int(support[2])
        )

        return {
            (0, -1, 0): FACE_DOWN,
            (0, 1, 0): FACE_UP,
            (0, 0, -1): FACE_NORTH,
            (0, 0, 1): FACE_SOUTH,
            (-1, 0, 0): FACE_WEST,
            (1, 0, 0): FACE_EAST
        }.get(offset)

    def is_support_ready(self, position):
        if self.is_solid(position) is True:
            return True
        pending_at = self.pending_targets.get(tuple(position))
        return (
            pending_at is not None
            and time.time() - pending_at < PENDING_TIMEOUT
        )

    def find_support(self, target, preferred=None):
        if target is None:
            return None, None

        if preferred is not None:
            face = self.face_between(
                preferred,
                target
            )

            if (
                face is not None
                and self.is_support_ready(preferred)
            ):
                return preferred, face

        candidates = (
            ((0, -1, 0), FACE_UP),
            ((0, 0, -1), FACE_SOUTH),
            ((0, 0, 1), FACE_NORTH),
            ((-1, 0, 0), FACE_EAST),
            ((1, 0, 0), FACE_WEST),
            ((0, 1, 0), FACE_DOWN)
        )

        for offset, face in candidates:
            support = (
                int(target[0]) + offset[0],
                int(target[1]) + offset[1],
                int(target[2]) + offset[2]
            )

            if self.is_support_ready(support):
                return support, face

        return None, None

    # ========================================================
    # 道路高度
    # ========================================================

    def update_road_height(self, player_position):
        x = int(math.floor(player_position[0]))
        z = int(math.floor(player_position[2]))

        predicted_layer = (
            int(math.floor(player_position[1])) - 1
        )

        if self.axis_mode == "horizontal" and self.locked_road_y is not None:
            self.road_y = self.locked_road_y
            return

        direct_below = (
            x,
            predicted_layer,
            z
        )

        # 只有玩家当前预测层确实有实体方块时才更新道路高度。
        if self.is_solid(direct_below) is True:
            self.road_y = predicted_layer
            if self.axis_mode == "horizontal" and self.locked_road_y is None:
                self.locked_road_y = predicted_layer
            self.last_anchor = direct_below
            return

        # 跳跃或短暂腾空时保留旧道路高度。
        if self.road_y is not None:
            difference = abs(
                predicted_layer - self.road_y
            )

            if difference <= MAX_ROAD_HEIGHT_DIFFERENCE:
                return

        # 初始化时向下扫描最多四层。
        for offset in (0, -1, -2, -3):
            candidate_y = predicted_layer + offset
            candidate = (
                x,
                candidate_y,
                z
            )

            if self.is_solid(candidate) is True:
                self.road_y = candidate_y
                self.last_anchor = candidate
                return

        if self.road_y is None:
            self.road_y = predicted_layer

    # ========================================================
    # 目标计算
    # ========================================================

    def calculate_placement(self):
        position = self.get_player_position()

        if position is None:
            return None

        self.update_motion_direction(position)
        self.update_road_height(position)

        if self.road_y is None:
            return None

        x = int(math.floor(position[0]))
        z = int(math.floor(position[2]))

        now = time.time()
        foot_above_road = position[1] - (float(self.road_y) + 1.0)
        if (
            self.jump_cycle_active
            and self.last_vertical_delta <= 0.002
            and foot_above_road <= 0.12
            and now - self.last_vertical_rise_time >= 0.22
        ):
            self.jump_cycle_active = False
            self.jump_step_placed = False
        rising_recently = (
            self.jump_cycle_active
            and now - self.last_vertical_rise_time <= 0.95
        )

        # 锁 Y 轴：只允许原地跳跃垫高，不计算任何水平目标。
        if self.axis_mode == "vertical":
            tower_target = (x, int(self.road_y) + 1, z)
            tower_support = (x, int(self.road_y), z)
            if (
                rising_recently
                and foot_above_road >= 0.42
                and not self.jump_step_placed
                and self.is_air(tower_target) is True
                and tower_target not in self.pending_targets
                and self.is_support_ready(tower_support)
            ):
                return {
                    "target": tower_target,
                    "support": tower_support,
                    "face": FACE_UP,
                    "jump_step": True
                }
            return None

        direction = self.get_build_direction(position)
        if direction is None:
            return None
        dx, dz = direction
        under = (x, int(self.road_y), z)

        # 自动模式只铺单格道路。跳跃时优先在前方道路上叠一格，
        # 玩家接近跳跃最高点时再尝试脚下，减少碰撞导致的放置失败。
        if (
            self.axis_mode == "auto"
            and rising_recently
            and foot_above_road >= 0.18
            and not self.jump_step_placed
        ):
            distances = [1]
            if foot_above_road >= 0.90:
                distances.append(0)
            for step_distance in distances:
                step_target = (
                    x + dx * step_distance,
                    int(self.road_y) + 1,
                    z + dz * step_distance
                )
                step_support = (
                    step_target[0],
                    int(self.road_y),
                    step_target[2]
                )
                if (
                    self.is_air(step_target) is True
                    and step_target not in self.pending_targets
                    and self.is_support_ready(step_support)
                ):
                    return {
                        "target": step_target,
                        "support": step_support,
                        "face": FACE_UP,
                        "jump_step": True
                    }

        # 第一优先级：脚下道路为空，立即补脚底。
        if self.is_air(under) is True and under not in self.pending_targets:
            behind = (
                x - dx,
                int(self.road_y),
                z - dz
            )

            support, face = self.find_support(
                under,
                behind
            )

            if support is None:
                support, face = self.find_support(
                    under,
                    self.last_anchor
                )

            if support is not None and face is not None:
                return {
                    "target": under,
                    "support": support,
                    "face": face
                }

        lookahead = max(1, min(5, int(self.extend_distance)))

        previous = under

        for distance in range(1, lookahead + 1):
            target = (
                x + dx * distance,
                int(self.road_y),
                z + dz * distance
            )

            target_air = self.is_air(target)

            if target_air is None:
                return None

            if target_air is True:
                if target in self.pending_targets:
                    previous = target
                    continue
                support, face = self.find_support(
                    target,
                    previous
                )

                if support is None:
                    support, face = self.find_support(
                        target,
                        self.last_anchor
                    )

                if support is not None and face is not None:
                    return {
                        "target": target,
                        "support": support,
                        "face": face
                    }

                return None

            previous = target
            self.last_anchor = target

        return None

    # ========================================================
    # 放置调用
    # ========================================================

    def get_build_method(self):
        if local_player is None:
            return None

        return getattr(
            local_player,
            "local_player_build_block",
            None
        )

    def submit_placement(self, placement):
        method = self.get_build_method()

        if method is None:
            return False

        support = placement["support"]
        face = placement["face"]

        # 首选文档中的四参数签名。
        try:
            result = method(
                int(support[0]),
                int(support[1]),
                int(support[2]),
                int(face)
            )

            return result is not False
        except TypeError:
            # 只在四参数签名不兼容时尝试元组签名。
            try:
                result = method(
                    (
                        int(support[0]),
                        int(support[1]),
                        int(support[2])
                    ),
                    int(face)
                )

                return result is not False
            except Exception:
                return False
        except Exception:
            return False

    # ========================================================
    # 放置验证
    # ========================================================

    def verify_pending_targets(self, now):
        targets = list(self.pending_targets.keys())

        for target in targets:
            target_air = self.is_air(target)

            if target_air is False:
                self.last_anchor = target

                try:
                    del self.pending_targets[target]
                except Exception:
                    pass

                continue

            started = self.pending_targets.get(
                target,
                now
            )

            if now - started >= PENDING_TIMEOUT:
                try:
                    del self.pending_targets[target]
                except Exception:
                    pass

    # ========================================================
    # 搭路主循环
    # ========================================================

    def build_tick(self):
        if not self.running:
            return

        now = time.time()

        try:
            if not self.refresh_ids():
                return

            # 验证不会阻止继续计算和放置其他目标。
            self.verify_pending_targets(now)

            if not self.has_placeable_item():
                return

            placement = self.calculate_placement()

            if placement is None:
                return

            target = placement["target"]

            # 客户端尚未同步的目标不要连续点击，先让验证逻辑等待结果。
            pending_at = self.pending_targets.get(target)
            if (
                pending_at is not None
                and now - pending_at < PENDING_RETRY_INTERVAL
            ):
                return

            previous_attempt = (
                self.target_attempt_times.get(
                    target,
                    0.0
                )
            )

            if (
                now - previous_attempt
                < TARGET_RETRY_INTERVAL
            ):
                return

            self.target_attempt_times[target] = now
            success = self.submit_placement(placement)

            if success:
                try:
                    del self.block_name_cache[target]
                except Exception:
                    pass
                self.pending_targets[target] = now
                if placement.get("jump_step"):
                    self.jump_step_placed = True

            # 清理过期的目标限速记录。
            if len(self.target_attempt_times) > 32:
                old_targets = list(
                    self.target_attempt_times.keys()
                )

                for old_target in old_targets:
                    attempt_time = (
                        self.target_attempt_times.get(
                            old_target,
                            now
                        )
                    )

                    if now - attempt_time > 2.0:
                        try:
                            del self.target_attempt_times[
                                old_target
                            ]
                        except Exception:
                            pass

        except Exception:
            pass

    def _make_layout(self, x, y, width, height, color, opacity=255):
        node = ccui.Layout.create()
        node.setContentSize(cc.Size(width, height))
        node.setPosition(cc.Vec2(x, y))
        node.setBackGroundColorType(ccui.LAYOUT_BACKGROUNDCOLORTYPE_SOLID)
        node.setBackGroundColor(color)
        node.setBackGroundColorOpacity(opacity)
        return node

    def _make_text(self, text, x, y, size, color, parent, anchor=0.0):
        node = ccui.Text.create(to_ui_text(text), "FZLTHJW_1", size)
        node.setPosition(cc.Vec2(x, y))
        node.setAnchorPoint(cc.Vec2(anchor, 0.5))
        node.setTextColor(color)
        parent.addChild(node)
        return node

    def _set_node_text(self, node, value):
        """兼容不同 CCUI 绑定的 setText/setString 与 unicode/UTF-8 要求。"""
        if node is None:
            return False
        values = (to_ui_text(value), to_text(value))
        for method_name in ("setText", "setString"):
            method = getattr(node, method_name, None)
            if method is None:
                continue
            for text_value in values:
                try:
                    method(text_value)
                    return True
                except Exception:
                    pass
        return False

    def _ensure_hud(self):
        if self.hud_root is not None:
            self._ensure_hud_item_renderer()
            return True
        if not CCUI_AVAILABLE:
            return False
        try:
            from gui_2d import GUI
            base = GUI.ui_mgr._base_node
            if base is None:
                return False
            size = cc.Director.getInstance().getWinSize()
            sw, sh = float(size.width), float(size.height)

            width, height = 360, 74
            x = max(8, (sw - width) / 2.0)
            y = max(100, sh * 0.62)
            root = self._make_layout(
                x, y, width, height, cc.Color3B(23, 27, 31), 226
            )
            base.addChild(root, 9999)

            accent = self._make_layout(
                0, 0, 5, height, cc.Color3B(66, 165, 245), 255
            )
            root.addChild(accent)

            icon_frame = self._make_layout(
                14, 9, 56, 56, cc.Color3B(12, 15, 18), 220
            )
            root.addChild(icon_frame)

            icon = ccui.ImageView.create()
            icon.setPosition(cc.Vec2(28, 28))
            try:
                icon.ignoreContentAdaptWithSize(False)
                icon.setContentSize(cc.Size(44, 44))
            except Exception:
                pass
            icon_frame.addChild(icon)

            self.hud_name = self._make_text(
                "等待方块", 86, 48, 20,
                cc.Color4B(245, 247, 250, 255), root
            )
            self.hud_count = self._make_text(
                "x0", 86, 23, 18,
                cc.Color4B(174, 183, 193, 255), root
            )
            self.hud_state = self._make_text(
                "运行中", width - 18, height / 2, 17,
                cc.Color4B(129, 199, 132, 255), root, 1.0
            )

            hud_hit = ccui.Layout.create()
            hud_hit.setContentSize(cc.Size(width, height))
            hud_hit.setPosition(cc.Vec2(0, 0))
            hud_hit.setTouchEnabled(True)
            try:
                hud_hit.setSwallowTouches(True)
            except Exception:
                pass
            hud_hit.addTouchEventListener(self._on_hud_touch)
            root.addChild(hud_hit)

            self.hud_root = root
            self.hud_icon = icon
            self.hud_accent = accent
            self.hud_texture = ""
            self.hud_screen_size = (sw, sh)
            self._ensure_hud_item_renderer()
            self._update_hud()
            return True
        except Exception as error:
            self.ui_error = "顶部状态条异常: %s" % to_text(error)[:80]
            try:
                root.removeFromParent(True)
            except Exception:
                pass
            return False

    def _hud_renderer_position(self):
        """将 CCUI 左下角坐标转换为原生 HUD 的左上角坐标。"""
        if self.hud_root is None:
            return None
        try:
            pos = self.hud_root.getPosition()
            sh = float(self.hud_screen_size[1])
            return (float(pos.x) + 18.0, sh - float(pos.y) - 61.0)
        except Exception:
            return None

    def _sync_hud_item_renderer_position(self):
        if self.hud_item_renderer_ui is None:
            return False
        position = self._hud_renderer_position()
        if position is None:
            return False
        return self._configure_hud_renderer(
            self.hud_item_renderer_ui, position, (48, 48)
        )

    def _renderer_controls(self, ui_node):
        panel = getattr(ui_node, "panel", None)
        item_control = getattr(ui_node, "item", None)
        renderer = getattr(ui_node, "renderer", None)
        if renderer is None:
            renderer = getattr(ui_node, "itemRender", None)
        return panel, item_control, renderer

    def _configure_hud_renderer(self, ui_node, position, size):
        if ui_node is None:
            return False
        configure = getattr(ui_node, "Configure", None)
        if configure is not None:
            try:
                return bool(configure(position, size))
            except Exception:
                pass
        panel, item_control, renderer = self._renderer_controls(ui_node)
        if renderer is None:
            return False
        for control in (panel, item_control, renderer):
            if control is None:
                continue
            try:
                control.SetTouchEnable(False)
            except Exception:
                pass
            try:
                control.SetGlobalPosition(position)
                control.SetSize(size, True)
            except Exception:
                pass
        for control_name in ("entityIcon", "unLockImg", "selectFrame"):
            control = getattr(ui_node, control_name, None)
            if control is not None:
                try:
                    control.SetVisible(False)
                except Exception:
                    pass
        return True

    def _set_hud_renderer_item(self, ui_node, item_name, aux_value):
        method = getattr(ui_node, "SetBridgeItem", None)
        if method is not None:
            try:
                return method(item_name, aux_value) is not False
            except Exception:
                pass
        method = getattr(ui_node, "SetBlockInfo", None)
        if method is not None:
            try:
                method({
                    "stage": "block",
                    "isUnlock": True,
                    "name": to_text(item_name),
                    "aux": int(aux_value)
                })
                return True
            except Exception:
                pass
        unused_panel, unused_item, renderer = self._renderer_controls(ui_node)
        if renderer is None:
            return False
        try:
            renderer.SetVisible(True)
            return renderer.SetUiItem(
                to_text(item_name), int(aux_value)
            ) is not False
        except Exception:
            return False

    def _set_hud_renderer_visible(self, ui_node, visible):
        method = getattr(ui_node, "SetBridgeVisible", None)
        if method is not None:
            try:
                method(bool(visible))
                return
            except Exception:
                pass
        method = getattr(ui_node, "SetScreenVisible", None)
        if method is not None:
            try:
                method(bool(visible))
            except Exception:
                pass
        panel, unused_item, renderer = self._renderer_controls(ui_node)
        for control in (panel, renderer):
            if control is not None:
                try:
                    control.SetVisible(bool(visible))
                except Exception:
                    pass

    def _ensure_hud_item_renderer(self):
        """创建 3.9 原生 ItemRenderer；失败时继续使用图片回退。"""
        if self.hud_root is None or self.leaving_world:
            return False
        if self.hud_item_renderer_ui is not None:
            return self._sync_hud_item_renderer_position()

        namespace = "InfTexAutoBridge"
        ui_key = "bridgeNativeItemRenderer"
        try:
            ui_node = clientApi.GetUI(namespace, ui_key)
        except Exception:
            ui_node = None

        if ui_node is None:
            try:
                clientApi.RegisterUI(
                    namespace,
                    ui_key,
                    NATIVE_RENDERER_CLASS,
                    "blockInfoBtn.main"
                )
                created = clientApi.CreateUI(
                    namespace,
                    ui_key,
                    {
                        "isHud": 1,
                        "update_screen": False,
                        "fresh_async": False
                    }
                )
                ui_node = created or clientApi.GetUI(namespace, ui_key)
            except Exception as error:
                self.ui_error = "原生方块贴图创建失败: %s" % to_text(error)[:80]
                ui_node = None

        # 某些裁剪版客户端没有暴露内置类，再回退到运行时包装类。
        if ui_node is None:
            ui_key = "bridgeItemRendererFallback"
            try:
                clientApi.RegisterUI(
                    namespace,
                    ui_key,
                    RUNTIME_UI_MODULE + ".BridgeItemRendererUI",
                    "blockInfoBtn.main"
                )
                created = clientApi.CreateUI(
                    namespace,
                    ui_key,
                    {
                        "isHud": 1,
                        "update_screen": False,
                        "fresh_async": False
                    }
                )
                ui_node = created or clientApi.GetUI(namespace, ui_key)
            except Exception as error:
                self.ui_error = "方块贴图回退失败: %s" % to_text(error)[:80]
                ui_node = None

        # 最后复用客户端官方已注册的方块信息按钮。此节点由游戏资源包
        # 创建，兼容性高于动态注册；借用时退出只隐藏，不销毁官方节点。
        if ui_node is None:
            try:
                ui_node = clientApi.GetUI("BlockInfoBtn", "blockInfoBtn")
            except Exception:
                ui_node = None
            if ui_node is None:
                try:
                    clientApi.RegisterUI(
                        "BlockInfoBtn", "blockInfoBtn",
                        NATIVE_RENDERER_CLASS, "blockInfoBtn.main"
                    )
                    clientApi.CreateUI(
                        "BlockInfoBtn", "blockInfoBtn", {"isHud": 1}
                    )
                    ui_node = clientApi.GetUI(
                        "BlockInfoBtn", "blockInfoBtn"
                    )
                except Exception as error:
                    self.ui_error = "官方方块贴图节点失败: %s" % to_text(error)[:80]
                    ui_node = None
            if ui_node is not None:
                self.hud_renderer_borrowed = True

        unused_panel, unused_item, renderer = self._renderer_controls(ui_node)
        if ui_node is None or renderer is None:
            return False

        self.hud_item_renderer_ui = ui_node
        self.hud_item_renderer_name = ""
        self.hud_item_renderer_aux = 0
        return self._sync_hud_item_renderer_position()

    def _remove_hud_item_renderer(self):
        ui_node = self.hud_item_renderer_ui
        if ui_node is None:
            try:
                ui_node = clientApi.GetUI(
                    "InfTexAutoBridge", "bridgeNativeItemRenderer"
                ) or clientApi.GetUI(
                    "InfTexAutoBridge", "bridgeItemRendererFallback"
                )
            except Exception:
                ui_node = None
        if ui_node is not None:
            try:
                self._set_hud_renderer_visible(ui_node, False)
            except Exception:
                pass
            if self.hud_renderer_borrowed:
                try:
                    ui_node.SetBlockInfo(None)
                except Exception:
                    pass
            else:
                try:
                    ui_node.SetRemove()
                except Exception:
                    pass
        self.hud_item_renderer_ui = None
        self.hud_item_renderer_name = ""
        self.hud_item_renderer_aux = 0
        self.hud_native_renderer_active = False
        self.hud_renderer_borrowed = False

    def _update_hud(self):
        if self.hud_root is None and not self._ensure_hud():
            return
        try:
            has_item = (
                self.item_count > 0
                and self.item_name
                and self.item_name.lower() not in AIR_NAMES
            )
            if has_item:
                count_text = "x%d" % self.item_count
                name_text = to_ui_text(self.item_display_name or self.item_name)
                self._set_node_text(self.hud_count, count_text)
                self._set_node_text(self.hud_name, name_text)
            else:
                self._set_node_text(self.hud_count, "x0")
                self._set_node_text(self.hud_name, "等待方块")

            if self.running:
                self.hud_state.setText("运行中")
                self.hud_state.setTextColor(cc.Color4B(129, 199, 132, 255))
                self.hud_accent.setBackGroundColor(cc.Color3B(66, 165, 245))
            else:
                self.hud_state.setText("已关闭")
                self.hud_state.setTextColor(cc.Color4B(239, 154, 154, 255))
                self.hud_accent.setBackGroundColor(cc.Color3B(117, 117, 117))

            was_native_renderer_active = self.hud_native_renderer_active
            renderer_ready = self._ensure_hud_item_renderer()
            renderer_loaded = False
            if renderer_ready and has_item:
                item_changed = (
                    self.item_name != self.hud_item_renderer_name
                    or self.item_aux != self.hud_item_renderer_aux
                )
                if item_changed:
                    renderer_loaded = bool(
                        self._set_hud_renderer_item(
                            self.hud_item_renderer_ui,
                            self.item_name,
                            self.item_aux
                        )
                    )
                    if renderer_loaded:
                        self.hud_item_renderer_name = self.item_name
                        self.hud_item_renderer_aux = self.item_aux
                else:
                    renderer_loaded = True
                self._set_hud_renderer_visible(
                    self.hud_item_renderer_ui, renderer_loaded
                )
            elif self.hud_item_renderer_ui is not None:
                self._set_hud_renderer_visible(
                    self.hud_item_renderer_ui, False
                )

            if renderer_loaded:
                self.hud_icon.setVisible(False)
                self.hud_texture = self.item_texture
                self.hud_native_renderer_active = True
            elif (
                self.item_texture != self.hud_texture
                or was_native_renderer_active
            ):
                self.hud_native_renderer_active = False
                self.hud_texture = self.item_texture
                if self.item_texture:
                    texture_candidates = [self.item_texture]
                    if not self.item_texture.lower().endswith(".png"):
                        texture_candidates.append(self.item_texture + ".png")
                    basename = self.item_texture.replace("\\", "/").split("/")[-1]
                    if basename:
                        texture_candidates.append(basename)
                        if not basename.lower().endswith(".png"):
                            texture_candidates.append(basename + ".png")
                    loaded = None
                    attempted = False
                    loaded_success = False
                    for candidate in texture_candidates:
                        texture_path = to_ui_text(candidate)
                        try:
                            loaded = self.hud_icon.loadTexture(
                                texture_path,
                                ccui.WIDGET_TEXTURERESTYPE_PLIST
                            )
                            attempted = True
                        except Exception:
                            pass
                        if loaded is not False and attempted:
                            loaded_success = True
                            break
                        try:
                            loaded = self.hud_icon.loadTexture(
                                texture_path,
                                ccui.WIDGET_TEXTURERESTYPE_LOCAL
                            )
                            attempted = True
                        except Exception:
                            pass
                        if loaded is not False and attempted:
                            loaded_success = True
                            break
                        try:
                            loaded = self.hud_icon.loadTexture(texture_path)
                            if loaded is not False:
                                attempted = True
                                loaded_success = True
                                break
                        except Exception:
                            pass
                    self.hud_icon.setVisible(loaded_success)
                else:
                    self.hud_icon.setVisible(False)
        except Exception as error:
            self.ui_error = "状态条刷新异常: %s" % to_text(error)[:80]

    def _add_click_area(self, parent, x, y, width, height, callback):
        hit = self._make_layout(
            x, y, width, height, cc.Color3B(255, 255, 255), 0
        )
        hit.setTouchEnabled(True)
        try:
            hit.setSwallowTouches(True)
        except Exception:
            pass

        def on_touch(widget, event_type, touch_id):
            if event_type == ccui.TOUCH_EVENT_ENDED:
                callback()

        hit.addTouchEventListener(on_touch)
        parent.addChild(hit)
        return hit

    def _make_panel_button(self, parent, x, y, width, height, text, callback):
        button = self._make_layout(
            x, y, width, height, cc.Color3B(45, 52, 60), 255
        )
        parent.addChild(button)
        label = self._make_text(
            text, width / 2, height / 2, 17,
            cc.Color4B(238, 241, 245, 255), button, 0.5
        )
        self._add_click_area(button, 0, 0, width, height, callback)
        return button, label

    def _create_config_panel(self, base, sw, sh):
        if self.config_panel is not None:
            return True

        width, height = 430, 286
        root = self._make_layout(
            0, 0, width, height, cc.Color3B(22, 26, 31), 246
        )
        base.addChild(root, 9999)

        header = self._make_layout(
            0, height - 54, width, 54, cc.Color3B(31, 37, 44), 255
        )
        root.addChild(header)
        self._make_text(
            "自动搭路设置", 20, 27, 22,
            cc.Color4B(245, 247, 250, 255), header
        )
        self._make_panel_button(
            header, width - 52, 8, 42, 38, "X", self.toggle_config_panel
        )

        self._make_text(
            "延伸距离", 24, 196, 18,
            cc.Color4B(195, 202, 211, 255), root
        )
        self._make_panel_button(
            root, 168, 177, 46, 42, "-", lambda: self.change_extend(-1)
        )
        distance_bg = self._make_layout(
            224, 177, 74, 42, cc.Color3B(14, 17, 21), 255
        )
        root.addChild(distance_bg)
        self.config_labels["distance"] = self._make_text(
            str(self.extend_distance), 37, 21, 20,
            cc.Color4B(255, 255, 255, 255), distance_bg, 0.5
        )
        self._make_panel_button(
            root, 308, 177, 46, 42, "+", lambda: self.change_extend(1)
        )

        self._make_text(
            "搭路模式", 24, 135, 18,
            cc.Color4B(195, 202, 211, 255), root
        )
        modes = (
            ("auto", "自动"),
            ("horizontal", "锁水平"),
            ("vertical", "锁Y轴")
        )
        button_width = 102
        for index, mode_info in enumerate(modes):
            mode_key, mode_text = mode_info
            button, label = self._make_panel_button(
                root,
                24 + index * (button_width + 12),
                88,
                button_width,
                42,
                mode_text,
                lambda key=mode_key: self.set_axis_mode(key)
            )
            self.config_labels["mode_" + mode_key] = (button, label)

        power_button, power_label = self._make_panel_button(
            root, 24, 24, width - 48, 46,
            "自动搭路", self.toggle
        )
        self.config_labels["power"] = (power_button, power_label)

        self.config_panel = root
        self.config_panel_visible = False
        root.setVisible(False)
        self._position_config_panel()
        self._refresh_config_panel()
        return True

    def _position_config_panel(self):
        if self.config_panel is None or self.float_root is None:
            return
        try:
            rp = self.float_root.getPosition()
            sw, sh = self.quick_screen_size
            panel_size = self.config_panel.getContentSize()
            x = rp.x - panel_size.width - 14
            if x < 8:
                x = rp.x + self.float_size[0] + 14
            x = max(8, min(sw - panel_size.width - 8, x))
            y = max(8, min(sh - panel_size.height - 8, rp.y - panel_size.height / 2))
            self.config_panel.setPosition(cc.Vec2(x, y))
        except Exception:
            pass

    def toggle_config_panel(self):
        if self.config_panel is None:
            return
        self.config_panel_visible = not self.config_panel_visible
        self.config_panel.setVisible(self.config_panel_visible)
        self._refresh_config_panel()

    def change_extend(self, delta):
        self.extend_distance = max(1, min(5, self.extend_distance + int(delta)))
        self._refresh_config_panel()

    def set_axis_mode(self, mode):
        if mode not in ("auto", "horizontal", "vertical"):
            return
        self.axis_mode = mode
        self.jump_cycle_active = False
        self.jump_step_placed = False
        self.locked_road_y = self.road_y if mode == "horizontal" else None
        self._refresh_config_panel()

    def _refresh_config_panel(self):
        if not self.config_labels:
            return
        try:
            self._set_node_text(
                self.config_labels["distance"], str(self.extend_distance)
            )
            for mode in ("auto", "horizontal", "vertical"):
                button, label = self.config_labels["mode_" + mode]
                selected = self.axis_mode == mode
                button.setBackGroundColor(
                    cc.Color3B(46, 125, 50) if selected
                    else cc.Color3B(45, 52, 60)
                )
                label.setTextColor(
                    cc.Color4B(255, 255, 255, 255) if selected
                    else cc.Color4B(190, 197, 205, 255)
                )
            power_button, power_label = self.config_labels["power"]
            power_button.setBackGroundColor(
                cc.Color3B(46, 125, 50) if self.running
                else cc.Color3B(183, 28, 28)
            )
            self._set_node_text(
                power_label,
                "关闭自动搭路" if self.running else "开启自动搭路"
            )
        except Exception as error:
            self.ui_error = "设置面板刷新异常: %s" % to_text(error)[:80]

    def _create_quick_button(self):
        if self.quick_root is not None and self.float_root is not None:
            self._update_quick_button()
            return True
        if not CCUI_AVAILABLE:
            self.ui_error = "cc/ccui 模块不可用"
            return False
        try:
            from gui_2d import GUI
            base = GUI.ui_mgr._base_node
            if base is None:
                self.ui_error = "GUI 根节点为空"
                return False
            size = cc.Director.getInstance().getWinSize()
            sw, sh = float(size.width), float(size.height)
        except Exception as error:
            self.ui_error = "GUI 未就绪: %s" % to_text(error)[:80]
            return False

        try:
            for old_node in (
                self.quick_root,
                self.float_root,
                self.config_panel
            ):
                if old_node is not None:
                    try:
                        old_node.removeFromParent(True)
                    except Exception:
                        pass
            self.quick_root = None
            self.float_root = None
            self.config_panel = None
            self.config_panel_visible = False
            self.config_labels = {}

            # 独立长条快捷键：短按切换运行状态，长按拖动。
            w, h = self.quick_size
            quick_x = max(8, sw - w - 24)
            quick_y = max(72, sh * 0.46)
            root = self._make_layout(
                quick_x, quick_y, w, h, cc.Color3B(23, 27, 31), 238
            )
            base.addChild(root, 10000)

            accent = self._make_layout(
                0, 0, 6, h, cc.Color3B(76, 175, 80), 255
            )
            root.addChild(accent)
            icon_bg = self._make_layout(
                16, 17, 48, 48, cc.Color3B(12, 15, 18), 220
            )
            root.addChild(icon_bg)
            icon_text = self._make_text(
                "路", 24, 24, 24,
                cc.Color4B(255, 255, 255, 255), icon_bg, 0.5
            )
            title = self._make_text(
                "自动搭路", 78, 52, 21,
                cc.Color4B(245, 247, 250, 255), root
            )
            state = self._make_text(
                "运行中", 78, 27, 17,
                cc.Color4B(129, 199, 132, 255), root
            )
            hit = ccui.Layout.create()
            hit.setContentSize(cc.Size(w, h))
            hit.setPosition(cc.Vec2(0, 0))
            hit.setTouchEnabled(True)
            try:
                hit.setSwallowTouches(True)
            except Exception:
                pass
            hit.addTouchEventListener(self._on_quick_touch)
            root.addChild(hit)

            self.quick_root = root
            self.quick_title = title
            self.quick_state = state
            self.quick_accent = accent
            self.quick_icon_text = icon_text

            # 独立设置悬浮球：短按展开/收起面板，长按移动位置。
            fw, fh = self.float_size
            float_x = max(8, sw - fw - 34)
            float_y = max(92, sh * 0.62)
            float_root = self._make_layout(
                float_x, float_y, fw, fh, cc.Color3B(0, 0, 0), 0
            )
            base.addChild(float_root, 10001)
            vertical = self._make_layout(
                10, 0, fw - 20, fh, cc.Color3B(17, 22, 27), 220
            )
            horizontal = self._make_layout(
                0, 10, fw, fh - 20, cc.Color3B(17, 22, 27), 220
            )
            center = self._make_layout(
                5, 5, fw - 10, fh - 10, cc.Color3B(31, 41, 49), 245
            )
            float_root.addChild(vertical)
            float_root.addChild(horizontal)
            float_root.addChild(center)
            float_accent = self._make_layout(
                fw - 19, fh - 19, 11, 11,
                cc.Color3B(76, 175, 80), 255
            )
            float_root.addChild(float_accent)
            float_icon = self._make_text(
                "设", fw / 2, fh / 2, 22,
                cc.Color4B(236, 239, 241, 255), float_root, 0.5
            )
            float_hit = ccui.Layout.create()
            float_hit.setContentSize(cc.Size(fw, fh))
            float_hit.setPosition(cc.Vec2(0, 0))
            float_hit.setTouchEnabled(True)
            try:
                float_hit.setSwallowTouches(True)
            except Exception:
                pass
            float_hit.addTouchEventListener(self._on_float_touch)
            float_root.addChild(float_hit)

            self.float_root = float_root
            self.float_accent = float_accent
            self.float_icon_text = float_icon
            self.quick_screen_size = (sw, sh)
            self.ui_error = ""
            self._create_config_panel(base, sw, sh)
            self._update_quick_button()
            return True
        except Exception as error:
            self.ui_error = "控件创建异常: %s" % to_text(error)[:80]
            for node in (
                locals().get("root"),
                locals().get("float_root"),
                self.config_panel
            ):
                if node is not None:
                    try:
                        node.removeFromParent(True)
                    except Exception:
                        pass
            self.quick_root = None
            self.float_root = None
            self.config_panel = None
            self.config_panel_visible = False
            self.config_labels = {}
            return False

    def _update_quick_button(self):
        if self.quick_root is None:
            return
        try:
            if self.running:
                self.quick_root.setBackGroundColor(cc.Color3B(23, 27, 31))
                self.quick_accent.setBackGroundColor(cc.Color3B(76, 175, 80))
                self._set_node_text(self.quick_state, "运行中")
                self.quick_state.setTextColor(cc.Color4B(129, 199, 132, 255))
                self.quick_icon_text.setTextColor(cc.Color4B(129, 199, 132, 255))
            else:
                self.quick_root.setBackGroundColor(cc.Color3B(23, 27, 31))
                self.quick_accent.setBackGroundColor(cc.Color3B(97, 97, 97))
                self._set_node_text(self.quick_state, "已关闭")
                self.quick_state.setTextColor(cc.Color4B(189, 189, 189, 255))
                self.quick_icon_text.setTextColor(cc.Color4B(189, 189, 189, 255))
            if self.float_accent is not None:
                self.float_accent.setBackGroundColor(
                    cc.Color3B(76, 175, 80) if self.running
                    else cc.Color3B(117, 117, 117)
                )
            self._refresh_config_panel()
        except Exception:
            pass

    def _get_touch_position(self, widget, event_type, touch_id):
        """优先使用移动端 CCUI 控件坐标，旧触摸分发器仅作降级。"""
        try:
            if event_type == ccui.TOUCH_EVENT_BEGAN:
                return widget.getTouchBeganPosition()
            if event_type == ccui.TOUCH_EVENT_MOVED:
                return widget.getTouchMovePosition()
            if event_type in (ccui.TOUCH_EVENT_ENDED, ccui.TOUCH_EVENT_CANCELED):
                method = getattr(widget, "getTouchEndPosition", None)
                if method:
                    return method()
        except Exception:
            pass
        try:
            touch = cc.Director.getInstance().getTouchDispatcher().getTouchById(touch_id)
            if touch:
                return touch.getLocation()
        except Exception:
            pass
        return None

    def _touch_xy(self, point):
        if point is None:
            return None
        try:
            return float(point.x), float(point.y)
        except Exception:
            try:
                return float(point[0]), float(point[1])
            except Exception:
                return None

    def _handle_drag_touch(
        self,
        prefix,
        node,
        node_size,
        widget,
        event_type,
        touch_id,
        tap_callback,
        follow_panel=False
    ):
        if node is None:
            return
        began = ccui.TOUCH_EVENT_BEGAN
        moved = ccui.TOUCH_EVENT_MOVED
        ended = ccui.TOUCH_EVENT_ENDED
        canceled = ccui.TOUCH_EVENT_CANCELED
        id_name = prefix + "_touch_id"
        dragging_name = prefix + "_dragging"
        moved_name = prefix + "_drag_moved"
        start_name = prefix + "_touch_start_time"
        origin_name = prefix + "_touch_origin"
        offset_name = prefix + "_drag_offset"

        if event_type == began:
            setattr(self, id_name, touch_id)
            setattr(self, dragging_name, False)
            setattr(self, moved_name, False)
            setattr(self, start_name, time.time())
            setattr(self, origin_name, None)
            point = self._touch_xy(
                self._get_touch_position(widget, event_type, touch_id)
            )
            if point is not None:
                rp = node.getPosition()
                setattr(self, origin_name, point)
                setattr(
                    self,
                    offset_name,
                    (point[0] - rp.x, point[1] - rp.y)
                )
            return

        if event_type == moved and touch_id == getattr(self, id_name):
            point = self._touch_xy(
                self._get_touch_position(widget, event_type, touch_id)
            )
            if point is None:
                return
            origin = getattr(self, origin_name)
            if origin is None:
                rp = node.getPosition()
                setattr(self, origin_name, point)
                setattr(
                    self,
                    offset_name,
                    (point[0] - rp.x, point[1] - rp.y)
                )
                return

            distance = math.sqrt(
                (point[0] - origin[0]) ** 2
                + (point[1] - origin[1]) ** 2
            )
            held_time = time.time() - getattr(self, start_name)
            if distance >= 7 or (held_time >= 0.18 and distance >= 1):
                setattr(self, dragging_name, True)
            if not getattr(self, dragging_name):
                return

            ox, oy = getattr(self, offset_name)
            sw, sh = self.quick_screen_size
            width, height = node_size
            nx = max(0, min(sw - width, point[0] - ox))
            ny = max(0, min(sh - height, point[1] - oy))
            node.setPosition(cc.Vec2(nx, ny))
            setattr(self, moved_name, True)
            if follow_panel:
                self._position_config_panel()
            return

        if event_type in (ended, canceled) and touch_id == getattr(self, id_name):
            held_time = time.time() - getattr(self, start_name)
            should_tap = (
                event_type == ended
                and not getattr(self, dragging_name)
                and not getattr(self, moved_name)
                and held_time < 0.45
            )
            setattr(self, dragging_name, False)
            setattr(self, id_name, -1)
            setattr(self, origin_name, None)
            if should_tap:
                tap_callback()

    def _on_quick_touch(self, widget, event_type, touch_id):
        try:
            self._handle_drag_touch(
                "quick",
                self.quick_root,
                self.quick_size,
                widget,
                event_type,
                touch_id,
                self.toggle,
                False
            )
        except Exception:
            pass

    def _on_float_touch(self, widget, event_type, touch_id):
        try:
            self._handle_drag_touch(
                "float",
                self.float_root,
                self.float_size,
                widget,
                event_type,
                touch_id,
                self.toggle_config_panel,
                True
            )
        except Exception:
            pass

    def _on_hud_touch(self, widget, event_type, touch_id):
        try:
            self._handle_drag_touch(
                "hud",
                self.hud_root,
                self.hud_size,
                widget,
                event_type,
                touch_id,
                lambda: None,
                False
            )
            self._sync_hud_item_renderer_position()
        except Exception:
            pass

    def toggle(self):
        if self.running:
            self.stop(True)
        else:
            self.start()

    def remove_control_ui(self):
        for node in (
            self.quick_root,
            self.float_root,
            self.config_panel
        ):
            if node is not None:
                try:
                    node.removeFromParent(True)
                except Exception:
                    pass
        self.quick_root = None
        self.float_root = None
        self.quick_title = None
        self.quick_state = None
        self.quick_accent = None
        self.quick_icon_text = None
        self.float_accent = None
        self.float_icon_text = None
        self.config_panel = None
        self.config_panel_visible = False
        self.config_labels = {}

    def set_hub_managed(self, value):
        self.hub_managed = bool(value)
        if self.hub_managed:
            self.remove_control_ui()
        elif not self.leaving_world:
            self._create_quick_button()
        return self.hub_managed

    def remove_quick_button(self):
        self.remove_control_ui()
        self._remove_hud_item_renderer()
        if self.hud_root is not None:
            try:
                self.hud_root.removeFromParent(True)
            except Exception:
                pass
        self.hud_root = None
        self.hud_icon = None
        self.hud_name = None
        self.hud_count = None
        self.hud_state = None
        self.hud_texture = ""

    def shutdown(self):
        self.stop(False)
        self.remove_quick_button()
        try:
            self.UnListenAllEvents()
        except Exception:
            pass

    # ========================================================
    # 启动和停止
    # ========================================================

    def start(self):
        if self.running:
            self._refresh_config_panel()
            return True

        if self.get_build_method() is None:
            self.send_msg(
                "§c自动搭路启动失败: 放置接口不存在"
            )
            return False

        self.running = True
        self.refresh_ids()

        if not self.hub_managed:
            self._create_quick_button()
        self._ensure_hud()
        self._update_quick_button()
        self._refresh_config_panel()
        self.update_display()
        self.build_tick()

        if not self.hub_managed:
            self.send_msg(
                "§a§l自动搭路已开启\n"
                "§7CCUI 状态条和自动选方块已启用"
            )
        return True

    def stop(self, show_message=False):
        self.running = False

        self.pending_targets.clear()
        self.target_attempt_times.clear()
        self.restore_original_slot()
        self.road_y = None
        self.last_anchor = None
        self.last_direction = None
        self.last_player_position = None
        self.motion_direction = None
        self.motion_direction_time = 0.0
        self.last_vertical_rise_time = 0.0
        self.last_vertical_delta = 0.0
        self.jump_cycle_active = False
        self.jump_step_placed = False
        self.locked_road_y = None

        if show_message:
            self.send_msg("§c自动搭路已停止")
        self._update_quick_button()
        self._refresh_config_panel()
        self._update_hud()


# ============================================================
# 防止重复加载
# ============================================================

try:
    old_cleanup = getattr(
        sys,
        "_auto_bridge_cleanup",
        None
    )

    if old_cleanup:
        old_cleanup()
except Exception:
    pass

try:
    old_instance = getattr(
        sys,
        "_auto_bridge_instance",
        None
    )

    if old_instance:
        cleanup = getattr(old_instance, "shutdown", None)
        if cleanup:
            cleanup()
        else:
            old_instance.stop(False)
except Exception:
    pass


# ============================================================
# 加载后自动启动
# ============================================================

try:
    auto_bridge = AutoBridge(
        clientApi.GetEngineNamespace(),
        "AutoBridgeSystem"
    )
    sys._auto_bridge_instance = auto_bridge
    sys._auto_bridge_cleanup = (
        lambda: auto_bridge.shutdown()
    )
    auto_bridge.start()
except Exception as error:
    try:
        notify = factory.CreateTextNotifyClient(
            clientApi.GetLevelId()
        )
        notify.SetLeftCornerNotify(
            "[AutoBridge] init error: %s" % to_text(error)
        )
    except Exception:
        pass
