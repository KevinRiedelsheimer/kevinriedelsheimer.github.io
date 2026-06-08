---
title: "RAG on SAP BTP, Part 1: Fundamentals"
date: 2026-02-06
draft: false
permalink: /blog/posts/2026/02/06/building-rag-applications-on-sap-btp-part-1-understanding-the-fundamentals/
series:
  key: rag-on-sap-btp
  title: Building RAG Applications on SAP BTP
  part: 1
  label: Understanding the Fundamentals
tags:
  - ai
  - sap
  - rag
  - hana
  - cap
description: An overview of Retrieval Augmented Generation, vector embeddings, and the SAP AI services used to build a RAG application on SAP BTP.
---

# Introduction

> NOTE: This is Part 1 of a 3-part series on building RAG applications with SAP BTP. It covers the fundamentals of RAG, vector embeddings, and the SAP AI services used throughout the series.

Building AI applications that can answer questions using your company's actual data is no longer science fiction. With Retrieval Augmented Generation (RAG), you can connect large language models to business documents, manuals, and knowledge bases so they have the context needed to provide accurate, grounded answers.

This series builds a complete RAG application on SAP Business Technology Platform. It uses SAP HANA Cloud's vector engine for storage, the SAP Cloud SDK for AI to connect to LLMs, and CAP to expose everything through a clean OData service.

## What is Retrieval Augmented Generation?

Retrieval Augmented Generation, or RAG, is a technique that enhances what LLMs can do by pulling in relevant information from a knowledge base. When a user asks a question, you vectorize that query, search through a vector database to find similar documents, and then pass both the query and those retrieved documents to the LLM. The model now has the context it needs to give a more accurate answer.

RAG matters because LLMs have some clear limitations. They are trained on data up to a specific date, so they do not know about anything that happened after that. They also do not know about your company's internal documents or specialized industry information. Without grounding in real data, they can hallucinate and confidently produce incorrect answers. RAG addresses those problems by connecting the model to your actual data.

A practical example makes the flow easier to see:

Imagine someone has a question about a specific machine in a manufacturing plant and needs to perform a repair. The question should be answered with the help of an LLM, but the LLM doesn't know anything about the machines being used in that plant. How can we solve this?

The AI engineer takes all instruction and repair manuals for the machines used within the plant and prepares them for RAG. First, these documents get split into smaller chunks, typically between 200 and 1000 tokens. Chunking matters because embedding models have token limits, and smaller chunks usually produce more precise search results. Each chunk then gets converted into a vector embedding using an embedding model. These embeddings are numerical representations that capture the semantic meaning of the text. The vector embeddings, along with their original text, get inserted into a vector database - the vector engine.

Now when someone asks a question, that query also gets embedded using the same embedding model. And this is crucial, you must use the same model because embeddings from different models exist in different vector spaces and can't be meaningfully compared. With the embedded query, you can now search the vector database to find the chunks most relevant to the question. This isn't just a keyword search. Different mathematical algorithms can be used to find the correct match within the vector space. The most commonly used one is cosine similarity search.

Cosine similarity search measures how similar two vectors are by calculating the angle between them in multi-dimensional space. The result ranges from -1 to 1, where 1 means the vectors point in identical directions (highly similar), 0 means they're perpendicular (unrelated), and -1 means they point in opposite directions. In practice, text embeddings usually have positive values, so you'll typically see similarity scores between 0 and 1.

The vector database returns the top matches with the highest similarity scores. These matching chunks then get passed to the LLM along with the original query. At that point, the model has both the question and the relevant context needed to generate an accurate response about that specific machine repair procedure.

## The Complete RAG Flow Visualized

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PREPARATION PHASE                            │
│                     (Done once upfront)                             │
└─────────────────────────────────────────────────────────────────────┘

    ┌────────────────────────┐
    │  Business Documents    │
    │  (Manuals, PDFs, etc)  │
    └───────────┬────────────┘
                │
                ▼
    ┌────────────────────────┐
    │   Document Chunking    │
    │  Split into 200-1000   │
    │  token pieces          │
    └───────────┬────────────┘
                │
                ▼
    ┌────────────────────────┐
    │   Embedding Model      │
    │  Convert chunks to     │
    │  vector embeddings     │
    └───────────┬────────────┘
                │
                ▼
    ┌────────────────────────────────────────────┐
    │      SAP HANA Cloud Vector Engine          │
    │                                            │
    │  ┌──────────────────────────────────────┐  │
    │  │ Chunk 1: [0.23, 0.45, ..., 0.87]     │  │
    │  │ Chunk 2: [0.12, 0.78, ..., 0.34]     │  │
    │  │ Chunk 3: [0.56, 0.21, ..., 0.92]     │  │
    │  │ ...                                  │  │
    │  └──────────────────────────────────────┘  │
    └────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         QUERY PHASE                                 │
