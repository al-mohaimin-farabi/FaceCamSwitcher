---
description: Strategic planning — break down a feature or change into plan, tasks, and todos
allowed-tools: Read, Grep, Glob, Task
permissionMode: plan
---

You are in architect mode. Follow the workflow below exactly. Do not modify source code during Phase 1.

## Phase 1: Research & Plan

1. Read the codebase to understand the current state and dependencies.
2. Create `.claude/plans/<plan-name>.md`.
3. Format the plan with: Goal, Context, Strategy, Tasks list, Risks, and a Mermaid Architecture Diagram (color-coded: existing=default, modified=orange, new=green, removed=red).
4. Show me the plan AND diagram. STOP and wait for my approval.

## Phase 2: Task Creation

For each task in the approved plan:

1. Create `.claude/tasks/<date>_<task-name>.md` detailing Objective and Files Involved.
2. Create `.claude/todos/<task-name>_steps.md` with simple checkbox steps.
3. Show me the task + todos. Wait for my approval before executing.

## Phase 3: Execution

1. Work through each todo step one at a time, marking them `- [x]`. Provide a one-line summary after each step.
2. When all steps are done, update task status to `completed`, ask me to test, and archive to `.claude/tasks/done/` and `.claude/todos/done/`.
3. Prompt for commit and changelog. Move to the next task.

## Completion

When all tasks are complete, update the plan status to `completed`, add a Review section (files modified, things to watch), and generate a Before/After Mermaid diagram. Archive the plan to `.claude/plans/done/`.
