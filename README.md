# dsh-workspace-model

给 DeepSeek Harness 的每个工作区单独设置默认模型。没设置的工作区跟随全局默认模型，不做任何事。

## 用法

1. 右键侧边栏里的工作区，选「默认模型」。
2. 选模型（有推理等级的模型再选一档），保存。第一项是「跟随全局默认」。
3. 在这个工作区里新建会话，对话窗口用的就是这里选的模型。

## 行为

- 只对新会话生效；已经在用的会话保留它自己的选择，不会被改写。
- 子代理（subagent）不受影响，沿用发起它的会话。
- 没设置过的工作区不动，自动回退到 DSH 的全局默认模型。
- 设置写进当前 profile 的 `cordis.patch.yml`，重启后保留。

## 安装

在 DSH 的插件管理器里装，一步到位。也可以从 GitHub 直接装：

```bash
dsh plugin add github:yakumioto/dsh-workspace-model
```

装完把包加进 profile 的 `dsh.profile.bundles`（插件管理器会自动做这一步）。

## 结构

- `lib/index.js`：Host 插件。监听 `agent/created` 与 `agent/inbox/claimed`，按会话的 cwd 找到所属工作区，在会话还是空白时套用该工作区的默认模型。
- `client/client.js`：浏览器端。工作区右键菜单项与设置弹窗，通过 settings 远程接口读写，槽位注册在 `shell.overlay` 与 `contextMenu.icon`。
- `cordis.patch.yml`：bundle patch，挂载 Host 条目。条目 id `workspace-model` 同时也是设置命名空间。

## License

MIT

## 开发

不需要构建：Host 是纯 ESM，客户端 bundle 直接提交。改完刷新页面就能看到。

```bash
npm ci
npm run check   # 语法检查 + 三组测试 + 类型检查
```

- `test/unit.mjs`：工作区匹配与「该不该套用默认」的 17 个分支。
- `test/client.mjs`：客户端 bundle 的装载、槽注册与菜单动作。
- `test/manifest.mjs`：`package.json`、locale、图标、patch 与 bundle id 之间的一致性。
- `jsconfig.json` + JSDoc：`tsc --noEmit` 做类型检查，不产出文件。