│                   (Happens at runtime)                              │
└─────────────────────────────────────────────────────────────────────┘

    ┌────────────────────────┐
    │     User Query:        │
    │ "How do I repair the   │
    │  CNC-500 machine?"     │
    └───────────┬────────────┘
                │
                ▼
    ┌────────────────────────┐
    │   Embedding Model      │
    │  (Same model as prep!) │
    │  Query → Vector        │
    └───────────┬────────────┘
                │
                ▼
    ┌────────────────────────────────────────────┐
    │   SAP HANA Vector Engine Search            │
    │   Cosine Similarity Calculation            │
    │                                            │
    │   Query: [0.25, 0.43, ..., 0.89]           │
    │   Compare with all stored vectors          │
    │                                            │
    │   Top 3 Matches (highest similarity):      │
    │   Chunk 47: Score 0.94                     │
    │   Chunk 12: Score 0.89                     │
    │   Chunk 33: Score 0.87                     │
    └───────────┬────────────────────────────────┘
                │
                ▼
    ┌────────────────────────────────────────────┐
    │   Retrieve Original Text Chunks            │
    │                                            │
    │  "To repair CNC-500, first disconnect..."  │
    │  "Safety protocol: Always wear gloves..."  │
    │  "Replacement parts for CNC-500 include..."│
    └───────────┬────────────────────────────────┘
                │
                ▼
    ┌────────────────────────────────────────────┐
    │            Prompt Construction             │
    │                                            │
    │  Context: [Retrieved chunks]               │
    │  +                                         │
    │  User Query: "How do I repair..."          │
    └───────────┬────────────────────────────────┘
                │
                ▼
    ┌────────────────────────────────────────────┐
    │        LLM (via Generative AI Hub)         │
    │                                            │
    │  Generates answer using both context       │
    │  and query to provide accurate,            │
    │  grounded response                         │
    └───────────┬────────────────────────────────┘
                │
                ▼
    ┌──────────────────────────┐
    │   Response to User:      │
    │ "To repair the CNC-500,  │
    │  follow these steps:     │
    │  1. Disconnect power..." │
    └──────────────────────────┘
