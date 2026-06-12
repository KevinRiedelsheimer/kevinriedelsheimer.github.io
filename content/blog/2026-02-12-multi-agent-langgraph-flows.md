---
title: Multi-Agent LangGraph Flows with SAP Cloud SDK for AI
date: 2026-06-15
draft: false
permalink: /blog/posts/2026/06/15/building-multi-agent-flows-with-langgraph-and-the-sap-cloud-sdk-for-ai/
tags:
  - ai
  - ai-agents
  - langgraph
description: A practical walkthrough of building a multi-agent LangGraph code review workflow with SAP Cloud SDK for AI, using specialized reviewers, shared state, and a final lead reviewer.
series:
  key: langgraph-code-review-agents
  title: Code Review Agents with LangGraph
  part: 2
  label: Coordinated Multi-Agent Reviews
---

# Introduction

In my previous post, [A Stateful Code Review Agent with LangGraph and the SAP Cloud SDK for AI](./2026-02-04-first-ai-agent-langgraph.md), I built a single-agent code reviewer. Starting with a single agent is the right place to start because it teaches the fundamentals: explicit state, node-based execution, and using a model-driven tool.

This article is part 2 of a 4-part series. If you have not read [Part 1: A Stateful Code Review Agent with LangGraph and the SAP Cloud SDK for AI](./2026-02-04-first-ai-agent-langgraph.md) yet, start there first.

For this post we stay with the "Code Review" use case. The difference is that we are no longer asking one agent to do everything.

