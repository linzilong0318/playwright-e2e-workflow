---
name: playwright-e2e-workflow
description: "端到端 Playwright 测试全流程编排:工作区固定 /opt/data/e2e/<sessionId> 真实目录、preflight 体检、后端拉基准配置物化、login.mjs 登录、probe-*.mjs 探索页面、write_file 写计划与测试、CLI npx playwright test 自验证、产出 json 报告、上传三类产物后清理。两个场景:场景 A「AI生成测试脚本」(裸传 MinIO + function/save 建库,无 functionUid)、场景 B「AI执行并修复已有脚本」(function/resources 下载 + biz 上传整表替换)。用户要求编写/运行/修复 Playwright 测试脚本时加载。"
version: 6.0.0
metadata:
  hermes:
    tags: [playwright, e2e, testing, workflow, cli]
---
# Playwright E2E 全流程编排

## 触发条件

- 用户要求"测试 <web路径> 的 <功能>",或要求编写/修改/运行任何 Playwright 测试脚本
- 用户提到测试计划、测试报告、功能测试
- **场景 A**:用户消息形如「请帮我创建Web功能测试」,含 projectUid/folderUid/displayName/relativePath/description/selectedTestCaseUids/selectedResourceUids
- **场景 B**:用户消息形如「请帮我执行并修改Web测试脚本」,含 functionUid(执行已存在脚本并修复)

## 用户输入解析

- **场景 A 字段**:`projectUid`(项目空间)、`folderUid`(测试目录)、`displayName`(功能名)、`relativePath`(页面相对路径,如 /iotWeb/deviceManage)、`description`(功能描述)、`selectedTestCaseUids`(关联用例)、`selectedResourceUids`(静态资源)。**无 functionUid**——收尾由 function/save 自动建记录并返回新 functionUid。
- **场景 B 字段**:`functionUid`(必填,占位符 xxxx 先询问)。
- **description 双用途**:① 写计划前先消化它理解功能需求(用例场景设计的主输入);② 透传给 function/save 存库。
- **relativePath 必填无兜底**:它驱动阶段 2 探索(probe 导航 baseUrl + relativePath),缺失/占位符 → 停下询问用户。
- **displayName/description 缺失**:先询问用户;确认无法获得时用固定文案——displayName 缺省 `AI自动测试-<relativePath>`、description 缺省 `基于 AI Agent 自动创建的 Playwright 自动化测试脚本`。projectUid/folderUid 缺失必须询问(后端必填,无兜底)。
- **静态资源失效处理(第一层,写脚本前)**:selectedResourceUids 给了 N 个、fetch_config 过滤返回 M 个——M==0 且 N>0 → 停下询问用户(提供新 uid / 确认跳过上传类用例 / 中止);0<M<N → 打印缺失清单继续。**不要静默跳过下载**,上传类用例无文件可测。
- `操作步骤`/`预期结果`即测试场景来源(正常路径 + 边界/校验失败)。`functionUid` 缺失只在场景 B 上传前询问一次。
- **用例与绑定页面不匹配**:先跑 `scripts/probe-sweep.mjs`(全模块文本扫描)拿"该 UI 不存在"的硬证据,再按可发现功能路线写 plan,范围说明里写明偏差;断言用**真实文案**,不贴合用例断言不存在的文案;最后给用户决策点。
- `参考资源`(如 *.fig 原型)仅作了解,不下载;静态资源(filePath 是 MinIO URL)也**不在本地下载**,由测试脚本运行时下载(见下)。

## 目录结构(方案 B:工作区 = sid 真实目录)

**会话工作区 = /opt/data/e2e/<HERMES_SESSION_ID>**。sid 由 hermes 显式注入 terminal 子进程环境;多会话并发各用各的目录。**场景 B 由前端触发新会话 → 全新 sid 目录,天然无覆盖问题**。

