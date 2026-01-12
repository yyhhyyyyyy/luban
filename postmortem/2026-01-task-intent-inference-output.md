# Postmortem: Task intent inference output was not uniformly structured

## Summary

Task intent inference is used in the "Create Task" phase to classify user input into a small set of intent kinds. The inference output was not uniformly structured because it included rationale text and could contain non-actionable phrases (e.g., requesting more information), which made downstream rendering and user confirmation inconsistent.

## Severity

**Sev-3 (Medium)**: the task preview UX degraded and the output contract was unstable for consumers.

## Impact

- Inconsistent summaries in the UI.
- Model output sometimes included non-contract fields or meta commentary.
- Prompt generation risked injecting repository-specific conventions into unrelated tasks.

## Detection

- Product requirement update: inference output must be minimal and uniform; prompts must be project-agnostic.

## Root cause

The inference schema allowed a rationale field, encouraging the model to produce varying natural language output. Additionally, the agent prompt template included repository-specific workflow commands, violating the requirement that created tasks are independent of this repository.

## Triggering commits (introduced by)

- `574ec84` implemented task preview and worktree creation.
- `26e1724` stabilized preview output but still allowed rationale in the schema.
- `7611c8b` tailored prompts per intent; the template still contained project-specific workflow phrasing.

## Fix commits (resolved/mitigated by)

- `ba8c800`:
  - removed rationale from the inference JSON schema
  - enforced "JSON only" output with a single `intent_kind` field
  - made agent prompts project-agnostic and removed repository-specific workflow commands

## Reproduction steps

1. Enter ambiguous task text in the Create Task input.
2. Observe that the model output includes rationale or requests for more information, or the prompt contains repository-specific commands unrelated to the target project.

## Resolution

Treat task intent inference as a strict, minimal JSON contract:

- output is always a single JSON object
- output includes only `intent_kind`
- prompts generated after inference can request further context, but inference output must not

## Lessons learned

- Model outputs used as intermediate structured data must have a narrow schema with strong validation.
- Prompt templates must be scoped to the target project, not the host application.

## Prevention / action items

1. Add contract tests that reject extra fields for the intent inference response.
2. Add snapshot tests for prompts per intent to ensure they remain project-agnostic.
3. Consider JSON schema validation at runtime for inference responses.

