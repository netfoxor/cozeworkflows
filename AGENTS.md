## 项目概述

风哥AI工作流集合——200+ 实用 Coze 工作流资源的开源仓库。包含工作流 JSON/ZIP 文件、使用说明文档和贡献指南，供用户导入到 Coze 平台使用。

## 技术栈

- 纯文档/资源项目，无可执行代码
- 工作流文件格式：JSON（打包为 ZIP）
- 文档格式：Markdown、DOCX
- 图片资源：PNG

## 目录结构

```
/workspace/projects/
├── .coze                          # 项目配置
├── AGENTS.md                      # 项目规范（本文件）
├── README.md                      # 项目说明与使用指南
├── Coze 工作流贡献指南              # 贡献指南文档
├── coze工作流200+源码使用说明.docx   # 详细使用说明
├── images/                        # README 引用的截图资源
├── 工作流200+合集分享/              # 198 个工作流原始 ZIP 文件
├── workflows-json/                 # 198 个解压后的工作流 JSON 文件
├── workflows-zip/                  # 198 个重新打包的 ZIP 文件（含二进制头部 + MANIFEST）
└── workflows-clipboard/            # 198 个剪贴板格式 JSON 文件（可直接粘贴到 Coze 编辑器）
```

## 关键入口 / 核心模块

- `README.md`：项目主文档，包含使用说明和 Coze 导入教程
- `工作流200+合集分享/`：核心资源目录，包含所有工作流 ZIP 文件
- 工作流命名规则：`Workflow-X<编号>_V<描述>_1-draft-<序号>.zip`

## 运行与预览

- 本项目为纯文档/资源集合，无可运行代码，不支持预览
- `preview_enable = "disabled"`

## 用户偏好与长期约束

- 无特殊约束

## 常见问题和预防

- 工作流 ZIP 文件为 Coze 平台专用格式，不可直接执行
- 图片资源仅用于 README 文档展示
- 剪贴板格式 JSON 用于直接粘贴到 Coze 工作流编辑器（Ctrl+V），需包含顶层 `bounds` 字段和每个 node 的 `_temp.bounds`
- `_temp.bounds.x = meta.position.x - 180`，`_temp.bounds.y = meta.position.y`
- node height: type=21（循环节点）为 138，其他为 112