```bash
SKILL_DIR=/opt/data/skills/playwright-e2e-workflow
PY=/opt/hermes/.venv/bin/python3      # ← uv 全局解释器,全流程固定用它
E2E_DIR=/opt/data/e2e/$HERMES_SESSION_ID   # ← 本会话工作区(每轮开头由 preflight 确保存在)
```

技能自带脚本(本 SKILL.md 所在目录 `scripts/`,**权威副本**,后端交互/物化逻辑全部走这里,勿改逻辑):

- `backend.py`:公共库(前缀常量/接口常量/Double-envelope 解析/multipart POST/JSON POST)
- `preflight.py`:阶段 0 工作区体检(每轮开头必跑,自动同步运行副本)
- `fetch_config.py`:阶段 1 拉基准配置 + 按 --resource-uids 过滤资源清单 + 打印 filePath(不下载)
- `fetch_resources.py`:场景 B 阶段 1.5 下载 script/plan/旧 report
- `publish_artifacts.py`:场景 A 阶段 6 收尾(3×裸传 + function/save,支持续传重试)
- `upload_artifact.py`:场景 B 阶段 6 上传(biz 端点,自动绑定)
- `prepare.mjs` / `cleanup.mjs`:物化/清理(运行副本由 preflight 同步)
- `login.mjs` / `seed.spec.ts`:登录/脚手架种子(同上)
- `probe-template.mjs` / `probe-sweep.mjs`:页面探索(⚠️ 必须先 cp 到 $E2E_DIR/ 再运行,不可直接以技能目录路径运行——ESM 的 import 从脚本所在目录向上解析 node_modules,技能目录不在解析链上,直接跑报 ERR_MODULE_NOT_FOUND)

```
/opt/data/e2e/
├── node_modules/                  # 共享:软链全局 playwright 包(preflight 自动初始化,勿删)
└── <sessionId>/                   # 会话工作区(唯一工作区,agent 与 CLI 同一位置)
    ├── template/                  # 基准配置来源(后端接口拉取覆盖),只读,永不手工改
    │   ├── playwright.config.ts   # GET config/detail 返回的 playwrightConfig 写入
    │   ├── global-setup.ts        # GET config/detail 返回的 globalSetup 写入
    ├── scripts/                   # prepare.mjs / cleanup.mjs(preflight 每轮同步)
    ├── login.mjs                  # 独立登录(Xvfb :<会话display>),只写本会话 auth.json
    ├── seed.spec.ts               # 脚手架种子(preflight 每轮同步)
    ├── probe-<页面>.mjs           # 探索脚本(从技能模板复制,探索期使用)
    ├── auth.json                  # Playwright storageState(本会话登录态,保留)
    ├── playwright.config.ts       # 物化产物(prepare 生成,可删)
    ├── global-setup.ts            # 物化产物(prepare 生成,可删)
    ├── tests/                     # 场景 A:生成物 *.spec.ts;场景 B:下载的旧脚本(修复对象)(上传后清)
    ├── specs/                     # 场景 A:生成物 *.plan.md;场景 B:下载的旧 plan(仅对齐意图)(上传后清)
    ├── report/                    # 新报告 test-results.json;场景 B 另有 prev-test-results.json(旧报告,丢弃)(上传后清)
    └── test-results/              # 生成物:playwright 运行产物(上传后清)
```

## 后端接口(闭环数据源,v6)

- 接口前缀**固定** `http://10.120.132.36:8005/ai-test`(backend.py `DEFAULT_PREFIX`;临时换环境用 `--prefix` 覆盖)。
- envelope 兼容两种:`{code, msg}` 与 `{success, message}`;成功判定:`code=="200"` 或 `success==true`(v6 实测接口均返回 success=true + code=00000)。
- **所有接口交互走技能自带 Python 脚本**,不用 curl heredoc:

