try {
const packet = require("packet");
const player = require("player");
const minecraft = require("minecraft");
const gui = require("gui");

function hexToUint8Array(hex) {
    if (hex.startsWith("0x")) hex = hex.slice(2);
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

function sendPyRpc(methodId, hexData) {
    packet.sendPyRpcPacket(methodId, hexToUint8Array(hexData).buffer);
}

function getLocalPlayerId() {
    const p = player.getLocalPlayer();
    return p ? p.getUniqueID() : null;
}

function stringToHex(str) {
    let hex = "";
    for (let i = 0; i < str.length; i++) {
        hex += str.charCodeAt(i).toString(16).padStart(2, "0");
    }
    return hex;
}

function generateRpcHex(playerId) {
    const hexLength = playerId.length.toString(16).padStart(2, "0");
    const playerIdHex = stringToHex(playerId);
    const baseHex = "c4" + hexLength + playerIdHex;
    let rpcHex = "93c40163920881c408706c617965724964c40b2d34323934393637323935c0";
    // 替换占位符为实际玩家 ID
    rpcHex = rpcHex.replace(/c40b2d34323934393637323935/, baseHex);
    return rpcHex;
}

function summonMount() {
    const localId = getLocalPlayerId();
    if (!localId) {
        minecraft.clientMessage("§c无法获取本地玩家ID");
        return;
    }

    sendPyRpc(0x5db23ae, "93c40163920681c4057374617274cf0000018fb5671c15c0");
    sendPyRpc(0x5db23ae, "93c401729208c4244d696e6563726166743a7065743a74656c65706f72745f6d6f756e745f72657175657374c0");
    sendPyRpc(0x5db23ae, generateRpcHex(localId));

    minecraft.clientMessage("§a坐骑召唤指令已发送");
}

const listItem = new gui.ArrayList({
    function: "summon_mount",
    name: "召唤坐骑",
    shortName: "召唤坐骑",
    enabled: true
});

function onSendChatMessageEvent(message) {
    if (message === "tc") {
        listItem.remove();          // 移除显示
        minecraft.clientMessage("§e已退出召唤坐骑脚本");
        exit();
        return true;
    }
    return false;
}

setTimeout(() => {
    summonMount();
}, 1000);
}catch(e){require("minecraft").minecraft.clientMessage('§b§e发现错误 => '+e.stack)};