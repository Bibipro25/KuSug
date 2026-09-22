//198281550(进群获取教程)
//非常完美的notebot🤓
const fs = require("fs");
const app = require("app");
const menu = require("menu");
const gui = require("gui");
const minecraft = require("minecraft");
const player = require("player");
const world = require("world");
const camera = require("camera");
const packet = require("packet");

menu.regFun("NoteBot");

var clientMessage = minecraft.clientMessage;
var getLocalPlayerUniqueID = function() {
    return player.getLocalPlayer().getUniqueID();
};
var getEntityPos = function(id) {
    if (!id || id === "" || id === "localPlayer") {
        return {x: 0, y: 0, z: 0};
    }
    try {
        var level = world.getClientWorld();
        if (!level) return {x: 0, y: 0, z: 0};
        var actor = level.getRuntimeEntity(id);
        if (!actor) {
            actor = level.getEntity(id);
        }
        if (!actor) return {x: 0, y: 0, z: 0};
        var pos = actor.getPos();
        if (!pos) return {x: 0, y: 0, z: 0};
        return {
            x: typeof pos.x === 'number' ? pos.x : 0,
            y: typeof pos.y === 'number' ? pos.y : 0,
            z: typeof pos.z === 'number' ? pos.z : 0
        };
    } catch(e) {
        return {x: 0, y: 0, z: 0};
    }
};


var PlayController = {
    isPlaying: false,
    schedule: null,
    index: 0,
    accumulatedTime: 0,
    tickCounter: 0
};

var _playLock = false;

var setLocalPlayerTurn = function(pitch, yaw) {
    try {
        var lp = player.getLocalPlayer();
        if (lp && typeof lp.setRotation === 'function') {
            lp.setRotation({ yaw: yaw, pitch: pitch });
            return true;
        }
        return false;
    } catch(e) {
        return false;
    }
};

var isReadingPitch = false;
globalThis.isReadingPitch = isReadingPitch;
var readQueue = [];
globalThis.readQueue = readQueue;
var readResponseCount = 0;
globalThis.readResponseCount = readResponseCount;
var pitchData = {};
globalThis.pitchData = pitchData;
var readTotal = 0;
globalThis.readTotal = readTotal;
var readClickIndex = 0;
globalThis.readClickIndex = readClickIndex;
var readStartTime = 0;
globalThis.readStartTime = readStartTime;
var getBlock = function(x,y,z) {
    try {
        var level = world.getClientWorld();
        if (!level) return null;
        var dim = level.getDimension("overworld");
        if (!dim) return null;
        return dim.getBlock({x:x,y:y,z:z});
    } catch(e) {
        return null;
    }
};
var buildBlock = function(id, x, y, z, side) {
    try {
        return player.getLocalPlayer().buildBlock({x:x,y:y,z:z}, side);
    } catch(e) {
        return false;
    }
};
var swingArm = function() {
    try { player.getLocalPlayer().swing(); } catch(e) {}
};
var setCameraRotation = function(pitch, yaw, roll) {
    try { camera.setRotation({x:pitch, y:yaw, z:roll}); } catch(e) {}
};
var createShape = function(opts) {
    try { return new world.Shape(opts); } catch(e) { return null; }
};
var removeShape = function(id) {
    try { if (id && typeof id.remove === 'function') id.remove(); } catch(e) {}
};
var getFilesDir = function() {
    try { return app.getFilesDir(); } catch(e) { return ""; }
};
var getResource = function() {
    try { return app.getResource(); } catch(e) { return ""; }
};
var sendPlayerAction = function(action) {
    try { packet.sendPlayerActionPacket(action); } catch(e) {}
};
var selectPlayerInventorySlot = function(id, slot) {
    try { player.getLocalPlayer().setSelectItemSlot(slot); return true; } catch(e) { return false; }
};
var getPlayerInventoryItem = function(id, slot) {
    try { var item = player.getLocalPlayer().getInventoryItem(slot); return item ? item.getName() : null; } catch(e) { return null; }
};
var getPlayerHotBarSize = function() {
    try { return player.getLocalPlayer().getHotBarSize(); } catch(e) { return 9; }
};
var getPlayerSelectItemSlot = function() {
    try { return player.getLocalPlayer().getSelectItemSlot(); } catch(e) { return 0; }
};
var executeCommand = function(cmd) {
    try { minecraft.queueExecuteCommand(cmd); } catch(e) {}
};
var file_exist = function(path) {
    try { return fs.exists(path); } catch(e) { return false; }
};
var read_file = function(path) {
    try { return fs.read(path); } catch(e) { return ""; }
};
var write_file = function(path, data) {
    try { fs.write(path, data); } catch(e) {}
};
var file_create_dir = function(path) {
    try { return fs.createDirectory(path); } catch(e) { return false; }
};
var file_list = function(path) {
    try { return fs.list(path); } catch(e) { return []; }
};
var file_delete = function(path) {
    try { fs.remove(path); } catch(e) {}
};
var resetCamera = function() {
    try { camera.resetCamera(); } catch(e) {}
};
var departCamera = function() {
    try { camera.departCamera(); } catch(e) {}
};
var File = {
    read: function(path) { 
        try { return fs.read(path); } catch(e) { return ""; } 
    },
    write: function(path, data) { 
        try { fs.write(path, data); } catch(e) {} 
    },
    readBinary: function(path) { 
        try { 
            if (typeof fs.readBinary === 'function') {
                return fs.readBinary(path);
            }
            if (typeof fs.read === 'function') {
                return fs.read(path, "binary");
            }
            return null;
        } catch(e) { 
            return null; 
        } 
    },
    exist: function(path) { 
        try { return fs.exists(path); } catch(e) { return false; } 
    },
    delete: function(path) {
        try { if (fs.exists(path)) fs.remove(path); } catch(e) {}
    }
};
var aimLoopTimerId = null;
var aimLoopRunning = false;
var _processingModuleEvent = false;
var isProcessingTick = false;
var aimTargetPos = null; 
var CONFIG = {
    clickDelay: 100,
    playSpeed: 1.0,
    enableAim: false,
    buildDelay: 100,
    enableShadow: false,
    scanRadius: 15,
    renderMode: 0,
    enableSwing: true,
    swingDuringPlay: true,
    aimMaster: true,
    enableParticle: false,
    blueFillR: 78,
    blueFillG: 97,
    blueFillB: 100,
    aimSpeed: 0.05,
    whiteFillR: 100,
    whiteFillG: 100,
    whiteFillB: 100,
   whiteFillA: 56,
    blueFillA: 14
};

var DATA_FOLDER = "/storage/emulated/0/Android/data/com.netease.x19/files/resources/notebot辅助/";
var DATA_FILE = "";
var buildOrigin = null;  
var savedRenderMode = 0;
var 标题文字背景颜色 = "#2c3e50";
var 标题文字开头颜色 = "#f39c12";
var 标题文字结尾颜色 = "#e74c3c";
var 文字背景颜色 = "#1e1e1e";
var 文字颜色 = "#ffffff";
var playAccumulatedTime = 0;
var playTickCounter = 0;
var playTickInterval = 50;
var readTimeout = null;
var readClickDelay = 0;
var readClickLastTime = 0;
var readLastProgressTime = 0;
var meid = "";
var isPlaying = false;
var isTuning = false;

var SMOOTH_SPEED = 0.05; 
var MIN_ANGLE_DIFF = 0.3; 
var isBuilding = false;
var currentSmoothPitch = 0;
var currentSmoothYaw = 0;
var hasInitialAngle = false;
var isRebuilding = false;
var isReadingPitch = false;
var _packetHookInstalled = false;
var musicIndex = 0;
var lastPlayTime = 0;
var tuningTask = null;
var buildingTask = null;
var rebuildingTask = null;
var notePositions = {};
var _blueBorderBackup = {};
var currentPlayPositions = {};
var lastBuildTick = 0;
var lastRebuildTick = 0;
var _isPlayMode = false;
var MUSIC_DATA = [];
var currentMusicPath = "";
var currentMusicName = "";
var isCmdPlaying = false;
var cmdPlayIndex = 0;
var lastCmdPlayTime = 0;
var cmdPlayInterval = null;
var cmdVolume = 1.0;
var scanModeEnabled = false;
var scannedPositions = {};
var scanRange = 30;
var pitchData = {};
var readQueue = [];
var readClickIndex = 0;
var readResponseCount = 0;
var readTotal = 0;
var readStartTime = 0;
var renderShapes = [];
var maxRenderShapes = 50;
var renderLifetime = 500;
var blueBorderShapes = {};
var blueBorderEnabled = false;
var _playSchedule = null;
var _playIndex = 0;
var savedTuneMap = {};
var silentLookEnabled = true;
var cameraDeparted = false;
var lastTargetPitch = null;
var lastTargetYaw = null;
var _speedAdjustedTime = 0;
var _lastSpeedCheck = Date.now();
var _cmdAccumulatedTime = 0;
var _cmdLastCheckTime = Date.now();
var _ready = false;


function getLocalPlayer() {
    try {
        return player.getLocalPlayer();
    } catch(e) {
        return null;
    }
}

function safeResetCamera() {
    try {
        resetCamera();
        cameraDeparted = false;
    } catch(e) {}
}

function safeDepartCamera() {
    try {
        departCamera();
        cameraDeparted = true;
    } catch(e) {}
}

var _applyingRot = false;
var _lastApplyTime = 0;


function applySilentRot(pitch, yaw) {
    try {
        var lp = getLocalPlayer();
        if (!lp) return;
        
        
        if (!hasInitialAngle) {
            try {
                var rot = lp.getRotation();
                if (rot) {
                    currentSmoothPitch = rot.pitch || 0;
                    currentSmoothYaw = rot.yaw || 0;
                    hasInitialAngle = true;
                } else {
                    currentSmoothPitch = pitch;
                    currentSmoothYaw = yaw;
                    hasInitialAngle = true;
                }
            } catch(e) {
                currentSmoothPitch = pitch;
                currentSmoothYaw = yaw;
                hasInitialAngle = true;
            }
        }
        
        
        var targetYaw = yaw;
        if (targetYaw > 180) targetYaw -= 360;
        if (targetYaw < -180) targetYaw += 360;
        
        var targetPitch = Math.max(-90, Math.min(90, pitch));
        
        
        var yawDiff = targetYaw - currentSmoothYaw;
        if (yawDiff > 180) yawDiff -= 360;
        if (yawDiff < -180) yawDiff += 360;
        
        var pitchDiff = targetPitch - currentSmoothPitch;
        
       
        if (Math.abs(yawDiff) < MIN_ANGLE_DIFF && Math.abs(pitchDiff) < MIN_ANGLE_DIFF) {
            currentSmoothPitch = targetPitch;
            currentSmoothYaw = targetYaw;
            setRotationDirectly(lp, targetPitch, targetYaw);
            return;
        }
        
        
        var newYaw = currentSmoothYaw + yawDiff * CONFIG.aimSpeed;
        var newPitch = currentSmoothPitch + pitchDiff * CONFIG.aimSpeed;
        
        
        newPitch = Math.max(-90, Math.min(90, newPitch));
        
        
        currentSmoothPitch = newPitch;
        currentSmoothYaw = newYaw;
        
        
        setRotationDirectly(lp, newPitch, newYaw);
        
    } catch(e) {}
}

function setRotationDirectly(lp, pitch, yaw) {
    try {
        var normYaw = yaw;
        if (normYaw > 180) normYaw -= 360;
        if (normYaw < -180) normYaw += 360;
        
       
        var finalPitch = Math.max(-90, Math.min(90, pitch));
        
        if (typeof lp.setRotation === 'function') {
            lp.setRotation({ yaw: normYaw, pitch: finalPitch });
        }
        if (typeof lp.setRotationPrev === 'function') {
            lp.setRotationPrev({ yaw: normYaw, pitch: finalPitch });
        }
        if (typeof lp.setYBodyRotation === 'function') {
            lp.setYBodyRotation(normYaw);
        }
        if (typeof lp.setYBodyRotationPrev === 'function') {
            lp.setYBodyRotationPrev(normYaw);
        }
        if (typeof lp.setYHeadRotation === 'function') {
            lp.setYHeadRotation(normYaw);
        }
        if (typeof lp.setYHeadRotationPrev === 'function') {
            lp.setYHeadRotationPrev(normYaw);
        }
        
        if (!cameraDeparted) {
            safeDepartCamera();
        }
        
     
        currentSmoothPitch = finalPitch;
        currentSmoothYaw = normYaw;
        lastTargetPitch = finalPitch;
        lastTargetYaw = normYaw;
        
    } catch(e) {}
}

function syncAimState() {
    try {
        if (CONFIG.aimMaster) {
            if (CONFIG.enableAim) {
                if (cameraDeparted) {
                    safeResetCamera();
                }
                lastTargetPitch = null;
                lastTargetYaw = null;
            } else if (silentLookEnabled) {
                if (!cameraDeparted) {
                    safeDepartCamera();
                }
            }
        } else {
            if (cameraDeparted) {
                safeResetCamera();
            }
            lastTargetPitch = null;
            lastTargetYaw = null;
        }
    } catch(e) {}
}


function aimAtBlock(x, y, z) {
    if (!CONFIG.aimMaster) return;
    if (!silentLookEnabled) return;

    try {
        var p = player.getLocalPlayer();
        if (!p) return;
        
        var pos = p.getPos();
        if (!pos) return;
        
        var px = pos.x;
        var py = pos.y + 1.62;
        var pz = pos.z;

        var dx = (x + 0.5) - px;
        var dy = (y + 2.5) - py;
        var dz = (z + 0.5) - pz;
        
        var horizontalDist = Math.sqrt(dx * dx + dz * dz);
        if (horizontalDist < 0.1) return;
        
        var relativePitch = Math.atan2(dy, horizontalDist) * 180 / Math.PI;
        var yaw = (Math.atan2(-dx, dz) * 180 / Math.PI + 360) % 360;
        var pitch = -relativePitch;
        
        
        lastTargetPitch = pitch;
        lastTargetYaw = yaw;
        
        applySilentRot(pitch, yaw);
    } catch(e) {}
}
function safeList(path) {
    try {
        var result = fs.list(path);
        return result || [];
    } catch(e) {
        return [];
    }
}

function safeMusicLength() {
    return (MUSIC_DATA && typeof MUSIC_DATA.length === 'number') ? MUSIC_DATA.length : 0;
}

function safeGetMusic(index) {
    if (!MUSIC_DATA || !Array.isArray(MUSIC_DATA)) return null;
    if (index < 0 || index >= MUSIC_DATA.length) return null;
    return MUSIC_DATA[index];
}

function deletePitchData() {
    pitchData = {};
    clientMessage("§d[删除] §6音高数据已清除");
}

function showSearchDialog() {
    clientMessage("§d[搜索] §6请输入搜索关键词");
}

function initLog() {
    clientMessage("§d[日志] §6日志已初始化");
}

function dumpLog() {
    clientMessage("§d[日志] §6日志导出功能开发中...");
}

function clearLog() {
    clientMessage("§d[日志] §6日志已清除");
}

