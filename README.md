# SuperShip — 船舶建模智能体

基于 RAG + Agent 的船舶建模工程助手，集成文档检索、知识问答、结构建模与 3D 预览能力。

## 项目定位

面向船舶工程领域的 AI 智能体，核心功能：

- **文档知识库**：上传 PDF/Word/Excel，自动分块、向量化、混合检索，支持 RAG 问答
- **技能系统**：可扩展的插件化技能框架，当前支持 PPT 生成、前端设计、画布设计、船舶加强筋建模
- **3D 模型预览**：通过自然语言生成 STEP 结构模型，浏览器内实时渲染 3D 预览
- **流式对话**：SSE 流式输出 + 实时 RAG 过程可视化 + 终止回答

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端框架 | FastAPI + Uvicorn |
| AI 框架 | LangChain + LangGraph Agent |
| LLM | 火山方舟（Volcengine ARK）Doubao 系列 |
| 向量数据库 | Milvus（Docker Compose 部署） |
| 嵌入模型 | Volcengine 多模态嵌入（2048 维） |
| 3D 建模 | CadQuery（Python 参数化 CAD） |
| 前端 3D | Three.js（ES Module 懒加载） |
| 前端框架 | Vue 3 CDN 单页应用 |
| 容器化 | Docker Compose（etcd + MinIO + Milvus + Attu） |

---

## 目录结构

```
SuperMew/
├── backend/                    # Python 后端
│   ├── app.py                  # FastAPI 入口，CORS，静态文件挂载
│   ├── api.py                  # REST API 端点（聊天/会话/文档/工作区/3D预览）
│   ├── agent.py                # LangChain Agent 创建、会话存储、流式输出
│   ├── schemas.py              # Pydantic 请求/响应模型
│   ├── tools.py                # Agent 工具（天气查询、知识库检索）
│   ├── embedding.py            # 稠密向量（火山方舟）+ BM25 稀疏向量
│   ├── document_loader.py      # 文档加载 + 三级滑动窗口分块
│   ├── rag_pipeline.py         # LangGraph RAG 工作流（检索→评分→重写→二次检索）
│   ├── rag_utils.py            # 检索工具函数（混合检索、Rerank、Auto-merging）
│   ├── milvus_client.py        # Milvus 客户端（双向量索引 + Hybrid Search + RRF）
│   ├── milvus_writer.py        # 向量写入（稠密+稀疏批量写入）
│   ├── parent_chunk_store.py   # 父级分块 DocStore（Auto-merging 回取父块）
│   └── skill/                  # 技能框架
│       ├── __init__.py         # 初始化，启动时自动发现技能
│       ├── skill_loader.py     # 渐进式 L1/L2/L3 加载器
│       └── skill_tools.py      # LangChain @tool 包装（use_skill、文件操作、Bash 执行）
├── frontend/                   # 静态前端
│   ├── index.html              # Vue 3 SPA（Three.js importmap + 3D 预览面板）
│   ├── script.js               # Vue 3 应用逻辑（聊天、会话、文档、3D 查看器）
│   └── style.css               # 深色工业主题样式
├── skills/                     # 可插拔技能定义
│   ├── frontend-design/        # 前端界面设计技能
│   ├── pptx/                   # PPT 生成/编辑技能
│   ├── canvas-design/          # 画布设计技能（含字体资源）
│   └── ship-stiffener/         # 船舶加强筋建模技能
│       ├── SKILL.md            # 技能定义（5 种型材 + 工作流程 + 代码规范）
│       ├── LICENSE.txt
│       └── examples/           # CadQuery 参考脚本（扁铁、T型材、L型材）
├── data/                       # 运行时数据
│   ├── customer_service_history.json  # 会话存储
│   ├── parent_chunks.json             # 父级分块存储
│   ├── documents/                     # 上传文档原文件
│   └── skill_workspace/               # 技能生成文件（.step/.py/等）
├── docker-compose.yml          # Milvus 容器编排
├── pyproject.toml              # 项目依赖
└── .env                        # 环境变量配置
```

---

## 核心模块详解

### 1. RAG 检索增强生成

端到端 RAG 流水线，从文档上传到精准问答：

**文档处理** (`document_loader.py`)
- 支持 PDF、Word、Excel 三种格式
- 三级滑动窗口分块（L1 ~1200 字 / L2 ~600 字 / L3 ~300 字）
- 每个分块携带层级元数据（`chunk_id` / `parent_chunk_id` / `chunk_level`）
- 仅 L3 叶子块写入 Milvus，L1/L2 父块写入本地 DocStore

**混合检索** (`milvus_client.py` + `rag_utils.py`)
- **双塔检索**：稠密向量（语义匹配）+ BM25 稀疏向量（关键词匹配）
- Milvus `AnnSearchRequest` 同时发起两路召回，**RRF 融合**排序
- 可选 Rerank 精排（Jina Rerank API），未配置时自动降级

