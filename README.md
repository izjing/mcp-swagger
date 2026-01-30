# mcp-swagger-schema

一个 MCP (Model Context Protocol) 服务器，用于查询 Swagger 规范中的接口 schema。

## 功能

- 根据 API 路径获取请求和响应的 JSON Schema
- 自动解析 `$ref` 引用
- 支持路径参数匹配（如 `/api/users/{id}`）
- 内置缓存机制

## 快速开始

### 第一步：找到你的 Swagger JSON 地址

你需要先获取项目的 Swagger/OpenAPI 规范地址，通常是类似这样的 URL：
- `https://your-api.com/v3/api-docs`

### 第二步：配置 MCP 服务器
在你的 MCP 配置文件中（通常是 `.mcp/config.json` 或类似的配置），添加如下配置：
```json
{
  "mcpServers": {
    "swagger-schema": {
      "command": "npx",
      "args": ["-y", "mcp-swagger-schema"],
      "env": {
        "SWAGGER_SPEC_URL": "替换成你的swagger地址"
      }
    }
  }
}
```


## ⚠️ 常见问题：找不到 npx 命令

如果启动失败，提示找不到 `npx`，按以下步骤解决：

### 步骤 1：打开终端，运行以下命令

```bash
which npx
```

你会看到类似这样的输出：
```
/Users/你的用户名/.nvm/versions/node/v20.0.0/bin/npx
```

### 步骤 2：复制 bin 目录路径

把上面输出的路径，去掉最后的 `/npx`，得到 bin 目录：
```
/Users/你的用户名/.nvm/versions/node/v20.0.0/bin
```

### 步骤 3：修改配置，添加 PATH

```json
{
  "mcpServers": {
    "swagger-schema": {
      "command": "npx",
      "args": ["-y", "mcp-swagger-schema"],
      "env": {
        "SWAGGER_SPEC_URL": "替换成你的swagger地址",
        "PATH": "步骤2得到的路径:/usr/bin:/bin"
      }
    }
  }
}
```

例如：
```json
{
  "mcpServers": {
    "swagger-schema": {
      "command": "npx",
      "args": ["-y", "mcp-swagger-schema"],
      "env": {
        "SWAGGER_SPEC_URL": "https://api.example.com/swagger.json",
        "PATH": "/Users/zhangsan/.nvm/versions/node/v20.0.0/bin:/usr/bin:/bin"
      }
    }
  }
}
```

---

## 使用方法

配置完成后，在对话中直接说：

> 获取 /api/users 接口的 schema

AI 会调用工具返回该接口的请求参数和响应结构。

### 工具参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| `path` | ✅ | 接口路径，如 `/api/users` |
| `method` | ❌ | HTTP 方法（get/post/put/delete），不填会自动选择 |

### 返回示例

```json
{
  "found": true,
  "path": "/api/users",
  "method": "post",
  "summary": "创建用户",
  "request": {
    "body": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "email": { "type": "string" }
      }
    }
  },
  "response": {
    "type": "object",
    "properties": {
      "id": { "type": "integer" },
      "name": { "type": "string" }
    }
  }
}
```

---

## 环境变量

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `SWAGGER_SPEC_URL` | ✅ | Swagger/OpenAPI JSON 规范的 URL |
| `SWAGGER_CACHE_TTL_MS` | ❌ | 缓存过期时间（毫秒），默认 60000 |

## License

MIT