```bash
# 场景 A/B 通用:拉基准配置(资源清单过滤可选)
$PY $SKILL_DIR/scripts/fetch_config.py --e2e-root $E2E_DIR [--resource-uids uid1,uid2]
# 场景 B:下载该 function 的脚本/计划/旧报告
$PY $SKILL_DIR/scripts/fetch_resources.py --function-uid <真实UID> --e2e-root $E2E_DIR
# 场景 A 收尾:3×裸传 + function/save(一步到位;重试时把 previewUrl 传回 --*-url 续传)
$PY $SKILL_DIR/scripts/publish_artifacts.py --script-file $E2E_DIR/tests/x.spec.ts \
    --plan-file $E2E_DIR/specs/x.plan.md --report-file $E2E_DIR/report/test-results.json \
    --project-uid <uid> --folder-uid <uid> --display-name <名> --relative-path <路径> \
    [--description <描述>] [--test-case-uids a,b] [--resource-uids a,b]
# 场景 B 收尾:上传修复后的脚本+报告(biz 端点,自动绑定,按类型整表替换)
$PY $SKILL_DIR/scripts/upload_artifact.py --type TEST_SCRIPT --file $E2E_DIR/tests/x.spec.ts --function-uid <真实UID>
$PY $SKILL_DIR/scripts/upload_artifact.py --type TEST_REPORT --file $E2E_DIR/report/test-results.json --function-uid <真实UID>
```

> **bash 坑:不要用 `UID` 作 shell 变量名**(`UID` 是 bash 内置只读变量,赋值静默失败并报 readonly variable)。用 `FUID` 等名字,赋值后先 `echo` 确认再上传;上传后核对返回的 relativePath 含真实 functionUid(形如 `/webtest/resources/<真实UID>/...`)。

### 1) fetch_config.py(拉基准配置,v6)

- `GET {prefix}/api/v1/web-test/config/detail?sessionId={sid}[&resourceList=uid...]`;`sessionId` 直接用 `$HERMES_SESSION_ID`,无需用户提供。
- `--resource-uids` 以**重复 resourceList 查询参数**按 resourceUid 过滤(OR 语义,实测确认),对应场景 A 的 selectedResourceUids;**不传 = 返回项目全部资源**(场景 B 即如此,忽略静态资源)。
- 成功:写 `$E2E_DIR/template/playwright.config.ts` + `template/global-setup.ts`;**不下载任何静态资源**,只打印返回资源的 fileName+filePath(agent 写进测试脚本,运行时下载到脚本同目录)。响应无 baseUrl/configUid/projectUid 字段,脚本改为从 playwrightConfig 文本提取 baseURL。
- 退出码 2:`A05010 未找到该会话绑定的项目数据` = 会话未绑定项目,如实报告停下询问;或 `--resource-uids 全部未命中` = 资源全失效/占位符,停下询问用户(不能伪造资源)。

### 2) fetch_resources.py(场景 B 下载,v6 新增)

- `GET {prefix}/api/v1/web-test/function/resources?functionUid={uid}` → `data:{functionUid, scriptList, testPlanList, testReportList}`,每项 `{webResourceUid, functionUid, resourceType(2/3/4), resourceUid, fileName, filePath}`。
- 下载:script → `tests/<原名>`(修复对象)、plan → `specs/<原名>`(仅对齐用例意图,不上传不保留)、report → `report/prev-test-results.json`(仅修复参考,直接丢弃)。
- 退出码 2:functionUid 无效 / **该 function 无测试脚本(无法修复)** / 网络错误。

### 3) publish_artifacts.py(场景 A 收尾,v6 新增)

- 每个产物二选一:`--*-file <路径>`(裸传)或 `--*-url <previewUrl>`(续传,跳过裸传)。
- 裸传:`POST {prefix}/file/upload`,multipart **只带 file 字段**(带任何业务参数都 00001,实测);响应 `data.previewUrl` 即 MinIO 地址,拿到立即打印。
- 建库:`POST {prefix}/api/v1/web-test/function/save`,body = message 元数据透传 + `resourceList:[{resourceType:2/3/4, fileName, filePath:previewUrl}]`;响应 `data` = 新建 functionUid。
- **失败语义(实测)**:save 失败(含 00004 参数校验)后端**不创建记录**,只有成功才创建 → 重试安全;重试把已打印的 previewUrl 传回 `--*-url` 只重跑 save,不重新裸传。
- `--function-uid` 预留:当前后端忽略 body 里的 functionUid(每次 save 都新建),将来支持更新语义时自动生效。
- `--dry-run`:只打印将执行的请求与 save body,不调后端。