**RAG 工作流** (`rag_pipeline.py`)
- 基于 LangGraph 的 4 节点工作流：
  1. `retrieve_initial` — 混合检索 + Auto-merging（L3→L2→L1 父块合并）
  2. `grade_documents` — LLM 二值相关性评分门控
  3. `rewrite_question` — 查询重写路由（Step-Back / HyDE / Complex）
  4. `retrieve_expanded` — 二次检索，对重写后查询重新召回
- 各节点实时推送步骤到前端（`emit_rag_step`）

**嵌入服务** (`embedding.py`)
- 稠密向量：调用火山方舟多模态嵌入 API（2048 维）
- 稀疏向量：自实现 BM25 算法（中英文分词 + IDF + TF-IDF 评分）

### 2. Agent 智能体

**核心架构** (`agent.py`)
- LangChain Agent 绑定系统提示词 + 工具集
- 同步/异步双模式：`chat_with_agent()` 和 `chat_with_agent_stream()`
- 流式输出：`agent.astream(stream_mode="messages")` 逐 token 推送
- 统一输出队列架构：后台任务产出 → `asyncio.Queue` → SSE 推送
- 会话存储：JSON 文件持久化，超长对话自动摘要压缩

**内置工具** (`tools.py`)
- `search_knowledge_base` — RAG 检索（含工具调用防重复守卫）
- `get_current_weather` — 高德天气 API

**系统提示词**
- 角色设定为专业船舶建模工程助手
- 包含技能目录描述，指导 Agent 何时激活技能
- 中文回复，工程化风格，无表情符号

### 3. 技能系统

渐进式加载框架，支持按需扩展新技能：

**三级加载机制** (`skill/skill_loader.py`)
| 级别 | 触发时机 | 加载内容 |
|------|---------|---------|
| L1 发现 | 服务启动 | YAML frontmatter 中的 name + description |
| L2 激活 | Agent 调用 `use_skill()` | 完整 SKILL.md 内容（含工作流程、代码规范） |
| L3 资源 | Agent 调用 `read_file()` | 示例脚本、模板等辅助文件 |

**工具绑定** (`skill/skill_tools.py`)
- `use_skill(skill_name)` — 激活技能，内容注入 Agent 上下文
- `read_file` / `write_file` / `list_files` / `create_directory` — 文件操作
- `execute_bash` — Shell 命令执行（自动使用项目虚拟环境 Python）
- 所有文件操作限定在 `data/skill_workspace/` 目录内

**已安装技能**

| 技能 | 描述 |
|------|------|
| `frontend-design` | 前端界面设计，生成 HTML/CSS/JS |
| `pptx` | PPT 生成/编辑，基于 OOXML 操作 |
| `canvas-design` | 画布设计，生成 PNG/PDF（含 40+ 字体资源） |
| `ship-stiffener` | 船舶加强筋建模，生成 CadQuery 脚本 + STEP 文件 |

**船舶加强筋建模技能** (`skills/ship-stiffener/`)
- 支持 5 种型材：扁铁（Flat Bar）、T 型材（T-Bar）、L 型材/角钢（L-Bar）、球扁钢（Bulb Flat）、自定义截面
- 工作流：解析参数 → 确认参数 → 写 CadQuery 脚本 → 执行生成 STEP → 输出报告
- 截面在 XY 平面绘制，沿 Z 轴挤出
- 同时输出 `.step`（CAD 模型）和 `.py`（可修改的源脚本）

### 4. 3D 模型预览

在浏览器内直接预览生成的 STEP 模型：

**后端转换** (`api.py` — `GET /workspace/preview/{filename}`)
- 使用 CadQuery `importStep()` 加载 STEP 文件
- OCP `BRepMesh_IncrementalMesh` 进行曲面三角化
- 提取顶点和三角面片，返回 JSON `{vertices, indices, vertex_count, face_count}`

**前端渲染** (`script.js` + Three.js)
- Three.js 通过 `importmap` 懒加载（仅首次预览时加载，约 600KB）
- `BufferGeometry` + `MeshStandardMaterial` 渲染金属质感模型
- `OrbitControls` 支持鼠标拖拽旋转、滚轮缩放
- 自动适配相机位置（基于包围盒）
- 底部信息栏实时显示顶点数、三角面片数

### 5. 前端界面

深色工业主题的 Vue 3 单页应用：

**布局结构**
- 左侧导航栏：新建会话、历史记录、文档管理
- 中间聊天区：消息气泡、SSE 流式输出、思考动画、RAG 步骤可视化
- 右侧面板：工作区文件列表（下载/删除/3D 预览）+ 3D 视口 + 信息栏

**核心交互**
- SSE 流式对话，思考→检索→回答在同一气泡内无缝过渡
- AbortController 支持随时终止生成
- 文档上传/删除，支持 PDF、Word、Excel
- 工作区文件自动刷新（每次对话完成后）
- STEP 文件一键 3D 预览

