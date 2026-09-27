# i18n：多语言基础设施

[中文](README.md) | [English](README.en.md)

## 职责

i18next 实例、语言持久化，以及把各 feature 的文案 bundle 合成资源表。这里只放**与业务无关**的多语言机制；任何一条具体文案都属于声明它的 feature。

## 内容

| 文件 | 说明 |
| --- | --- |
| `locale.ts` | 语言词汇表：`Locale`（`zh-CN` \| `en-US`）、`LOCALES`、`DEFAULT_LOCALE`（`zh-CN`）、`isLocale` 收窄、`storedLocale` / `rememberLocale`（键 `ora.locale`，与 desktop 一致，两个产品共用一个语言选择）、`applyDocumentLanguage`（把语言写到 `<html lang>`，让浏览器选对字体栈与断行规则）。localStorage 不可用时全部降级为默认语言，不阻塞启动。 |
| `resource-bundle.ts` | `TranslationBundle`（一个 feature 的两种语言文案）与 `composeTranslationResources`：合成即校验——两种语言的逻辑键必须一致（复数键按 `Intl.PluralRules` 展开后再比，所以英文缺 `_one` 会在启动时报错而不是渲染出原始 key），同一个键不能被两个 feature 同时声明。返回类型是各 bundle 键的并集，因此请求一个没人声明的键是类型错误。纯数据，不 import i18next，不 import React。 |
| `resources.ts` | 组合根：唯一知道"哪个 feature 拥有哪些文案"的地方，新增 feature 只需在这里加一行。只导出 `featureTranslationResources`（供错误信息定位归属）与 `translationResources`（交给 i18next 的两张表）。 |
| `i18n-instance.ts` | 应用唯一的 i18next 实例。import 即初始化并绑定 react-i18next，因此任意组件直接用 `useTranslation()` 即可，无需 Provider；入口 `main.tsx` import 一次。导出 `TranslationKey`（键的联合类型）、`activeLocale()`、`setLocale()`。 |
| `i18n.test.ts` | 验证合成器的三条拒绝规则（语言缺键、重复键、复数形缺失）、随产品发布的 bundle 两种语言键集一致且每种节点都有标签与描述、语言存储的收窄与往返、以及实例的语言切换会同时更新 `activeLocale()` 与 `<html lang>`。 |

## 依赖方向

只依赖第三方库、`@/i18n/*` 兄弟模块，以及**各 feature 的 `translations.ts`**（仅限 `resources.ts`）。禁止 import React 组件、`@/api`、`@/features/**` 的实现文件——`translations.ts` 是纯数据，可以依赖；其它文件不行，否则语言基础设施会反向依赖业务实现。

## 不变量

- `keySeparator: false` 必须保持。文案键是扁平的点分命名空间（`workflows.node.agent.label`），打开分隔符会让 i18next 把它当成嵌套路径而查不到。
- `initAsync: false` 必须保持。资源在 `init()` 里同步给全，异步初始化会让首帧渲染出未解析的 key。
- `resources.ts` 是唯一 import feature bundle 的地方。别处 import 会让"一个键属于谁"变得无法静态判断，也会让重复键检查失效。
- 节点目录存的是**键**（`workflows.node.<kind>.label`）而不是已解析文案：节点的标题在创建时解析一次并写进图数据，切换语言只应该重绘调色板，不应该改写画布上已有的节点。
- 当前资源只覆盖 workflow 一个 feature，界面其余部分仍是中文硬编码。实例是应用级的，扩大覆盖面只需往 `featureTranslationResources` 加 bundle，调用点不用改。
