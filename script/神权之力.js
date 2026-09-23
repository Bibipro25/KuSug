try {
const menu = require("menu");
const minecraft = require("minecraft");
const app = require("app");
const player = require("player");
const world = require("world");
const camera = require("camera");

const MAIN_MENU_ID = 'nituzchz';
const BAN_MENU_ID = 'ha_ban_sub';

let myid = player.getLocalPlayer().getUniqueID();

const menuTitle = {
    name: '神权之力',
    size: 15,
    elevation: 50,
    background: '#2D2D2D',
    padding: [4, 4, 4, 4],
    colors: ['#FFFFFF', '#FFFFFF']
};

const menuItems = {
    exit: {
        type: 'TextView',
        key: 'exit',
        name: '退出脚本',
        color: '#FF5252',
        size: 11,
        padding: [5, 5, 5, 5]
    },
    areaDestroySwitch: {
        type: 'Switch',
        key: 'areaDestroy',
        name: '选区破坏',
        color: '#FFB74D',
        size: 11,
        padding: [5, 0, 5, 0]
    },
    areaDestroyCoords: {
        type: 'EditText',
        key: 'areaCoords',
        name: '输入坐标\n使用空格分隔',
        color: '#FFB74D',
        max_lines: 1,
        text: "",
        hint: "请输入文本",
        size: 8
    },
    lineDestroySwitch: {
        type: 'Switch',
        key: 'lineDestroy',
        name: '视线破坏',
        color: '#FFB74D',
        size: 11,
        padding: [5, 0, 5, 0]
    },
    lineDestroyConnect: {
        type: 'CheckBox',
        key: 'lineConnect',
        name: '视线连接破坏',
        color: '#FFB74D',
        size: 9,
        padding: [5, 0, 5, 0]
    },
    hideDropItems: {
        type: 'CheckBox',
        key: 'hideDropItems',
        name: '不显示掉落物',
        color: '#FFB74D',
        size: 9,
        padding: [5, 0, 5, 0]
    },
    lineDestroyDistance: {
        type: "SeekBar",
        key: "lineDistance",
        format: "视线破坏距离: %d",
        color: "#4DD0E1",
        size: 10,
        padding: [5, 4, 5, 4],
        value: 16,
        min: 0,
        max: 256
    },
    destroyRange: {
        type: "SeekBar",
        key: "destroyRange",
        format: "破坏范围: %d",
        color: "#4DD0E1",
        size: 10,
        padding: [5, 4, 5, 4],
        value: 1,
        min: 0,
        max: 7
    },
    banListSwitch: {
        type: 'Switch',
        key: 'banList',
        name: '封神榜',
        color: '#CE93D8',
        size: 11,
        padding: [5, 0, 5, 0]
    }
};

const menuItemsList = Object.values(menuItems);

const opToolMenu = {
    type: 'TextView',
    sound: 'click.mp3',
    name: '神权之力',
    tag: 'ha_zchz_fun',
    color: '#000080',
    size: 12,
    padding: [5, 5, 5, 5],
    items: menuItemsList
};

const menuConfig = {
    type: 'Menu',
    title: menuTitle,
    color: '#E0E0E0',
    alpha: 0.95,
    can_close: true,
    image_scaled_size: 40,
    radius: 5,
    show_dividers: true,
    hide: true,
    items: [opToolMenu]
};

const state = {
    banList: false,
    lineDestroy: false,
    lineConnect: false,
    lineDistance: 16,
    areaDestroy: false,
    areaCoords: "",
    destroyRange: 1,
    hideDropItems: false,
    lineDestroyCounter: 0,
    lineDestroyInterval: 5,
    areaDestroyCounter: 0,
    areaDestroyInterval: 5,
    dropItemCounter: 0,
    dropItemInterval: 10,
    pendingBanAll: false,
    pendingBanPlayers: []
};

function getOnlinePlayers() {
    const list = world.getClientWorld().getPlayerList() || {};
    const players = [];
    for (const uuid in list) {
        const p = list[uuid];
        if (p && p.id) {
            players.push({ id: p.id, name: p.name || p.id });
        }
    }
    return players;
}

function buildBanSubMenu() {
    const allPlayers = getOnlinePlayers().filter(p => p.id !== myid);
    const playerSwitches = allPlayers.map(p => ({
        type: 'Switch',
        key: 'ban_player_' + p.name,
        name: p.name,
        color: '#CE93D8',
        size: 10
    }));
    const items = [
        {
            type: 'Switch',
            key: 'ban_all',
            name: '全部玩家',
            color: '#CE93D8',
            size: 11
        },
        ...playerSwitches,
        {
            type: 'TextView',
            key: 'ban_refresh',
            name: '刷新列表',
            color: '#CE93D8',
            size: 10
        }
    ];
    return {
        type: 'Menu',
        title: {
            name: '封神榜',
            size: 15,
            elevation: 3,
            background: '#2D2D2D',
            padding: [4, 4, 4, 4],
            colors: ['#FFFFFF', '#FFFFFF']
        },
        color: '#E0E0E0',
        alpha: 0.95,
        can_close: true,
        image_scaled_size: 40,
        radius: 5,
        show_dividers: true,
        hide: true,
        items: [{
            type: 'TextView',
            key: 'banList',
            name: '封神榜',
            color: '#000080',
            tag: 'ha_ban_sub',
            size: 11,
            padding: [5, 0, 5, 0],
            items: items
        }]
    };
}

function getPlayerIdByName(name) {
    const plist = getOnlinePlayers();
    const found = plist.find(p => p.name === name);
    return found ? found.id : null;
}

function executeBanPlayer(pid) {
    let pyCode = `# -*- coding: utf-8 -*-
import mod.client.extraClientApi as clientApi

system = clientApi.GetSystem('ha_divine_power_staff_mod', 'client_system')
if not system:
    raise RuntimeError("无法获取神权法杖系统实例，可能因为模组未加载")

dim_id = clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId()).GetCurrentDimension()
event_data = {
    'pick_data': {
        'type': 'Entity',
        'entityId': '${pid}',
    },
    'dimensionId': dim_id,
}
system.NotifyToServer('left_button_divine_power_staff_event', event_data)
`;
    app.evalPython(pyCode);
}

function executeBanAll() {
    let pyCode = `# -*- coding: utf-8 -*-
import mod.client.extraClientApi as clientApi

system = clientApi.GetSystem('ha_divine_power_staff_mod', 'client_system')
if not system:
    raise RuntimeError("无法获取神权法杖系统实例，可能因为模组未加载")

my_id = clientApi.GetLocalPlayerId()
player_list = clientApi.GetPlayerList()
dim_id = clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId()).GetCurrentDimension()

for pid in player_list:
    if pid == my_id:
        continue
    event_data = {
        'pick_data': {
            'type': 'Entity',
            'entityId': pid,
        },
        'dimensionId': dim_id,
    }
    system.NotifyToServer('left_button_divine_power_staff_event', event_data)
`;
    app.evalPython(pyCode);
}

function executeLineDestroy() {
    let pos = player.getLocalPlayer().getPos();
    let rot = camera.getRotation();
    if (!pos || !rot) return;

    let pitch = rot.pitch;
    let yaw = rot.yaw;

    let dx = -Math.sin(yaw * Math.PI / 180) * Math.cos(pitch * Math.PI / 180);
    let dy = Math.sin(pitch * Math.PI / 180);
    let dz = -Math.cos(yaw * Math.PI / 180) * Math.cos(pitch * Math.PI / 180);

    let ex = pos.x;
    let ey = pos.y;
    let ez = pos.z;

    let dis = state.lineDistance;
    let r = state.destroyRange;

    let brokenBlocks = new Set();
    let startI = state.lineConnect ? 1 : dis;

    for (let i = startI; i <= dis; i++) {
        let cx = Math.floor(ex + dx * i);
        let cy = Math.floor(ey + dy * i);
        let cz = Math.floor(ez + dz * i);

        for (let x = cx - r; x <= cx + r; x++) {
            for (let y = cy - r; y <= cy + r; y++) {
                for (let z = cz - r; z <= cz + r; z++) {
                    brokenBlocks.add([x, y, z]);
                }
            }
        }
    }

    let coords = Array.from(brokenBlocks);
    if (coords.length === 0) return;

    let pyCode = `# -*- coding: utf-8 -*-
import json
import mod.client.extraClientApi as clientApi

system = clientApi.GetSystem('ha_divine_power_staff_mod', 'client_system')
if not system:
    raise RuntimeError("无法获取神权法杖系统实例，可能因为模组未加载")

dim_id = clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId()).GetCurrentDimension()
coords = ${JSON.stringify(coords)}

for x, y, z in coords:
    event_data = {
        'pick_data': {
            'type': 'Block',
            'x': x,
            'y': y,
            'z': z,
        },
        'dimensionId': dim_id,
    }
    system.NotifyToServer('left_button_divine_power_staff_event', event_data)
`;
    app.evalPython(pyCode);
}

function executeAreaDestroy() {
    const input = state.areaCoords.trim();
    if (!input) {
        minecraft.clientMessage('§c输入为空');
        return;
    }
    const parts = input.split(/\s+/);
    if (parts.length !== 6) {
        minecraft.clientMessage('§c格式错误，需要6个数字（x1 y1 z1 x2 y2 z2），使用空格分隔');
        return;
    }
    const nums = parts.map(Number);
    if (nums.some(isNaN)) {
        minecraft.clientMessage('§c坐标包含无效数字');
        return;
    }
    let [x1, y1, z1, x2, y2, z2] = nums;
    let minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    let minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    let minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);

    let pyCode = `# -*- coding: utf-8 -*-
import mod.client.extraClientApi as clientApi

system = clientApi.GetSystem('ha_divine_power_staff_mod', 'client_system')
if not system:
    raise RuntimeError("无法获取神权法杖系统实例，可能因为模组未加载")

dim_id = clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId()).GetCurrentDimension()
min_x = ${minX}
max_x = ${maxX}
min_y = ${minY}
max_y = ${maxY}
min_z = ${minZ}
max_z = ${maxZ}

for x in xrange(min_x, max_x + 1):
    for y in xrange(min_y, max_y + 1):
        for z in xrange(min_z, max_z + 1):
            event_data = {
                'pick_data': {
                    'type': 'Block',
                    'x': x,
                    'y': y,
                    'z': z,
                },
                'dimensionId': dim_id,
            }
            system.NotifyToServer('left_button_divine_power_staff_event', event_data)
`;
    app.evalPython(pyCode);

    let total = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
    minecraft.clientMessage('§a已发送 ' + total + ' 个破坏包');
}

