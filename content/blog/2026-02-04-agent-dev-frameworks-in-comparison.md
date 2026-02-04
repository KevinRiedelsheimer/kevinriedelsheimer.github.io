---
title: Confused by all the Agent Frameworks - Don't be anymore!
date: 2026-02-04
draft: true
tags:
  - AI
  - AI Agents
  - LangGraph
  - LangChain
  - CrewAI
  - Google ADK
  - AutoGen
description: In this blog post I want to talk about the different agent frameworks out there and how they can be compared on a higher level.
---

Artificial Intelligence is such a vast and huge beast with switching hype topics every couple of months. For someone who is coming into this world it can be overwhelming and discouraging. If you feel like this, don't worry, you are not alone. I do feel the same way every now and then. This feeling came to me just recently when I wanted to build a new workshop around AI Agents and Agent orchestration. Let's dive into some of my findings from my research.

## Where the heck do I get started?

TL;DR

I wrote my first agent with LangGraph, and you might ask why - Simply! It was the only one I was familiar with. Of course I've heard about many other frameworks out there but I stuck to what I worked with in the past. This is absolutely fine but probably not sufficient going forward with AI development.

The first challenge is understanding what's out there. There are so many different frameworks from different companies, each framework seems to be the best solution for building intelligent agents. Some of these examples are LangGraph, AutoGen, CrewAI, Google ADK, Semantic Kernel, and many more.

For me I wanted to understand what the strengths, weaknesses, and use cases are around these frameworks. Asking the right questions should help narrow your options. Do you want to build a single autonomous agent that needs to reason through tasks? Do you need multiple specialized agents collaborating on a problem? Are you working within a set ecosystem like Microsoft, Google Cloud or AWS? What programming language do you want to use for your agents?

## What are AI agents?

Before we dive into the different frameworks and their specifics, let's talk about what an AI agent is. The basic idea behind an agent is that it is a piece of software allowing an LLM to use different types of tools. LLMs are amazing in understanding natural language and producing natural language to react on given input prompts. If you look at LLMs, they are the brain of the operation but we need a body to do the hard labor. This is where agents come into play. Agents allow the LLM to access different resources and tools to execute tasks, gather information or trigger other agents to do some work with so called agent workflows.

The LLMs can directly interact with an agent or multiple agents if they are known to the LLM. You can make agents known to an LLM through different types of tools like an agent supported client or a cloud landscape which interfaces with the LLM.

The agents can then access different tools, resources or other agents to complete their task. In the past this step could be cumbersome because there was no standard interfacing protocol defining on how an agent would interact with the before-mentioned parts. To solve this, Anthropic created a protocol which should standardize the interfaces. The Model-Context-Protocol (MCP) was born.

MCP gives you a highly standardized protocol that allows you to create a clear interface implementation giving the agents a set of functions to interact with. Because this protocol is standardized and highly adapted by the industry there is a vast amount of MCP Servers (the implementation of the protocol) out there, ready to be consumed by your army of agents.

The diagram below gives a high-level overview on how MCP works:

![how-mcp-works](../images/2026/2026-02-04-agent-dev-frameworks-in-comparison/how_mcp_works.png)

## What are the core capabilities of an agent framework

Before we dive into specifics of each framework, let's establish a common understanding on what the key capabilities are of such a framework.

The essence of every agent frameworks are:

**1. Tool/Function/Resource calling**: The ability for agents to interact with external systems, APIs, databases and other resources.
**2. State & Memory Management**: Keep track of conversation history, intermediate/final results, and context across multiple steps. Especially important for complex agent workflows.
**3. Orchestration**: Providing a framework to coordinate the flow of tasks, whether it is multiple agents working together or if it is a single agent's reasoning loop.

Every framework we'll discuss implements these capabilities differently, and understanding these differences is the key to choosing the right tool for your project.

## Comparing major agent frameworks

## Wrapping up

What a post!

## Footnotes

1. Do you like footnotes?
1. Everybody does, fool!
