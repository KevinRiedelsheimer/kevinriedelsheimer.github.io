---
title: A Stateful Code Review Agent with LangGraph and the SAP Cloud SDK for AI
date: 2026-06-08
draft: false
permalink: /blog/posts/2026/02/04/building-your-first-ai-agent-with-langgraph-and-the-sap-cloud-sdk-for-ai/
tags:
  - ai
  - ai-agents
  - langgraph
  - SAP BTP
description: A practical walkthrough of a LangGraph-based code review agent using SAP Cloud SDK for AI, including tool use, state management, and agent-driven tool selection.
---

# Introduction

AI agents are everywhere these days, but building one that actually works reliably can be tricky. There are tons of frameworks out there: CrewAI, AutoGen, LangGraph, and more. Each of these frameworks have their own approach to agent orchestration, if you want to learn more about the different options and have a clean comparison, check out my blog post about Agent frameworks: [Confused by all the Agent Frameworks - Don't be anymore!](./2026-02-04-agent-dev-frameworks-in-comparison.md).

This post walks through a code review agent built with LangGraph, with an emphasis on letting the model decide when to use tools instead of hard-coding a rigid script.

> NOTE: This post focuses on building a single agent. If you want to take the next step into coordinated specialist agents, I cover that in [Building Multi-Agent LangGraph Flows with SAP Cloud SDK for AI](./2026-02-12-multi-agent-langgraph-flows.md).

## Why LangGraph?

LangGraph takes a different approach compared to other agent frameworks. Instead of hiding the orchestration details from you, it gives you explicit control over state management and workflow execution. This means you write a bit more code upfront, but you get:

- **Complete visibility** - into what data flows between steps
- **Type-safe state management** - with TypeScript
- **Debuggable workflows** - just `console.log(state)` anywhere
- **Testable nodes** - each node is just an async function

Think of it like this: CrewAI is like an automatic transmission, while LangGraph is manual. You have more control, but you need to understand how the gears work.

## What we're building

We'll build a code review agent that can analyze code and suggest improvements. The agent will:

1. Review code snippets for best practices and potential issues
2. Decide on its own when to use tools (like a complexity analyzer)
3. Maintain conversation state as it reviews
4. Provide actionable feedback

What makes this truly "agentic" is that the LLM decides when tools are needed, we're not forcing a predetermined workflow even if we define a state graph with LangGraph. This walkthrough uses SAP Cloud SDK for AI throughout, because it fits well with enterprise use cases on SAP BTP.

## Setting up your project

First, you'll need a TypeScript project with a few dependencies. Here's what you'll need:

```bash
npm init -y
npm install @langchain/langgraph @langchain/core dotenv zod
npm install @sap-ai-sdk/langchain
```

Create a `.env` file with your SAP AI Core credentials:

```bash
AICORE_SERVICE_KEY='{"clientid":"...","clientsecret":"...","url":"..."}'
MODEL_NAME="gpt-4"
RESOURCE_GROUP="your-resource-group"
```

That is enough to run the implementation in this post.

## Understanding agent state in LangGraph

Here's where LangGraph differs from other frameworks. You explicitly define what data flows through your agent workflow. This might seem like extra work, but it makes debugging so much easier.

Create `src/types.ts`:

```typescript
import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  codeSnippet: Annotation<string>,
  reviewResult: Annotation<string | undefined>({
    reducer: (_, update) => update,
    default: () => undefined,
  }),
});

export type AgentStateType = typeof AgentState.State;
```

**What's happening here?**

- `messages`: LangChain's standard message format, it accumulates the conversation history
- `codeSnippet`: The code we're reviewing
- `reviewResult`: The final review output

The beauty of this approach is that TypeScript knows exactly what fields exist at any point in the workflow. No surprises at runtime.

## Why use SAP Cloud SDK for AI?

Before getting into the implementation, it is worth clarifying why SAP Cloud SDK for AI is a strong fit here:

**SAP Cloud SDK for AI gives you:**

- **Enterprise governance**: Audit trails, usage tracking, cost allocation
- **Model flexibility**: Switch between GPT-4, Claude, Llama, Mistral without code changes
- **No API key sprawl**: One credential per subaccount, centrally managed
- **SAP ecosystem integration**: Works seamlessly with CAP, HANA, BTP services
- **Built-in security**: OAuth, credential rotation, no hardcoded keys

For the kind of agent in this post, it keeps the LangGraph logic clean while delegating model access, authentication, and governance to the SAP layer.

## Connecting via SAP Cloud SDK for AI

The SAP Cloud SDK for AI makes it dead simple to connect to LLMs through SAP AI Core. No manual OAuth flows, no API key management; it handles all of that for you.

Create `src/agentCloudSDK.ts`:

```typescript
import "dotenv/config";
import { ChatOpenAI } from "@sap-ai-sdk/langchain";
import type { AgentStateType } from "./types.js";

const llm = new ChatOpenAI({
  modelName: process.env.MODEL_NAME!,
  temperature: 0.3, // Lower for code review - we want consistent, focused feedback
});
```

The SDK automatically reads your credentials from the `AICORE_SERVICE_KEY` environment variable. Temperature is set low (0.3) because code reviews need to be consistent and precise, not creative.

## Building your first agent node

In LangGraph, a node is just an async function. It receives the current state and returns a partial state update. LangGraph handles merging the updates for you.

```typescript
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";

async function reviewerNode(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  console.log("\n🔍 Code Review Agent starting...");

  const messages = [
    new SystemMessage(
      "You are an expert code reviewer. Analyze code for best practices, potential bugs, security issues, and performance concerns. Be constructive and specific.",
    ),
    new HumanMessage(`Please review this code:\n\n${state.codeSnippet}`),
  ];

  const response = await llm.invoke(messages);
  console.log("✅ Review complete");

  return {
    reviewResult: response.content as string,
    messages: [...messages, response],
  };
}
```

Notice we only return the fields we're updating. LangGraph keeps everything else from the previous state intact. This is way cleaner than manually spreading `...state` everywhere.

## Creating the workflow

Now we wire everything together into a state graph:

```typescript
import { StateGraph, END, START } from "@langchain/langgraph";
import { AgentState } from "./types.js";

function buildGraph() {
  const workflow = new StateGraph(AgentState);

  workflow
    .addNode("reviewer", reviewerNode)
    .addEdge(START, "reviewer")
    .addEdge("reviewer", END);

  return workflow.compile();
}

async function main() {
  const app = buildGraph();

  const codeToReview = `
function processUser(user) {
  const data = JSON.parse(user);
  return data.name + ' ' + data.email;
}
  `;

  const initialState: typeof AgentState.State = {
    codeSnippet: codeToReview,
    reviewResult: undefined,
    messages: [],
  };

  const result = await app.invoke(initialState);

  console.log("\n" + "=".repeat(50));
  console.log("Code Review Results:");
  console.log("=".repeat(50));
  console.log(result.reviewResult);
}

main();
```

The flow is simple:

1. Start → Reviewer Node → End

Run it with:

```bash
npx tsx src/agentCloudSDK.ts
```

You should see the LLM identify issues like missing error handling, string concatenation instead of template literals, and lack of input validation.

## Making it truly agentic: Let the LLM decide when to use tools

Calling a tool directly from application code is not especially agentic; it is still just a function call. In a real agent, **the LLM decides** when tools are needed based on the conversation.

The next step is to add a code complexity tool and let the LLM decide when to use it.

### Creating a code analysis tool

Create `src/tools.ts`:

```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const analyzeComplexityTool = tool(
  async ({ code }) => {
    // Simple cyclomatic complexity estimate
    const branches = (code.match(/if|else|for|while|case|\?\:/g) || []).length;
    const functions = (code.match(/function|=>|\bclass\b/g) || []).length;
    const complexity = branches + functions;

    let rating = "Low";
    if (complexity > 10) rating = "High";
    else if (complexity > 5) rating = "Medium";

    return JSON.stringify({
      cyclomaticComplexity: complexity,
      rating,
      recommendation:
        complexity > 10
          ? "Consider breaking this into smaller functions"
          : "Complexity is acceptable",
    });
  },
  {
    name: "analyze_code_complexity",
    description:
      "Analyzes code complexity and provides a cyclomatic complexity score. Use this when you need objective metrics about code structure.",
    schema: z.object({
      code: z.string().describe("The code snippet to analyze"),
    }),
  },
);
```

Notice the `description`: this tells the LLM **when** to use the tool. The LLM reads this and decides: "Do I need complexity metrics for this review?"

### Binding tools to the LLM

Now we bind the tool to our LLM. This is where the magic happens:

```typescript
import { analyzeComplexityTool } from "./tools.js";

const llmWithTools = llm.bindTools([analyzeComplexityTool]);

async function reviewerNode(
  state: AgentStateType,
): Promise<Partial<AgentStateType>> {
  console.log("\n🔍 Code Review Agent starting...");

  const messages = [
    new SystemMessage(
      "You are an expert code reviewer. When reviewing code, you can use the analyze_code_complexity tool to get objective complexity metrics. Use it when the code seems complex or nested.",
    ),
    new HumanMessage(`Please review this code:\n\n${state.codeSnippet}`),
  ];

  // First call - LLM decides if it needs tools
  const response = await llmWithTools.invoke(messages);

  // Check if LLM wants to use tools
  if (response.tool_calls && response.tool_calls.length > 0) {
    console.log("🔧 Agent decided to use complexity analysis tool");

    // Execute the tool
    const toolResult = await analyzeComplexityTool.invoke(
      response.tool_calls[0].args,
    );

    // Give the tool result back to the LLM
    const finalResponse = await llm.invoke([
      ...messages,
      response,
      new ToolMessage({
        content: toolResult,
        tool_call_id: response.tool_calls[0].id,
      }),
    ]);

    return {
      reviewResult: finalResponse.content as string,
      messages: [...messages, response, finalResponse],
    };
  }

  // LLM didn't need tools
  console.log("💭 Agent decided tools weren't needed");
  return {
    reviewResult: response.content as string,
    messages: [...messages, response],
  };
}
```

The LLM:

1. Reads the code
2. Decides: "Is this complex enough to warrant analysis?"
3. Either uses the tool or doesn't
4. Incorporates tool results into its review

Try it with simple vs complex code, and you'll see the agent only calls the tool when it makes sense.

## Key differences from other frameworks

If you're coming from CrewAI or other frameworks, here's what's different:

| Concept       | CrewAI                             | LangGraph                            |
| ------------- | ---------------------------------- | ------------------------------------ |
| Agent         | Agent class with `@tool` decorator | Node function (plain async function) |
| State         | Implicit task context              | Explicit `AgentState` type           |
| Orchestration | YAML config files                  | Code-based StateGraph                |
| Tool calling  | Framework decides when             | LLM decides when (via `bindTools()`) |

LangGraph's philosophy is **code-over-config**. Instead of YAML files defining behavior, you write TypeScript functions. This gives you type safety, IDE support, and complete control over execution flow.

## Wrapping up

We've built a truly agentic code review system that:

✅ Lets the LLM decide when to use tools (not forced workflows)  
✅ Uses SAP Cloud SDK for AI to access models cleanly from LangGraph  
✅ Maintains explicit state through LangGraph  
✅ Provides actionable, context-aware feedback

The key takeaways:

- **Real agents make decisions** - use `bindTools()` to let the LLM choose when tools are needed
- **LangGraph gives you control** - explicit state management means no hidden surprises
- **SAP Cloud SDK for AI keeps integration simple** - model access, credentials, and governance stay out of your agent logic
- **TypeScript makes it solid** - catch state issues at compile time, not runtime

**When to use SAP Cloud SDK for AI:**

- Enterprise applications needing audit trails
- Multi-team environments needing cost allocation
- Regulated industries requiring compliance
- Apps already in the SAP ecosystem

## Open source note

If you want an open source variant later, you do not need to redesign the agent. Keep the LangGraph state, nodes, and tools the same, and swap the model layer for a LangChain-compatible open source backend such as Ollama. In practice, that mostly means replacing the `ChatOpenAI` initialization, pointing it at your local or self-hosted model, and re-testing tool-calling behavior because open source models vary more in how reliably they request tools.

If you want to keep going from here, the next step is [Building Multi-Agent LangGraph Flows with SAP Cloud SDK for AI](./2026-02-12-multi-agent-langgraph-flows.md), where several specialized agents work together on a more complex review workflow.

## Resources

- [LangGraph.js Documentation](https://langchain-ai.github.io/langgraphjs/)
- [SAP Cloud SDK for AI](https://github.com/SAP/ai-sdk-js)
- [SAP Generative AI Hub](https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/generative-ai-hub-in-sap-ai-core-7db524ee75e74bf8b50c167951fe34a5)
- [Ollama](https://ollama.com/)
- [LangChain Tool Calling](https://js.langchain.com/docs/modules/agents/tools/)
