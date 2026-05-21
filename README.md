# Viskit Studio

![Viskit Studio logo](docs/assets/brand/viskit-logo.svg)

Viskit Studio 是一个自托管商品视觉套包生产工作台，用于生成商品首图、详情模块、文案规格、模板方案与服务商配置。

![Viskit Studio 商品视觉套包示例](docs/assets/intro/marketing-kit-overview.jpg)

| 商品首图 | 详情模块 |
| --- | --- |
| ![Viskit Studio 商品首图示例](docs/assets/intro/hero-cover.jpg) | ![Viskit Studio 商品详情模块示例](docs/assets/intro/detail-module.jpg) |

## 项目架构

- **Web**：Next.js 14，工作台、套包管理、编辑器、模板库、服务商配置。
- **API**：FastAPI + SQLAlchemy，业务路由、配置、生成任务、健康检查。
- **数据库**：SQLite / PostgreSQL。
- **文件**：本地文件系统，生成图片写入 `data/imagegen/`。
- **事件**：进程内 `KitEventBus`。

```text
apps/api/              FastAPI 后端与业务路由
apps/web/              Next.js Web 工作台
services/copywriter/   文案与合规能力
services/editor/       图片 OCR、修补编辑
services/imagegen/     视觉套包生成与模板库
services/providers/    AI 服务商抽象层
packages/schemas/      OpenAPI、TypeScript 与 Python 共享模型
infra/                 PostgreSQL Compose 与 SQL 迁移
```

## Docker 部署

`docker-compose.yml`：

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_API_BASE_URL: ${NEXT_PUBLIC_API_BASE_URL:-}
        UV_EXTRAS: ${UV_EXTRAS:-}
    ports:
      - "0.0.0.0:${VISKIT_WEB_PORT:-3068}:3000"
    environment:
      DATABASE_URL: ${VISKIT_DATABASE_URL:-sqlite:////app/data/viskit.db}
      CONFIG_PATH: /app/data/config.yaml
      IMAGEGEN_OUTPUT_DIR: /app/data/imagegen
      VISKIT_AUTO_MIGRATE: "1"
      VISKIT_BOOTSTRAP_WORKSPACE: "1"
      NEXT_SERVER_API_BASE_URL: http://127.0.0.1:8000
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      APIMART_API_KEY: ${APIMART_API_KEY:-}
    volumes:
      - ${VISKIT_DATA_DIR:-./data}:/app/data
    restart: unless-stopped
```

## 源码开发

```bash
make bootstrap
cp .env.example .env
make db-migrate
make dev
```

验证：

```bash
make lint
make typecheck
make web-build
```
