/*
    Adaptation: TimeUnbound
*/

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

const main_menu = () => {
    if (PY_list.length === 0) {
        minecraft.clientMessage('§e读取脚本列表失败(可能是没有储存权限)');
        return;
    }
    var menu = {
        type: 'form',
        title: '§3共' + PY_list.length + '个脚本',
        content: '列表',
        buttons: [{
            text: '§9设置'
        }, {
            text: '§9上次加载: §e' + last_script
        }]
    };
    for (let i = 0; i < PY_list.length; i++) {
        const py = PY_list[i]
        const size = py.length / 1024
        menu.buttons[i + 2] = {
            text: '§e' + py.name + '§r - §a' + size.toFixed(2) + 'kb',
            image: {
                type: "path",
                data: "textures/ui/storageIconColor.png"
            }
        }
    }
    gui.addForm(JSON.stringify(menu), function(index) {
        if (index == 0) settings();
        if (index == 1) load(last_script);
        if (index >= 2) {
            const py_name = PY_list[index - 2].name
            load(py_name)
            sp.putString("py", py_name)
        }
    })
}

const settings = () => {
    const json = {
        "type": "custom_form",
        "title": "§a设置",
        "content": [{
            "type": "slider",
            "text": "加载延迟/S",
            "min": 1,
            "max": 10,
            "step": 1,
            "default": config.delay
        }, {
            "type": "slider",
            "text": "加载次数",
            "min": 1,
            "max": 10,
            "step": 1,
            "default": config.times
        }, {
            "type": "toggle",
            "text": "本地加载模式",
            "default": config.mode == "eval"
        }]
    };
    gui.addForm(JSON.stringify(json), function(delay, times, mode) {
        if (Array.isArray(delay)) { mode = delay[2]; times = delay[1]; delay = delay[0] }
        config.delay = delay
        config.times = times
        config.mode = (mode) ? 'eval' : 'load'
        main_menu()
    })
}

const load = (script_name) => {
    minecraft.clientMessage('§e加载脚本==> §b' + script_name)
    var py_path = path + "/py/" + script_name;
    if (!fs.exists(py_path)) return minecraft.clientMessage('§e脚本不存在==> §b' + script_name)
    var py_text = fs.read(py_path);
    var state = false
    setTimeout(() => {
        try {
            for (let i = 0; i < config.times; i++) {
                if (config.mode === "eval") { app.evalPython(py_text); state = true }
                if (config.mode === "load") { app.execPython(py_path); state = true }
            }
        } catch (e) {
            state = false
            minecraft.clientMessage("§c" + JSON.stringify(e.stack || e));
        }
        minecraft.clientMessage('§ePY加载' + (state ? '成功' : '失败'))
    }, config.delay * 1000);
};

const path = app.getResource()
const PY_list = get_file_list(path + "/py", "py")
const last_script = getData("py", "没有数据")

var config = {
    mode: "load",
    times: 1,
    delay: 0
}

main_menu()
