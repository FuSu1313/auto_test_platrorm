# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库中工作时提供指导。

## 项目概述

AutoTest (QAgent) 是一个 AI 驱动的全栈自动化测试管理平台，技术栈为：Django 4.2 + DRF 后端，React 19 + Vite + Ant Design 6 前端，MySQL 数据库，Redis 支持 Celery 和 Django Channels。

## 常用命令

### 后端 (Django)

```bash
# 安装依赖
pip install -r requirements.txt

# 环境配置（复制并编辑）
cp .env.example .env

# 数据库初始化（MySQL 8.0+，数据库名：qagent，字符集：utf8mb4）
python manage.py makemigrations
python manage.py migrate
python manage.py createsuperuser

# 启动开发服务器
python manage.py runserver

# 启动 Celery 异步任务（需要 Redis）
celery -A backend worker -l info

# 手动执行所有定时 API 测试任务
python manage.py run_all_scheduled_tasks

# 通过 Daphne 启动（支持 WebSocket）
daphne backend.asgi:application --port 8000
```

### 前端 (React)

```bash
cd web
npm install
npm run dev        # 开发服务器（默认端口 5173）
npm run build      # 生产构建
npm run lint       # ESLint 检查
```

### 关键 URL

- 前端：`http://localhost:5173`
- 后端 API：`http://localhost:8000/api/`
- Swagger API 文档：`http://localhost:8000/api/docs/`
- Django 管理后台：`http://localhost:8000/admin/`

## 架构说明

### 分层结构

```
backend/          Django 项目配置（settings, urls, wsgi, asgi, celery）
apps/             13 个本地 Django 应用（详见下文）
web/              React SPA（Vite + Ant Design 6 + Redux Toolkit）
tools/allure/     内嵌 Allure 命令行工具
```

所有 Django 配置集中在 `backend/settings.py`（单文件，无拆分模块）。通过环境变量读取配置（`python-decouple`，`.env` 文件和 `os.environ`）。

### 13 个应用及其职责

| 应用 | 职责 |
|-----|------|
| `apps/users` | 自定义 User 模型（`AUTH_USER_MODEL`），UserProfile，JWT 认证 |
| `apps/projects` | 项目（Project）、成员（负责人/管理员/开发者/测试者/观察者）、环境配置 |
| `apps/testcases` | 测试用例增删改查，步骤管理，附件和评论 |
| `apps/testsuites` | 测试套件分组 |
| `apps/executions` | TestPlan → TestRun → TestRunCase 执行流程，含状态追踪和历史 |
| `apps/reports` | 测试报告和报告模板（JSON 格式） |
| `apps/reviews` | 多评审人评审流程，含评审模板和检查清单 |
| `apps/versions` | 版本管理，与测试用例关联 |
| `apps/requirement_analysis` | AI 文档解析 → 业务需求提取 → 测试用例生成 |
| `apps/api_testing` | API 项目管理/集合/请求管理，测试套件，定时任务，环境变量，通知 |
| `apps/assistant` | 智能助手，集成 Coze API |
| `apps/core` | 统一变量解析引擎、通知配置（飞书/企微/钉钉 Webhook）、定时任务调度命令 |
| `apps/agent` | ReAct Agent 引擎 + 工具注册中心（11 个测试管理工具） |

### 关键跨模块模式

**认证鉴权**：JWT (simplejwt)，access token 60 分钟，refresh token 7 天，支持轮换和黑名单。`/api/` 路径通过 `backend.middleware.DisableCSRFMiddleware` 全局禁用 CSRF。DRF 默认配置：所有接口需要认证（`IsAuthenticated`），分页大小 20，纯 JSON 响应。

**用户模型**：`apps.users.models.User` 继承 `AbstractUser`，所有模块通过 `get_user_model()` 引用。通过一对一 `UserProfile` 扩展主题/语言/时区偏好。

**变量替换**：`apps.core.variable_resolver.VariableResolver` — 在任何文本中使用 `${函数名(参数)}` 语法注入动态数据。支持 50+ 函数（随机值、中国身份信息、Base64/MD5/SHA/AES 加解密、时间戳、CRON 表达式、二维码等）。全局便捷函数：`resolve_variables(text)`（位于 `apps.core.variable_resolver`）。

