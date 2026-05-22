# Viskit Studio

自托管商品视觉工作台。

![Viskit Studio 工作台生成预览](docs/assets/intro/workbench-generation-preview.png)

| 图片预览与二次编辑 | 商品套包概览 |
| --- | --- |
| ![图片预览弹窗](docs/assets/intro/asset-preview-dialog.png) | ![商品视觉套包示例](docs/assets/intro/marketing-kit-overview.jpg) |

## 现在能做什么

- 商品图上传
- 商品信息识别
- 结构化 brief
- 输出计划编辑
- 支持白底图、模特图、试穿/买家秀、Banner、详情模块、14 图套包
- 生成任务队列
- 图片预览、下载、删除、二次编辑
- 模板库
- 服务商配置
- SQLite / PostgreSQL

## Docker 部署

Docker：

```bash
cp .env.example .env
mkdir -p data
cp config.yaml.example data/config.yaml
docker compose up -d
```

访问：

```text
http://localhost:3068
```

## 源码部署

安装 `make`：

```bash
# Debian / Ubuntu
sudo apt update && sudo apt install -y make

# macOS
xcode-select --install

# Windows
winget install -e --id GnuWin32.Make
```

Windows 安装后，把这个目录加入系统 `Path`，然后重启 PowerShell / CMD：

```text
C:\Program Files (x86)\GnuWin32\bin
```

验证：

```powershell
make -v
```

准备：

```bash
make install-prod
```

构建：

```bash
make build
```

启动：

```bash
make start
```

## 开发者模式

```bash
make bootstrap
cp .env.example .env
mkdir -p data
cp config.yaml.example data/config.yaml
make db-migrate
make dev
```

## 检查

```bash
make lint
make typecheck
make test
make web-build
```

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `VISKIT_WEB_PORT` | Web 端口，默认 `3068` |
| `VISKIT_DATA_DIR` | 宿主机数据目录，默认 `./data` |
| `VISKIT_DATABASE_URL` | Docker 里的数据库地址，默认 SQLite |
| `VISKIT_GENERATION_JOB_CONCURRENCY` | 单个生成任务并发数，默认 `4` |
| `NEXT_PUBLIC_API_BASE_URL` | 前端外部 API 地址；同源部署一般留空 |
| `OPENAI_API_KEY` | OpenAI 或 OpenAI 兼容接口密钥 |
| `ANTHROPIC_API_KEY` | Anthropic 兼容接口密钥 |
| `APIMART_API_KEY` | API Mart 密钥 |
| `CHATGPT2API_KEY` | chatgpt2api 密钥 |
| `CPA_API_KEY` | CPA / CLIProxyAPI 密钥 |
| `SUB2API_API_KEY` | Sub2API 密钥 |
| `COMPLIANCE_SCREEN_API_KEY` | 合规检查服务密钥，可选 |

## 服务商配置

`data/config.yaml`：

```yaml
providers:
  vision:
    protocol: openai_compatible
    base_url: https://api.example.com
    api_key_env: OPENAI_API_KEY
    model: gpt-4o

  llm:
    protocol: openai_compatible
    base_url: https://api.example.com
    api_key_env: OPENAI_API_KEY
    model: gpt-4.1

  image:
    protocol: openai_compatible
    base_url: https://api.example.com
    api_key_env: OPENAI_API_KEY
    model: gpt-image-2

  compliance_screen:
    protocol: openai_compatible
    base_url: https://api.example.com
    api_key_env: OPENAI_API_KEY
    model: gpt-4.1-mini
```

## 图片接口

OpenAI 兼容：

```yaml
providers:
  image:
    protocol: openai_compatible
    base_url: http://your-gateway:3000
    api_key_env: OPENAI_API_KEY
    model: gpt-image-2
```

接口：

- `POST /v1/images/generations`
- `POST /v1/images/edits`

通用反代 / 网关：

- CPA / CLIProxyAPI: https://github.com/router-for-me/CLIProxyAPI
- Sub2API: https://github.com/Wei-Shaw/sub2api
- New API: https://github.com/QuantumNous/new-api
- chatgpt2api: https://github.com/basketikun/chatgpt2api

`image_generation`：

```yaml
providers:
  image:
    protocol: image_generation
    adapter: chatgpt2api
    base_url: http://host.docker.internal:8317
    api_key_env: CHATGPT2API_KEY
    model: gpt-image-2
```

适配器：

```text
gemini
gemini_openai
openai
chatgpt2api
volcengine_ark
z_image_gitee
jimeng2api
grok
siliconflow_adapter
```

## PostgreSQL

```env
UV_EXTRAS=--extra postgres
VISKIT_DATABASE_URL=postgresql+psycopg://viskit:viskit@postgres:5432/viskit
POSTGRES_DB=viskit
POSTGRES_USER=viskit
POSTGRES_PASSWORD=viskit
```

## 生成结果接口

示例：

```json
{
  "job_id": "gen_xxx",
  "status": "succeeded",
  "outputs": [
    {
      "output_id": "out_xxx",
      "status": "succeeded",
      "image_url": "/api/generation/jobs/gen_xxx/outputs/out_xxx/image",
      "download_url": "/api/generation/jobs/gen_xxx/outputs/out_xxx/image",
      "image_id": "asset:asset_xxx"
    }
  ]
}
```

图片响应：

```text
Content-Type: image/png
Cache-Control: no-store
```

图片 ID：

```text
asset:{asset_id}
kit-slot:{kit_id}:{slot_id}
```

## 目录

```text
apps/api/              FastAPI 后端
apps/web/              Next.js 前端
apps/web/public/minipaint/
                       内置 miniPaint 静态资源
services/copywriter/   文案、合规、OCR
services/editor/       图片编辑
services/imagegen/     生图编排和模板
services/providers/    服务商适配
packages/schemas/      共享 schema
infra/                 PostgreSQL 与迁移
```

## 致谢

- chatgpt2api: https://github.com/basketikun/chatgpt2api
- miniPaint: https://github.com/viliusle/miniPaint

## License

MIT. See [LICENSE](LICENSE).