### 4) upload_artifact.py(场景 B 收尾,沿用 biz 端点)

- `POST {prefix}/api/v1/file/upload`,query: `type`/`sessionId`/`functionUid` + multipart `file`;type 枚举 `TEST_SCRIPT`/`TEST_PLAN`/`TEST_REPORT`。
- **按类型整表替换(实测)**:上传 TEST_SCRIPT 即清空并替换整个 scriptList,与文件名无关;TEST_PLAN/TEST_REPORT 同理各自隔离 → 修复后同名上传新脚本即覆盖旧脚本,不会出现新旧两条。
- 自动绑定 functionUid(relativePath 含 /webtest/resources/<uid></uid>/),**无需 function/save**。
- 成功判定:success==true 或 code=="200",且 `data.url` 非空;`functionUid` 从 message 取,占位符直接拒绝退出。
- 退出码 2:业务层 `{"success":false,"code":"00001",...}`(HTTP 200)按 pitfalls 排查法处理,如实报告,不伪造 url。

### 5) function/save 接口要点(供 publish_artifacts.py 使用方理解)

- 必填:folderUid、displayName(实测校验顺序 folderUid→displayName);projectUid 文档必填;relativePath/description/selectedTestCaseUids/selectedResourceUids/resourceList 均可选。
- **纯创建**:body 里的 functionUid 被忽略,每次调用都新建记录,返回新 functionUid。
- 无删除端点(delete/remove 均路由不存在),误建的 function 记录只能前端手动清理。

## 核心原则

1. **基准配置唯一来源是后端接口**:每轮任务开头 GET config/detail 覆盖会话目录 template/,prepare 幂等物化。template/ 手工改动会被下次拉取覆盖;接口不可达时如实报告阻塞,不要伪造配置。
2. **/opt/data/auth.json 是 Hermes 凭据库,永不触碰**。Playwright 的 storageState 一律用 `$E2E_DIR/auth.json`。
3. **容器无 DISPLAY**:所有自动跑测必须 headless + `--no-sandbox`;登录必须显式 `DISPLAY=:<会话display> node login.mjs`。会话 display 由 preflight 按 **sid** 确定性分配(`99 + sha1(sid) % 16`)并自动启动 Xvfb,多会话并发互不干扰。
4. **CLI 验证时不要传 `--reporter=list`**,会覆盖配置里的 json reporter,导致 report/ 不生成。
5. **输出务必精简**:probe dump 的 JSON 可能较大,优先 `--out` 落盘后按需读取关键字段;每轮 response 优先执行工具调用,文字分析精简到最少。
6. **Python 解释器固定 `/opt/hermes/.venv/bin/python3`**(uv 全局环境,`uv python find` 确认):所有 python 调用(脚本/内联)一律用绝对路径,不依赖 PATH 里的裸 `python3`;该路径若失效,用 `uv python find` 重新确认后再改。
7. **后端交互不手写 curl/heredoc**:一律调用技能 `scripts/` 下的固化脚本(fetch_config.py / fetch_resources.py / publish_artifacts.py / upload_artifact.py),参数、envelope 解析、退出码语义已固化。
8. **每轮流程开头必跑 preflight.py 体检工作区**(自动:同步运行副本脚本、按 sid 启动会话 Xvfb、初始化共享 node_modules):阻塞项(FAIL)先修复再继续;提示项(WARN/info)按需处理。
9. **运行副本脚本只读、不手工改**:每轮 preflight 强制从技能目录覆盖同步,手工改动会被覆盖;要改脚本逻辑直接改技能目录权威副本。

## 工作流(每轮任务)

