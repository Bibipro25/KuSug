// JS 脚本加载器（v2）：列出资源目录 script 下的 .js 脚本，点击即加载
const menu = require("menu");
const minecraft = require("minecraft");
const app = require("app");
const fs = require("fs");

const MENU_ID = "js-ui";

const getSuffix = (filename) => {
    var parts = filename.split(".");
    return parts[parts.length - 1];
};

const get_file_list = (path, Suffix) => {
    const list = fs.list(path) || [];
    const output = [];
    for (const i in list) {
        if (getSuffix(list[i].name) === Suffix) {
            output.push(list[i]);
        }
    }
    output.sort((a, b) => a.name.localeCompare(b.name));
    return output;
};

const getSize = (path) => {
    const data = fs.read(path, "utf8");
    return data.length / 1024;
};

const main_menu = () => {
    if (JS_list.length === 0) {
        minecraft.clientMessage('§b[JS加载器]§e读取脚本文件夹失败(可能为空)');
        return;
    }
    var menuCfg = {
        type: "Menu",
        title: {
            name: "脚本列表",
            size: 16,
            padding: [4,2,4,2],
            text_margins: [3,2,3,2],
            background: "$menu_title_background_color",
            "colors": [
                "$menu_title_gradient_text_begin_color",
                "$menu_title_gradient_text_end_color"
            ],
        },
        color: "$menu_color",
        alpha: 0.85,
        radius: 8,
        elevation: 3,
        can_close: true,
        show_dividers: true,
        hide: true,
        items: []
    };
    for (let i = 0; i < JS_list.length; i++) {
        const js = JS_list[i];
        const size = getSize(js.path);
        menuCfg.items[i] = {
            type: "TextView",
            name: js.name,
            color: "$menu_item_color",
            tip: "加载 " + js.name,
            load_script: js.name
        };
    }
    menu.remove(MENU_ID);
    menu.load(MENU_ID, JSON.stringify(menuCfg));
    menu.show(MENU_ID);
};

const path = app.getResource();
const JS_list = get_file_list(path + "/script", "js");

main_menu();