var NoteBot_Menu = {
    "type": "Menu",
    "title": {
        "name": "Notebot v9.178",
        "size": 18,
        "elevation": 3,
        "background": "#1a1a2e",
        "padding": [6,6,6,6],
        "colors": ["#a78bfa", "#7c3aed"]
    },
    "color": "#16213e",
    "alpha": 0.92,
    "can_close": true,
    "radius": 12,
    "hide": true,
    "items": [
        {"type":"TextView","name":" 控 制 中 心","color":"#c4b5fd","size":13,"padding":[5,8,5,8]},
        {"type":"TextView","sound":"click.mp3","name":"[+] 加载音乐文件","color":"#a78bfa","size":12,"padding":[12,6,12,6],"send_message":"loadmusic"},
        {"type":"TextView","name":"━━━━━━━━━━━━━━━━","color":"#4c1d95","size":10,"padding":[5,12,5,6]},
        {"type":"TextView","sound":"click.mp3","name":"[?] 材料指南","color":"#a78bfa","size":12,"padding":[12,6,12,6],"send_message":"buildguide"},
        {"type":"TextView","sound":"click.mp3","name":"指令播放","color":"#a78bfa","size":12,"padding":[10,5,10,5],"send_message":"cmdplay"},
        {"type":"TextView","sound":"click.mp3","name":"停止指令播放","color":"#ff8888","size":12,"padding":[10,5,10,5],"send_message":"cmdstop"},
        {"type":"TextView","sound":"click.mp3","name":"[R] 读取音符盒音高","color":"#a78bfa","size":12,"padding":[12,6,12,6],"send_message":"readpitch"},
        {"type":"TextView","sound":"click.mp3","name":"[T] 开始调音","color":"#a78bfa","size":12,"padding":[12,6,12,6],"send_message":"kq"},
        {
            "type": "GradientTextView",
            "name": "━━━倍速━━━",
            "start_color": "#f39c12",
            "end_color": "#e74c3c",
            "size": 10,
            "elevation": 3,
            "padding": [5,5,5,5],
            "tag": "NoteBot",
            "items": [
                {
                    "type": "SeekBar",
                    "key": "playSpeedSlider",
                    "name": "当前倍速",
                    "format": "当前倍速:%.2fx",
                    "color": "#ffffff",
                    "size": 12,
                    "padding": [5,5,5,5],
                    "value": 1.0,
                    "min": 0.5,
                    "max": 2.0
                }
            ]
        },
        {"type":"TextView","sound":"click.mp3","name":"[>] 演奏音符盒","color":"#a78bfa","size":12,"padding":[12,6,12,6],"send_message":"ys"},
        {"type":"TextView","sound":"click.mp3","name":"[□] 停止演奏","color":"#f87171","size":12,"padding":[12,6,12,6],"send_message":"tz"},
        {"type":"TextView","sound":"click.mp3","name":"[↺] 退出当前演奏","color":"#a78bfa","size":12,"padding":[12,6,12,6],"send_message":"resetprogress"},
        {"type":"TextView","name":"━━━━━━━━━━━━━━━━","color":"#4c1d95","size":10,"padding":[5,12,5,6]},
        {"type":"TextView","sound":"click.mp3","name":"[H] 演奏挥手 (开关)","color":"#a78bfa","size":13,"padding":[6,3,6,3],"send_message":"toggleSwingPlay"},

{"type":"TextView","name":"━━━━━━━━━━━━━━━━","color":"#4c1d95","size":10,"padding":[5,12,5,6]},
{
    "type": "Switch",
    "key": "aimMaster",
    "name": "转头开关",
    "color": "#ffffff",
    "size": 12,
    "padding": [5,2,5,2],
    "checked": true,
    "tag": "NoteBot"
},

{
    "type": "GradientTextView",
    "name": "━━━转头速度━━━",
    "start_color": "#a78bfa",
    "end_color": "#7c3aed",
    "size": 10,
    "elevation": 3,
    "padding": [5,5,5,5],
    "tag": "NoteBot",
    "items": [
        {
            "type": "SeekBar",
            "key": "aimSpeed",
            "name": "速度",
            "format": "速度:%.0f",
            "color": "#ffffff",
            "size": 12,
            "padding": [5,2,5,2],
            "value": 5,
            "min": 1,
            "max": 20
        }
    ]
},
{"type":"TextView","sound":"click.mp3","name":"设置建造原点","color":"#a78bfa","size":12,"padding":[12,6,12,6],"send_message":"setorigin"},
{"type":"TextView","sound":"click.mp3","name":"[B] 建造音符阵列","color":"#a78bfa","size":12,"padding":[12,6,12,6],"send_message":"buildnote"},
{"type":"TextView","sound":"click.mp3","name":"停止建造","color":"#f87171","size":12,"padding":[12,6,12,6],"send_message":"stopbuild"},
{"type":"TextView","name":"━━━颜色调节━━━","color":"#c4b5fd","size":12,"padding":[5,8,5,8]},
{
    "type": "GradientTextView",
    "name": "━━━蓝色填充━━━",
    "start_color": "#3b82f6",
    "end_color": "#1d4ed8",
    "size": 10,
    "elevation": 3,
    "padding": [5,5,5,5],
    "tag": "NoteBot",
    "items": [
        {
            "type": "SeekBar",
            "key": "blueFillR",
            "name": "红色",
            "format": "红色:%.0f",
            "color": "#ff6b6b",
            "size": 12,
            "padding": [5,2,5,2],
            "value": 78,
            "min": 0,
            "max": 100
        },
        {
            "type": "SeekBar",
            "key": "blueFillG",
            "name": "绿色",
            "format": "绿色:%.0f",
            "color": "#51cf66",
            "size": 12,
            "padding": [5,2,5,2],
            "value": 97,
            "min": 0,
            "max": 100
        },
        {
            "type": "SeekBar",
            "key": "blueFillB",
            "name": "蓝色",
            "format": "蓝色:%.0f",
            "color": "#4dabf7",
            "size": 12,
            "padding": [5,2,5,2],
            "value": 78,
            "min": 0,
            "max": 100
        },
        {
            "type": "SeekBar",
            "key": "blueFillA",
            "name": "透明度",
            "format": "透明度:%.0f%%",
            "color": "#ffffff",
            "size": 12,
            "padding": [5,2,5,2],
            "value": 14,
            "min": 0,
            "max": 100
        }
    ]
},
{
    "type": "GradientTextView",
    "name": "━━━白色渲染━━━",
    "start_color": "#6b7280",
    "end_color": "#374151",
    "size": 10,
    "elevation": 3,
    "padding": [5,5,5,5],
    "tag": "NoteBot",
    "items": [
        {
            "type": "SeekBar",
            "key": "whiteFillR",
            "name": "红色",
            "format": "红色:%.0f",
            "color": "#ff6b6b",
            "size": 12,
            "padding": [5,2,5,2],
            "value": 100,
            "min": 0,
            "max": 100
        },
        {
            "type": "SeekBar",
            "key": "whiteFillG",
            "name": "绿色",
            "format": "绿色:%.0f",
            "color": "#51cf66",
            "size": 12,
            "padding": [5,2,5,2],
            "value": 100,
            "min": 0,
            "max": 100
        },
        {
            "type": "SeekBar",
            "key": "whiteFillB",
            "name": "蓝色",
            "format": "蓝色:%.0f",
            "color": "#4dabf7",
            "size": 12,
            "padding": [5,2,5,2],
            "value": 100,
            "min": 0,
            "max": 100
        },
       {
            "type": "SeekBar",
            "key": "whiteFillA",
            "name": "透明度",
            "format": "透明度:%.0f%%",
            "color": "#ffffff",
            "size": 12,
            "padding": [5,2,5,2],
            "value": 14,
            "min": 0,
            "max": 100
        }
    ]
},
{"type":"TextView","name":"━━━━━━━━━━━━━━━━",
"color":"#4c1d95","size":10,"padding":[5,12,5,6]},
        {"type":"TextView","sound":"click.mp3","name":"[W] 白色渲染 (开关)","color":"#a78bfa","size":12,"padding":[12,6,12,6],"send_message":"togglerender"},
        {"type":"TextView","sound":"click.mp3","name":"[C] 清除渲染","color":"#f87171","size":12,"padding":[12,6,12,6],"send_message":"clearrender"},
        {"type":"TextView","sound":"click.mp3","name":"[B] 蓝色边框 (开关)","color":"#60a5fa","size":12,"padding":[12,6,12,6],"send_message":"blueborder"},
        {"type":"TextView","sound":"click.mp3","name":"[X] 移除蓝色边框","color":"#f87171","size":12,"padding":[12,6,12,6],"send_message":"removeborder"},
        {"type":"TextView","sound":"click.mp3","name":"粒子渲染 (开关)","color":"#a78bfa","size":12,"padding":[12,6,12,6],"send_message":"toggleParticle"},
        {"type":"TextView","name":"━━━━━━━━━━━━━━━━","color":"#4c1d95","size":10,"padding":[5,12,5,6]},
        {"type":"TextView","sound":"click.mp3","name":"[I] 显示信息","color":"#a78bfa","size":12,"padding":[12,6,12,6],"send_message":"info"},
        {"type":"TextView","name":"━━━━━━━━━━━━━━━━","color":"#4c1d95","size":10,"padding":[5,12,5,6]},
        {"type":"TextView","sound":"click.mp3","name":"[X] 退出脚本","color":"#fca5a5","size":12,"padding":[12,6,12,6],"send_message":"tc"}
    ]
};

function getNbsNotePosition(instrumentId, key) {
    let local = key - 33;
    if (local < 0) local = 0;
    if (local > 24) local = 24;
    return instrumentId * 25 + local;
}

function parseNbsFile(buffer) {
    try {
        var arrayBuffer = buffer;
        if (buffer instanceof Uint8Array) {
            arrayBuffer = buffer.buffer;
        } else if (buffer.buffer instanceof ArrayBuffer) {
            arrayBuffer = buffer.buffer;
        }
        
        if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 10) {
            clientMessage("[调试] NBS数据无效，长度: " + (arrayBuffer ? arrayBuffer.byteLength : "null"));
            return { success: false, data: [], totalMs: 0 };
        }
        
        var dataView = new DataView(arrayBuffer);
        var fileSize = dataView.byteLength;
        var offset = 0;
        
        var songLength = dataView.getUint16(offset, true);
        offset += 2;
        
        var version = 0;
        var defaultInstruments = 10;
        if (songLength === 0) {
            version = dataView.getUint8(offset);
            offset += 1;
            defaultInstruments = dataView.getUint8(offset);
            offset += 1;
        }
        
   
        
        if (version >= 3) {
            songLength = dataView.getUint16(offset, true);
            offset += 2;
        }
        
        var songLayers = dataView.getUint16(offset, true);
        offset += 2;
        
        function skipString() {
            var len = dataView.getUint32(offset, true);
            offset += 4 + len;
        }

        skipString();
        skipString();
        skipString();
        skipString();
        
        var tempo = dataView.getUint16(offset, true) / 100.0;
        offset += 2;
        
        
        offset += 1;
        offset += 1;
        offset += 1;
        offset += 4;
        offset += 4;
        offset += 4;
        offset += 4;
        offset += 4;
        skipString();
        
        if (version >= 4) {
            offset += 1;
            offset += 1;
            offset += 2;
        }
        
        if (defaultInstruments > 16) {
            var customCount = defaultInstruments - 16;
            for (var i = 0; i < customCount; i++) {
                if (offset + 4 > fileSize) break;
                var nameLen = dataView.getUint32(offset, true);
                offset += 4 + nameLen;
                if (offset + 4 > fileSize) break;
                var fileLen = dataView.getUint32(offset, true);
                offset += 4 + fileLen;
            }
        }
        
        var noteMap = {};
        var currentTick = -1;
        
        while (true) {
            var jumpTick = dataView.getUint16(offset, true);
            offset += 2;
            if (jumpTick === 0) break;
            currentTick += jumpTick;
            
            var currentLayer = -1;
            while (true) {
                var jumpLayer = dataView.getUint16(offset, true);
                offset += 2;
                if (jumpLayer === 0) break;
                currentLayer += jumpLayer;
                
                var instrument = dataView.getUint8(offset);
                offset += 1;
                var key = dataView.getUint8(offset);
                offset += 1;
                
                var velocity = 100;
                if (version >= 4) {
                    velocity = dataView.getUint8(offset);
                    offset += 1;
                    offset += 1;
                    offset += 2;
                }
                
                if (velocity < 1) continue;
                
                var pos = getNbsNotePosition(instrument, key);
                if (!noteMap[currentTick]) noteMap[currentTick] = [];
                noteMap[currentTick].push(pos);
            }
        }
        
        var sortedTicks = Object.keys(noteMap).map(Number).sort(function(a, b) { return a - b; });
        var result = [];
        var prevTick = -1;
        
        var actualTempo = tempo;
        
        if (version >= 4) {
            if (tempo > 60) {
                actualTempo = tempo / 2;
                clientMessage("[调试] V4+快速文件，Tempo " + tempo + " 调整为 " + actualTempo);
            } else {
                clientMessage("[调试] V4+ Tempo: " + tempo);
            }
        } else {
            actualTempo = tempo;
            clientMessage("[调试] 旧版 Tempo: " + tempo + " (直接使用)");
        }
        
        var msPerTick = 1000 / actualTempo;

        
        for (var ti = 0; ti < sortedTicks.length; ti++) {
            var tick = sortedTicks[ti];
            var deltaTick = prevTick === -1 ? tick : tick - prevTick;
            var delayMs = Math.max(1, Math.round(deltaTick * msPerTick));
            
            var rawPositions = noteMap[tick];
            var uniquePositions = [];
            for (var pi = 0; pi < rawPositions.length; pi++) {
                var pp = rawPositions[pi];
                var found = false;
                for (var pj = 0; pj < uniquePositions.length; pj++) {
                    if (uniquePositions[pj] === pp) { found = true; break; }
                }
                if (!found) uniquePositions.push(pp);
            }
            uniquePositions.sort(function(a, b) { return a - b; });
            
            result.push([delayMs, uniquePositions]);
            prevTick = tick;
        }
        
        var totalMs = sortedTicks.length ? sortedTicks[sortedTicks.length - 1] * msPerTick : 0;
        clientMessage("[调试] NBS解析成功: " + result.length + " 个事件");
        return {
            success: true,
            data: result,
            totalMs: totalMs
        };
    } catch(e) {
        clientMessage("[调试] NBS解析异常: " + e.message);
        return { success: false, data: [], totalMs: 0 };
    }
}

const LAYER_NAMES = {
    0: "竖琴(空气)", 1: "贝斯(木板)", 2: "低音鼓(石头)", 3: "小军鼓(沙子)",
    4: "踩镲(玻璃)", 5: "吉他(羊毛)", 6: "长笛(粘土)", 7: "钟(金块)",
    8: "编钟(浮冰)", 9: "木琴(骨块)", 10: "铁琴(铁块)", 11: "牛铃(灵魂沙)",
    12: "迪吉里杜管(南瓜)", 13: "比特(绿宝石)", 14: "班卓琴(干草块)", 15: "叮当(荧石)"
};