function removeDropItems() {
    const actors = world.getClientWorld().getActors() || [];
    actors.forEach(actor => {
        if (actor.getIdentifier().fullName === 'minecraft:item') actor.remove();
    });
}

function onReadyEvent() {
    myid = player.getLocalPlayer().getUniqueID();
}

function onTickEvent() {
    if (state.pendingBanAll) {
        executeBanAll();
        state.pendingBanAll = false;
    }
    if (state.pendingBanPlayers.length > 0) {
        const players = state.pendingBanPlayers.slice();
        state.pendingBanPlayers = [];
        players.forEach(pid => executeBanPlayer(pid));
    }

    if (state.lineDestroy) {
        if (state.lineDestroyCounter >= 4) {
            executeLineDestroy();
        }
        state.lineDestroyCounter++;
        if (state.lineDestroyCounter >= state.lineDestroyInterval) state.lineDestroyCounter = 0;
    }
    if (state.areaDestroy) {
        if (state.areaDestroyCounter >= 4) {
            executeAreaDestroy();
            state.areaDestroy = false;
        }
        state.areaDestroyCounter++;
        if (state.areaDestroyCounter >= state.areaDestroyInterval) state.areaDestroyCounter = 0;
    }
    if (state.hideDropItems) {
        if (state.dropItemCounter >= state.dropItemInterval) {
            removeDropItems();
            state.dropItemCounter = 0;
        }
        state.dropItemCounter++;
    }
}

