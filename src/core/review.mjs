import { z } from "zod";
import { ERROR_CODE } from "./errors.mjs";

export const REVIEW_JSON_SCHEMA = Object.freeze({
  additionalProperties: false,
  properties: {
    blockedReason: { maxLength: 1_200, type: "string" },
    checks: {
      items: {
        additionalProperties: false,
        properties: {
          evidence: { maxLength: 1_000, type: "string" },
          name: { maxLength: 200, type: "string" },
          status: { enum: ["passed", "failed", "not_run"], type: "string" }
        },
        required: ["name", "status", "evidence"],
        type: "object"
      },
      maxItems: 12,
      type: "array"
    },
    findings: {
      items: {
        additionalProperties: false,
        properties: {
          evidence: { maxLength: 1_500, minLength: 1, type: "string" },
          line: { minimum: 0, type: "integer" },
          path: { maxLength: 500, type: "string" },
          priority: { enum: ["P0", "P1", "P2", "P3"], type: "string" },
          suggestion: { maxLength: 1_000, minLength: 1, type: "string" },
          title: { maxLength: 300, minLength: 1, type: "string" }
        },
        required: ["priority", "path", "line", "title", "evidence", "suggestion"],
        type: "object"
      },
      maxItems: 8,
      type: "array"
    },
    summary: { maxLength: 1_200, minLength: 1, type: "string" },
    verdict: { enum: ["PASS", "REVISE", "BLOCKED"], type: "string" }
  },
  required: ["verdict", "summary", "blockedReason", "findings", "checks"],
  type: "object"
});

const findingSchema = z.object({
  evidence: z.string().min(1).max(1_500),
  line: z.number().int().min(0),
  path: z.string().max(500),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  suggestion: z.string().min(1).max(1_000),
  title: z.string().min(1).max(300)
}).strict();

const checkSchema = z.object({
  evidence: z.string().max(1_000),
  name: z.string().min(1).max(200),
  status: z.enum(["passed", "failed", "not_run"])
}).strict();

export const reviewSchema = z.object({
  blockedReason: z.string().max(1_200),
  checks: z.array(checkSchema).max(12),
  findings: z.array(findingSchema).max(8),
  summary: z.string().min(1).max(1_200),
  verdict: z.enum(["PASS", "REVISE", "BLOCKED"])
}).strict().superRefine((review, context) => {
  if (review.verdict === "PASS" && review.findings.length) {
    context.addIssue({
      code: "custom",
      message: "PASS cannot include actionable findings.",
      path: ["findings"]
    });
  }
  if (review.verdict === "REVISE" && review.findings.length === 0) {
    context.addIssue({
      code: "custom",
      message: "REVISE requires at least one finding.",
      path: ["findings"]
    });
  }
  if (review.verdict === "BLOCKED" && !review.blockedReason.trim()) {
    context.addIssue({
      code: "custom",
      message: "BLOCKED requires a reason.",
      path: ["blockedReason"]
    });
  }
  if (review.verdict !== "BLOCKED" && review.blockedReason.trim()) {
    context.addIssue({
      code: "custom",
      message: "Only BLOCKED may include a blocked reason.",
      path: ["blockedReason"]
    });
  }
});

export function parseReview(value) {
  const parsed = reviewSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0]?.message || "Reviewer output failed validation.";
  return {
    blockedReason: `Reviewer output did not satisfy Duet's protocol: ${issue}`,
    checks: [],
    findings: [],
    protocolError: ERROR_CODE.REVIEW_PROTOCOL_INVALID,
    summary: "The review could not be validated.",
    verdict: "BLOCKED"
  };
}

export function formatFindings(findings) {
  return findings.map((finding) => {
    const location = finding.path
      ? `${finding.path}${finding.line ? `:${finding.line}` : ""}`
      : "repository";
    return `- [${finding.priority}] ${location} — ${finding.title}\n  Evidence: ${finding.evidence}\n  Minimal fix: ${finding.suggestion}`;
  }).join("\n");
}

export function formatReview(review) {
  const sections = [review.summary];
  if (review.blockedReason) sections.push(`Blocked: ${review.blockedReason}`);
  if (review.findings.length) sections.push(`Findings:\n${formatFindings(review.findings)}`);
  if (review.checks.length) {
    sections.push(`Checks:\n${review.checks.map((check) =>
      `- ${check.name}: ${check.status}${check.evidence ? ` — ${check.evidence}` : ""}`
    ).join("\n")}`);
  }
  return sections.join("\n\n");
}