function getLayerFromBlockName(blockName) {
    if (!blockName) return -1;
    let name = blockName.toLowerCase().replace("minecraft:", "").trim();
    const map = {
        "air": 0, "cave_air": 0, "void_air": 0,
        "grass_block": 0, "dirt": 0, "coarse_dirt": 0, "podzol": 0, "mycelium": 0,
        "rooted_dirt": 0, "moss_block": 0, "mud": 0, "grass": 0,
        "oak_leaves": 0, "spruce_leaves": 0, "birch_leaves": 0, "jungle_leaves": 0,
        "acacia_leaves": 0, "dark_oak_leaves": 0, "mangrove_leaves": 0,
        "azalea_leaves": 0, "flowering_azalea_leaves": 0, "cherry_leaves": 0,
        "bamboo_mosaic": 0, "sponge": 0, "wet_sponge": 0,
        "oak_planks": 1, "spruce_planks": 1, "birch_planks": 1, "jungle_planks": 1,
        "acacia_planks": 1, "dark_oak_planks": 1, "crimson_planks": 1, "warped_planks": 1,
        "mangrove_planks": 1, "bamboo_planks": 1, "cherry_planks": 1,
        "oak_log": 1, "spruce_log": 1, "birch_log": 1, "jungle_log": 1,
        "acacia_log": 1, "dark_oak_log": 1, "crimson_stem": 1, "warped_stem": 1,
        "mangrove_log": 1, "cherry_log": 1, "bamboo_block": 1,
        "oak_wood": 1, "spruce_wood": 1, "birch_wood": 1, "jungle_wood": 1,
        "acacia_wood": 1, "dark_oak_wood": 1, "crimson_hyphae": 1, "warped_hyphae": 1,
        "mangrove_wood": 1, "cherry_wood": 1,
        "stripped_oak_log": 1, "stripped_spruce_log": 1, "stripped_birch_log": 1,
        "stripped_jungle_log": 1, "stripped_acacia_log": 1, "stripped_dark_oak_log": 1,
        "stripped_crimson_stem": 1, "stripped_warped_stem": 1,
        "stripped_mangrove_log": 1, "stripped_cherry_log": 1,
        "stripped_oak_wood": 1, "stripped_spruce_wood": 1, "stripped_birch_wood": 1,
        "stripped_jungle_wood": 1, "stripped_acacia_wood": 1, "stripped_dark_oak_wood": 1,
        "stripped_crimson_hyphae": 1, "stripped_warped_hyphae": 1,
        "stripped_mangrove_wood": 1, "stripped_cherry_wood": 1,
        "stone": 2, "cobblestone": 2, "stone_bricks": 2, "mossy_cobblestone": 2,
        "mossy_stone_bricks": 2, "cracked_stone_bricks": 2, "chiseled_stone_bricks": 2,
        "smooth_stone": 2, "granite": 2, "polished_granite": 2, "diorite": 2,
        "polished_diorite": 2, "andesite": 2, "polished_andesite": 2,
        "blackstone": 2, "polished_blackstone": 2, "polished_blackstone_bricks": 2,
        "cracked_polished_blackstone_bricks": 2, "chiseled_polished_blackstone": 2,
        "basalt": 2, "polished_basalt": 2, "smooth_basalt": 2,
        "deepslate": 2, "cobbled_deepslate": 2, "polished_deepslate": 2,
        "deepslate_bricks": 2, "deepslate_tiles": 2, "chiseled_deepslate": 2,
        "tuff": 2, "calcite": 2, "dripstone_block": 2,
        "end_stone": 2, "end_stone_bricks": 2,
        "netherrack": 2, "nether_brick": 2, "red_nether_brick": 2,
        "brick": 2, "brick_block": 2,
        "prismarine": 2, "dark_prismarine": 2, "prismarine_bricks": 2,
        "sand": 3, "red_sand": 3, "gravel": 3,
        "sandstone": 3, "red_sandstone": 3, "chiseled_sandstone": 3,
        "cut_sandstone": 3, "smooth_sandstone": 3,
        "chiseled_red_sandstone": 3, "cut_red_sandstone": 3, "smooth_red_sandstone": 3,
        "soul_sand": 3, "soul_soil": 3,
        "glass": 4, "tinted_glass": 4,
        "white_stained_glass": 4, "orange_stained_glass": 4,
        "magenta_stained_glass": 4, "light_blue_stained_glass": 4,
        "yellow_stained_glass": 4, "lime_stained_glass": 4,
        "pink_stained_glass": 4, "gray_stained_glass": 4,
        "light_gray_stained_glass": 4, "cyan_stained_glass": 4,
        "purple_stained_glass": 4, "blue_stained_glass": 4,
        "brown_stained_glass": 4, "green_stained_glass": 4,
        "red_stained_glass": 4, "black_stained_glass": 4,
        "white_wool": 5, "orange_wool": 5, "magenta_wool": 5,
        "light_blue_wool": 5, "yellow_wool": 5, "lime_wool": 5,
        "pink_wool": 5, "gray_wool": 5, "light_gray_wool": 5,
        "cyan_wool": 5, "purple_wool": 5, "blue_wool": 5,
        "brown_wool": 5, "green_wool": 5, "red_wool": 5, "black_wool": 5,
        "clay": 6, "gold_block": 7, "gilded_blackstone": 7,
        "packed_ice": 8, "ice": 8, "blue_ice": 8,
        "bone_block": 9, "iron_block": 10,
        "soul_sand": 11, "soul_soil": 11,
        "carved_pumpkin": 12, "pumpkin": 12,
        "emerald_block": 13, "hay_block": 14,
        "glowstone": 15, "sea_lantern": 15, "shroomlight": 15,
        "pale_oak_planks": 1, "pale_oak_log": 1, "pale_oak_wood": 1,
        "stripped_pale_oak_log": 1, "stripped_pale_oak_wood": 1,
        "pale_oak_leaves": 0, "pale_oak_sapling": 0,
        "crafter": 2, "hanging_roots": 0, "moss_carpet": 0
    };
    if (name in map) return map[name];
    if (name.includes("plank") || name.includes("log") || name.includes("wood") || 
        name.includes("stem") || name.includes("hyphae") || name.includes("bamboo")) return 1;
    if (name.includes("stone") || name.includes("cobble") || name.includes("brick") || 
        name.includes("deepslate") || name.includes("tuff") || name.includes("calcite") || 
        name.includes("basalt") || name.includes("blackstone") || name.includes("netherrack") || 
        name.includes("end_stone") || name.includes("prismarine")) return 2;
    if (name.includes("sand") || name.includes("gravel")) return 3;
    if (name.includes("glass")) return 4;
    if (name.includes("wool") || name.includes("carpet")) return 5;
    return -1;
}

function getLayerFromBlock(x, y, z) {
    let below = getBlock(x, y, z);
    if (!below) return 0;
    let blockName = (below.namespace || "").replace("minecraft:", "");
    let layer = getLayerFromBlockName(blockName);
    if (layer === -1) {
        if (below.id === 0) return 0;
        if (below.id === 5 || below.id === 125) return 1;
        if (below.id === 1 || below.id === 4 || below.id === 48) return 2;
        if (below.id === 12 || below.id === 13) return 3;
        if (below.id === 20 || below.id === 95) return 4;
        if (below.id === 35) return 5;
        if (below.id === 82) return 6;
        if (below.id === 41) return 7;
        if (below.id === 174) return 8;
        if (below.id === 216) return 9;
        if (below.id === 42) return 10;
        if (below.id === 170) return 11;
        if (below.id === 86) return 12;
        if (below.id === 133) return 13;
        if (below.id === 89) return 15;
        return 0;
    }
    return layer;
}

function getBlockByLayerIdx(layerIdx) {
    const blocks = {
        0: "空气", 1: "木板", 2: "石头", 3: "沙子", 4: "玻璃",
        5: "羊毛", 6: "粘土", 7: "金块", 8: "浮冰",
        9: "骨块", 10: "铁块", 11: "灵魂沙",
        12: "南瓜", 13: "绿宝石块", 14: "干草块", 15: "荧石"
    };
    return blocks[layerIdx] || "未知";
}

function getBlockIdByLayer(layerIdx) {
    var blocks = {
        0: "minecraft:air",
        1: "minecraft:oak_planks",
        2: "minecraft:stone",
        3: "minecraft:sand",
        4: "minecraft:glass",
        5: "minecraft:white_wool",
        6: "minecraft:clay",
        7: "minecraft:gold_block",
        8: "minecraft:packed_ice",
        9: "minecraft:bone_block",
        10: "minecraft:iron_block",
        11: "minecraft:soul_sand",
        12: "minecraft:pumpkin",
        13: "minecraft:emerald_block",
        14: "minecraft:hay_block",
        15: "minecraft:glowstone"
    };
    return blocks[layerIdx] || "minecraft:air";
}
function isBlockMatch(item, targetId) {
    try {
        if (!item) return false;
        if (typeof item.isNull === 'function' && item.isNull()) return false;
        if (typeof item.getNBT !== 'function') return false;
        var nbt = item.getNBT() || "";
        if (!nbt) return false;
        var match = nbt.match(/id:"([^"]+)"/);
        if (!match) return false;
        return match[1] === targetId;
    } catch(e) {
        return false;
    }
}
function findBlockInHotbarById(targetId) {
    try {
        var hotBarSize = getPlayerHotBarSize(meid);
        for (var slot = 0; slot < hotBarSize; slot++) {
            var item = player.getLocalPlayer().getInventoryItem(slot);
            if (isBlockMatch(item, targetId)) {
                return slot;
            }
        }
    } catch(e) {}
    return -1;
}

function extractBlockName(nbt) {
    if (!nbt) return "";
    var match = nbt.match(/Block:\{name:"([^"]+)"/);
    if (match) return match[1];
    match = nbt.match(/id:"([^"]+)"/);
    if (match) return match[1];
    return "";
}

function isBlockMatch(item, targetId) {
    try {
        if (!item) return false;
        if (typeof item.isNull === 'function' && item.isNull()) return false;
        if (typeof item.getNBT !== 'function') return false;
        var nbt = item.getNBT() || "";
        if (!nbt) return false;
        var blockName = extractBlockName(nbt);
        return blockName === targetId;
    } catch(e) {
        return false;
    }
}
function selectBlockInHotbar(targetId) {
    var slot = findBlockInHotbarById(targetId);
    if (slot === -1) return false;
    selectPlayerInventorySlot(meid, slot);
    return true;
}
function getInstrumentByPos(pos) {
    let layerIdx = Math.floor(pos / 25);
    const instruments = {
        0: "note.harp", 1: "note.bass", 2: "note.bd", 3: "note.snare",
        4: "note.hat", 5: "note.guitar", 6: "note.flute", 7: "note.bell",
        8: "note.chime", 9: "note.xylophone", 10: "note.iron_xylophone",
        11: "note.cow_bell", 12: "note.didgeridoo", 13: "note.bit",
        14: "note.banjo", 15: "note.pling"
    };
    return instruments[layerIdx] || "note.harp";
}

function ensureFolder() {
    if (!fs.exists(DATA_FOLDER)) {
        let result = fs.createDirectory(DATA_FOLDER);
        if (result) {
            minecraft.clientMessage("[NoteBot] 已创建数据文件夹: " + DATA_FOLDER);
        }
        return result;
    }
    return true;
}

function clearAuxFolder() {
    if (!fs.exists(DATA_FOLDER)) {
        ensureFolder();
        return true;
    }
    try {
        let files = safeList(DATA_FOLDER);
        if (files) {
            for (let i = 0; i < files.length; i++) {
                if (files[i].isFile) {
                    fs.remove(DATA_FOLDER + files[i].name);
                }
            }
        }
        return true;
    } catch(e) {
        return false;
    }
}

function getPitchDataFile() {
    if (!currentMusicName) return null;
    let name = currentMusicName.replace(/\.[^.]+$/, "") + ".txt";
    return DATA_FOLDER + name;
}

function loadPitchData() {
    let pitchFile = getPitchDataFile();
    if (!pitchFile) return false;
    if (!fs.exists(pitchFile)) return false;
    try {
        let content = fs.read(pitchFile);
        if (!content || content === "") return false;
        pitchData = JSON.parse(content);
        minecraft.clientMessage("§d[加载] §6音高数据加载成功 §7(" + Object.keys(pitchData).length + " 个音符)");
        return true;
    } catch(e) {
        minecraft.clientMessage("§d[加载] §c音高数据加载失败");
        return false;
    }
}

function savePitchData() {
    let pitchFile = getPitchDataFile();
    if (!pitchFile) return false;
    if (Object.keys(pitchData).length === 0) {
        minecraft.clientMessage("§d[保存] §c没有音高数据可保存");
        return false;
    }
    try {
        clearAuxFolder();
        ensureFolder();
        let jsonStr = JSON.stringify(pitchData, null, 2);
        fs.write(pitchFile, jsonStr);
        minecraft.clientMessage("§d[保存] §6音高数据保存成功 §7(" + Object.keys(pitchData).length + " 个音符)");
        return true;
    } catch(e) {
        minecraft.clientMessage("§d[保存] §c音高数据保存失败");
        return false;
    }
}

function deleteShape(shape) {
    if (!shape) return;
    
    if (shape.fillId) {
        if (Array.isArray(shape.fillId)) {
            for (let j = 0; j < shape.fillId.length; j++) {
                try { removeShape(shape.fillId[j]); } catch(e) {}
            }
        } else {
            try { removeShape(shape.fillId); } catch(e) {}
        }
    }
 
    if (shape.borderId) {
        try { removeShape(shape.borderId); } catch(e) {}
    }
    if (shape.topFill) {
        try { removeShape(shape.topFill); } catch(e) {}
    }
}

function getMusicFolderPath() {
    let paths = [
        app.getResource() + "/music/",
        "/storage/emulated/0/Android/data/com.netease.x19/files/resources/music/",
        getFilesDir() + "/music/"
    ];
    for (let i = 0; i < paths.length; i++) {
        let basePath = paths[i];
        if (fs.exists(basePath)) return basePath;
        if (fs.createDirectory(basePath)) {
            minecraft.clientMessage("[NoteBot] 已创建音乐文件夹: " + basePath);
            return basePath;
        }
    }
    return app.getResource() + "/music/";
}

function fixJSON(content) {
    content = content.replace(/^\uFEFF/, "");
    content = content.replace(/^\s+/, "");
    content = content.replace(/\s+$/, "");
    content = content.replace(/,(\s*[}\]])/g, "$1");
    content = content.replace(/,+\s*,/g, ",");
    return content;
}

function readMusicFile(path) {
    if (path.toLowerCase().endsWith(".nbs")) {
        try {
            var buffer = null;
            if (typeof File !== 'undefined' && typeof File.readBinary === 'function') {
                buffer = File.readBinary(path);
                minecraft.clientMessage("§d[调试] §7使用 File.readBinary");
            }
            if (!buffer && typeof fs.readBinary === 'function') {
                buffer = fs.readBinary(path);
                minecraft.clientMessage("§d[调试] §7使用 fs.readBinary");
            }
            if (!buffer) {
                minecraft.clientMessage("§d[调试] §cNBS文件读取失败");
                return { success: false, error: "NBS文件读取失败" };
            }
            var arrayBuffer = null;
            if (buffer instanceof ArrayBuffer) {
                arrayBuffer = buffer;
            } else if (buffer instanceof Uint8Array) {
                arrayBuffer = buffer.buffer;
            } else if (buffer.buffer instanceof ArrayBuffer) {
                arrayBuffer = buffer.buffer;
            }
            if (!arrayBuffer || arrayBuffer.byteLength === 0) {
                return { success: false, error: "NBS数据为空" };
            }
            var parseResult = parseNbsFile(arrayBuffer);
            return parseResult;
        } catch(e) {
            minecraft.clientMessage("§d[调试] §cNBS异常: " + e.message);
            return { success: false, error: "NBS异常: " + e.message };
        }
    }
    
    var content = fs.read(path);
    if (!content || content === "") {
        return { success: false, error: "文件为空" };
    }
    
    try {
        var jsonData = JSON.parse(content);
        if (Array.isArray(jsonData) && jsonData.length > 0 && Array.isArray(jsonData[0]) && jsonData[0].length === 2) {
            return { success: true, data: jsonData };
        }
        if (typeof jsonData === "object" && jsonData !== null) {
            if (Array.isArray(jsonData.data)) return { success: true, data: jsonData.data };
            if (Array.isArray(jsonData.music_data)) return { success: true, data: jsonData.music_data };
            if (Array.isArray(jsonData.MUSIC_DATA)) return { success: true, data: jsonData.MUSIC_DATA };
        }
    } catch(e) {}
    
    try {
        var lines = content.split(/\r?\n/).filter(function(line) { return line.trim() !== ""; });
        var musicData = [];
        for (var li = 0; li < lines.length; li++) {
            var line = lines[li].trim();
            if (line.startsWith("#") || line.startsWith("//")) continue;
            var parts = line.split(/\s+/);
            if (parts.length < 2) continue;
            var delay = parseInt(parts[0]);
            if (isNaN(delay) || delay < 0) continue;
            var positions = [];
            for (var pi = 1; pi < parts.length; pi++) {
                var pos = parseInt(parts[pi]);
                if (!isNaN(pos) && pos >= 0) positions.push(pos);
            }
            if (positions.length > 0) musicData.push([delay, positions]);
        }
        if (musicData.length > 0) {
            return { success: true, data: musicData, totalMs: 0 };
        }
    } catch(e) {}
    
    return { success: false, error: "无法识别的文件格式" };
}

function loadMusic(fileName) {
    let basePath = getMusicFolderPath();
    let extensions = [".nbs", ".json", ".txt", ""];
    let foundPath = null;
    for (let i = 0; i < extensions.length; i++) {
        let testPath = basePath + fileName + extensions[i];
        if (fs.exists(testPath)) {
            foundPath = testPath;
            break;
        }
    }
    if (!foundPath) {
        minecraft.clientMessage("§d[加载] §c找不到音乐文件: " + fileName);
        return false;
    }
    let result = readMusicFile(foundPath);
    if (!result.success) {
        minecraft.clientMessage("§d[加载] §c" + result.error);
        MUSIC_DATA = [];
        return false;
    }
    MUSIC_DATA = result.data || [];
    currentMusicPath = foundPath;
    let pathParts = foundPath.split("/");
    currentMusicName = pathParts[pathParts.length - 1];
    pitchData = {};
    scannedPositions = {};
    notePositions = {};
    let totalMs = result.totalMs || 0;
    for (let i = 0; i < MUSIC_DATA.length; i++) {
        if (MUSIC_DATA[i] && typeof MUSIC_DATA[i][0] === 'number') {
            totalMs += MUSIC_DATA[i][0];
        }
    }
    minecraft.clientMessage("§d[加载] §6音乐加载成功 §7" + currentMusicName);
    loadPitchData();
    return true;
}

function showMusicList() {
    let basePath = getMusicFolderPath();
    let files = safeList(basePath);
    let musicFiles = [];
    if (files) {
        for (let i = 0; i < files.length; i++) {
            if (files[i].name.endsWith(".json") || files[i].name.endsWith(".txt") || files[i].name.endsWith(".nbs")) {
                musicFiles.push(files[i]);
            }
        }
    }
    if (musicFiles.length === 0) {
        minecraft.clientMessage("§d[加载] §c音乐文件夹下没有音乐文件");
        return;
    }
    let buttons = [];
    for (let i = 0; i < musicFiles.length; i++) {
        let name = musicFiles[i].name.replace(/\.(nbs|json|txt)$/, "");
        buttons.push({ text: name });
    }
    let form = {
        type: "form",
        title: "选择音乐",
        content: "请选择要加载的音乐文件",
        buttons: buttons
    };
    gui.addForm(JSON.stringify(form), function(index) {
        if (index >= 0 && index < musicFiles.length) {
            let name = musicFiles[index].name.replace(/\.(nbs|json|txt)$/, "");
            loadMusic(name);
        }
    });
}