**视觉风格**
- 深蓝底色 `#0c1420` + 钢蓝强调色 `#3b82f6`
- Inter（正文）+ JetBrains Mono（代码/数据）
- 圆角 2-4px，无边框渐变，工业科技感

### 6. 基础设施

**Milvus 向量数据库** (`docker-compose.yml`)
- `standalone` — Milvus 主服务（端口 19530）
- `etcd` — 元数据存储
- `minio` — S3 兼容对象存储（端口 9000/9001）
- `attu` — 可视化管理界面（端口 8080）

**数据存储**
- 会话历史：`data/customer_service_history.json`
- 父级分块：`data/parent_chunks.json`
- 技能产出：`data/skill_workspace/`
- 向量数据：Milvus + `volumes/` 持久化

---

## API 端点一览

### 聊天与会话
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/chat` | 聊天（非流式） |
| POST | `/chat/stream` | 聊天（SSE 流式） |
| GET | `/sessions/{user_id}` | 列出用户会话 |
| GET | `/sessions/{user_id}/{session_id}` | 获取会话消息 |
| DELETE | `/sessions/{user_id}/{session_id}` | 删除会话 |

### 文档管理
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/documents` | 列出已上传文档 |
| POST | `/documents/upload` | 上传并处理文档 |
| DELETE | `/documents/{filename}` | 删除文档向量数据 |

### 工作区与 3D 预览
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/workspace/files` | 列出技能生成文件 |
| GET | `/workspace/files/{filename}` | 下载文件 |
| DELETE | `/workspace/files/{filename}` | 删除文件 |
| GET | `/workspace/preview/{filename}` | STEP 文件 3D 预览（返回三角网格 JSON） |

---

## 本地部署

### 1. 环境准备
- Python 3.12+
- Docker / Docker Compose（Milvus 依赖）
- 推荐包管理器：`uv`

### 2. 安装依赖

```bash
# uv（推荐）
uv sync

# 或 pip
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
```

### 3. 启动 Milvus

```bash
docker compose up -d

# 确认服务状态
docker compose ps
```

端口说明：Milvus `19530` / MinIO API `9000` / MinIO Console `9001` / Attu `8080`

### 4. 配置环境变量

在项目根目录创建 `.env`：

```env
# ===== LLM（火山方舟） =====
ARK_API_KEY=your_ark_api_key
MODEL=your_model_endpoint_id
BASE_URL=https://ark.cn-beijing.volces.com/api/v3
EMBEDDER=your_embedding_endpoint_id
GRADE_MODEL=your_grading_endpoint_id

# ===== Milvus =====
MILVUS_HOST=127.0.0.1
MILVUS_PORT=19530

# ===== 技能框架（可选，有默认值） =====
SKILLS_DIR=skills
SKILL_WORK_DIR=data/skill_workspace

# ===== Rerank（可选，不配则自动降级） =====
RERANK_MODEL=your_rerank_model
RERANK_BINDING_HOST=https://your-rerank-host
RERANK_API_KEY=your_rerank_api_key

# ===== 工具（可选） =====
AMAP_API_KEY=your_amap_api_key
```

### 5. 启动应用

```bash
uv run python backend/app.py
```

访问：
- 前端页面：`http://127.0.0.1:8000/`
- API 文档：`http://127.0.0.1:8000/docs`

---

## 关键技术亮点

### 混合检索
稠密向量（语义）+ BM25 稀疏向量（关键词），Milvus Hybrid Search + RRF 融合排序。稀疏检索失败时自动降级为纯稠密检索。

### 三级分块 + Auto-merging
L1/L2/L3 三层滑窗切分；检索时优先召回 L3 叶子块，满足阈值后自动合并到父块（L3→L2→L1），从 DocStore 读取完整上下文。

### 跨线程实时推送
RAG 工具在 `ThreadPoolExecutor` 中运行时，通过 `loop.call_soon_threadsafe()` 将步骤事件安全地推送回主线程的 `asyncio.Queue`，实现工具执行期间的实时前端更新。

### 技能渐进加载
技能分三个级别按需加载，避免一次性注入过多上下文。Agent 自主判断何时激活技能，激活后技能指令作为 SystemMessage 注入上下文。

### 3D 模型 Web 预览
CadQuery/OCP 在后端将 STEP 文件三角化为 JSON 网格数据，前端 Three.js 懒加载渲染，无需安装 CAD 软件即可在浏览器中查看模型。

---

## 扩展新技能

在 `skills/` 目录下创建新文件夹，按以下结构组织：

```
skills/my-skill/
├── SKILL.md          # 技能定义（YAML frontmatter + 工作流程 + 代码规范）
├── LICENSE.txt       # 许可证
└── examples/         # 参考脚本（可选）
```

SKILL.md frontmatter 格式：

```yaml
---
name: my-skill
description: "技能描述，用于系统提示词中的技能目录"
license: MIT
---
```

服务启动时自动发现新技能（L1），Agent 在对话中按需激活（L2/L3）。