### 阶段 0:环境就绪 + 工作区体检(每轮开头,两场景共用)

```bash
SKILL_DIR=/opt/data/skills/software-development/playwright-e2e-workflow
PY=/opt/hermes/.venv/bin/python3
export PLAYWRIGHT_BROWSERS_PATH=/opt/hermes/.playwright

# 工作区体检(必跑):确认 sid 工作区/同步脚本/启动会话 Xvfb/初始化共享 node_modules;FAIL 先修,退出码 0 才继续
$PY $SKILL_DIR/scripts/preflight.py
export E2E_DIR=/opt/data/e2e/$HERMES_SESSION_ID
# 若提示上次生成物未清理(已上传的前提下): cd $E2E_DIR && node scripts/cleanup.mjs
```

### 阶段 1:拉取基准配置 + 物化(两场景共用,参数不同)

1. 拉配置:
   - 场景 A:`$PY $SKILL_DIR/scripts/fetch_config.py --e2e-root $E2E_DIR --resource-uids <selectedResourceUids 逗号分隔>`(消息无静态资源则不传)。M==0 且 N>0 → 停下询问用户。
   - 场景 B:`$PY $SKILL_DIR/scripts/fetch_config.py --e2e-root $E2E_DIR`(不传资源参数,忽略静态资源)。
   - A05010 = 会话未绑定项目,如实报告并停下询问用户。
2. 物化:`cd $E2E_DIR && node scripts/prepare.mjs`
   - 自动补丁:storageState 绝对路径、headless: true、`--no-sandbox`、global-setup 的 AUTH_FILE 注入 + 无 DISPLAY 时给出登录指引、CR-only 行尾归一化、软链全局 playwright 包到 node_modules。template/assets 已不存在(v6 不下载),无资源同步。
   - **浏览器字段归一化**:下发配置可能指定 `browserName: 'msedge'`(或 firefox/webkit 等)和 `channel: 'msedge'`,prepare 自动移除,统一用本机 chromium——不要尝试安装缺失浏览器,也不要手工改回。
   - prepare 的补丁是字符串替换,基于常见模式;若下发配置不含这些模式,补丁会**静默跳过**——物化后人工核对关键项。
3. 登录(仅 auth 过期时):`DISPLAY=:<会话display> node login.mjs`(display 号看 preflight 输出;登录成功写 `$E2E_DIR/auth.json`)
4. 冒烟:`cd $E2E_DIR && npx playwright test seed.spec.ts` 应 1 passed。

### 阶段 1.5(仅场景 B):下载待修复产物

```bash
$PY $SKILL_DIR/scripts/fetch_resources.py --function-uid <真实UID> --e2e-root $E2E_DIR
```

- 下载后:读 `specs/*.plan.md` 对齐用例意图(不上传不保留)、读 `report/prev-test-results.json` 找上次失败点(直接丢弃)。
- 注意:下载的旧脚本可能引用相对路径(如 assets/),以工作区根为 cwd 解析——与原生成布局一致;缺文件时如实报告。

### 阶段 2:探索 + 测试计划(纯 CLI)

1. 复制探索模板(每页面一次,可复用):`cp $SKILL_DIR/scripts/probe-template.mjs $E2E_DIR/probe-<页面>.mjs`,按需在 `interact(page)` 里写交互。
   - **模板是 ESM**:内部用 `import`(`.mjs` 下 `require` 直接 ReferenceError),复制后勿改回 require;baseURL 提取已兼容 `process.env.BASE_URL || 'url'` 形式。
   - **场景 B 的 relativePath 从下载的 plan/旧脚本里找**(原生成时的页面路径),不再从 message 解析。