function spawnShadow(x, y, z) {
    if (!CONFIG.enableShadow) return;
    sendPlayerAction({
        id: meid,
        pos: { x: x, y: y + 0.5, z: z },
        type: 17
    });
}



function removeBlueBorder(x, y, z) {
    var key = x + "," + y + "," + z;
    var data = blueBorderShapes[key];
    if (!data) return;
    if (Array.isArray(data.fillId)) {
        for (var i = 0; i < data.fillId.length; i++) {
            try { removeShape(data.fillId[i]); } catch(e) {}
        }
    } else {
        try { removeShape(data.fillId); } catch(e) {}
    }
    if (data.borderFill) try { removeShape(data.borderFill); } catch(e) {}
    if (data.fillFill) try { removeShape(data.fillFill); } catch(e) {}
    delete blueBorderShapes[key];
}

var blueBorderShapes = {};
var blueBorderEnabled = false;
function addBlueBorder(x, y, z) {
    let key = x + "," + y + "," + z;
    if (blueBorderShapes[key]) return;
    try {
        var fillFill = createShape({
            type: 'box',
            isFill: true,
            lower: { x: x, y: y, z: z },
            upper: { x: x + 1, y: y + 1, z: z + 1 },
            color: { 
                r: CONFIG.blueFillR / 100,
                g: CONFIG.blueFillG / 100,
                b: CONFIG.blueFillB / 100,
                a: CONFIG.blueFillA / 100  
            }
        });
        blueBorderShapes[key] = {
            fillId: fillFill,
            x: x, y: y, z: z,
            fillFill: fillFill
        };
        return fillFill;
    } catch(e) {
        return null;
    }
}

function addBlueBordersToAllNotes() {
    var notes = scanAllNoteBlocksInRange();
    if (!notes || notes.length === 0) {
        minecraft.clientMessage("§d[蓝色边框] §c未找到音符盒");
        return;
    }
    for (var key in blueBorderShapes) {
        var data = blueBorderShapes[key];
        if (data) {
            try { removeShape(data.fillId); } catch(e) {}
            if (data.fillFill) try { removeShape(data.fillFill); } catch(e) {}
        }
    }
    blueBorderShapes = {};
    var count = 0;
    for (var i = 0; i < notes.length; i++) {
        var note = notes[i];
        var key = note.x + "," + note.y + "," + note.z;
        var fillFill = createShape({
            type: 'box',
            isFill: true,
            lower: { x: note.x, y: note.y, z: note.z },
            upper: { x: note.x + 1, y: note.y + 1, z: note.z + 1 },
            color: { 
                r: CONFIG.blueFillR / 100, 
                g: CONFIG.blueFillG / 100, 
                b: CONFIG.blueFillB / 100, 
                a: CONFIG.blueFillA / 100  
            }
        });
        blueBorderShapes[key] = {
            fillId: fillFill,
            x: note.x, y: note.y, z: note.z,
            fillFill: fillFill
        };
        count++;
    }
    blueBorderEnabled = true;
    minecraft.clientMessage("§d[蓝色填充] §6已开启 §7(" + count + " 个音符盒)");
}





function removeBlueBorders() {
    for (var key in blueBorderShapes) {
        var data = blueBorderShapes[key];
        if (data) {
            try { removeShape(data.fillId); } catch(e) {}
            if (data.fillFill) try { removeShape(data.fillFill); } catch(e) {}
        }
    }
    blueBorderShapes = {};
    blueBorderEnabled = false;
}

function toggleBlueBorder() {
    if (blueBorderEnabled) {
        removeBlueBorders();
        blueBorderEnabled = false;
        clientMessage("§d[蓝色边框] §c已关闭");
    } else {
        addBlueBordersToAllNotes();
        blueBorderEnabled = true;
        clientMessage("§d[蓝色边框] §6已开启");
    }
}

function createWhiteBorderBox(x, y, z) {
    if (CONFIG.renderMode !== 1) return null;
    while (renderShapes.length >= maxRenderShapes) {
        let old = renderShapes.shift();
        deleteShape(old);
        if (blueBorderEnabled && old.x !== undefined && old.y !== undefined && old.z !== undefined) {
            addBlueBorder(old.x, old.y, old.z);
        }
    }
    try {
        var fullFill = createShape({
            type: 'box',
            isFill: true,
            lower: { x: x, y: y, z: z },
            upper: { x: x + 1, y: y + 1, z: z + 1 },
            color: { 
                r: CONFIG.whiteFillR / 100,
                g: CONFIG.whiteFillG / 100,
                b: CONFIG.whiteFillB / 100,
                a: CONFIG.whiteFillA / 100  
            }
        });
        
        var borderFill = createShape({
            type: 'box',
            isFill: false,
            lower: { x: x, y: y, z: z },
            upper: { x: x + 1, y: y + 1, z: z + 1 },
            color: { 
                r: CONFIG.whiteFillR / 100,
                g: CONFIG.whiteFillG / 100,
                b: CONFIG.whiteFillB / 100,
                a: 1.0  
            }
        });
        
        renderShapes.push({
            fillId: fullFill,
            borderId: borderFill,
            createTime: Date.now(),
            lifetime: 500,
            x: x, y: y, z: z,
            isFullFill: true
        });
        return { fillId: fullFill, borderId: borderFill };
    } catch(e) {
        return null;
    }
}

function updateRenderShapes() {
    if (!renderShapes || renderShapes.length === 0) return;
    try {
        var now = Date.now();
        var toRemove = [];
        for (var i = 0; i < renderShapes.length; i++) {
            var shape = renderShapes[i];
            if (!shape) continue;
            var age = now - shape.createTime;
            var lifetime = shape.lifetime || 100;
            var progress = age / lifetime;

            if (progress < 1) {
                var scale = 1 + 0.2 * progress;
                var half = 0.5 * scale;
                var cx = shape.x + 0.5;
                var cy = shape.y + 0.5;
                var cz = shape.z + 0.5;
                var lower = { x: cx - half, y: cy - half, z: cz - half };
                var upper = { x: cx + half, y: cy + half, z: cz + half };
                
                var fillAlpha = (CONFIG.whiteFillA / 100) * (1 - progress);
                var borderAlpha = 1.0 * (1 - progress);

                if (shape.fillId) {
                    shape.fillId.lower = lower;
                    shape.fillId.upper = upper;
                    
                    shape.fillId.color = { 
                        r: CONFIG.whiteFillR / 100,
                        g: CONFIG.whiteFillG / 100,
                        b: CONFIG.whiteFillB / 100,
                        a: fillAlpha 
                    };
                }
                
                if (shape.borderId) {
                    shape.borderId.lower = lower;
                    shape.borderId.upper = upper;
                    
                    shape.borderId.color = { 
                        r: CONFIG.whiteFillR / 100,
                        g: CONFIG.whiteFillG / 100,
                        b: CONFIG.whiteFillB / 100,
                        a: borderAlpha 
                    };
                }
            } else {
                toRemove.push(i);
            }
        }
        for (var i = toRemove.length - 1; i >= 0; i--) {
            var idx = toRemove[i];
            var shape = renderShapes[idx];
            if (shape) {
                deleteShape(shape);
            }
            renderShapes.splice(idx, 1);
        }
    } catch(e) {}
}

function clearRenderShapes() {
    for (var i = renderShapes.length - 1; i >= 0; i--) {
        deleteShape(renderShapes[i]);
    }
    renderShapes = [];
    minecraft.clientMessage("§d[渲染] §6已清除");
}

function clickBlock(x, y, z) {
    if (!meid || meid === "" || meid === "localPlayer") return false;
    try {
        aimTargetPos = { x: x, y: y, z: z };
        
        if (CONFIG.aimMaster && silentLookEnabled) {
            startAimLoop();
        }
        
        if (CONFIG.enableAim || silentLookEnabled) {
            try { aimAtBlock(x, y, z); } catch(e) {}
        }
        
        if (_isPlayMode) {
            if (CONFIG.swingDuringPlay) swingArm();
        } else {
            if (CONFIG.enableSwing) swingArm();
        }
        packet.sendPlayerActionPacket({ id: meid, pos: { x: x, y: y, z: z }, action: 0 });
        packet.sendPlayerActionPacket({ id: meid, pos: { x: x, y: y, z: z }, action: 1 });

        spawnShadow(x, y, z);
        
        if (CONFIG.enableParticle) {
            packet.sendPlayerActionPacket({ id: meid, pos: { x: x, y: y, z: z }, action: 17 });
        }
        
        if (CONFIG.renderMode === 1) {
            createWhiteBorderBox(x, y, z);
        }
        return true;
    } catch(e) {
        return false;
    }
}
function updateAimTarget() {
    if (!aimTargetPos) return;
    if (!CONFIG.aimMaster) return;
    if (!silentLookEnabled) return;
    aimAtBlock(aimTargetPos.x, aimTargetPos.y, aimTargetPos.z);
}
function toggleParticle() {
    CONFIG.enableParticle = !CONFIG.enableParticle;
    minecraft.clientMessage("§d[开关] §6粒子渲染 " + (CONFIG.enableParticle ? "§a开启" : "§c关闭"));
}

