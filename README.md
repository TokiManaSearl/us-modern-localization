# 现代美国都市小说文化转置 · Codex Skill

把用户提供的小说转置到**现代美国都市现实背景**，仍用便于回译的中文交付。先完整通读、重新取书名、交映射计划并锁定，再逐章改写；每五章核对连续性与文化残留。你可以在这个版本上开发出你自己的转换洗稿工具，比如把中国修仙小说转换成赛博朋克世界观。

最终两份 Word：改写正文；映射计划表（含全局映射、逐章变更对照和风险）。中世纪/奇幻不是输出分支。核心剧情无法等效现实化时必须请求授权，不暗改；本技能不是自动洗掉版权或保证平台过审的工具。

## 一条命令安装到 Codex

**本仓库已发布到 https://github.com/TokiManaSearl/us-modern-localization 。** 不需要发布npm包。

使用第三方开源 Skills CLI（当前公开文档要求 Node.js 22.20+、npm/npx；Git克隆路径还需Git）：

```sh
npx skills add TokiManaSearl/us-modern-localization --skill us-modern-localization -a codex -g --copy -y
```

`-g` 安装到用户级、`--copy` 使用普通副本、`-y` 跳过确认。不要与别的同名技能混装：第三方工具可能覆盖同名安装，已有修改先备份；首次可去掉 `-y` 交互确认。安装命令会联网下载第三方CLI及仓库，不执行本仓库内小说内容，不会自动装Word运行依赖。隐私要求较高时用下面离线安装。

若要仅用于当前项目，去掉 `-g`。安装后在Codex下一轮或重新打开会话，点名：

```text
$us-modern-localization
读取我提供的小说，先完整通读并生成映射计划表。目标固定为现代美国都市；暂不改核心剧情，先交计划。
```

也可直接告诉支持 skill-installer 的 Codex：

```text
请安装 https://github.com/TokiManaSearl/us-modern-localization/tree/main/skills/us-modern-localization 中的技能。
```

安装目录由所用工具决定；Codex官方安装器文档默认 `$CODEX_HOME/skills`，未设置时 `~/.codex/skills`；第三方Skills CLI可能使用共享技能目录。不要重复安装两套副本。

## 下载ZIP后的本地安装（无网络、无第三方包）

先解压本仓库，进入含 `install.py` 的目录，使用已有Python 3.10+：

```sh
python install.py --dry-run
python install.py
```

macOS/Linux可用 `python3`，Windows可用已配置的 `py -3`。默认目标为 `$CODEX_HOME/skills/us-modern-localization` 或 `~/.codex/skills/us-modern-localization`。`--dest` 指定的是技能**父目录**，例如：

```sh
python install.py --dest .agents/skills
```

安装器仅复制 `skills/us-modern-localization/`，目标存在时拒绝覆盖（包括坏链接）；拒绝来源符号链接和Windows junction/reparse点；不联网、不改配置、不删除目录、不自动装依赖。为避免意外操作，不提供强制覆盖开关。路径或磁盘错误时可能留下不完整目录，先人工检查再处理，不反复盲装。请在普通、非链接的目录解压，避免其他程序同时修改源或安装目录。

更新时先保存旧版和个人修改，再通过原安装工具更新；本地安装器不会合并或自动移除旧版。卸载只删除实际安装的该技能目录，写作项目和书稿无需删除。

## 安装后运行所需环境

| 用途 | 要求 |
|---|---|
| 阅读规则及创作 | 可用的Codex会话/模型访问，及文件读写能力 |
| 残留词表扫描 | Node.js 20+，仅标准库，无npm依赖 |
| 读写Word | Python 3.10+ 与已经配置好的 python-docx |
| 页码更新与版式复审 | WPS/Word由用户打开检查；可选宿主已有且已授权的渲染能力 |

**安装技能不等于安装以上环境。** 缺依赖时Codex应报告缺口，不静默联网安装，不把MD当Word交付。标准Codex没有原工作台专属工具也可使用本版；详见 [运行约定](skills/us-modern-localization/references/runtime.md)。本仓库不附模型服务或API密钥。

## 功能与限制

- 固定映射人物、别名、地点和制度；所有改动能回到原章定位。
- 原文只读，保留主支线、感情线、动机、伏笔回收与反转。只换词不等于制度适配。
- 法律、医疗、金融去操作化，保留冲突，不承诺具体地区审查结果。
- 新书名简短易懂，两份Word统一题名；每章含可导航标题与书签链接。
- QA结合词表、台账反查及语义审阅。扫描器有限词表会误报漏报、默认每词最多20处，不能证明所有文化依赖已清除；台账冲突另读结果，不只看退出码。普通扫描不直接读DOCX。
- 输出质量需要真实书稿试用及人工复核；公开发布前请核实自身具有原文改编权，不上传未经许可的小说、私人对话和个人资料。

## 仓库布局

```text
README.md
LICENSE
THIRD_PARTY_NOTICES.md
install.py
tests/test_install.py
skills/us-modern-localization/
  SKILL.md
  LICENSE
  THIRD_PARTY_NOTICES.md
  licenses/
  references/runtime.md
  references/cultural-transfer/
  references/story-import/references/outline-reverse-rules.md
  references/story-deslop/references/
```

只发布文化转置核心及直接引用的方法；不携带原工具箱的开书、扫榜、浏览器、Dashboard等不相关模块。原工作台技能不受该副本影响。

## 上传到GitHub（维护者）

1. 新建空仓库，建议名 `us-modern-localization`；是否公开由你决定。不要上传整个工作台项目。
2. 将本目录**里面的内容**放到仓库根，确保路径是 `skills/us-modern-localization/SKILL.md`，不要多套一层 `github/`。
3. 确认本README中的安装链接指向真实仓库 `TokiManaSearl/us-modern-localization`。默认分支不是main时，也修改自然语言安装链接里的分支。
4. 运行测试：`python -B -m unittest discover -s tests -v`。在新的临时技能父目录用 `--dest` 安装一次。
5. 用一个干净Codex会话验证发现技能、读取引用、生成两份Word；再检查WPS导航。不要把本地测试当作已完成远程安装验证。
6. 保留所有许可证与第三方声明，核对版权归属后再发布。许可选项本次由AI自动代答选MIT，不是对版权归属的证明。

维护者也可用GitHub网页的 Upload files 上传目录内容，或在本目录自行git init、提交并推送；本仓库已创建并推送至 https://github.com/TokiManaSearl/us-modern-localization （默认分支 `main`）。

## 来源与许可

本项目原创增量适用 [MIT](LICENSE)，仅覆盖有权授权的技能规则与代码；小说及实际改写产物不自动纳入该许可。上游 oh-story 和 Scriveno 内容保留各自MIT声明，见 [第三方声明](THIRD_PARTY_NOTICES.md)。技能安装副本内也带许可证，避免只安装子目录时丢失版权文件。

安装约定核对来源（制作时读取，外部工具将来可能变化）：
- https://github.com/openai/skills/tree/main/skills/.system/skill-installer
- https://github.com/vercel-labs/skills/blob/main/docs/commands.md