2. 跑 probe:`cd $E2E_DIR && node probe-<页面>.mjs --path <页面路径>`(自动带 `$E2E_DIR/auth.json` 登录态,headless + `--no-sandbox`;输出大时加 `--out /tmp/probe.json`)。页面路径场景 A 从 message 的 relativePath 取。
   - **同页面此前测过时**:先查 `references/` 下的页面沉淀文件,再 session_search 历史会话取已验证的定位器与选项值,能一次写对测试省大量 probe 往返。
   - probe 拿不到交互结果时,在 interact() 里补步骤重跑;仍拿不准的定位器用 `page.evaluate` 写临时 dump 片段确认 class/祖先路径。
3. 按用例步骤/description 设计场景(正常路径 + 边界 + 校验失败)。**场景 A 若 message 有 selectedResourceUids:测试脚本内嵌静态资源运行时下载逻辑**(下载到脚本同目录,即 spec 的 __dirname;多 spec 共享时抽独立 helper 如 tests/download-assets.ts;下载 helper 校验 HTTP ok 且字节数>0,失败即 throw fail-fast——上传类用例必须有真文件,不能静默跳过)。
4. `write_file` 写计划到 `$E2E_DIR/specs/<name>.plan.md`。**plan 格式约定**:顶层 `# <功能名>`;每个场景一个 `## 场景:<场景名>` section,内容为编号步骤 + 每步预期(成对);最后补"边界/校验失败"场景。场景 A 此文件即 TEST_PLAN 上传物(经裸传+save);场景 B 的 plan 不生成不上传。

### 阶段 3:编写/修改测试(纯 CLI)

- 场景 A:按 plan 手写 `$E2E_DIR/tests/<scenario>.spec.ts`。**代码结构约定**:`describe('<功能名>')` 匹配计划顶层;每个 `test('<场景名>')` 匹配场景标题;步骤注释对应 plan 步骤;定位器严格按已知坑写法(chint 组件系列);正常路径 + 边界 + 校验失败各成 test。
- 场景 B:在下载的 `tests/<原名>.spec.ts` 上**修改修复**(基于原脚本修 bug,不是从零重写);修复范围以旧 plan 用例意图 + 旧 report 失败点为据。
- 定位器拿不准时回阶段 2 补 probe。
- 写完 `cd $E2E_DIR && npx playwright test --list` 确认测试被加载。

### 阶段 4:自验证 + 修复(纯 CLI)

1. `cd $E2E_DIR && npx playwright test` 跑全部(不传 --reporter)。
2. 失败项看终端报错 + `$E2E_DIR/test-results/`(错误快照/trace);修选择器/时序/断言后重跑,直到全绿。
3. 顽固问题 `test.fixme()` + 注释原因(两场景均允许,场景 B 修复也允许)。
4. 场景 B 的"资源下载失败"类报错 = 资源问题而非脚本问题,如实报告 + 给用户决策点,不硬造假文件。

### 阶段 5:CLI 出报告(必须,不传 --reporter)

```bash
cd $E2E_DIR && PLAYWRIGHT_BROWSERS_PATH=/opt/hermes/.playwright npx playwright test
```

- json 报告: `$E2E_DIR/report/test-results.json`(配置里 `reporter: [['list'], ['json', {outputFile: 'report/test-results.json'}]]`)
- 检查 stats: `/opt/hermes/.venv/bin/python3 -c "import json;d=json.load(open('report/test-results.json'));print(d['stats'])"`(在 `$E2E_DIR` 下执行)

### 阶段 6:上传 + 清理

- **场景 A**(生成,无 functionUid):收集 `tests/*.spec.ts`(TEST_SCRIPT)、`specs/*.plan.md`(TEST_PLAN)、`report/test-results.json`(TEST_REPORT),调一次 `publish_artifacts.py`(三个产物文件路径 + message 元数据)。校验退出码 0 且打印新建 functionUid。**失败重试:把已打印的 previewUrl 传回 `--*-url`,只重跑 save**。
  - publish 被后端 00001 阻塞时:不跑 cleanup,保留 tests/specs/report 产物,如实报告后端故障,待恢复后重跑本阶段再清理。