function tuneBlock(x, y, z) {
    if (CONFIG.enableAim || silentLookEnabled) {
        aimAtBlock(x, y, z);
    }
    swingArm();
    if (CONFIG.renderMode === 1) {
        createWhiteBorderBox(x, y, z);
    }
    return buildBlock(meid, x, y, z, 1);
}
function addWhiteRenderToAllNotes() {
    var notes = scanAllNoteBlocksInRange();
    if (!notes || notes.length === 0) {
        minecraft.clientMessage("§d[白色渲染] §c未找到音符盒");
        return;
    }
    
    
    for (var i = renderShapes.length - 1; i >= 0; i--) {
        deleteShape(renderShapes[i]);
    }
    renderShapes = [];
    
    var count = 0;
    for (var i = 0; i < notes.length; i++) {
        var note = notes[i];
        var shape = createWhiteBorderBox(note.x, note.y, note.z);
        if (shape) count++;
    }
    
    minecraft.clientMessage("§d[白色渲染] §6已创建 §7(" + count + " 个音符盒)");
}
function getPlayerFootPos() {
    var pos = getEntityPos(meid);
    return { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
}

function scanNoteBlocks() {
    if (!MUSIC_DATA || MUSIC_DATA.length === 0) {
        minecraft.clientMessage("§d[扫描] §c请先加载音乐文件");
        return null;
    }
    var neededNotes = {};
    for (var i = 0; i < MUSIC_DATA.length; i++) {
        var beat = MUSIC_DATA[i];
        if (!beat) continue;
        var positions = beat[1];
        if (!Array.isArray(positions)) positions = [positions];
        for (var j = 0; j < positions.length; j++) {
            var pos = positions[j];
            var layer = Math.floor(pos / 25);
            var pitch = pos % 25;
            var key = layer + "_" + pitch;
            if (!neededNotes[key]) {
                neededNotes[key] = {
                    pos: pos,
                    layer: layer,
                    pitch: pitch
                };
            }
        }
    }
    var neededKeys = Object.keys(neededNotes);

    var p = player.getLocalPlayer();
    var pos = p.getPos();
    var cx = Math.floor(pos.x);
    var cy = Math.floor(pos.y);
    var cz = Math.floor(pos.z);
    var half = 15;
    var dim = p.getDimension();
    var sortedPositions = getSpiralPositions(cx, cy, cz, half);
    var allNoteBlocks = [];
    for (var idx = 0; idx < sortedPositions.length; idx++) {
        var sp = sortedPositions[idx];
        var x = sp.x;
        var y = sp.y;
        var z = sp.z;
        try {
            var block = dim.getBlock({x: x, y: y, z: z});
            if (!block) continue;
            var namespace = block.getNamespace();
            var id = block.getItemId();
            if (namespace === "minecraft:noteblock" || id === "25" || id === "568") {
                var belowBlock = dim.getBlock({x: x, y: y - 1, z: z});
                var actualLayer = 0;
                if (belowBlock) {
                    var belowName = (belowBlock.getNamespace() || "").replace("minecraft:", "");
                    actualLayer = getLayerFromBlockName(belowName);
                    if (actualLayer === -1) actualLayer = 0;
                }
                allNoteBlocks.push({
                    x: x, y: y, z: z,
                    key: x + "," + y + "," + z,
                    actualLayer: actualLayer,
                    dist: sp.dist
                });
            }
        } catch(e) {}
    }

    var foundNotes = {};
    var totalFound = 0;
    var usedBlocks = [];
    var missingNotes = [];
    for (var i = 0; i < neededKeys.length; i++) {
        var key = neededKeys[i];
        var info = neededNotes[key];
        var targetLayer = info.layer;
        var matched = false;
        for (var j = 0; j < allNoteBlocks.length; j++) {
            if (usedBlocks.indexOf(j) !== -1) continue;
            var note = allNoteBlocks[j];
            if (note.actualLayer === targetLayer) {
                foundNotes[info.pos] = {
                    x: note.x, y: note.y, z: note.z,
                    pos: info.pos,
                    layer: targetLayer
                };
                usedBlocks.push(j);
                totalFound++;
                matched = true;
                break;
            }
        }
        if (!matched) {
            missingNotes.push({
                pos: info.pos,
                layer: targetLayer,
                layerName: getBlockByLayerIdx(targetLayer)
            });
        }
    }
    scannedPositions = foundNotes;
    if (foundNotes && Object.keys(foundNotes).length > 0) {
        _blueBorderBackup = {};
        for (var posKey in foundNotes) {
            _blueBorderBackup[posKey] = {
                x: foundNotes[posKey].x,
                y: foundNotes[posKey].y,
                z: foundNotes[posKey].z
            };
        }
    }
    if (missingNotes.length > 0) {
        var showCount = Math.min(5, missingNotes.length);
        for (var i = 0; i < showCount; i++) {
            var miss = missingNotes[i];
        }
        if (missingNotes.length > 5) {
        }
    }
    minecraft.clientMessage("§d[扫描] §6匹配 " + totalFound + "/" + neededKeys.length + " 个音符盒");
    if (totalFound === 0) {
        minecraft.clientMessage("§d[扫描] §c没有找到匹配的音符盒");
        return null;
    }
    return foundNotes;
}



function buildNoteArray() {
    if (!MUSIC_DATA || MUSIC_DATA.length === 0) {
        clientMessage("§c[建造] §7请先加载音乐文件");
        return;
    }
    
    if (!buildOrigin) {
        clientMessage("§d[建造] §c请先设置原点");
        return;
    }
    
    var lp = player.getLocalPlayer();
    if (!lp) {
        clientMessage("§c[建造] §7无法获取玩家");
        return;
    }
    
    var usedPos = getUsedPositions();
    if (usedPos.length === 0) {
        clientMessage("§c[建造] §7没有音符数据");
        return;
    }
    
    var originX = buildOrigin.x;
    var originY = buildOrigin.y;
    var originZ = buildOrigin.z;
    
    var tasks = [];
    var index = 0;
    var sideLength = Math.ceil(Math.sqrt(usedPos.length));
    
    for (var i = 0; i < usedPos.length; i++) {
        var p = usedPos[i];
        var layerIdx = Math.floor(p / 25);
        var blockId = getBlockIdByLayer(layerIdx);
        var row = Math.floor(index / sideLength);
        var col = index % sideLength;
        var x = originX + col;
        var z = originZ + row;
        var y = originY;
        tasks.push({
            x: x,
            y: y,
            z: z,
            layerIdx: layerIdx,
            bottomBlockId: blockId
        });
        index++;
    }
    
    if (!autoSelectNoteBlock()) {
        clientMessage("§c[建造] §7快捷栏没有音符盒");
        return;
    }
    
    isBuilding = true;
    buildingTask = {
        tasks: tasks,
        built: 0,
        failed: 0,
        index: 0,
        total: tasks.length,
        _waiting: false,
        _tickCounter: 0
    };
    
    clientMessage("§d[建造] §6开始建造 §7(" + tasks.length + " 个音符盒)");
}
function scanAllNoteBlocksInRange() {
    try {
        var p = player.getLocalPlayer();
        var pos = p.getPos();
        var cx = Math.floor(pos.x);
        var cy = Math.floor(pos.y);
        var cz = Math.floor(pos.z);
        var half = 15;
        var foundNotes = [];
        var dim = p.getDimension();
        var sortedPositions = getSpiralPositions(cx, cy, cz, half);
        for (var idx = 0; idx < sortedPositions.length; idx++) {
            var sp = sortedPositions[idx];
            var x = sp.x;
            var y = sp.y;
            var z = sp.z;
            try {
                var block = dim.getBlock({x: x, y: y, z: z});
                if (!block) continue;
                var namespace = block.getNamespace();
                var id = block.getItemId();
                if (namespace === "minecraft:noteblock" || id === "25" || id === "568") {
                    foundNotes.push({
                        x: x, y: y, z: z,
                        key: x + "," + y + "," + z
                    });
                }
            } catch(e) {}
        }
        return foundNotes;
    } catch(e) {
        minecraft.clientMessage("§c扫描错误: " + e);
        return [];
    }
}

function startReadPitch() {
    if (globalThis.isReadingPitch) {
        minecraft.clientMessage("§d[读取] §c读取进行中，请稍候");
        return;
    }
    if (isTuning) {
        minecraft.clientMessage("§d[读取] §c请等待调音完成");
        return;
    }
    if (isPlaying) {
        minecraft.clientMessage("§d[读取] §c请先停止播放");
        return;
    }
    if (!MUSIC_DATA || MUSIC_DATA.length === 0) {
        minecraft.clientMessage("§d[读取] §c请先加载音乐文件");
        return;
    }
    try {
        var files = fs.list(DATA_FOLDER);
        if (files) {
            for (var i = 0; i < files.length; i++) {
                var filePath = DATA_FOLDER + files[i].name;
                if (fs.exists(filePath)) {
                    fs.remove(filePath);
                }
            }
            minecraft.clientMessage("§d[读取] §6已清理 " + files.length + " 个文件");
        }
    } catch(e) {
        minecraft.clientMessage("§d[读取] §c清理文件失败: " + e.message);
    }
    minecraft.clientMessage("§d[读取] §6正在扫描音符盒...");
    scanNoteBlocks();
    if (Object.keys(scannedPositions).length === 0) {
        minecraft.clientMessage("§d[读取] §c扫描失败，没有找到音符盒");
        return;
    }
    clearAuxFolder();
    globalThis.pitchData = {};
    globalThis.readQueue = [];
    globalThis.readClickIndex = 0;
    globalThis.readResponseCount = 0;
    globalThis.readTotal = 0;
    globalThis.readStartTime = Date.now();
    for (var posKey in scannedPositions) {
        var info = scannedPositions[posKey];
        globalThis.readQueue.push({
            x: info.x, y: info.y, z: info.z,
            pos: parseInt(posKey)
        });
    }
    globalThis.readTotal = globalThis.readQueue.length;
    if (globalThis.readTotal === 0) {
        minecraft.clientMessage("§d[读取] §c没有音符盒可读取");
        return;
    }
    minecraft.clientMessage("§d[读取] §6开始读取音高 §7(" + globalThis.readTotal + " 个音符盒)");
    globalThis.isReadingPitch = true;
    if (readTimeout) {
        clearTimeout(readTimeout);
        readTimeout = null;
    }
    readTimeout = setTimeout(function() {
        if (globalThis.isReadingPitch) {
            minecraft.clientMessage("§d[读取] §c超时已收到 " + globalThis.readResponseCount + "/" + globalThis.readTotal + " 个响应");
            finishReadPitch();
        }
    }, 25000);
}


function zigzagDecode(n) {
    return (n >> 1) ^ -(n & 1);
}


function onReceiveServerPacketEvent(id, name, bin) {
    if (id !== 26) return false;
    if (!globalThis.isReadingPitch) return false;
    
    try {
        var bytes = new Uint8Array(bin);
        var offset = 0;
        
        var varints = [];
        for (var i = 0; i < 5; i++) {
            var r = readVarInt(bytes, offset);
            if (!r) return false;
            offset = r.offset;
            varints.push(r.value);
        }
        
        var x = zigzagDecode(varints[0]);
        var y = varints[1];  
        var z = zigzagDecode(varints[2]);
        var pitch = Math.floor(varints[4] / 2);
        
        var lp = player.getLocalPlayer();
        if (!lp) return false;
        var pos = lp.getPos();
        if (!pos) return false;
        
        var dx = x - pos.x;
        var dy = y - pos.y;
        var dz = z - pos.z;
        var distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        if (distance > 15) {
            return false;
        }
        
        var queue = globalThis.readQueue;
        var count = globalThis.readResponseCount;
        if (count < queue.length) {
            var item = queue[count];
            var key = item.x + "," + item.y + "," + item.z;
            globalThis.pitchData[key] = pitch;
            globalThis.readResponseCount = count + 1;
        }
        
    } catch(e) {}
    return false;
}

function processReadTick() {
    if (!globalThis.isReadingPitch) return;
    if (Date.now() - globalThis.readStartTime > 25000) {
        finishReadPitch();
        return;
    }
    if (globalThis.readClickIndex >= globalThis.readTotal) {
        if (globalThis.readResponseCount < globalThis.readTotal) {
            return;
        }
        finishReadPitch();
        return;
    }
    var item = globalThis.readQueue[globalThis.readClickIndex];
    tuneBlock(item.x, item.y, item.z);
    globalThis.readClickIndex++;
}

function finishReadPitch() {
    globalThis.isReadingPitch = false;
    var resultCount = Object.keys(globalThis.pitchData).length;
    if (resultCount > 0) {
        pitchData = globalThis.pitchData;
        savePitchData();
        minecraft.clientMessage("§d[读取] §6读取完成 §7(" + resultCount + "/" + globalThis.readTotal + " 个)");
        minecraft.clientMessage("§d[提示] §6可开始调音");
    } else {
        minecraft.clientMessage("§d[读取] §c读取失败，未收到任何音高数据");
    }
    globalThis.readQueue = [];
    globalThis.readClickIndex = 0;
    globalThis.readResponseCount = 0;
    globalThis.readTotal = 0;
}

function readVarInt(bytes, offset) {
    var result = 0;
    var shift = 0;
    var b = 0;
    while (offset < bytes.length) {
        b = bytes[offset];
        offset++;
        result |= (b & 0x7F) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
        if (shift > 35) break;
    }
    return { value: result, offset: offset };
}

function testNoteBlockPitch() {
    var p = player.getLocalPlayer();
    var pos = p.getPos();
    var x = Math.floor(pos.x);
    var y = Math.floor(pos.y) - 1;
    var z = Math.floor(pos.z);
    var dim = p.getDimension();
    var block = dim.getBlock({x: x, y: y, z: z});
    if (!block) {
        minecraft.clientMessage("§d[测试] §c脚下没有方块");
        return;
    }
    var namespace = block.getNamespace();
    var id = block.getItemId();
    if (namespace === "minecraft:noteblock" || id === "25" || id === "568") {
        var pitch = getNoteBlockPitch(x, y, z);
        if (pitch !== -1) {
            minecraft.clientMessage("§d[测试] §6当前音高: " + pitch);
        } else {
            minecraft.clientMessage("§d[测试] §c无法读取音高");
        }
    } else {
        minecraft.clientMessage("§d[测试] §c这不是一个音符盒");
    }
}

function startTuning() {
    if (isTuning) { 
        clientMessage("§d[调音] §c调音进行中，请稍候"); 
        return; 
    }
    if (isPlaying) { 
        clientMessage("§d[调音] §c请先停止播放"); 
        return; 
    }
    for (var key in blueBorderShapes) {
        var data = blueBorderShapes[key];
        if (data) {
            if (Array.isArray(data.fillId)) {
                for (var j = 0; j < data.fillId.length; j++) {
                    try { removeShape(data.fillId[j]); } catch(e) {}
                }
            } else {
                try { removeShape(data.fillId); } catch(e) {}
            }
            if (data.borderFill) try { removeShape(data.borderFill); } catch(e) {}
            if (data.fillFill) try { removeShape(data.fillFill); } catch(e) {}
        }
    }
    blueBorderShapes = {};
    blueBorderEnabled = false;
    for (var i = renderShapes.length - 1; i >= 0; i--) {
        deleteShape(renderShapes[i]);
    }
    renderShapes = [];
    CONFIG.renderMode = 0;
    minecraft.clientMessage("§d[调音] §c已关闭白色渲染");
    clientMessage("§d[调音] §6正在重新扫描音符盒...");
    scannedPositions = {};
    var result = scanNoteBlocks();
    if (!result || Object.keys(scannedPositions).length === 0) {
        clientMessage("§d[调音] §c没有找到音符盒，请站在音符盒附近执行");
        return;
    }
    if (Object.keys(pitchData).length === 0) {
        loadPitchData();
    }
    if (Object.keys(pitchData).length === 0) {
        clientMessage("§d[调音] §c没有音高数据，请先执行读取音高");
        return;
    }
    var tasks = [];
    var alreadyCorrect = 0;
    for (var posKey in scannedPositions) {
        var info = scannedPositions[posKey];
        var coordKey = info.x + "," + info.y + "," + info.z;
        var targetPitch = parseInt(posKey) % 25;
        var currentPitch = 0;
        if (pitchData[coordKey] !== undefined) {
            currentPitch = pitchData[coordKey];
        }
        if (currentPitch === targetPitch) {
            alreadyCorrect++;
            continue;
        }
        var clicksNeeded = (targetPitch - currentPitch + 25) % 25;
        if (clicksNeeded === 0) {
            alreadyCorrect++;
            continue;
        }
        tasks.push({
            x: info.x, y: info.y, z: info.z,
            targetPitch: targetPitch,
            currentPitch: currentPitch,
            remaining: clicksNeeded,
            total: clicksNeeded,
            posKey: posKey
        });
    }
    if (tasks.length === 0) {
        clientMessage("§d[调音] §6所有 " + alreadyCorrect + " 个音符盒音高已正确");
        addBlueBordersToAllNotes();
        return;
    }
    var totalClicks = tasks.reduce(function(sum, t) { return sum + t.total; }, 0);
    clientMessage("§d[调音] §6需要调音 " + tasks.length + " 个音符盒，总计点击 " + totalClicks + " 次");
    isTuning = true;
    tuningTask = {
        tasks: tasks,
        round: 0,
        lastClick: 0,
        completed: 0,
        totalClicks: totalClicks
    };
    clientMessage("§d[调音] §6开始调音...");
}

function stopTuning() {
    isTuning = false;
    tuningTask = null;
    for (var i = renderShapes.length - 1; i >= 0; i--) {
        deleteShape(renderShapes[i]);
    }
    renderShapes = [];
    CONFIG.renderMode = 1;
    savedRenderMode = 1;
    minecraft.clientMessage("§d[调音] §6已开启白色渲染");
    addBlueBordersToAllNotes();
    minecraft.clientMessage("§d[调音] §c已取消");
}

function processTuningTick() {
    if (!isTuning || !tuningTask) return;
    var now = Date.now();
    if (now - tuningTask.lastClick < CONFIG.clickDelay) return;
    var toClick = [];
    for (var i = 0; i < tuningTask.tasks.length; i++) {
        var task = tuningTask.tasks[i];
        if (task.remaining > 0) {
            toClick.push(task);
        }
    }
    if (toClick.length === 0) {
        minecraft.clientMessage("§d[调音] §6调音完成");
        stopTuning();
        return;
    }
    for (var i = 0; i < toClick.length; i++) {
        var task = toClick[i];
        tuneBlock(task.x, task.y, task.z);
        task.remaining--;
        tuningTask.completed++;
    }
    tuningTask.lastClick = now;
    tuningTask.round++;
    if (tuningTask.round % 5 === 0) {
        var remaining = 0;
        for (var i = 0; i < tuningTask.tasks.length; i++) {
            remaining += tuningTask.tasks[i].remaining;
        }
    }
}

function getNoteBlockPitch(x, y, z) {
    try {
        var p = player.getLocalPlayer();
        var dim = p.getDimension();
        var block = dim.getBlock({x: x, y: y, z: z});
        if (!block) return -1;
        var nbt = block.getNBT();
        if (!nbt) return -1;
        var pitch = -1;
        if (typeof nbt === 'object') {
            if (nbt.note !== undefined) {
                pitch = parseInt(nbt.note);
            } else if (nbt.states && nbt.states.note !== undefined) {
                pitch = parseInt(nbt.states.note);
            }
        }
        return pitch;
    } catch(e) {
        return -1;
    }
}



function startPlay() {
    let len = safeMusicLength();
    if (len === 0) {
        clientMessage("§d[演奏] §c请先加载音乐");
        return;
    }
    if (isTuning) { 
        clientMessage("§d[演奏] §c请等待调音完成");
        return; 
    }
    
 
    _playLock = true;
    
  
    isPlaying = false;
    _isPlayMode = false;
    PlayController.isPlaying = false;
    

    _playSchedule = null;
    _playIndex = 0;
    playAccumulatedTime = 0;
    playTickCounter = 0;
    _speedAdjustedTime = 0;
    _lastSpeedCheck = Date.now();
    currentPlayPositions = {};
    
    PlayController.schedule = null;
    PlayController.index = 0;
    PlayController.accumulatedTime = 0;
    PlayController.tickCounter = 0;
    
   
    for (let i = renderShapes.length - 1; i >= 0; i--) {
        deleteShape(renderShapes[i]);
    }
    renderShapes = [];
    
  
    let playMap = {};
    if (Object.keys(scannedPositions).length > 0) {
        playMap = scannedPositions;
    } else if (Object.keys(notePositions).length > 0) {
        playMap = notePositions;
    } else {
        clientMessage("§d[演奏] §c没有可用的音符盒，请先扫描");
        _playLock = false;
        return;
    }
    if (isCmdPlaying) stopCmdPlay();
    
    currentPlayPositions = {};
    for (var key in playMap) {
        currentPlayPositions[key] = {
            x: playMap[key].x,
            y: playMap[key].y,
            z: playMap[key].z
        };
    }
    
    var schedule = [];
    var accumulatedTime = 0;
    for (var i = 0; i < len; i++) {
        var beat = safeGetMusic(i);
        if (!beat) continue;
        var delay = Math.max(1, Math.floor(beat[0] / CONFIG.playSpeed));
        accumulatedTime += delay;
        schedule.push({
            time: accumulatedTime,
            positions: beat[1]
        });
    }

   
    _playSchedule = schedule;
    _playIndex = 0;
    playAccumulatedTime = 0;
    PlayController.schedule = schedule;
    PlayController.index = 0;
    PlayController.accumulatedTime = 0;
    _isPlayMode = true;
    isPlaying = true;
    PlayController.isPlaying = true;
    
  
    _playLock = false;
    
    clientMessage("§d[演奏] §6开始播放 §7(" + schedule.length + " 个事件)");
}

function stopPlay() {
  
    _playLock = true;
    
 
    isPlaying = false;
    _isPlayMode = false;
    PlayController.isPlaying = false;
    
  
    _playIndex = 0;
    _playSchedule = null;
    playAccumulatedTime = 0;
    playTickCounter = 0;
    _speedAdjustedTime = 0;
    _lastSpeedCheck = Date.now();
    currentPlayPositions = {};
    
    PlayController.schedule = null;
    PlayController.index = 0;
    PlayController.accumulatedTime = 0;
    PlayController.tickCounter = 0;
    
  
    for (let i = renderShapes.length - 1; i >= 0; i--) {
        deleteShape(renderShapes[i]);
    }
    renderShapes = [];
    
   
    _playLock = false;
    
    clientMessage("§d[演奏] §c已停止");
}

function processPlayTick() {
 
    if (_playLock) return;
    
  
    if (!PlayController.isPlaying) return;
    if (!isPlaying) return;
    
    var schedule = PlayController.schedule;
    if (!schedule || schedule.length === 0 || PlayController.index >= schedule.length) {
        clientMessage("§d[演奏] §6播放完成");
        stopPlay();
        return;
    }
    
   
    var deltaMs = playTickInterval * CONFIG.playSpeed;
    PlayController.accumulatedTime += deltaMs;
    
    var maxPerTick = 3;
    var processed = 0;
    var index = PlayController.index || 0;
    
   
    while (index < schedule.length && processed < maxPerTick) {
      
        if (!PlayController.isPlaying) {
            PlayController.index = index;
            return;
        }
        if (_playLock) {
            PlayController.index = index;
            return;
        }
        
        var event = schedule[index];
        if (PlayController.accumulatedTime >= event.time) {
            var positions = event.positions;
            if (!Array.isArray(positions)) positions = [positions];
            for (var i = 0; i < positions.length; i++) {
                var pos = positions[i];
                var posStr = pos.toString();
                var posData = currentPlayPositions[posStr];
                if (posData) {
                    clickBlock(posData.x, posData.y, posData.z);
                }
            }
            index++;
            processed++;
        } else {
            break;
        }
    }
    PlayController.index = index;
}

function getCmdPitch(pos) {
    var localPos = pos % 25;
    var semitone = localPos - 12;
    var pitch = Math.pow(2, semitone / 12);
    pitch = Math.max(0.5, Math.min(2.0, pitch));
    return pitch.toFixed(4);
}

function startCmdPlay() {
    if (!MUSIC_DATA || typeof MUSIC_DATA.length === 'undefined' || MUSIC_DATA.length === 0) {
        minecraft.clientMessage("§d[指令播放] §c请先加载音乐");
        return;
    }
    if (isCmdPlaying) {
        stopCmdPlay();
        java.lang.Thread.sleep(100);
    }
    if (isPlaying) stopPlay();
    isCmdPlaying = true;
    cmdPlayIndex = 0;
    _cmdAccumulatedTime = 0;
    _cmdLastCheckTime = Date.now();
    minecraft.clientMessage("§d[指令播放] §6开始播放 §7(音量: " + cmdVolume + ")");
}

function processCmdPlayTick() {
    if (!isCmdPlaying) return;
    let len = safeMusicLength();
    if (len === 0 || cmdPlayIndex >= len) {
        clientMessage("§d[指令播放] §6播放完成");
        stopCmdPlay();
        return;
    }
    let now = Date.now();
    let delta = now - _cmdLastCheckTime;
    _cmdLastCheckTime = now;
    if (delta > 50) delta = 50;
    _cmdAccumulatedTime += delta * CONFIG.playSpeed;
    let processed = 0;
    while (cmdPlayIndex < len && processed < 5) {
        let beat = safeGetMusic(cmdPlayIndex);
        if (!beat) {
            cmdPlayIndex++;
            continue;
        }
        let delay = Math.max(1, Math.floor(beat[0] / CONFIG.playSpeed));
        if (_cmdAccumulatedTime >= delay) {
            let posList = beat[1];
            if (!Array.isArray(posList)) posList = [posList];
            for (let i = 0; i < posList.length; i++) {
                let pos = posList[i];
                let instrument = getInstrumentByPos(pos);
                let pitch = getCmdPitch(pos);
                executeCommand("execute as @a[r=10] at @s run playsound " + instrument + "@s" + " ~ ~ ~ " + cmdVolume + " " + pitch + " 1");
            }
            cmdPlayIndex++;
            _cmdAccumulatedTime -= delay;
            processed++;
        } else {
            break;
        }
    }
}

function stopCmdPlay() {
    if (!isCmdPlaying && !cmdPlayInterval) return;
    isCmdPlaying = false;
    if (cmdPlayInterval) {
        clearInterval(cmdPlayInterval);
        cmdPlayInterval = null;
    }
    minecraft.clientMessage("§d[指令播放] §c已停止");
}

function setCmdVolume(vol) {
    cmdVolume = Math.max(0.1, Math.min(2.0, vol));
    minecraft.clientMessage("§d[设置] §6音量已设为 " + cmdVolume);
}

function getUsedPositions() {
    var used = new Set();
    if (!MUSIC_DATA || typeof MUSIC_DATA.length === 'undefined' || MUSIC_DATA.length === 0) {
        return [];
    }
    for (var beat of MUSIC_DATA) {
        if (!beat) continue;
        var positions = beat[1];
        if (!Array.isArray(positions)) {
            positions = [positions];
        }
        for (var pos of positions) {
            used.add(pos);
        }
    }
    return Array.from(used);
}

function calculateRequiredBlocks() {
    var requiredBlocks = {};
    var usedPos = getUsedPositions();
    if (!usedPos || usedPos.length === 0) {
        return requiredBlocks;
    }
    for (var pos of usedPos) {
        var layerIdx = Math.floor(pos / 25);
        var block = getBlockByLayerIdx(layerIdx);
        requiredBlocks[block] = (requiredBlocks[block] || 0) + 1;
    }
    return requiredBlocks;
}

function getItemName(item) {
    try {
        if (!item) return "";
        
        if (typeof item.getDescriptionName === 'function') {
            var name = item.getDescriptionName();
            if (name && name !== "") return name;
        }
        if (typeof item.getName === 'function') {
            var name = item.getName();
            if (name && name !== "") return name;
        }
        return "";
    } catch(e) {
        return "";
    }
}

function findBlockInHotbar(blockName, blockAux) {
    try {
        const lp = getLocalPlayer();
        if (!lp) return -1;
        let hotbarSize = 9;
        try { hotbarSize = lp.getHotBarSize(); } catch(e) {}
        for (let slot = 0; slot < hotbarSize; slot++) {
            try {
                const item = lp.getInventoryItem(slot);
                if (item && !item.isNull()) {
                    let itemName = "";
                    try { itemName = item.getName() || ""; } catch(e) {}
                    let itemAux = 0;
                    try { itemAux = item.getAux ? item.getAux() : 0; } catch(e) {}
                    
                    minecraft.clientMessage("§7[调试] 槽位" + slot + ": §f" + itemName);
                    if (itemName && itemName.indexOf(blockName) !== -1) {
                        if (blockAux === 0 || itemAux === 0 || blockAux === itemAux) {
                            return slot;
                        }
                    }
                }
            } catch(e) {}
        }
        return -1;
    } catch(e) {
        return -1;
    }
}
function isNoteBlock(itemName) {
    if (!itemName) return false;
    var name = itemName.toString().toLowerCase();
    
    return name.includes("noteblock") || 
           name.includes("音符盒") || 
           name.includes("note block") ||
           name === "音符盒";
}


function isTargetBlock(itemName, targetBlock) {
    if (!itemName) return false;
    var name = itemName.toString();
    var target = targetBlock.toString();
    return name.indexOf(target) !== -1;
}



function autoSelectNoteBlock() {
    try {
        var hotBarSize = getPlayerHotBarSize(meid);
        var currentSlot = getPlayerSelectItemSlot(meid);
        
        var currentItem = player.getLocalPlayer().getInventoryItem(currentSlot);
        if (currentItem && !currentItem.isNull()) {
            if (isBlockMatch(currentItem, "minecraft:noteblock")) return true;
        }
        for (var slot = 0; slot < hotBarSize; slot++) {
            if (slot === currentSlot) continue;
            var item = player.getLocalPlayer().getInventoryItem(slot);
            if (item && !item.isNull()) {
                if (isBlockMatch(item, "minecraft:noteblock")) {
                    selectPlayerInventorySlot(meid, slot);
                    return true;
                }
            }
        }
    } catch(e) {}
    return false;
}

function autoSelectBottomBlock(targetId) {
    if (targetId === "minecraft:air") return true;
    try {
        var hotBarSize = getPlayerHotBarSize(meid);
        var currentSlot = getPlayerSelectItemSlot(meid);
        
        var currentItem = player.getLocalPlayer().getInventoryItem(currentSlot);
        if (currentItem && !currentItem.isNull()) {
            if (isBlockMatch(currentItem, targetId)) return true;
        }
        for (var slot = 0; slot < hotBarSize; slot++) {
            if (slot === currentSlot) continue;
            var item = player.getLocalPlayer().getInventoryItem(slot);
            if (item && !item.isNull()) {
                if (isBlockMatch(item, targetId)) {
                    selectPlayerInventorySlot(meid, slot);
                    return true;
                }
            }
        }
    } catch(e) {}
    return false;
}
function placeNoteBlock(x, y, z) {
    if (!autoSelectNoteBlock()) {
        minecraft.clientMessage("§d[建造] §c快捷栏没有找到音符盒");
        return false;
    }
    if (CONFIG.enableAim || silentLookEnabled) {
        aimAtBlock(x, y, z);
    }
    swingArm();
    var result = buildBlock(meid, x, y, z, 1);
    if (result) {
        spawnShadow(x, y, z);
        if (CONFIG.renderMode === 1) {
            createWhiteBorderBox(x, y, z);
        }
    }
    return result;
}

function placeBottomBlock(x, y, z, blockType) {
    if (blockType === "air") return true;
    if (!autoSelectBottomBlock(blockType)) return false;
    if (CONFIG.enableAim || silentLookEnabled) {
        aimAtBlock(x, y, z);
    }
    swingArm();
    var result = buildBlock(meid, x, y, z, 1);
    if (result) spawnShadow(x, y, z);
    return result;
}

function showBuildGuide() {
    var requiredBlocks = calculateRequiredBlocks();
    var usedPos = getUsedPositions();
    if (!usedPos || usedPos.length === 0) {
        minecraft.clientMessage("§d[材料指南] §c没有音乐数据，请先加载音乐");
        return;
    }
    minecraft.clientMessage("§d[材料指南]");
    for (var [block, count] of Object.entries(requiredBlocks)) {
        minecraft.clientMessage("§7" + block + " §f×" + count);
    }
    minecraft.clientMessage("§7音符盒 §f×" + usedPos.length);
}

function generateBuildTasks() {
    var usedPos = getUsedPositions();
    if (!usedPos || usedPos.length === 0) return [];
    var layerMap = new Map();
    for (var pos of usedPos) {
        var layerIdx = Math.floor(pos / 25);
        var localIdx = pos % 25;
        if (!layerMap.has(layerIdx)) layerMap.set(layerIdx, []);
        layerMap.get(layerIdx).push({ globalPos: pos, localIdx: localIdx });
    }
    var layers = Array.from(layerMap.keys()).sort((a,b) => a-b);
    var buildTasks = [];
    var totalNotes = 0;
    for (var notes of layerMap.values()) totalNotes += notes.length;
    var columnsPerRow = Math.max(1, Math.ceil(Math.sqrt(totalNotes)));
    var currentRow = 0, currentCol = 0;
    for (var i = 0; i < layers.length; i++) {
        var layerIdx = layers[i];
        var notes = layerMap.get(layerIdx);
        var block = getBlockByLayerIdx(layerIdx);
        for (var note of notes) {
            if (currentCol >= columnsPerRow) { currentRow++; currentCol = 0; }
            buildTasks.push({
                globalPos: note.globalPos,
                localIdx: note.localIdx,
                block: block,
                row: currentRow,
                col: currentCol,
                layerIdx: layerIdx
            });
            currentCol++;
        }
    }
    var foot = getPlayerFootPos();
    var baseX = foot.x, baseZ = foot.z, baseY = foot.y - 2;
    for (var task of buildTasks) {
        task.x = baseX + task.col;
        task.z = baseZ + task.row;
        task.y = baseY;
        task.belowY = task.y - 1;
    }
    return buildTasks;
}

function startManualBuild() {
    if (isBuilding) { 
        minecraft.clientMessage("§d[建造] §c已有建造任务进行中");
        return; 
    }
    if (isPlaying || isTuning || isRebuilding) { 
        minecraft.clientMessage("§d[建造] §c请先停止其他任务");
        return; 
    }
    var buildTasks = generateBuildTasks();
    if (buildTasks.length === 0) {
        minecraft.clientMessage("§d[建造] §c没有音乐数据，请先加载音乐");
        return;
    }
    isBuilding = true;
    buildingTask = { tasks: buildTasks, index: 0, total: buildTasks.length };
    minecraft.clientMessage("§d[建造] §6开始建造 §7(" + buildTasks.length + " 个音符盒)");
}
function startBuild() {
    if (isBuilding) {
        minecraft.clientMessage("§c[建造] 建造中，输入 §b/st §c停止");
        return;
    }
    if (!currentFile || currentFile === "") {
        minecraft.clientMessage("§c[建造] 请先选择文件 (§b/kq)");
        return;
    }
    const filePath = DATA_PATH + currentFile;
    const data = loadDataFile(filePath);
    if (!data) {
        minecraft.clientMessage("§c[建造] 数据加载失败");
        return;
    }
    
    const filteredData = [];
    for (const item of data) {
        if (item.blockId !== "" && item.blockId.indexOf("空气") === -1 && item.blockId.indexOf("未知方块") === -1) {
            filteredData.push(item);
        }
    }
    if (filteredData.length === 0) {
        minecraft.clientMessage("§c[建造] 没有可建造的方块");
        return;
    }
    
    const pos = getPlayerPosFloat();
    if (!pos) {
        minecraft.clientMessage("§c[建造] 无法获取玩家位置");
        return;
    }
    
    const originX = Math.floor(pos.x);
    const originY = Math.floor(pos.y) + 3;
    const originZ = Math.floor(pos.z);
    
    const queue = [];
    for (const item of filteredData) {
        queue.push({
            blockId: item.blockId,
            x: originX + item.x,
            y: originY + item.y,
            z: originZ + item.z
        });
    }
    
    const seen = {};
    const unique = [];
    for (const p of queue) {
        const key = p.x + "," + p.y + "," + p.z;
        if (!seen[key]) { seen[key] = true; unique.push(p); }
    }
    
    buildQueue = unique;
    buildIndex = 0;
    buildCount = 0;
    totalBlocks = buildQueue.length;
    isBuilding = true;
    tickCounter = 0;
    waitForPlayer = false;
    missingBlocks = {};
    
    const first = buildQueue[0];
    minecraft.clientMessage("§d[建造] 开始建造 §f" + currentFile + " §7(" + totalBlocks + " 个方块)");
    minecraft.clientMessage("§7原点: §f(" + originX + ", " + originY + ", " + originZ + ")");
    minecraft.clientMessage("§7第一个方块: §f(" + first.x + ", " + first.y + ", " + first.z + ")");
    minecraft.clientMessage("§7距离限制: §f" + BUILD_RADIUS + " 格");
}
function stopBuild() {
    if (!isBuilding) {
        clientMessage("§c[建造] 没有正在进行的建造");
        return;
    }
    isBuilding = false;
    buildingTask = null;
    clearRenderShapes();
    clientMessage("§d[建造] §c已停止");
}
function setBuildOrigin() {
    var lp = player.getLocalPlayer();
    if (!lp) {
        clientMessage("§c[原点] §7无法获取玩家位置");
        return;
    }
    var pos = lp.getPos();
    if (!pos) {
        clientMessage("§c[原点] §7无法获取玩家位置");
        return;
    }
    
    var usedPos = getUsedPositions();
    if (usedPos.length === 0) {
        clientMessage("§c[原点] §7没有音符数据，请先加载音乐");
        return;
    }
    
    var totalNotes = usedPos.length;
    var sideLength = Math.ceil(Math.sqrt(totalNotes));
    
    buildOrigin = {
        x: Math.floor(pos.x) - Math.floor(sideLength / 2),
        y: Math.floor(pos.y) - 2,
        z: Math.floor(pos.z) - Math.floor(sideLength / 2)
    };
    
    clientMessage("§d[原点] §6已设置: §f(" + buildOrigin.x + ", " + buildOrigin.y + ", " + buildOrigin.z + ")");
}

function startRebuild() {
    if (isRebuilding) { 
        minecraft.clientMessage("§d[重造] §c已有重造任务进行中");
        return; 
    }
    if (isPlaying || isTuning || isBuilding) { 
        minecraft.clientMessage("§d[重造] §c请先停止其他任务");
        return; 
    }
    if (Object.keys(notePositions).length === 0) {
        minecraft.clientMessage("§d[重造] §c没有已建造的音符盒");
        return;
    }
    var count = 0;
    for (var globalPos in notePositions) {
        var pos = notePositions[globalPos];
        destroyBlockAt(pos.x, pos.y, pos.z);
        count++;
    }
    notePositions = {};
    minecraft.clientMessage("§d[重造] §6已拆除 " + count + " 个音符盒");
}

function stopRebuild() {
    isRebuilding = false;
    rebuildingTask = null;
    clearRenderShapes();
    minecraft.clientMessage("§d[重造] §c已取消");
}

function processBuildTick() {
    if (!isBuilding) return;
    if (!buildingTask) {
        isBuilding = false;
        return;
    }
    if (buildingTask.index >= buildingTask.tasks.length) {
        isBuilding = false;
        minecraft.clientMessage("§d[建造] §6建造完成");
        buildingTask = null;
        return;
    }
    
    var task = buildingTask.tasks[buildingTask.index];
    
    var block = getBlock(task.x, task.y, task.z);
    if (block && block.namespace !== "minecraft:air") {
        buildingTask.index++;
        return;
    }
    
    if (task.bottomBlockId && task.bottomBlockId !== "minecraft:air") {
        if (!autoSelectBottomBlock(task.bottomBlockId)) {
            if (!buildingTask._waiting) {
                buildingTask._waiting = true;
                clientMessage("§d[等待] §c缺少方块 §f" + getBlockByLayerIdx(task.layerIdx));
            }
            return;
        }
        buildingTask._waiting = false;
        
        var bottomResult = buildBlock(meid, task.x, task.y - 1, task.z, 1);
        if (!bottomResult) {
            bottomResult = buildBlock(meid, task.x, task.y - 1, task.z, 0);
        }
        if (!bottomResult) {
            if (!buildingTask._waiting) {
                buildingTask._waiting = true;
                clientMessage("§d[等待] §c底部方块放置失败，检查目标位置是否被阻挡");
            }
            return;
        }
    }
    
    if (!autoSelectNoteBlock()) {
        if (!buildingTask._waiting) {
            buildingTask._waiting = true;
            clientMessage("§d[等待] §c快捷栏没有音符盒");
        }
        return;
    }
    buildingTask._waiting = false;
    
    var result = buildBlock(meid, task.x, task.y, task.z, 1);
    if (!result) {
        result = buildBlock(meid, task.x, task.y, task.z, 0);
    }
    
    if (result) {
        buildingTask.built++;
        buildingTask.index++;
        buildingTask._waiting = false;
    } else {
        if (!buildingTask._waiting) {
            buildingTask._waiting = true;
            clientMessage("§d[等待] §c音符盒放置失败，检查目标位置是否被阻挡");
        }
        return;
    }
}

function showInfo() {
    var usedPos = getUsedPositions();
    var scannedCount = Object.keys(scannedPositions).length;
    var cachedCount = Object.keys(pitchData).length;
    var musicLen = (MUSIC_DATA && typeof MUSIC_DATA.length !== 'undefined') ? MUSIC_DATA.length : 0;
    minecraft.clientMessage("");
    minecraft.clientMessage("§d=== NoteBot v9.178 信息 ===");
    minecraft.clientMessage("§7音乐: §f" + (currentMusicName || "未加载"));
    minecraft.clientMessage("§7扫描分配: §f" + scannedCount + " 个");
    minecraft.clientMessage("§7音高缓存: §f" + cachedCount + " 个");
    minecraft.clientMessage("§7音乐事件: §f" + musicLen + " 个");
    minecraft.clientMessage("§7扫描半径: §f" + scanRange + " 格");
    minecraft.clientMessage("§7转头瞄准: §f" + (CONFIG.enableAim ? "开启" : "关闭"));
    minecraft.clientMessage("§7静默转头: §f" + (silentLookEnabled ? "开启" : "关闭"));
    minecraft.clientMessage("§7虚影特效: §f" + (CONFIG.enableShadow ? "开启" : "关闭"));
    minecraft.clientMessage("§7调音间隔: §f" + CONFIG.clickDelay + "ms");
    minecraft.clientMessage("§7播放速度: §f" + CONFIG.playSpeed.toFixed(2) + "x");
}

function setScanRadius(radius) {
    scanRange = Math.max(1, Math.min(50, radius));
    CONFIG.scanRadius = scanRange;
    minecraft.clientMessage("§d[设置] §6扫描半径已设为 " + scanRange + " 格");
}

function toggleAim() { 
    CONFIG.enableAim = !CONFIG.enableAim;
    minecraft.clientMessage("§d[开关] §6转头瞄准 " + (CONFIG.enableAim ? "§a开启" : "§c关闭"));
}

function toggleShadow() {
    CONFIG.enableShadow = !CONFIG.enableShadow;
    minecraft.clientMessage("§d[开关] §6虚影特效 " + (CONFIG.enableShadow ? "§a开启" : "§c关闭"));
}

function toggleRender() {
    CONFIG.renderMode = (CONFIG.renderMode + 1) % 2;
    if (CONFIG.renderMode === 0) {
        for (var i = renderShapes.length - 1; i >= 0; i--) {
            deleteShape(renderShapes[i]);
        }
        renderShapes = [];
        minecraft.clientMessage("§d[开关] §c白色渲染已关闭");
    } else {
        
        addWhiteRenderToAllNotes();
        minecraft.clientMessage("§d[开关] §6白色渲染已开启");
    }
}

function toggleSwingDuringPlay() {
    CONFIG.swingDuringPlay = !CONFIG.swingDuringPlay;
    minecraft.clientMessage("§d[开关] §6演奏挥手 " + (CONFIG.swingDuringPlay ? "§a开启" : "§c关闭"));
}

function toggleSwing() {
    CONFIG.enableSwing = !CONFIG.enableSwing;
    minecraft.clientMessage("§d[开关] §6全局挥手 " + (CONFIG.enableSwing ? "§a开启" : "§c关闭"));
}

function exitScript() {

    aimTargetPos = null;
    stopAimLoop(); 

    isPlaying = false;
    isTuning = false;
    isBuilding = false;
    aimTargetPos = null; 

    isRebuilding = false;
    isReadingPitch = false;
    _isPlayMode = false;
    if (isCmdPlaying) stopCmdPlay();
    
    
    for (let i = renderShapes.length - 1; i >= 0; i--) {
        deleteShape(renderShapes[i]);
    }
    renderShapes = [];
    
   
    for (let key in blueBorderShapes) {
        let data = blueBorderShapes[key];
        if (!data) continue;
        if (data.fillId) {
            try { if (data.fillId && typeof data.fillId.remove === 'function') data.fillId.remove(); } catch(e) {}
        }
        if (data.fillFill) {
            try { if (data.fillFill && typeof data.fillFill.remove === 'function') data.fillFill.remove(); } catch(e) {}
        }
    }
    blueBorderShapes = {};
    blueBorderEnabled = false;
    
    MUSIC_DATA = [];
    pitchData = {};
    scannedPositions = {};
    notePositions = {};
    _playSchedule = null;
    readQueue = [];
    currentPlayPositions = {};
    _blueBorderBackup = {};
    _playIndex = 0;
    _speedAdjustedTime = 0;
    cmdPlayIndex = 0;
    isCmdPlaying = false;
    tuningTask = null;
    buildingTask = null;
    rebuildingTask = null;
    if (readTimeout) {
        clearTimeout(readTimeout);
        readTimeout = null;
    }
    
    silentLookEnabled = false;
    if (cameraDeparted) {
        safeResetCamera();
        cameraDeparted = false;
    }
    lastTargetPitch = null;
    lastTargetYaw = null;
    
    clientMessage("§d[NoteBot] §6脚本已退出");
    exit();
}

function resetProgress() {
    isPlaying = false;
    _isPlayMode = false;
    _playSchedule = null;
    _playIndex = 0;
    _speedAdjustedTime = 0;
    _lastSpeedCheck = Date.now();
    musicIndex = 0;
    
    playAccumulatedTime = 0;
    playTickCounter = 0;
    PlayController.accumulatedTime = 0;
    PlayController.index = 0;
    PlayController.schedule = null;
    PlayController.isPlaying = false;
    
    for (var i = renderShapes.length - 1; i >= 0; i--) {
        deleteShape(renderShapes[i]);
    }
    renderShapes = [];
    minecraft.clientMessage("§d[重置] §6播放已完全停止，可加载新文件");
}
function updateExistingWhiteShapes() {
    var r = CONFIG.whiteFillR / 100;
    var g = CONFIG.whiteFillG / 100;
    var b = CONFIG.whiteFillB / 100;
    var a = CONFIG.whiteFillA / 100;
    
    for (var i = 0; i < renderShapes.length; i++) {
        var shape = renderShapes[i];
        if (!shape) continue;
        
        if (shape.fillId) {
            try {
                shape.fillId.color = { 
                    r: r,
                    g: g,
                    b: b,
                    a: a
                };
            } catch(e) {}
        }
    }
}
function updateMenuToggle() {
    for (var item of NoteBot_Menu.items) {
        if (item.send_message === "toggleAim") {
            item.name = "转头瞄准(" + (CONFIG.enableAim ? "✓开启" : "✗关闭") + ")";
        }
        if (item.send_message === "toggleShadow") {
            item.name = "虚影特效(" + (CONFIG.enableShadow ? "✓开启" : "✗关闭") + ")";
        }
        if (item.send_message === "toggleSwing") {
            item.name = "全局挥手(" + (CONFIG.enableSwing ? "✓开启" : "✗关闭") + ")";
        }
        if (item.send_message === "toggleSwingPlay") {
            item.name = "演奏挥手(" + (CONFIG.swingDuringPlay ? "✓开启" : "✗关闭") + ")";
        }
    }
}

function onSendChatMessageEvent(text) {
    if (!_ready) return false;
    var msg = text.toLowerCase().trim();
    if (msg === "speed1_0") { CONFIG.playSpeed = 1.0; return true; }


    
    if (msg === "speed1_1") { CONFIG.playSpeed = 1.1; return true; }
    if (msg === "speed1_2") { CONFIG.playSpeed = 1.2; return true; }
    if (msg === "speed1_3") { CONFIG.playSpeed = 1.3; return true; }
    if (msg === "speed1_4") { CONFIG.playSpeed = 1.4; return true; }
    if (msg === "loadpitch") { loadPitchData(); return true; }
    if (msg === "toggleparticle" || msg === "tp") { toggleParticle(); return true; }
    if (msg === "scan") { scanNoteBlocks(); return true; }
    if (msg === "readpitch") { startReadPitch(); return true; }
    if (msg === "savepitch") { savePitchData(); return true; }
    if (msg === "delpitch") { deletePitchData(); return true; }
    if (msg === "kq") { startTuning(); return true; }
    if (msg === "stoptune") { stopTuning(); return true; }
    if (msg === "ys") { startPlay(); return true; }
    if (msg === "tz") { stopPlay(); return true; }
    if (msg === "info") { showInfo(); return true; }
    if (msg === "tc") { exitScript(); return true; }
    if (msg === "menu") { menu.show("NoteBot"); return true; }
    if (msg === "toggleaim") { toggleAim(); return true; }
    if (msg === "toggleshadow") { toggleShadow(); return true; }
    if (msg === "testpitch" || msg === "tp") { testNoteBlockPitch(); return true; }
    if (msg === "toggleswingplay" || msg === "tsp") { toggleSwingDuringPlay(); return true; }
    if (msg === "toggleswing" || msg === "ts") { toggleSwing(); return true; }
    if (msg === "cmdplay") { startCmdPlay(); return true; }
    if (msg === "cmdstop") { stopCmdPlay(); return true; }
    if (msg === "/play") { startCmdPlay(); return true; }
    if (msg === "/stop") { stopCmdPlay(); return true; }
    if (msg.startsWith("/vol ")) { setCmdVolume(parseFloat(msg.substring(5))); return true; }
    if (msg === "togglerender" || msg === "tr") { toggleRender(); return true; }
    if (msg === "clearrender" || msg === "cr") { clearRenderShapes(); minecraft.clientMessage("§d[渲染] §6已清除"); return true; }
    if (msg === "blueborder" || msg === "bb") { toggleBlueBorder(); return true; }
    if (msg === "removeborder" || msg === "rb") { removeBlueBorders(); return true; }
    if (msg === "silent") {
        CONFIG.aimMaster = true;
        CONFIG.enableAim = false;
        silentLookEnabled = true;
        if (!cameraDeparted) {
            safeDepartCamera();
            cameraDeparted = true;
        }
        clientMessage("§a静默转头: 已开启（模型转头+自由视角）");
        return true;
    }
    if (msg === "normal") {
        CONFIG.aimMaster = true;
        CONFIG.enableAim = true;
        silentLookEnabled = false;
        if (cameraDeparted) {
            safeResetCamera();
            cameraDeparted = false;
        }
        lastTargetPitch = null;
        lastTargetYaw = null;
        clientMessage("§a普通转头: 已开启（摄像机跟随）");
        return true;
    }
    if (msg === "aim") {
        CONFIG.aimMaster = !CONFIG.aimMaster;
        if (CONFIG.aimMaster) {
            CONFIG.enableAim = true;
            silentLookEnabled = false;
            if (cameraDeparted) {
                safeResetCamera();
                cameraDeparted = false;
            }
            clientMessage("§a转头: 已开启 (普通转头)");
        } else {
            CONFIG.enableAim = false;
            silentLookEnabled = false;
            if (cameraDeparted) {
                safeResetCamera();
                cameraDeparted = false;
            }
            clientMessage("§c转头: 已关闭");
        }
        return true;
    }
    if (msg.startsWith("/load") || msg.startsWith("load")) {
        var parts = msg.split(/\s+/);
        if (parts.length >= 2) {
            loadMusic(parts[1]);
        } else {
            showMusicList();
        }
        return true;
    }
    if (msg === "buildguide" || msg === "bg") { showBuildGuide(); return true; }
    if (msg === "build") { startManualBuild(); return true; }
    if (msg === "stopbuild") { stopBuild(); return true; }
    if (msg === "rebuild") { startRebuild(); return true; }
    if (msg === "stopbuild" || msg === "sb") { stopBuild(); return true; }
    if (msg === "buildnote") { buildNoteArray(); return true; }
    if (msg === "resetprogress" || msg === "rp") { resetProgress(); return true; }
    if (msg === "setorigin") { setBuildOrigin(); return true; }
    if (msg === "stoprebuild") { stopRebuild(); return true; }
    if (msg.startsWith("scanradius") || msg.startsWith("sr")) {
        var parts = msg.split(/\s+/);
        if (parts.length >= 2) {
            setScanRadius(parseInt(parts[1]));
        } else {
            minecraft.clientMessage("用法: scanradius <半径> (1-50)");
        }
        return true;
    }
    return false;
}

function getSpiralPositions(cx, cy, cz, radius) {
    var positions = [];
    for (var dy = -radius; dy <= radius; dy++) {
        for (var dz = -radius; dz <= radius; dz++) {
            for (var dx = -radius; dx <= radius; dx++) {
                var x = cx + dx;
                var y = cy + dy;
                var z = cz + dz;
                var dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
                if (dist > radius) continue;
                positions.push({
                    x: x, y: y, z: z,
                    dist: dist,
                    dx: dx, dy: dy, dz: dz
                });
            }
        }
    }
    positions.sort(function(a, b) {
        if (a.dist !== b.dist) return a.dist - b.dist;
        if (a.dy !== b.dy) return a.dy - b.dy;
        if (a.dz !== b.dz) return a.dz - b.dz;
        return a.dx - b.dx;
    });
    return positions;
}

function onCallModuleEvent(args) {

    
    if (_processingModuleEvent) return;
    if (!_ready) return;
 
    if (args.playSpeedSlider !== undefined) {
        var speed = Math.min(2.0, Math.max(0.5, args.playSpeedSlider));
        CONFIG.playSpeed = speed;
        _processingModuleEvent = false;
        return;
    }

if (args.aimSpeed !== undefined) {
    CONFIG.aimSpeed = Math.min(20, Math.max(1, args.aimSpeed)) / 100;
    _processingModuleEvent = false;
    return;
}
   
    if (args.blueFillR !== undefined) {
        CONFIG.blueFillR = args.blueFillR;

        if (blueBorderEnabled) {
            removeBlueBorders();
            addBlueBordersToAllNotes();
        }
        _processingModuleEvent = false;
        return;
    }

    
    if (args.blueFillG !== undefined) {
        CONFIG.blueFillG = args.blueFillG;

        if (blueBorderEnabled) {
            removeBlueBorders();
            addBlueBordersToAllNotes();
        }
        _processingModuleEvent = false;
        return;
    }

 
    if (args.blueFillB !== undefined) {
        CONFIG.blueFillB = args.blueFillB;
       
        if (blueBorderEnabled) {
            removeBlueBorders();
            addBlueBordersToAllNotes();
        }
        _processingModuleEvent = false;
        return;
    }

 
    if (args.whiteFillR !== undefined) {
        CONFIG.whiteFillR = args.whiteFillR;

        updateExistingWhiteShapes();
        _processingModuleEvent = false;
        return;
    }

    
    if (args.whiteFillG !== undefined) {
        CONFIG.whiteFillG = args.whiteFillG;

        updateExistingWhiteShapes();
        _processingModuleEvent = false;
        return;
    }

    
    if (args.whiteFillB !== undefined) {
        CONFIG.whiteFillB = args.whiteFillB;

        updateExistingWhiteShapes();
        _processingModuleEvent = false;
        return;
    }

if (args.blueFillA !== undefined) {
    CONFIG.blueFillA = args.blueFillA;
    if (blueBorderEnabled) {
        removeBlueBorders();
        addBlueBordersToAllNotes();
    }
    _processingModuleEvent = false;
    return;
}


if (args.whiteFillA !== undefined) {
    CONFIG.whiteFillA = args.whiteFillA;
    updateExistingWhiteShapes();
    _processingModuleEvent = false;
    return;
}

    if (args.fun !== "NoteBot") {
        _processingModuleEvent = false;
        return;
    }

    _processingModuleEvent = true;
    try {
     
        var _aimSubModeVal = (args.key === "aimSubMode") ? args.value : args.aimSubMode;
        if (_aimSubModeVal !== undefined) {
            var selected = _aimSubModeVal;
            for (var _i = 0; _i < NoteBot_Menu.items.length; _i++) {
                var item = NoteBot_Menu.items[_i];
                if (item.key === "aimSubMode" && item.items) {
                    for (var _j = 0; _j < item.items.length; _j++) {
                        var opt = item.items[_j];
                        opt.checked = (opt.key === selected);
                    }
                }
            }
            updateMenuToggle();
            if (CONFIG.aimMaster) {
                if (selected === "enableAim") {
                    CONFIG.enableAim = true;
                    silentLookEnabled = false;
                    if (cameraDeparted) {
                        safeResetCamera();
                        cameraDeparted = false;
                    }
                    lastTargetPitch = null;
                    lastTargetYaw = null;
                    clientMessage("转头模式: 普通转头");
                } else if (selected === "silentLookEnabled") {
                    CONFIG.enableAim = false;
                    silentLookEnabled = true;
                    if (!cameraDeparted) {
                        safeDepartCamera();
                        cameraDeparted = true;
                    }
                    clientMessage("转头模式: 静默转头");
                }
            }
            _processingModuleEvent = false;
            return;
        }

  
        var _aimMasterVal = (args.key === "aimMaster") ? args.value : args.aimMaster;
        if (_aimMasterVal !== undefined) {
            CONFIG.aimMaster = !!_aimMasterVal;
            if (!CONFIG.aimMaster) {
                CONFIG.enableAim = false;
                silentLookEnabled = false;
                if (cameraDeparted) {
                    safeResetCamera();
                    cameraDeparted = false;
                }
                lastTargetPitch = null;
                lastTargetYaw = null;
                clientMessage("转头: 已关闭");
            } else {
                CONFIG.enableAim = false;
                silentLookEnabled = true;
                if (!cameraDeparted) {
                    safeDepartCamera();
                    cameraDeparted = true;
                }
                clientMessage("§6转头: 已开启");
            }
            updateMenuToggle();
            _processingModuleEvent = false;
            return;
        }

  
        if (args.enableShadow !== undefined) {
            CONFIG.enableShadow = args.enableShadow;
            for (var _i = 0; _i < NoteBot_Menu.items.length; _i++) {
                var item = NoteBot_Menu.items[_i];
                if (item.key === "enableShadow") {
                    item.checked = CONFIG.enableShadow;
                    break;
                }
            }
            updateMenuToggle();
            clientMessage("虚影特效: " + (CONFIG.enableShadow ? "开启" : "关闭"));
            _processingModuleEvent = false;
            return;
        }


        if (args.blueBorderEnabled !== undefined) {
            CONFIG.blueBorderEnabled = args.blueBorderEnabled;
            for (var _i = 0; _i < NoteBot_Menu.items.length; _i++) {
                var item = NoteBot_Menu.items[_i];
                if (item.key === "blueBorderEnabled") {
                    item.checked = CONFIG.blueBorderEnabled;
                    break;
                }
            }
            if (CONFIG.blueBorderEnabled) {
                addBlueBordersToAllNotes();
            } else {
                removeBlueBorders();
            }
            updateMenuToggle();
            clientMessage("蓝色填充: " + (CONFIG.blueBorderEnabled ? "开启" : "关闭"));
            _processingModuleEvent = false;
            return;
        }

      
        if (args.renderMaster !== undefined) {
            CONFIG.renderMaster = args.renderMaster;
            if (!CONFIG.renderMaster) {
                CONFIG.renderMode = 0;
                for (var _i = 0; _i < NoteBot_Menu.items.length; _i++) {
                    var item = NoteBot_Menu.items[_i];
                    if (item.key === "renderModeSelect" && item.items) {
                        for (var _j = 0; _j < item.items.length; _j++) {
                            var opt = item.items[_j];
                            opt.checked = false;
                        }
                    }
                }
                clearRenderShapes();
                updateMenuToggle();
                clientMessage("渲染: 已关闭");
                _processingModuleEvent = false;
                return;
            } else {
                var selected = null;
                for (var _i = 0; _i < NoteBot_Menu.items.length; _i++) {
                    var item = NoteBot_Menu.items[_i];
                    if (item.key === "renderModeSelect" && item.items) {
                        for (var _j = 0; _j < item.items.length; _j++) {
                            var opt = item.items[_j];
                            if (opt.checked) {
                                selected = opt.key;
                                break;
                            }
                        }
                        if (selected) break;
                    }
                }
                if (selected) {
                    if (selected === "whiteFill") CONFIG.renderMode = 1;
                    else if (selected === "rainbowFill") CONFIG.renderMode = 4;
                    else if (selected === "greenFrame") CONFIG.renderMode = 2;
                    else if (selected === "rainbowFrame") CONFIG.renderMode = 3;
                    var modeNames = {
                        "whiteFill": "白色填充",
                        "rainbowFill": "彩虹填充",
                        "greenFrame": "绿色线框",
                        "rainbowFrame": "彩虹线框"
                    };
                    clientMessage("渲染: 已开启 → " + modeNames[selected]);
                } else {
                    for (var _i = 0; _i < NoteBot_Menu.items.length; _i++) {
                        var item = NoteBot_Menu.items[_i];
                        if (item.key === "renderModeSelect" && item.items) {
                            for (var _j = 0; _j < item.items.length; _j++) {
                                var opt = item.items[_j];
                                if (opt.key === "whiteFill") {
                                    opt.checked = true;
                                    CONFIG.renderMode = 1;
                                    break;
                                }
                            }
                            break;
                        }
                    }
                }
                clearRenderShapes();
                updateMenuToggle();
                _processingModuleEvent = false;
                return;
            }
        }

  
        if (args.renderModeSelect !== undefined) {
            var selected = args.renderModeSelect;
            for (var _i = 0; _i < NoteBot_Menu.items.length; _i++) {
                var item = NoteBot_Menu.items[_i];
                if (item.key === "renderModeSelect" && item.items) {
                    for (var _j = 0; _j < item.items.length; _j++) {
                        var opt = item.items[_j];
                        opt.checked = (opt.key === selected);
                    }
                }
            }
            updateMenuToggle();
            if (CONFIG.renderMaster) {
                if (selected === "whiteFill") CONFIG.renderMode = 1;
                else if (selected === "rainbowFill") CONFIG.renderMode = 4;
                else if (selected === "greenFrame") CONFIG.renderMode = 2;
                else if (selected === "rainbowFrame") CONFIG.renderMode = 3;
                clearRenderShapes();
                var modeNames = {
                    "whiteFill": "白色填充",
                    "rainbowFill": "彩虹填充",
                    "greenFrame": "绿色线框",
                    "rainbowFrame": "彩虹线框"
                };
                clientMessage("渲染模式: " + modeNames[selected]);
            }
            _processingModuleEvent = false;
            return;
        }

        
        if (args.key === "clickDelay") {
            CONFIG.clickDelay = args.value;
            clientMessage("调音间隔: " + args.value + "ms");
            _processingModuleEvent = false;
            return;
        }

   
        if (args.key === "buildDelay") {
            CONFIG.buildDelay = args.value;
            clientMessage("建造延迟: " + args.value + "ms");
            _processingModuleEvent = false;
            return;
        }

       
        if (args.key === "playSpeed") {
            var speed = Math.min(2.0, Math.max(0.5, args.value / 100));
            CONFIG.playSpeed = speed;
            clientMessage("播放速度已设为 " + speed.toFixed(2) + "x");
            _processingModuleEvent = false;
            return;
        }

        
        if (args.send_message) {
            switch(args.send_message) {
                case "buildguide": showBuildGuide(); break;
                case "build": startManualBuild(); break;
                case "stopbuild": stopBuild(); break;
                case "rebuild": startRebuild(); break;
                case "stoprebuild": stopRebuild(); break;
                case "scan": scanNoteBlocks(); break;
                case "readpitch": startReadPitch(); break;
                case "savepitch": savePitchData(); break;
                case "loadpitch": loadPitchData(); break;
                case "delpitch": deletePitchData(); break;
                case "kq": startTuning(); break;
                case "stoptune": stopTuning(); break;
                case "ys": startPlay(); break;
                case "tz": stopPlay(); break;
                case "info": showInfo(); break;
                case "tc": exitScript(); break;
                case "loadmusic": showMusicList(); break;
                case "searchmusic": showSearchDialog(); break;
                case "clearrender": clearRenderShapes(); minecraft.clientMessage("[渲染] 已清除"); break;
                case "resetprogress": resetProgress(); break;
                case "cmdplay": startCmdPlay(); break;
                case "cmdstop": stopCmdPlay(); break;
                case "testpitch": testNoteBlockPitch(); break;
                case "initlog": initLog(); break;
                case "applyBlueColor":
                    applyBlueColor();
                    break;
                case "applyWhiteColor":
                    applyWhiteColor();
                    break;
                case "dump": dumpLog(); break;
                case "setorigin": setBuildOrigin(); break;
                case "clearlog": clearLog(); break;
                case "setradius":
                    var radii = [5, 7, 10, 15, 20, 25, 30, 40, 50];
                    var current = radii.indexOf(scanRange);
                    var next = (current + 1) % radii.length;
                    setScanRadius(radii[next]);
                    for (var _i = 0; _i < NoteBot_Menu.items.length; _i++) {
                        var item = NoteBot_Menu.items[_i];
                        if (item.send_message === "setradius") {
                            item.name = "扫描半径: " + scanRange;
                            break;
                        }
                    }
                    updateMenuToggle();
                    break;
                default:
                    break;
            }
        }
    } finally {
        _processingModuleEvent = false;
    }
}


function applyBlueColor() {
    
    var r = CONFIG.blueFillR;
    var g = CONFIG.blueFillG;
    var b = CONFIG.blueFillB;
    
    
    
    if (blueBorderEnabled) {
        removeBlueBorders();
        addBlueBordersToAllNotes();

    } else {
        
    }
}

function applyWhiteColor() {
    var r = CONFIG.whiteFillR;
    var g = CONFIG.whiteFillG;
    var b = CONFIG.whiteFillB;
    
    clientMessage("§d[颜色] §6应用白色填充 RGB(" + r + "%, " + g + "%, " + b + "%)");
    
 
    if (CONFIG.renderMode === 1) {
        updateExistingWhiteShapes();
    } else {
        
        CONFIG.renderMode = 1;
        addWhiteRenderToAllNotes();
        clientMessage("§d[颜色] §6白色渲染已自动开启并应用颜色");
    }
}
function setPlaySpeed(speed) {
    speed = Math.min(2.0, Math.max(0.5, speed));
    CONFIG.playSpeed = speed;
    for (var item of NoteBot_Menu.items) {
        if (item.key === "speedDisplay") {
            item.name = "🎵 速度: " + speed.toFixed(2) + "x";
        }
        if (item.key === "playSpeedSlider") {
            item.value = speed;
        }
    }
}


const BUILD_DELAY = 5;  

function aimLoop() {
    if (!aimLoopRunning) return;
    if (CONFIG.aimMaster && silentLookEnabled && aimTargetPos) {
        aimAtBlock(aimTargetPos.x, aimTargetPos.y, aimTargetPos.z);
    }
    aimLoopTimerId = setTimeout(aimLoop, 1);
}


function startAimLoop() {
    if (aimLoopRunning) return;
    aimLoopRunning = true;
    aimLoop();
}


function stopAimLoop() {
    aimLoopRunning = false;
    if (aimLoopTimerId) {
        clearTimeout(aimLoopTimerId);
        aimLoopTimerId = null;
    }
    hasInitialAngle = false;
}
function onTickEvent() {
    if (!_ready) return;
    if (!meid || meid === "" || meid === "localPlayer") return;
    if (isProcessingTick) return;
    
    var now = Date.now();

    if (!CONFIG.aimMaster && cameraDeparted) {
        resetCamera();
        cameraDeparted = false;
        lastTargetPitch = null;
        lastTargetYaw = null;
    }
    
    if (PlayController.isPlaying && PlayController.schedule && PlayController.schedule.length > 0) {
        processPlayTick();
    }
    
    if (!isPlaying && !isTuning && !isBuilding && !isRebuilding && !isCmdPlaying && !isReadingPitch) {
        return;
    }
    
    isProcessingTick = true;
    try {
        var startTime = now;
        var maxExecutionTime = 30;
        
        if (CONFIG.renderMode === 1 && renderShapes && renderShapes.length > 0) {
            updateRenderShapes();
            if (Date.now() - startTime > maxExecutionTime) { isProcessingTick = false; return; }
        }
        
        if (isBuilding && buildingTask) {
            if (!buildingTask._tickCounter) buildingTask._tickCounter = 0;
            buildingTask._tickCounter++;
            if (buildingTask._tickCounter < 5) {
                isProcessingTick = false;
                return;
            }
            buildingTask._tickCounter = 0;
            processBuildTick();
            
            if (Date.now() - startTime > maxExecutionTime) {
                isProcessingTick = false;
                return;
            }
        }
        
        if (isRebuilding && rebuildingTask) {
            if (now - lastRebuildTick >= CONFIG.buildDelay) {
                processRebuildTick();
                lastRebuildTick = now;
            }
            if (Date.now() - startTime > maxExecutionTime) { isProcessingTick = false; return; }
        }
        
        if (isCmdPlaying && MUSIC_DATA && MUSIC_DATA.length > 0) {
            processCmdPlayTick();
            if (Date.now() - startTime > maxExecutionTime) { isProcessingTick = false; return; }
        }
        
        if (isReadingPitch && readQueue && readQueue.length > 0) {
            processReadTick();
            if (Date.now() - startTime > maxExecutionTime) { isProcessingTick = false; return; }
        }
        
        if (isTuning && tuningTask && tuningTask.tasks && tuningTask.tasks.length > 0) {
            processTuningTick();
            if (Date.now() - startTime > maxExecutionTime) { isProcessingTick = false; return; }
        }
        
    } catch(e) {
    } finally {
        isProcessingTick = false;
    }
}

getMusicFolderPath();
ensureFolder();

isPlaying = false;
_playSchedule = null;
_playIndex = 0;
_speedAdjustedTime = 0;
_lastSpeedCheck = Date.now();
MUSIC_DATA = [];
isTuning = false;
tuningTask = null;
isBuilding = false;
buildingTask = null;
isRebuilding = false;
rebuildingTask = null;
isReadingPitch = false;
isCmdPlaying = false;
cmdPlayIndex = 0;
_cmdAccumulatedTime = 0;
_cmdLastCheckTime = Date.now();
renderShapes = [];
currentPlayPositions = {};
notePositions = {};
scannedPositions = {};
pitchData = {};
_blueBorderBackup = {};
readQueue = [];
readClickIndex = 0;
readResponseCount = 0;
readTotal = 0;
globalThis.onReceiveServerPacketEvent = onReceiveServerPacketEvent;

try {
    var lp = player.getLocalPlayer();
    if (lp) {
        meid = String(lp.getUniqueID());
        clientMessage("§a玩家ID已获取: " + meid);
    } else {
        meid = "localPlayer";
        clientMessage("§c使用localPlayer");
    }
} catch(e) {
    meid = "localPlayer";
    clientMessage("§c获取ID失败: " + e.message);
}

for (var item of NoteBot_Menu.items) {
    if (item.send_message === "toggleAim") {
        item.name = "转头瞄准(" + (CONFIG.enableAim ? "✓开启" : "✗关闭") + ")";
    }
    if (item.send_message === "toggleShadow") {
        item.name = "虚影特效(" + (CONFIG.enableShadow ? "✓开启" : "✗关闭") + ")";
    }
    if (item.send_message === "toggleSwing") {
        item.name = "全局挥手(" + (CONFIG.enableSwing ? "✓开启" : "✗关闭") + ")";
    }
    if (item.send_message === "toggleSwingPlay") {
        item.name = "演奏挥手(" + (CONFIG.swingDuringPlay ? "✓开启" : "✗关闭") + ")";
    }
}

menu.remove("NoteBot");
menu.load("NoteBot", JSON.stringify(NoteBot_Menu));
setTimeout(function() {
    menu.show("NoteBot");
}, 100);

syncAimState();
_ready = true;
minecraft.clientMessage("§dNoteBot v9.178 §6已启动");