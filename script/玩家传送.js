const menu = require("menu");
const minecraft = require("minecraft");
const app = require("app");
const player = require("player");
const world = require("world");
const packet = require("packet");

const MENU_ID = 'player_tp_menu';
const PREFIX = '§b[玩家传送] ';
const REQUEST_TIMEOUT_MS = 8000;
const POS_RPC_ID = 98247598;

var pendingTeleport = null;
var playerList = [];

function getMyId() {
    return player.getLocalPlayer().getUniqueID();
}

function info(message) {
    minecraft.clientMessage(PREFIX + message);
}

function normalizeHex(hex) {
    return (hex || '').replace(/^0x/i, '').toLowerCase();
}

function bytesToHex(data) {
    return Array.from(new Uint8Array(data), byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToUint8Array(hex) {
    hex = normalizeHex(hex);
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
    return new Uint8Array(bytes);
}

function stringToHex(str) {
    let hex = '';
    for (let i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(2, '0');
    return hex;
}

function hexToString(hex) {
    hex = normalizeHex(hex);
    let str = '';
    for (let i = 0; i < hex.length; i += 2) str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    return str;
}

function intHex(num, bytes) {
    return num.toString(16).padStart(bytes * 2, '0');
}

function msgpackBinHex(str) {
    const dataHex = stringToHex(str);
    const len = dataHex.length / 2;
    if (len <= 0xff) return 'c4' + intHex(len, 1) + dataHex;
    if (len <= 0xffff) return 'c5' + intHex(len, 2) + dataHex;
    return 'c6' + intHex(len, 4) + dataHex;
}

function msgpackStringCandidates(str) {
    const dataHex = stringToHex(str);
    const len = dataHex.length / 2;
    const candidates = [msgpackBinHex(str)];
    if (len <= 31) candidates.push((0xa0 + len).toString(16) + dataHex);
    if (len <= 0xff) candidates.push('d9' + intHex(len, 1) + dataHex);
    if (len <= 0xffff) candidates.push('da' + intHex(len, 2) + dataHex);
    return candidates;
}

function readMsgpackStringHexAt(hex, index) {
    hex = normalizeHex(hex);
    const tag = parseInt(hex.substr(index, 2), 16);
    let len;
    let dataStart;

    if (tag >= 0xa0 && tag <= 0xbf) {
        len = tag - 0xa0;
        dataStart = index + 2;
    } else if (tag === 0xc4 || tag === 0xd9) {
        len = parseInt(hex.substr(index + 2, 2), 16);
        dataStart = index + 4;
    } else if (tag === 0xc5 || tag === 0xda) {
        len = parseInt(hex.substr(index + 2, 4), 16);
        dataStart = index + 6;
    } else if (tag === 0xc6 || tag === 0xdb) {
        len = parseInt(hex.substr(index + 2, 8), 16);
        dataStart = index + 10;
    } else {
        return null;
    }

    const valueHex = hex.substr(dataStart, len * 2);
    if (valueHex.length !== len * 2) return null;
    return {
        valueHex,
        value: hexToString(valueHex),
        nextIndex: dataStart + len * 2
    };
}

function findEncodedStringIndex(hex, text, fromIndex) {
    hex = normalizeHex(hex);
    const candidates = msgpackStringCandidates(text).map(normalizeHex);
    let bestIndex = -1;

    for (const candidate of candidates) {
        const index = hex.indexOf(candidate, fromIndex || 0);
        if (index !== -1 && (bestIndex === -1 || index < bestIndex)) bestIndex = index;
    }

    return bestIndex;
}

function parseFloat64BE(hex) {
    if (hex.length !== 16) throw new Error('float64 hex length must be 16');
    const bytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    return new DataView(bytes.buffer).getFloat64(0, false);
}

function parsePosValueAfter(hex, fromIndex) {
    hex = normalizeHex(hex);
    const valueKeyHex = stringToHex('value');
    const valueKeyIndex = hex.indexOf(valueKeyHex, fromIndex);
    if (valueKeyIndex === -1) throw new Error('value key not found');

    let pos = valueKeyIndex + valueKeyHex.length;
    if (hex.substr(pos, 2) !== '93') throw new Error('position value is not a 3-item array');
    pos += 2;

    const coordinates = [];
    for (let i = 0; i < 3; i++) {
        const typeTag = hex.substr(pos, 2);
        if (typeTag !== 'cb') throw new Error('position item is not float64');
        pos += 2;
        coordinates.push(parseFloat64BE(hex.substr(pos, 16)));
        pos += 16;
    }

    return {
        x: Number(coordinates[0].toFixed(2)),
        y: Number(coordinates[1].toFixed(2)),
        z: Number(coordinates[2].toFixed(2))
    };
}

function parseTargetPos(hex, playerId) {
    hex = normalizeHex(hex);
    const posMapIndex = hex.indexOf(stringToHex('posMap'));
    if (posMapIndex === -1) return null;

    const playerIndex = findEncodedStringIndex(hex, playerId, posMapIndex);
    if (playerIndex === -1) return null;

    return parsePosValueAfter(hex, playerIndex);
}

function getSameDimensionFromHex(hex, playerId) {
    hex = normalizeHex(hex);
    const sameMapIndex = hex.indexOf(stringToHex('isSameDimensionMap'));
    if (sameMapIndex === -1) return null;

    const playerIndex = findEncodedStringIndex(hex, playerId, sameMapIndex);
    if (playerIndex === -1) return null;

    const encoded = readMsgpackStringHexAt(hex, playerIndex);
    if (!encoded) return null;

    const boolTag = hex.substr(encoded.nextIndex, 2);
    if (boolTag === 'c3') return true;
    if (boolTag === 'c2') return false;
    return null;
}

function sendPyRpc(id, data) {
    packet.sendPyRpcPacket(id, hexToUint8Array(data).buffer);
}

function sendPlayerPos(targetId, requesterId) {
    sendPyRpc(POS_RPC_ID, '93c401729200c4314d696e6563726166743a7065743a7065745f736b696c6c5f667269656e645f6332735f6765745f667269656e645f706f73c0');
    sendPyRpc(
        POS_RPC_ID,
        '93c40163920082c407706c617965727391' +
        msgpackBinHex(targetId) +
        'c40b726571506c617965724964' +
        msgpackBinHex(requesterId) +
        'c0'
    );
}

function clearExpiredPending(showMessage) {
    if (!pendingTeleport) return false;
    if (Date.now() - pendingTeleport.startedAt <= REQUEST_TIMEOUT_MS) return false;

    if (showMessage) info(`§c获取 §e${pendingTeleport.name} §c坐标超时`);
    pendingTeleport = null;
    return true;
}

function refreshPlayerList() {
    try {
        const myId = getMyId();
        const level = world.getClientWorld();
        const list = level.getPlayerList() || {};
        playerList = [];
        for (const uuid in list) {
            const p = list[uuid];
            if (p && p.id && p.id !== myId) {
                playerList.push({
                    id: p.id,
                    name: p.name || p.id
                });
            }
        }
    } catch (e) {
        info('§c刷新玩家列表失败: ' + e.message);
        playerList = [];
    }

    if (playerList.length === 0) {
        info('§c没有其他在线玩家');
        return false;
    }

    return true;
}

function buildTpMenu() {
    const menu = {
        type: 'Menu',
        title: {
            name: '玩家传送',
            size: 15,
            padding: [4, 2, 4, 2],
            text_margins: [12, 2, 12, 2],
            background: '$menu_title_background_color',
            colors: ['$menu_title_gradient_text_begin_color', '$menu_title_gradient_text_end_color']
        },
        color: '$menu_color',
        alpha: 0.85,
        radius: 9,
        elevation: 3,
        can_close: true,
        show_dividers: true,
        hide: true,
        items: [{
            type: 'TextView',
            name: '>刷新列表<',
            color: '$menu_item_color',
            size: 12,
            tip: '已刷新玩家列表',
            send_message: '#refresh_tp',
            clickable: true
        }, {
            type: 'TextView',
            name: '>退出脚本<',
            color: '$menu_item_hide_color',
            size: 12,
            tip: '已退出玩家传送脚本',
            send_message: '#exit_tp',
            clickable: true
        }]
    };

    playerList.forEach(player => {
        menu.items.push({
            type: 'TextView',
            name: player.name,
            color: '$menu_item_color',
            size: 12,
            tip: `获取 ${player.name} 的坐标并传送`,
            send_message: `#tp_to ${player.id}`,
            clickable: true
        });
    });

    return menu;
}

function showTpMenu() {
    menu.remove(MENU_ID);
    menu.load(MENU_ID, JSON.stringify(buildTpMenu()));
    menu.show(MENU_ID);
    info(`§a菜单已加载，共 §e${playerList.length} §a名玩家`);
}

function requestTeleport(targetId) {
    clearExpiredPending(false);

    if (pendingTeleport) {
        info(`§e正在等待 §f${pendingTeleport.name} §e的坐标，请稍后`);
        return;
    }

    const myId = getMyId();
    if (!targetId || targetId === myId) return;

    const targetPlayer = playerList.find(player => player.id === targetId);
    const targetName = targetPlayer ? targetPlayer.name : '目标玩家';

    pendingTeleport = {
        id: targetId,
        name: targetName,
        startedAt: Date.now()
    };

    info(`§a正在获取 §e${targetName} §a的坐标...`);
    sendPlayerPos(targetId, myId);
}

function onSendChatMessageEvent(message) {
    if (message === '#exit_tp') {
        menu.remove(MENU_ID);
        info('§c脚本已退出');
        exit();
        return true;
    }

    if (message === '#refresh_tp') {
        if (refreshPlayerList()) showTpMenu();
        return true;
    }

    if (message.startsWith('#tp_to ')) {
        requestTeleport(message.substring(7));
        return true;
    }

    return false;
}

function onPyRpcReceiveEvent(id, data) {
    if (!data || !pendingTeleport) return;
    if (clearExpiredPending(true)) return;

    const hex = normalizeHex(bytesToHex(data));
    if (!hex.includes(stringToHex('posMap'))) return;

    try {
        const pos = parseTargetPos(hex, pendingTeleport.id);
        if (!pos) return;

        const isSameDimension = getSameDimensionFromHex(hex, pendingTeleport.id);
        if (isSameDimension === false) {
            info(`§c目标 §e${pendingTeleport.name} §c维度不同，无法传送`);
            pendingTeleport = null;
            return;
        }

        if (isSameDimension === null) {
            info('§e未获取到维度信息，已取消传送');
            pendingTeleport = null;
            return;
        }

        const name = pendingTeleport.name;
        minecraft.requestExecuteCommand(`/ww tp ${pos.x} ${pos.y} ${pos.z}`, () => {
            info(`§a已传送至 §e${name} §7[${pos.x}, ${pos.y}, ${pos.z}]`);
        });
        pendingTeleport = null;
    } catch (e) {
        info('§c获取坐标失败: ' + e.message);
        pendingTeleport = null;
    }
}

function onTickEvent() {
    clearExpiredPending(true);
}

function onLeaveGameEvent() {
    menu.remove(MENU_ID);
    pendingTeleport = null;
    playerList = [];
    exit();
}

if (!app.isInGame()) {
    app.showToast('请进入游戏后再运行');
    exit();
} else if (refreshPlayerList()) {
    showTpMenu();
} else {
    exit();
}