- **场景 B**(修复,有 functionUid):只上传修复后的脚本 + 新报告,biz 端点各调一次 `upload_artifact.py`(type=TEST_SCRIPT / TEST_REPORT,`--function-uid` 从 message 取;按类型整表替换,自动绑定,无需 function/save)。**plan 不上传、旧 report 不上传**。
- 清理:`cd $E2E_DIR && node scripts/cleanup.mjs`(保留 template/scripts/login.mjs/seed.spec.ts/auth.json;场景 B 下载的旧脚本/plan/旧 report 一并清)。
- 彻底重置:`cd $E2E_DIR && node scripts/cleanup.mjs --all`(连 auth.json 一起删;多用户下会话结束建议清理)。

## 已知坑(必读)

全部踩坑记录在 `references/pitfalls.md`(随技能加载可见),写定位器、排查失败前必读:

- 页面探索与登录:中文界面、登录滑块、单点登录互踢、模块级路由 404 菜单壳陷阱
- chint 组件通用交互坑:下拉面板/虚拟滚动表格/分页器/搜索空态/表单校验错误
- 物化与运行环境坑:CR-only 行尾、node_modules 解析、浏览器归一化、--reporter 覆盖
- 后端接口坑(v6):双上传端点并存(裸传只认 file / biz 按类型整表替换)、save 纯创建语义、resourceList 过滤、无删除端点、00001 排查法、A05010 会话未绑定

## 架构历史(方案 B 迁移记录)

- **6.0(2026-08-13):双场景 + 新后端接口**。场景 A(生成)收尾改为 裸传 `/file/upload`(只认 file 字段,返回 previewUrl)→ `function/save`(纯创建,透传 message 元数据 + resourceList 2/3/4),不再需要 functionUid;静态资源不再本地下载,由测试脚本运行时下载到脚本同目录(多环境通用);config/detail 新增重复 resourceList 参数按 resourceUid 过滤。场景 B(修复)新增:`function/resources` 下载 script/plan/旧 report,修复后 biz 端点 `/api/v1/file/upload` 上传(实测按类型整表替换,同名/不同名都替换整个列表),自动绑定 functionUid。全部接口形态 2026-08-13 实测确认。
- **5.0(2026-08-13):移除 playwright-test MCP,纯 CLI**。工作区固定 `/opt/data/e2e/<sid>` 真实目录。删除 watchdog pid 目录、ppid 链自发现、指针文件、run-test-mcp.sh。探索用 probe-*.mjs;写计划/测试用 write_file;验证用 CLI。动机:ppid 链自发现依赖 hermes 进程模型(8/12 与 8/13 实测形态不同,模型会漂移),gateway 多会话并发下存在"选错 watchdog"的必然失效模式;CLI 路径只依赖 sid 注入(契约行为),隔离一眼看穿。
- **4.x(2026-08-12~13):watchdog pid 目录 + ppid 链自发现**。历史机制仅作参考,不再适用。

## 验证

- preflight.py 退出码 0(无 FAIL 阻塞项;脚本已同步、会话 Xvfb 在跑、共享 node_modules 就位)
- prepare 后 `cd $E2E_DIR && npx playwright test --list` 能列出测试
- seed 冒烟 1 passed(`$E2E_DIR` 下 `npx playwright test seed.spec.ts`)
- probe 冒烟:`node probe-<页面>.mjs --path /xxx` 输出结构化 dump
- fetch_config.py 退出码 0 且 `$E2E_DIR/template/` 两文件为最新基准配置;--resource-uids 场景打印资源 fileName+filePath 清单
- 场景 B:fetch_resources.py 退出码 0,`tests/` 有旧脚本、`report/prev-test-results.json` 存在
- `$E2E_DIR/report/test-results.json` 存在且 stats.expected > 0
- 场景 A:publish_artifacts.py 退出码 0 且打印新建 functionUid;场景 B:两个 upload_artifact.py 各返回退出码 0 且 data.url 非空
- cleanup 后 `$E2E_DIR` 只剩:template/ scripts/ login.mjs seed.spec.ts auth.json
