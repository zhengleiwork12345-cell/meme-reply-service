# Meme Reply Service（自托管 Docker）

此服务为斗图助手提供安全的 AI 回击图生成接口。它使用火山引擎方舟的即梦同源 Seedream 图像生成接口；上传图像只在请求内存中处理，不写入对象存储、数据库或日志。

## 运行前准备

1. 准备 PostgreSQL 14+，使用独立的应用数据库账号、TLS 连接，并在数据库防火墙中只允许 Docker 主机的固定出口 IP 访问。
2. 在 PostgreSQL 中执行 `sql/001_init.sql`。
3. 在火山引擎方舟开通即梦同源图片生成能力，创建 API Key，并确定可调用的模型 ID 或推理接入点 ID。建议在方舟控制台创建推理接入点，并将它作为 `ARK_IMAGE_MODEL`。
4. 在 Docker 主机的密钥管理或受限权限的环境文件中配置 `ARK_API_KEY`、`ARK_IMAGE_MODEL`、`DATABASE_URL`、`AUTH_JWT_SECRET`、`REGISTRATION_INVITE_CODE`。不要把它们写进 Dockerfile、镜像、Git 仓库或构建日志。

服务使用自有账户：密码以 bcrypt 哈希保存，App 通过短期 JWT 与轮换刷新令牌访问 API。PostgreSQL 保存账户、设备、刷新令牌哈希和不含图片内容的生成审计；不设置每日次数限制。

## 本地验证

```powershell
copy .env.example .env
npm ci
npm run typecheck
npm test
```

生产启动前必须提供 `ARK_API_KEY`、`ARK_IMAGE_MODEL`、`DATABASE_URL`、`AUTH_JWT_SECRET` 和 `REGISTRATION_INVITE_CODE`；缺失任一项会立即退出，服务不会以无鉴权模式启动。

## 使用 Docker 部署

在 `meme-reply-service` 目录构建镜像：

```powershell
docker build -t meme-reply-service:latest .
```

在服务器的受限目录中创建环境文件（例如 `/opt/meme-reply-service/runtime.env`），内容以 `.env.example` 为准；该文件权限应仅允许部署账号读取。然后运行：

```bash
docker run -d --name meme-reply-service --restart unless-stopped --env-file /opt/meme-reply-service/runtime.env -p 8080:8080 meme-reply-service:latest
```

将反向代理（Nginx、Caddy 或现有网关）的 HTTPS 域名指向容器的 `8080` 端口，并将最终 HTTPS 地址写入移动端 `.env` 的 `EXPO_PUBLIC_MEME_API_URL`。网络端口可公开，但应用层的业务接口仍强制要求自有账户的 JWT。

图像提供商为火山引擎方舟的即梦同源 Seedream；`ARK_IMAGE_MODEL` 可填写官方模型 ID，或你在方舟控制台创建的推理接入点 ID。后端以 `b64_json` 接收结果后直接返回给 App，不使用结果 URL，因此不会在你的服务器持久化图片。即梦参考图目前仅接收 PNG 或 JPEG，单张上传仍限制为 5 MB。

## 发布到 Docker Hub

仓库包含 GitHub Actions 工作流 `.github/workflows/publish-dockerhub.yml`。先在 Docker Hub 创建一个名为 `meme-reply-service` 的仓库，再在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 添加：

- `DOCKERHUB_USERNAME`：Docker Hub 用户名。
- `DOCKERHUB_TOKEN`：Docker Hub 创建的仅用于此仓库、具有 Read & Write 权限的 Personal Access Token。

配置完成后，推送到 `main` 会自动发布 `DOCKERHUB_USERNAME/meme-reply-service:latest` 和不可变的 `sha-<提交短哈希>` 标签；也可在 GitHub Actions 页面手动运行 **Publish Docker image**。Docker 主机部署时执行：

```bash
docker pull DOCKERHUB_USERNAME/meme-reply-service:latest
docker run -d --name meme-reply-service --restart unless-stopped --env-file /opt/meme-reply-service/runtime.env -p 8080:8080 DOCKERHUB_USERNAME/meme-reply-service:latest
```

## HTTP 合约

- `GET /health` → `{ "ok": true }`
- `POST /auth/register`：邮箱、至少 10 位密码、设备 UUID 与注册邀请码。
- `POST /auth/login` / `POST /auth/refresh`：获取或轮换 JWT 会话。
- `POST /v1/meme-replies`：`multipart/form-data`，字段 `source`（PNG/JPEG，≤5 MB）、`mood`、可选 `replyText`（≤30 字），以及 `Authorization: Bearer <JWT>`。
- 成功：`{ requestId, mimeType: "image/png" | "image/jpeg" | "image/webp", imageBase64 }`。
- 失败：`{ requestId, code, message }`；使用 400、401、429、502 或 503，且不会回传即梦上游原始错误。