function showBanMenu() {
    setTimeout(() => {
        try {
            menu.remove(BAN_MENU_ID);
            menu.load(BAN_MENU_ID, JSON.stringify(buildBanSubMenu()));
        } catch (e) {
            minecraft.clientMessage('§c封神榜加载失败 => ' + e);
        }
    }, 100);
    setTimeout(() => {
        try {
            menu.show(BAN_MENU_ID);
        } catch (e) {
            minecraft.clientMessage('§c封神榜显示失败 => ' + e);
        }
    }, 200);
}

function hideBanMenu() {
    setTimeout(() => {
        menu.remove(BAN_MENU_ID);
    }, 100);
}

function cleanMenu() {
    setTimeout(() => {
        menu.remove(MAIN_MENU_ID);
        menu.remove(BAN_MENU_ID);
    }, 100);
}

function onCallModuleEvent(params) {
    const stateKeys = ['banList', 'lineDestroy', 'lineConnect', 'lineDistance', 'areaDestroy', 'areaCoords', 'destroyRange', 'hideDropItems'];

    for (let key in params) {
        if (key === 'value' || key === 'fun' || key === 'name') continue;
        if (stateKeys.includes(key) && params[key] !== undefined) {
            state[key] = params[key];
        }

        if (key === 'banList') {
            if (params.banList) {
                showBanMenu();
            } else {
                hideBanMenu();
            }
        }

        if (key === 'ban_all' && params.ban_all === true) {
            state.pendingBanAll = true;
        }

        if (key.startsWith('ban_player_') && params[key] === true) {
            const playerName = key.substring('ban_player_'.length);
            const pid = getPlayerIdByName(playerName);
            if (pid) {
                state.pendingBanPlayers.push(pid);
            }
        }
    }

    if (params.key === 'ban_refresh') {
        showBanMenu();
    }

    if (params.key === 'exit') {
        minecraft.clientMessage('退出脚本');
        cleanMenu();
        exit();
    }
}

menu.remove(MAIN_MENU_ID);
menu.remove(BAN_MENU_ID);
menu.load(MAIN_MENU_ID, JSON.stringify(menuConfig));
menu.regFun('ha_zchz_fun');
menu.regFun('ha_ban_sub');
menu.show(MAIN_MENU_ID);
minecraft.clientMessage('加载 神权之力V1.1');

}catch(e){require("minecraft").minecraft.clientMessage('§b§e发现错误 => '+e.stack)};