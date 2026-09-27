# 内部认证

Gateway 独占外部登录集成。Cloud 核心不接入密码、SAML、OAuth 客户端或华为 SDK，也不根据姓名/email 合并账号。Gateway 通过华为 IDaaS 2.0 Authorization Code（`client_secret_post` 机密客户端）或 GitHub OAuth（Authorization Code + PKCE S256）规范化出 `{source, subject, displayName?, globalUserId?}`；`source` 是长期稳定的账号命名空间，`(source,subject)` 联合唯一。华为员工身份固定为 `source=huawei-corp`、`subject=<IDaaS uuid>`，同次验证的 `globalUserId` 是与天舟目录相连的第二身份键。Cloud 原子绑定两个标识，若各自已指向不同用户则拒绝自动合并。姓名只在首次 JIT 创建 Cloud 用户时形成快照，工号和邮箱不参与身份或授权。生产入口是 `cmd/gateway`（PostgreSQL 浏览器会话、`/api/v1` 代理），见 `docs/gateway.md`。

HTTP 使用两种独立签名凭据：`Authorization: Bearer <service JWT>` 证明调用服务，`X-Ora-User-Token: <user JWT>` 证明最终用户。公开 API 要求 gateway 服务；访问检查/执行准入要求 controller 服务及用户凭据；后台控制 API 只要求 controller 服务；Node 接口只要求带资源范围的 node 服务凭据。普通 header 不能替代任何一类签名。Controller 的 gRPC 控制接口（`control.grpc_addr`）当前阶段不做认证：Controller 以 `x-ora-controller-id` metadata 声明自己的 ControllerId，Cloud 只把它记为租约与提交记录的持有者，因此该地址只应监听回环或私网。

验证器仅允许 `EdDSA` / Ed25519，校验 `kid`、配置中的 issuer、key purpose（user/service）、固定服务角色、`aud`、签名、必须存在的 `iat/exp`、未来签发时间及不超过 5 分钟的生命期。`nbf` 存在时也由 JWT 验证器校验。用户凭据 `caller` 必须精确匹配 service `sub`。每个用户请求在 PG 检查用户状态与有效成员；停用记录保留，不自动改写资源拥有者。

配置示例（路径是 cloud 可读的 Ed25519 PKIX PUBLIC KEY PEM）：

```yaml
auth:
  audience: ora-cloud
  keys:
    - id: gateway-service-2026
      issuer: ora-internal-issuer
      kind: service
      role: gateway
      public_key_file: /run/ora-keys/gateway-service.pem
    - id: user-identity-2026
      issuer: ora-internal-issuer
      kind: user
      public_key_file: /run/ora-keys/user-identity.pem
    - id: controller-service-2026
      issuer: ora-internal-issuer
      kind: service
      role: controller
      public_key_file: /run/ora-keys/controller-service.pem
    - id: node-service-2026
      issuer: ora-internal-issuer
      kind: service
      role: node
      public_key_file: /run/ora-keys/node-service.pem
```

允许同时配置新旧 key ID 以轮换公钥，重启 server 载入配置。Cloud 从不持有这些私钥。签发权由 Gateway/受控基础设施适配器承担；这里没有另建认证中心。`cmd/gateway` 用两把独立的 Ed25519 私钥分别签发 service 与 user 凭据，对应上面 `gateway-service-2026` 与 `user-identity-2026` 两个 purpose 不同的公钥条目。连接层仍应使用 TLS 或受控服务网络，JWT 不负责保密。

内网部署为 Cloud 设置 `directory.endpoint`、`directory.hw_id`、`directory.environment` 和 `directory.app_key_file`（相应环境变量为 `CLOUD_DIRECTORY_ENDPOINT`、`CLOUD_DIRECTORY_HW_ID`、`CLOUD_DIRECTORY_ENVIRONMENT`、`CLOUD_DIRECTORY_APP_KEY_FILE`）。endpoint 固定到天舟 `/api/framework/v1/user/search` 的 HTTPS 地址；`app_key_file` 是仅服务进程可读的密钥文件。Cloud 分别把部署值放到 `X_HW_ID`、`tianzhou-env` 和 `X_HW_APPKEY` 请求头，不记录其值。公网部署留空 endpoint，成员管理使用私有邀请和申请链接；浏览器不持有天舟机器凭据。

service claims 示例（JWT header 同时带 `alg=EdDSA,kid=gateway-service-2026`）：

```json
{"iss":"ora-internal-issuer","aud":["ora-cloud"],"sub":"gateway-instance-a","kind":"service","role":"gateway","iat":1788931200,"exp":1788931260}
```

user claims 同样独立签名，时间值在实际调用时生成：

```json
{"iss":"ora-internal-issuer","aud":["ora-cloud"],"sub":"uuid~stable-account-id","kind":"user","source":"huawei-corp","globalUserId":"205045249610656","displayName":"显示名","caller":"gateway-instance-a","iat":1788931200,"exp":1788931260}
```

Controller 代表用户准入时，Gateway/内部受控转发路径必须签发 `caller=controller-instance-a` 的用户凭据，不能直接转发绑定 gateway 的 token。后台阶段推进使用 controller 自己的服务凭据和 operation 中已保存的 `actorUserId`；无需原用户 token 长期有效。租约 holder 从已验证的 service `sub` 取得，不能通过 body 指定另一 holder。

Node 服务凭据的 `sub` 是每次进程启动新建的 Node UUID，并增加 `workspaceId`、`sandboxId`（cloud sandbox instance UUID）和 `generation`。基础设施签发端必须从获准的 sandbox plan 建立这个绑定，不能接受调用者自行选择资源。Cloud 检查当前 Workspace generation、已登记 Substrate ID、未确认终止 sandbox 和 Node 唯一性；旧 Node/旧 generation 拒绝回写。Node 进程更换前必须终止或 fence 旧实例，不能凭新的 Node UUID覆盖存活节点。

外部 provider token 不进入内部 JWT；user JWT 只携带稳定 subject、固定 source、经验证的华为 `globalUserId` 和首次 JIT 所需的显示名。Gateway session 默认在 IDaaS 部署中 12 小时绝对过期，退出或管理员吊销可立即失效；第一版不做人事状态后台同步。管理员移除成员后，Cloud 立即拒绝该成员的新请求和执行准入，已开始的任务按原生命周期收尾。

首次登录、GitHub PKCE 绑定、回调重放/并发、伪造/过期/错 aud、错服务角色、caller 不匹配、命名空间分离、用户停用均有真实 HTTP+PG 回归测试。模拟器的临时私钥仅供本地演示和测试，不作为部署密钥。
