---
name: save-skill
description: Save what we just did as a reusable skill. Use at the end of a session to capture a workflow, technique, or process that you want to repeat.
disable-model-invocation: true
---

The user wants to save what was done in this session as a reusable Claude Code skill.

## Steps

1. **Review the session**: Look at what was accomplished — the tools used, files modified, commands run, and the overall workflow.

2. **Identify the reusable pattern**: What was the core workflow or technique? Strip away project-specific details and extract the generalizable process.

3. **Ask the user**:
   - "What should this skill be called?" (suggest a name based on what was done)
   - "Should this be a project skill (.claude/skills/) or a personal skill (~/.claude/skills/)?"
   - "Should only you be able to invoke it, or should Claude use it automatically when relevant?"

4. **Create the skill**: Write the SKILL.md file with:
   - YAML frontmatter: name, description, and `disable-model-invocation: true` if user-only
   - Clear step-by-step instructions based on what was done
   - Use `$ARGUMENTS` for any variable parts (file names, branch names, etc.)
   - Keep it under 500 lines — move detailed reference to supporting files if needed

5. **Verify**: Show the user the created skill and explain how to invoke it with `/skill-name`.

## Example output

If the session involved setting up a new API endpoint:

```
.claude/skills/new-endpoint/SKILL.md
```

```yaml
---
name: new-endpoint
description: Scaffold a new REST API endpoint with tests and documentation
disable-model-invocation: true
---

Create a new API endpoint for $ARGUMENTS:

1. Create the route handler in src/routes/
2. Add request/response validation schemas
3. Write integration tests
4. Update the API documentation
5. Run tests to verify
```

## Important

- Don't include project-specific file paths — use patterns like "src/routes/" not "/Users/alice/myproject/src/routes/"
- Include any commands that should be run (test, lint, build)
- If the workflow has multiple variants, use $ARGUMENTS to parameterize