```

## What are Vector Embeddings?

> "Vector embeddings are mathematical representations used to encode objects into multi-dimensional vector space. These embeddings capture the relationships and similarities between objects. SAP HANA Cloud Vector Engine will facilitate the storage and analysis of complex and unstructured vector data(embeddings) into a format that can be seamlessly processed, compared, and utilized to build various intelligent data applications and add more context in case of GenAI scenarios."

> Source: Vectorize your Data: SAP HANA Cloud's Vector Engine for Unified Data Excellence

SAP HANA Cloud is one of the best in-memory databases on the market. It's also the go-to database for CAP applications. SAP added the vector engine to SAP HANA Cloud, which provides a data foundation for a whole new set of natural and intuitive capabilities. You'll use the vector engine to augment large language models with business context, the vector engine stores relevant business data as vector embeddings and searches for similar embeddings based on user prompts. The corresponding text of these vector embeddings then gets passed along to your LLM for accurate, contextual business answers.

The vector engine is built to work seamlessly with generative AI applications. You can store different types of data: text, images, or sound as vector embeddings, which you can then use for RAG requests, natural language processing, image recognition, similarity searches, and recommendation systems.

The SAP HANA Cloud vector engine comes bundled with your SAP HANA Cloud instance on SAP BTP. Within your subaccount, you or the global account admin can assign entitlements to enable the SAP HANA Cloud service plan. Vector embeddings are just another data type in HANA, you can use them in SQL queries and HANA operations just like any other data type.

## Understanding SAP AI Core and Generative AI Hub

### SAP AI Core

SAP AI Core is the core AI service within SAP Business Technology Platform. It provides you with all the tools you need to build AI solutions, and capabilities to manage the execution and operations of AI assets. The focus is on providing a service that's standardized, scalable, and hyperscaler-agnostic. Using SAP AI Core lets you easily integrate into existing SAP solutions and BTP services.

### Generative AI Hub

To leverage large language models (LLMs) or foundation models in your applications, you use the Generative AI Hub on SAP AI Core. You can switch between different models, compare results, and pick the one that works best for your use case. SAP has strict data privacy contracts with LLM providers to ensure your data stays safe.

You can access your deployed models using an API endpoint, the SAP Cloud SDK for AI, or through the user interface in SAP AI Launchpad. The SAP Cloud SDK for AI is available for the major SAP programming languages: Java, ABAP, JavaScript, and Python.

If you're interested in trying it out, check out the [Generative AI Hub trial](https://www.sap.com/products/artificial-intelligence/generative-ai-hub-trial.html).

### SAP AI Launchpad

In SAP AI Launchpad, you can manage your LLM usage, prompt templates, orchestration workflows, grounding, and much more. It's a helpful application for exploring and managing the important generative AI capabilities you'll need for your AI-enabled applications.

#### Understanding Resource Groups and LLM Deployments

SAP AI Launchpad organizes your AI resources using a hierarchical structure built around two key concepts: resource groups and deployments.

**Resource Groups** act as logical containers that help you organize and isolate your AI resources. Think of them as workspaces or environments within SAP AI Core. You might create separate resource groups for different projects, teams, or stages of your development lifecycle (dev, test, prod). Each resource group has its own set of deployments, configurations, and artifacts. This separation ensures that changes in one resource group don't affect others, making access control and resource allocation much easier to manage.

**LLM Deployments** are the actual instances of foundation models that you've made available for use. When you want to use a specific LLM like GPT-4, Claude, or any other model available through SAP Generative AI Hub, you create a deployment for it within a resource group. Each deployment has a unique deployment ID and is associated with a specific model configuration. For example, you might have a GPT-4 deployment for general text generation and a text-embedding-3-small deployment for creating vector embeddings for your RAG use case.

When working with the SAP Cloud SDK for AI, you'll need to reference both the resource group name and the specific deployment (usually by model name or deployment ID) to connect to your desired LLM. This is why in code examples you'll see throughout this series, you'll see the `resourceGroup` parameter, it tells the SDK which resource group contains the deployment you want to use.

## What is the SAP Cloud SDK for AI?

The SAP Cloud SDK for AI lets you connect to SAP AI Core, SAP Generative AI Hub, and the Orchestration service. The SDK is available for different programming languages like Python, JavaScript, Java, and ABAP. This series uses the JavaScript version to complement a CAP OData service with AI functionality.

The SAP Cloud SDK for AI provides four different packages you can use depending on your use case:

- **@sap-ai-sdk/orchestration**: Incorporates generative AI orchestration capabilities into your AI activities
- **@sap-ai-sdk/langchain**: Provides LangChain model clients built on top of the foundation model clients
- **@sap-ai-sdk/foundation-models**: Incorporates generative AI foundation models into your AI activities
- **@sap-ai-sdk/ai-api**: Provides tools to manage your scenarios and workflows in SAP AI Core

Without the SAP Cloud SDK for AI you would need to:

- Handle authentication yourself
- Manage different provider APIs
- Deal with model-specific request formats

The SDK provides a unified interface and integrates directly with SAP AI Core and Generative AI Hub.

## What's next?

Part 2 moves on to the vector store implementation with CAP and HANA. It covers how to:

- Set up connections to SAP AI Core and SAP HANA Cloud
- Chunk documents into meaningful pieces
- Create embeddings using the SAP Cloud SDK for AI
- Store everything in HANA's vector engine

## Resources

- [SAP AI Core Documentation](https://help.sap.com/docs/sap-ai-core)
- [SAP HANA Cloud Vector Engine Guide](https://help.sap.com/docs/hana-cloud-database/sap-hana-cloud-sap-hana-database-vector-engine-guide/)
- [SAP Cloud SDK for AI](https://github.com/SAP/ai-sdk-js)
- [Generative AI Hub Trial](https://www.sap.com/products/artificial-intelligence/generative-ai-hub-trial.html)