**AI 集成**：所有 AI 调用统一通过 `apps.requirement_analysis.models.AIModelService` 进行，提供 OpenAI 兼容格式的 API 调用（同步、流式、自动续写）。模型配置通过 `AIModelConfig` 数据行存储，按 model_type + role（writer/reviewer/browser_use_text）筛选。支持多个 AI 厂商（DeepSeek、通义千问、OpenAI、Anthropic、Google Gemini、Groq、Ollama 等）。

**操作日志**：在 `apps/api_testing` 中，使用 `apps.api_testing.operation_logger.log_operation()` 记录用户操作。该函数静默失败——日志记录错误不会中断业务流程。

**通知系统**：`apps.core.models.UnifiedNotificationConfig` 存储飞书/企业微信/钉钉 Webhook 机器人配置。`apps.api_testing.models.TaskNotificationSetting` 配置每个定时任务的邮件和 Webhook 通知，支持自定义收件人。

**定时任务**：`apps.api_testing.models.ScheduledTask` 支持三种触发方式——CRON 表达式（基于 `croniter`）、固定间隔和单次执行。管理命令 `run_all_scheduled_tasks` 轮询并执行到期任务。任务通知通过 `TaskNotificationSetting` 发送。

**WebSocket**：Django Channels + Redis 通道层。ASGI 配置（`backend/asgi.py`）在 Channels 未安装时自动降级为纯 HTTP。WebSocket 路由定义在 `apps.app_automation.routing` 中。

### 测试生命周期流程

```
需求文档（上传）
  → AI 分析（AIModelService）
  → 业务需求提取
  → 测试用例生成（AI，支持流式或完整输出）
  → AI 评审 + 优化改进
  → 测试用例（手动或导入）
  → 用例评审（多评审人流程）
  → 测试计划 → 测试执行 → 逐条执行用例（状态追踪）
  → 测试报告（JSON 摘要 + Allure 集成）
```

与之并行的 API 测试链路：

```
API 项目 → API 集合 → API 请求
  → 测试套件（有序请求 + 断言）
  → 测试执行记录
  → 定时任务（cron/interval/once）
  → 通知（邮件 + Webhook）
```

### Agent 架构

ReAct Agent（`apps/agent/engine.py`）按 Thought → Action → Observation 循环执行，最大迭代 10 次。`apps/agent/tools.py` 中的 `ToolRegistry` 注册了操作测试用例、测试计划、测试执行、报告和 API 项目的领域工具。工具方法内部使用 `sync_to_async` 处理 Django ORM 的同步调用。引擎复用 `AIModelService` 进行 LLM 调用。

### 自定义邮件后端

`apps.api_testing.custom_email_backend.CustomEmailBackend` 扩展 Django 的 SMTP 后端，禁用 SSL 证书验证。已在 settings 中配置为 `EMAIL_BACKEND`。

### 前端架构

- **路由**：React Router DOM 7，`ProtectedRoute`（登录保护）和 `GuestRoute`（登录/注册页面）
- **状态管理**：Redux Toolkit，包含 `userSlice` 和 `appSlice`
- **API 层**：`web/src/services/` 目录下的服务模块（Axios + JWT 自动刷新拦截器）
- **页面组织**：按模块划分 —— `api-testing/`（8 页）、`ai-generation/`（14 页）、`agent/`、`testcases/`、`test-tools/`（18 个工具）、`data-factory/`、`projects/`、`auth/`
- **国际化**：i18next，支持 `zh-cn` 和 `en` 语言

## 重要编码规范

- 所有 Django 模型显式指定 `db_table` 名称（不使用 Django 自动生成的 `app_model` 格式）
- ForeignKey/ManyToMany 字段始终指定 `related_name`
- Agent 工具中的 Django ORM 异步调用使用 `sync_to_async()`（来自 `asgiref`）
- AI 模型配置通过 `is_active=True` 筛选；使用 `AIModelConfig.get_active_config(model_type, role)` 或 `cls.objects.filter(is_active=True).first()` 获取
- 模型 `__str__` 方法统一使用中文
- 大多数模型都包含 `created_at` 和 `updated_at` 字段
- `.gitignore` 忽略 migration 文件、IDE 目录和虚拟环境
- 代码注释和回答请使用中文
