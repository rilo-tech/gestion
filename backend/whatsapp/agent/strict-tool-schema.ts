export type StrictSchemaIssue = {
  toolName: string;
  path: string;
  problem: string;
  missing?: string[];
};

export function reqString(): Record<string, unknown> {
  return { type: 'string' };
}

export function reqNumber(): Record<string, unknown> {
  return { type: 'number' };
}

export function reqInteger(): Record<string, unknown> {
  return { type: 'integer' };
}

export function reqBoolean(): Record<string, unknown> {
  return { type: 'boolean' };
}

export function nString(): Record<string, unknown> {
  return { type: ['string', 'null'] };
}

export function nNumber(): Record<string, unknown> {
  return { type: ['number', 'null'] };
}

export function nInteger(): Record<string, unknown> {
  return { type: ['integer', 'null'] };
}

export function nBoolean(): Record<string, unknown> {
  return { type: ['boolean', 'null'] };
}

export function nArray(items: Record<string, unknown>): Record<string, unknown> {
  return { type: ['array', 'null'], items };
}

export function strictObject(properties: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(properties);
  return {
    type: 'object',
    properties,
    required: keys,
    additionalProperties: false,
  };
}

function isObjectSchema(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function propertyKeys(properties: unknown): string[] {
  if (!isObjectSchema(properties)) return [];
  return Object.keys(properties);
}

function requiredKeys(required: unknown): string[] {
  return Array.isArray(required) ? required.map((row) => String(row)) : [];
}

export function validateStrictJsonSchema(
  schema: unknown,
  toolName: string,
  path = '$.parameters'
): StrictSchemaIssue[] {
  const issues: StrictSchemaIssue[] = [];
  if (!isObjectSchema(schema)) {
    issues.push({ toolName, path, problem: 'schema must be an object' });
    return issues;
  }

  const type = schema.type;
  const types = Array.isArray(type) ? type : type ? [type] : [];

  if (types.includes('object') || (types.length === 0 && isObjectSchema(schema.properties))) {
    const props = propertyKeys(schema.properties);
    const req = requiredKeys(schema.required);

    if (!isObjectSchema(schema.properties)) {
      issues.push({ toolName, path: `${path}.properties`, problem: 'object must declare properties' });
    }
    if (!Array.isArray(schema.required)) {
      issues.push({ toolName, path: `${path}.required`, problem: 'object must declare required array' });
    } else {
      const missing = props.filter((key) => !req.includes(key));
      const extra = req.filter((key) => !props.includes(key));
      if (missing.length) {
        issues.push({
          toolName,
          path: `${path}.required`,
          problem: 'required must include every property key',
          missing,
        });
      }
      if (extra.length) {
        issues.push({
          toolName,
          path: `${path}.required`,
          problem: 'required contains keys not present in properties',
          missing: extra,
        });
      }
    }
    if (schema.additionalProperties !== false) {
      issues.push({
        toolName,
        path,
        problem: 'object must set additionalProperties: false',
      });
    }

    for (const key of props) {
      const child = (schema.properties as Record<string, unknown>)[key];
      issues.push(...validateStrictJsonSchema(child, toolName, `${path}.properties.${key}`));
    }
  }

  if (types.includes('array') || schema.items) {
    if (!schema.items) {
      issues.push({ toolName, path: `${path}.items`, problem: 'array must declare items schema' });
    } else {
      issues.push(...validateStrictJsonSchema(schema.items, toolName, `${path}.items`));
    }
  }

  return issues;
}

export function validateStrictToolSchema(tool: {
  name: string;
  parameters: Record<string, unknown>;
}): StrictSchemaIssue[] {
  return validateStrictJsonSchema(tool.parameters, tool.name, '$.parameters');
}

export function normalizeStrictToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      const normalized = value
        .map((item) =>
          isObjectSchema(item) ? normalizeStrictToolArgs(item as Record<string, unknown>) : item
        )
        .filter((item) => item !== null && item !== undefined);
      if (normalized.length) out[key] = normalized;
      continue;
    }
    if (isObjectSchema(value)) {
      const nested = normalizeStrictToolArgs(value as Record<string, unknown>);
      if (Object.keys(nested).length) out[key] = nested;
      continue;
    }
    out[key] = value;
  }
  return out;
}
