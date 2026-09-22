/*
    Adaptation: TimeUnbound
*/

var config = {
    mode: "load",
    allowExit: false,
    times: 1,
    delay: 0,
    debug: true,
    scriptPath: "script"
}

const minecraft = require("minecraft")
const gui = require("gui")
const fs = require("fs")
const app = require("app")
const sp = require("sp")

const getData = (key, def) => sp.contains(key) ? sp.getString(key) : def

const getSuffix = (filename) => {
    var parts = filename.split(".");
    return parts[parts.length - 1];
}

const get_file_list = (path, Suffix) => {
    const list = fs.exists(path) ? fs.list(path) : []
    const output = []
    for (const i in list) {
        if (getSuffix(list[i].name) === Suffix) output.push({ name: list[i].name, length: Number(list[i].size) })
    }
    output.sort((a, b) => a.name.localeCompare(b.name));
    return output
}

const main_menu = (filter = '') => {
    let filteredList = JS_list;
    if (filter) {
        filteredList = JS_list.filter(js =>
            js.name.toLowerCase().includes(filter.toLowerCase())
        );
    }

    if (filteredList.length === 0) {
        minecraft.clientMessage('§b§e没有找到匹配的脚本');
        return;
    }

    var menu = {
        type: 'form',
        title: `§3共${filteredList.length}个脚本${filter ? '(已过滤)' : ''}`,
        content: '列表',
        buttons: [{
            text: '§6搜索脚本',
            image: {
                type: "path",
                data: "textures/ui/magnifyingGlass"
            }
        }, {
            text: '§9脚本加载调整'
        }, {
            text: '§9上次加载: §e' + last_script
        }]
    };

    for (let i = 0; i < filteredList.length; i++) {
        const js = filteredList[i]
        const size = js.length / 1024
        menu.buttons[i + 3] = {
            text: '§e' + js.name + '§r - §a' + size.toFixed(2) + 'kb',
            image: {
                type: "path",
                data: "textures/ui/storageIconColor.png"
            }
        }
    }

    gui.addForm(JSON.stringify(menu), function(index) {
        if (index == 0) show_search();
        if (index == 1) settings();
        if (index == 2) load(last_script);
        if (index >= 3) {
            const js_name = filteredList[index - 3].name
            load(js_name)
            minecraft.clientMessage('§b§e加载脚本 => §b' + js_name)
        }
    })
}

const show_search = () => {
    const searchForm = {
        "type": "custom_form",
        "title": "§6搜索脚本",
        "content": [{
            "type": "input",
            "text": "输入脚本名称关键字",
            "placeholder": "输入部分名称即可",
            "default": ""
        }]
    };

    gui.addForm(JSON.stringify(searchForm), function(data) {
        const keyword = String(Array.isArray(data) ? data[0] : data).trim();
        if (keyword) {
            main_menu(keyword);
        } else {
            main_menu();
        }
    });
}

const settings = () => {
    const json = ` {
        "type": "custom_form",
        "title": "§a脚本加载调整",
        "content": [{
            "type": "slider",
            "text": "加载脚本次数",
            "min": 1,
            "max": 10,
            "step": 1,
            "default": ` + config.times + `
        }]
    }`;
    gui.addForm(json, function(times) {
        config.times = Array.isArray(times) ? times[0] : times;
        main_menu();
    });
}

const load = (script_name) => {
    const js_path = path + "/" + config.scriptPath + "/" + script_name;
    if (!fs.exists(js_path)) return minecraft.clientMessage('§b§e脚本不存在 => §b' + script_name)
    var js_text = fs.read(js_path);
    sp.putString("script", script_name)
    setTimeout(() => {
        var state = true
        for (let i = 0; i < config.times; i++) {
            try {
                if (config.mode === "eval") {
                    var js = js_text + ((config.allowExit && js_text.indexOf("exit()") === -1) ? "\nfunction onSendChatMessageEvent(text) {if(text === \"退出\") {require(\"minecraft\").minecraft.clientMessage('§b§e已退出'); exit(); return true;}}" : "");
                    eval(js);
                }
                if (config.mode === "load") {
                    if (config.allowExit && js_text.indexOf("exit()") === -1) {
                        fs.write(js_path, js_text + "\nfunction onSendChatMessageEvent(text) {if(text === \"退出\") {require(\"minecraft\").minecraft.clientMessage('§b[脚本菜单]§e已退出'); exit(); return true;}}");
                        js_text = fs.read(js_path);
                    }
                    if (config.debug && js_text.indexOf("try") === -1) {
                        fs.write(js_path, "try {\n" + js_text + "\n}catch(e){require(\"minecraft\").minecraft.clientMessage('§b§e发现错误 => '+e.stack)};");
                        js_text = fs.read(js_path);
                    }
                    runScript(script_name);
                }
            } catch (e) {
                state = false
                if (config.debug) minecraft.clientMessage('§b§e发现错误 => ' + (e && e.stack ? e.stack : e))
            }
        }
        minecraft.clientMessage('§b§eJS加载' + (state ? '成功' : '失败'))
    }, config.delay * 1000);
};

const path = app.getResource()
const JS_list = get_file_list(path + "/" + config.scriptPath + "/", "js")
const last_script = getData("script", "没有数据")

main_menu()