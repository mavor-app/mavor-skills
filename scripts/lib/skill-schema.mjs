import { z } from 'zod';

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SkillFieldSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  description: z.string().optional(),
  required: z.boolean().optional(),
});

export const SkillFrontmatterSchema = z.object({
  name: z.string().regex(SKILL_NAME_PATTERN),
  displayName: z.string(),
  description: z.string(),
  version: z.string().optional().default('0.0.1'),
  category: z.string(),
  runtime: z.object({
    type: z.enum(['llm', 'script', 'hybrid']),
    entry: z.string().optional(),
    executor: z
      .enum(['api-model', 'cli-agent', 'auto'])
      .optional()
      .default('auto'),
    model: z.string().optional(),
  }),
  capabilities: z
    .object({
      tools: z.array(z.string()).optional().default([]),
      permissions: z.array(z.string()).optional().default([]),
    })
    .optional()
    .default({ tools: [], permissions: [] }),
  tags: z.array(z.string()).optional().default([]),
  input: z.record(SkillFieldSchema).optional(),
  output: z.record(SkillFieldSchema).optional(),
});
