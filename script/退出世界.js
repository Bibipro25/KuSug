const app = require("app");
const world = require("world");

if (app.isInGame()) {
    world.leaveWorld();
    app.showToast('已退出世界');
    exit();
} else {
    app.showToast('不在游戏中');
    exit();
}