Instead, we split the review across specialized agents and let LangGraph coordinate how information flows between them. If you have looked at the [Code-based Agents CodeJam](https://github.com/SAP-samples/codejam-code-based-agents/tree/main/exercises/JavaScript) JavaScript exercises for multi-agent systems, the structure here should feel familiar: configuration stays in code, state is explicit, nodes do one job each, and a final synthesis node combines the results. The pattern is the same, but the domain here is reviewing pull requests rather than an investigation workflow.

From here, the next planned step in the series is [GitHub MCP for LangGraph Code Review Agents](), where the same workflow is wired into real pull requests. After that comes [Enhancing LangGraph Code Review Agents with Skills](), which focuses on reusable guidance and domain-specific behavior.

## When multi-agent flows make sense

Multi-agent systems are useful when one agent would otherwise need too many responsibilities at once. It generally makes sense to have single-purpose agents to keep the principal of seperation of concerns applied.

That usually shows up when:

- different parts of the task need different prompts or evaluation criteria
- intermediate results need to be passed between steps
- you want clearer observability into which step produced which finding
- one final answer depends on several narrower review passes

A security reviewer should focus on different concerns than a performance reviewer, and neither should be responsible for writing the final developer-facing summary.

If your workflow doesn't require multiple agents coordinating a more complex use case, it is best to stay with a single specialized agent. A multi-agent system can quickly become cost-intensive, so understanding if a use case requires a multi-agent system is important.

## What we are building

We will build a multi-agent code review flow with four nodes:

1. A **security reviewer** that looks for unsafe code paths, missing validation, and secret handling issues
2. A **performance reviewer** that looks for inefficient loops, repeated work, and obvious scaling risks
3. A **maintainability reviewer** that looks for readability, duplication, and structural problems
4. A **lead reviewer** that combines all findings into one final review comment

This is a small, explicit workflow. Each agent has one responsibility, and LangGraph defines the execution order.

## Keep configuration in code

One of the best ideas in LangGraph is that agent configuration lives next to the code that uses it.

To use TypeScript over JavaScript makes sense in such a scenario.
It keeps the orchestration readable, type-safe, and refactorable by expressing it directly in TypeScript.

Create `src/agentConfigs.ts`:

```typescript
export const AGENT_CONFIGS = {
  securityReviewer: {
    systemPrompt: `You are a senior application security reviewer.
Focus only on authentication, authorization, input validation, secret handling,
injection risks, insecure defaults, and unsafe data access.
Return concrete findings and recommended fixes.`,
  },
  performanceReviewer: {
    systemPrompt: `You are a senior performance reviewer.
Focus only on repeated work, unnecessary database calls, blocking operations,
memory-heavy transformations, and obvious scalability bottlenecks.
Return concrete findings and recommended fixes.`,
  },
  maintainabilityReviewer: {
    systemPrompt: `You are a senior maintainability reviewer.
Focus only on readability, duplication, naming, modularity, and long-term
supportability. Return concrete findings and recommended fixes.`,
  },
  leadReviewer: {
    systemPrompt: (
      securityFindings: string,
      performanceFindings: string,
      maintainabilityFindings: string,
    ) => `You are the lead code reviewer.
You have received specialist findings from three reviewers.

SECURITY FINDINGS:
${securityFindings}

PERFORMANCE FINDINGS:
${performanceFindings}

MAINTAINABILITY FINDINGS:
${maintainabilityFindings}

Produce one concise final review comment.
Group findings by priority, remove overlap, and keep the advice actionable.`,
  },
};
```

Two things matter here:

- each specialist has a narrow system prompt
- the lead reviewer gets prior outputs injected through a prompt function

That second point is one of the most useful multi-agent patterns in LangGraph. Earlier node outputs become inputs to later nodes through shared state.

## Defining the shared state

Multi-agent systems stay manageable only when state is explicit.

Create `src/types.ts`:

```typescript
import { Annotation } from "@langchain/langgraph";

export const AgentState = Annotation.Root({
  pullRequestTitle: Annotation<string>,
  codeSnippet: Annotation<string>,
  securityFindings: Annotation<string | undefined>({
    reducer: (_, update) => update,
    default: () => undefined,
  }),
  performanceFindings: Annotation<string | undefined>({
    reducer: (_, update) => update,
    default: () => undefined,
  }),
  maintainabilityFindings: Annotation<string | undefined>({
    reducer: (_, update) => update,
    default: () => undefined,
  }),
  finalReview: Annotation<string | undefined>({
    reducer: (_, update) => update,
    default: () => undefined,
  }),
  messages: Annotation<Array<{ role: string; content: string }>>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
});

export type AgentStateType = typeof AgentState.State;
```

This state shape is deliberately simple, and that is exactly what you want.

- `pullRequestTitle` and `codeSnippet` are the required inputs
- each specialist writes to its own field
- `finalReview` is only set by the lead reviewer
- `messages` gives you a simple execution trail for debugging

## Connecting the model

To stay close to the single-agent post, we will keep using the SAP Cloud SDK for AI.

Create `src/llm.ts`:

```typescript
import "dotenv/config";
import { ChatOpenAI } from "@sap-ai-sdk/langchain";

export const llm = new ChatOpenAI({
  modelName: process.env.MODEL_NAME!,
  temperature: 0.2,
});
```

The lower temperature helps with consistency. In a multi-agent workflow, stable output matters more than stylistic variety.

## Building the workflow class

We will use a workflow class to keep node implementations and graph construction together. That is a good fit here as well.

Create `src/codeReviewWorkflow.ts`:

```typescript
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { END, START, StateGraph } from "@langchain/langgraph";
import { AGENT_CONFIGS } from "./agentConfigs.js";
import { llm } from "./llm.js";
import { AgentState } from "./types.js";
import type { AgentStateType } from "./types.js";

export class CodeReviewWorkflow {
  private graph;

  constructor() {
    this.graph = this.buildGraph();
  }

  private buildGraph() {
    const workflow = new StateGraph(AgentState);

    workflow
      .addNode("security_reviewer", this.securityReviewerNode.bind(this))
      .addNode("performance_reviewer", this.performanceReviewerNode.bind(this))
      .addNode(
        "maintainability_reviewer",
        this.maintainabilityReviewerNode.bind(this),
      )
      .addNode("lead_reviewer", this.leadReviewerNode.bind(this))
      .addEdge(START, "security_reviewer")
      .addEdge("security_reviewer", "performance_reviewer")
      .addEdge("performance_reviewer", "maintainability_reviewer")
      .addEdge("maintainability_reviewer", "lead_reviewer")
      .addEdge("lead_reviewer", END);

    return workflow;
  }
}
```

Notice the repeated `.bind(this)`. When you pass a class method as a LangGraph node, JavaScript otherwise loses the class instance context.

## Implementing the specialist reviewers

Each specialist follows the same pattern: read from state, invoke the model with a narrow prompt, then write one result back to state.

```typescript
  private async securityReviewerNode(
    state: AgentStateType,
  ): Promise<Partial<AgentStateType>> {
    const response = await llm.invoke([
      new SystemMessage(AGENT_CONFIGS.securityReviewer.systemPrompt),
      new HumanMessage(
        `Pull request: ${state.pullRequestTitle}\n\nCode:\n${state.codeSnippet}`,
      ),
    ]);

    const findings = response.content as string;

    return {
      securityFindings: findings,
      messages: [
        {
          role: "assistant",
          content: `Security reviewer finished:\n${findings}`,
        },
      ],
    };
  }

  private async performanceReviewerNode(
    state: AgentStateType,
  ): Promise<Partial<AgentStateType>> {
    const response = await llm.invoke([
      new SystemMessage(AGENT_CONFIGS.performanceReviewer.systemPrompt),
      new HumanMessage(
        `Pull request: ${state.pullRequestTitle}\n\nCode:\n${state.codeSnippet}`,
      ),
    ]);

    const findings = response.content as string;

    return {
      performanceFindings: findings,
      messages: [
        {
          role: "assistant",
          content: `Performance reviewer finished:\n${findings}`,
        },
      ],
    };
  }

  private async maintainabilityReviewerNode(
    state: AgentStateType,
  ): Promise<Partial<AgentStateType>> {
    const response = await llm.invoke([
      new SystemMessage(AGENT_CONFIGS.maintainabilityReviewer.systemPrompt),
      new HumanMessage(
        `Pull request: ${state.pullRequestTitle}\n\nCode:\n${state.codeSnippet}`,
      ),
    ]);

    const findings = response.content as string;

    return {
      maintainabilityFindings: findings,
      messages: [
        {
          role: "assistant",
          content: `Maintainability reviewer finished:\n${findings}`,
        },
      ],
    };
  }
```

This is where multi-agent systems start to pay off. Each node is small, readable, and specialized. The prompts are easier to maintain because each agent has one job instead of one giant blended instruction set.

## Adding the lead reviewer

The final node does not search for new issues. It synthesizes what the specialists already found.

```typescript
  private async leadReviewerNode(
    state: AgentStateType,
  ): Promise<Partial<AgentStateType>> {
    const response = await llm.invoke([
      new SystemMessage(
        AGENT_CONFIGS.leadReviewer.systemPrompt(
          state.securityFindings ?? "No security issues found.",
          state.performanceFindings ?? "No performance issues found.",
          state.maintainabilityFindings ?? "No maintainability issues found.",
        ),
      ),
      new HumanMessage(
        `Create the final review comment for ${state.pullRequestTitle}.`,
      ),
    ]);

    const finalReview = response.content as string;

    return {
      finalReview,
      messages: [
        {
          role: "assistant",
          content: `Lead reviewer finished:\n${finalReview}`,
        },
      ],
    };
  }
```

Earlier nodes gather or refine information, and a final node turns those partial results into the answer you actually want to present.

## Running the workflow

All that is left now is a kickoff method and a small entry point.

Add this method to `CodeReviewWorkflow`:

```typescript
  async kickoff(inputs: {
    pullRequestTitle: string;
    codeSnippet: string;
  }): Promise<string> {
    const app = this.graph.compile();

    const result = await app.invoke({
      pullRequestTitle: inputs.pullRequestTitle,
      codeSnippet: inputs.codeSnippet,
      messages: [],
    });

    return result.finalReview ?? "Review completed but no final review was generated.";
  }
```

Then create `src/main.ts`:

```typescript
import "dotenv/config";
import { CodeReviewWorkflow } from "./codeReviewWorkflow.js";

async function main() {
  const workflow = new CodeReviewWorkflow();

  const result = await workflow.kickoff({
    pullRequestTitle: "Harden user import flow",
    codeSnippet: `
async function importUsers(users, db) {
  const imported = [];

  for (const user of users) {
    const existing = await db.query(
      "SELECT * FROM users WHERE email = '" + user.email + "'",
    );

    if (!existing.length) {
      await db.query(
        "INSERT INTO users(name, email) VALUES ('" + user.name + "', '" + user.email + "')",
      );
    }

    imported.push(user.name + " <" + user.email + ">");
  }

  return imported;
}
`,
  });

  console.log("\nFinal Review\n");
  console.log(result);
}

main();
```

Run it with:

```bash
npx tsx src/main.ts
```

This example gives every reviewer something real to comment on: unsafe string interpolation for SQL, repeated database work inside a loop, and code that could be clearer to maintain.

## Where tools fit into this design

The single-agent post already showed how the model can decide when to use tools. That idea still applies here, but now tool access can be scoped per specialist.

For example:

- the security reviewer could bind a secrets scanning or dependency risk tool
- the performance reviewer could bind a complexity analysis tool
- the maintainability reviewer could bind a linting or duplication helper

That gives you a cleaner least-privilege setup than one generalist agent having access to every tool.

```typescript
const securityLlm = llm.bindTools([scanSecretsTool, dependencyRiskTool]);
const performanceLlm = llm.bindTools([analyzeComplexityTool]);
```

The real engineering payoff of multi-agent systems is not just more prompts, but better speration of responsibility around tools and context. The seperation of concerns makes observability of these agent systems easier as it is clearer on who did what at a specific time.

## Production considerations

Before putting a flow like this into production, tighten up a few things.

### 1. Keep agents narrow

If two agents have nearly identical prompts, you probably do not need two agents.

### 2. Keep state explicit

Do not hide important coordination inside prompt text if it belongs in typed state.

```typescript
// Bad — coordination buried in prompt string, invisible to the graph
function reviewNode(state: Record<string, unknown>) {
  const prompt = `The previous agent flagged ${state.rawText} as risky. Review it.`;
  // ...
}

// Good — coordination lives in typed state, visible and testable
interface AgentState {
  rawText: string;
  riskFlagged: boolean;
  riskReason: string;
}

function reviewNode(state: AgentState) {
  if (state.riskFlagged) {
    // The graph can branch, log, or escalate here — no string parsing needed.
    // riskReason is already a typed field, not something extracted from a prompt.
    console.log(`Escalating: ${state.riskReason}`);
  }
}
```

### 3. Prefer explicit graphs over clever routing

Start with sequential or clearly bounded flows. Add dynamic routing only when the problem really needs it.

### 4. Log intermediate outputs

Most multi-agent failures are coordination failures. You want to know which node produced which output.

### 5. Validate node outputs

If a downstream node depends on structured content, use schema validation instead of trusting free-form text blindly.

Without validation, a malformed LLM response silently propagates through your graph and fails far from the source. Schema validation catches this at the boundary:

```typescript
import { z } from "zod";

const ReviewResult = z.object({
  approved: z.boolean(),
  issues: z.array(z.string()),
  confidence: z.number(),
});

type ReviewResult = z.infer<typeof ReviewResult>;

// Node validates its own output before passing it downstream
const result: ReviewResult = ReviewResult.parse(llmStructuredOutput);
```

LangGraph.js integrates well with Zod. Define your state schema once and use `.parse()` at each node boundary so invalid output fails fast at the source rather than silently breaking a downstream node.

## When to stay with a single agent

Do not force a multi-agent design when the simpler design is already good enough.

Stay with a single agent when:

- the task is short and mostly linear
- the same prompt and tools are sufficient end to end
- you do not need intermediate review passes
- extra orchestration would add more complexity than value

The goal is not to maximize the number of agents. The goal is to make the workflow easier to reason about and more reliable to operate.

## Wrapping up

The key point is simple: you do not need a new use case to explain multi-agent LangGraph systems. The same code-review example from the single-agent post already becomes more interesting once you break it into specialized reviewers with a final synthesis step.

Some key findings on LangGraph Typescript agents:

- keep configuration in code
- pass information through explicit state
- give each node one job
- let later nodes synthesize earlier outputs

If the previous post showed how to build one agent that can review code, this post shows how to scale that idea into a small team of specialists without turning the workflow into a black box.

The next step in the series is [GitHub MCP for LangGraph Code Review Agents](./2026-02-14-github-mcp-code-review.md). That post moves from orchestration alone to practical integration, so the agents can inspect pull requests and publish review output where developers actually work.

## Resources

- [LangGraph.js Documentation](https://langchain-ai.github.io/langgraphjs/)
- [SAP Cloud SDK for AI](https://github.com/SAP/ai-sdk-js)
- [SAP-samples CodeJam Code-Based Agents](https://github.com/SAP-samples/codejam-code-based-agents/tree/main/exercises/JavaScript)
- [LangChain Tool Calling](https://js.langchain.com/docs/modules/agents/tools/)
