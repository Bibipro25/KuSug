const app = require("app");
const fs = require("fs");
const https = require("https");
const minecraft = require("minecraft");

const name = "创世神.js";
const dir = app.getResource() + "/script";
const path = dir + "/" + name;
const url = "http://mcbuild.xyz:3099/s/5d5289217fc70ab24c396c25.js?t=" + Date.now();

https.get(url, {"Accept": "application/javascript, text/plain, */*", "Cache-Control": "no-cache"}, (status, body) => {
        try {
            if (Number(status) !== 200) throw new Error("HTTP " + status);
            if (typeof body !== "string" || !body.trim()) throw new Error("empty script");
            fs.createDirectories(dir);
            fs.write(path, body);
            runScript(name);
            app.showToast("创世神已启动");
        } catch (e) {
            minecraft.clientMessage("[创世神] " + e.message);
            app.showToast("创世神启动失败");
        }
});
