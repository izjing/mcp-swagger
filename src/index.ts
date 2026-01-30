#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

const SWAGGER_URL = process.env.SWAGGER_SPEC_URL || "";

const CACHE_TTL_MS = Number(process.env.SWAGGER_CACHE_TTL_MS || "60000");

let cachedSpec: any = null;
let cachedAt = 0;

async function loadSpec() {
  if (!SWAGGER_URL) {
    throw new Error("SWAGGER_SPEC_URL environment variable is required");
  }
  if (cachedSpec && Date.now() - cachedAt < CACHE_TTL_MS) return cachedSpec;
  const res = await axios.get(SWAGGER_URL, { timeout: 15000 });
  cachedSpec = res.data;
  cachedAt = Date.now();
  return cachedSpec;
}

function decodeJsonPointer(s: string) {
  return s.replace(/~1/g, "/").replace(/~0/g, "~");
}

function getByRef(spec: any, ref: string) {
  if (!ref.startsWith("#/")) throw new Error(`Only local $ref supported: ${ref}`);
  const parts = ref.slice(2).split("/").map(decodeJsonPointer);
  let cur = spec;
  for (const p of parts) cur = cur?.[p];
  return cur;
}

function deref(spec: any, node: any, seen = new Set<string>(), depth = 0): any {
  if (!node || typeof node !== "object") return node;
  if (depth > 40) return node;

  if (typeof node.$ref === "string") {
    const ref = node.$ref;
    if (seen.has(ref)) return { $ref: ref, _note: "circular_ref_detected" };
    seen.add(ref);
    const target = getByRef(spec, ref);
    const merged = { ...target, ...node };
    delete (merged as any).$ref;
    return deref(spec, merged, seen, depth + 1);
  }

  if (Array.isArray(node)) return node.map((x) => deref(spec, x, new Set(seen), depth + 1));

  const out: any = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = deref(spec, v, new Set(seen), depth + 1);
  }
  return out;
}

function matchPath(paths: Record<string, any>, input: string) {
  if (paths[input]) return input;

  const inParts = input.split("/").filter(Boolean);
  for (const p of Object.keys(paths)) {
    const parts = p.split("/").filter(Boolean);
    if (parts.length !== inParts.length) continue;

    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const a = parts[i];
      const b = inParts[i];
      if (a.startsWith("{") && a.endsWith("}")) continue;
      if (a !== b) {
        ok = false;
        break;
      }
    }
    if (ok) return p;
  }
  return null;
}

function pickSuccessResponse(responses: any) {
  return (
    responses?.["200"] ||
    responses?.["201"] ||
    responses?.["202"] ||
    Object.entries(responses || {}).find(([k]) => /^\d+$/.test(k) && k.startsWith("2"))?.[1] ||
    null
  );
}

function isSwagger2(spec: any): boolean {
  return spec.swagger && spec.swagger.startsWith("2.");
}

function getRequestBodySchemaV2(parameters: any[]) {
  const bodyParam = parameters?.find((p: any) => p.in === "body");
  return bodyParam?.schema || null;
}

function getResponseSchemaV2(responses: any) {
  const success = pickSuccessResponse(responses);
  return success?.schema || null;
}

function getJsonSchemaFromContent(content: any) {
  if (!content) return null;
  return content["application/json"]?.schema || content["application/*+json"]?.schema || content["*/*"]?.schema || null;
}

const server = new Server(
  { name: "mcp-swagger-schema", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_api_schema",
        description: "根据接口路径获取 Swagger/OpenAPI 的请求和响应 schema",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "接口路径，如 /api/paymentPackage/updatePaymentPackageMaterialConfig" },
            method: { type: "string", description: "HTTP 方法，可选，如 post/get；不填则自动选一个存在的方法" }
          },
          required: ["path"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "get_api_schema") {
    return { content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }] };
  }

  const { path, method } = request.params.arguments as { path: string; method?: string };

  try {
    const spec = await loadSpec();

    const matched = matchPath(spec.paths || {}, path);
    if (!matched) {
      return { content: [{ type: "text", text: "未在 Swagger(OpenAPI) 中找到该 path" }] };
    }

    const pathItem = spec.paths[matched];
    const m =
      (method || "").toLowerCase() ||
      (["post", "get", "put", "delete", "patch"].find((x) => pathItem?.[x]) ?? null);

    if (!m || !pathItem[m]) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ found: false, matchedPath: matched, availableMethods: Object.keys(pathItem || {}) })
          }
        ]
      };
    }

    const op = pathItem[m];
    const allParameters = [...(pathItem.parameters || []), ...(op.parameters || [])];

    let requestBodySchema: any = null;
    let responseSchema: any = null;
    let parameters: any[] = allParameters;

    if (isSwagger2(spec)) {
      // Swagger 2.0
      requestBodySchema = getRequestBodySchemaV2(allParameters);
      responseSchema = getResponseSchemaV2(op.responses);
      // 过滤掉 body 参数，只保留 query/path/header 参数
      parameters = allParameters.filter((p: any) => p.in !== "body");
    } else {
      // OpenAPI 3.0
      requestBodySchema = getJsonSchemaFromContent(op.requestBody?.content);
      const success = pickSuccessResponse(op.responses);
      responseSchema = getJsonSchemaFromContent(success?.content);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            found: true,
            swaggerUrl: SWAGGER_URL,
            version: isSwagger2(spec) ? "2.0" : "3.x",
            path: matched,
            method: m,
            operationId: op.operationId || null,
            summary: op.summary || op.description || null,
            request: {
              parameters: deref(spec, parameters),
              body: requestBodySchema ? deref(spec, requestBodySchema) : null
            },
            response: responseSchema ? deref(spec, responseSchema) : null
          }, null, 2)
        }
      ]
    };
  } catch (err: any) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }] };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
