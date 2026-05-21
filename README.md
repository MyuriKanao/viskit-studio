# Viskit Studio

Viskit Studio 是一个自托管商品视觉套包生产工作台，面向单运营账号生成商品营销图、详情图、文案规格与服务商配置。

## 项目内容

```text
apps/api/              FastAPI 后端与业务路由
apps/web/              Next.js 14 Web 工作台
services/copywriter/   文案与合规能力
services/editor/       图片 OCR、修补与合成编辑
services/imagegen/     视觉套包生成与模板库
services/providers/    AI 服务商抽象层
packages/schemas/      OpenAPI、TypeScript 与 Python 共享模型
infra/                 Docker Compose 与 SQL 迁移
```

仓库只保留运行源码、配置样例、迁移和必要静态资源；
## 本地运行

```bash
make bootstrap
cp .env.example .env
make compose-up
make dev
```

默认服务：

- Web: `http://localhost:3001`
- API: `http://localhost:8001`
- OpenAPI: `http://localhost:8001/openapi.json`

## 常用命令

```bash
make lint
make typecheck
make web-build
```
