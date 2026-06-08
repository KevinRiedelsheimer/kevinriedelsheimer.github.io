---
title: "RAG on SAP BTP, Part 3: Orchestration and Grounding"
date: 2026-02-10
draft: false
permalink: /blog/posts/2026/02/10/building-rag-applications-on-sap-btp-part-3-implementing-the-rag-flow/
series:
  key: rag-on-sap-btp
  title: Building RAG Applications on SAP BTP
  part: 3
  label: Implementing the RAG Flow
tags:
  - ai
  - sap
  - rag
  - hana
  - cap
description: A walkthrough of the orchestration setup, grounding configuration, and CAP service layer for the completed RAG flow.
---

# Introduction

> NOTE: This is Part 3 of a 3-part series. Make sure you've read [Part 1](/blog/2026-02-06-rag-on-sap-btp-part1) and [Part 2](/blog/2026-02-08-rag-on-sap-btp-part2) first.

We've covered the fundamentals of RAG and built our vector store. Now it's time to bring it all together. In this final part, we'll implement the RAG query flow using SAP's orchestration and grounding services, and expose everything through a clean CAP OData service.

## Orchestration service configuration

There are two ways of defining the orchestration service configuration:

1. Use the graphical configurator in SAP AI Launchpad and load it into your code
2. Use a JSON based configuration within code

The orchestration service in SAP AI Core allows you to combine multiple AI capabilities into a single workflow. For RAG use cases, you'll typically configure the model parameters, prompt templating, content filtering, and grounding.

### Option 1: Using SAP AI Launchpad Configuration

In SAP AI Launchpad, you can use the graphical interface to configure your orchestration workflow. This is particularly useful when you want business users or non-technical stakeholders to manage prompt templates and model configurations without touching code.

Once you've configured and saved your orchestration workflow in SAP AI Launchpad, you'll get a configuration ID that you can reference in your code:

```javascript
import { OrchestrationClient } from "@sap-ai-sdk/orchestration";

const orchestrationClient = new OrchestrationClient(
  {
    configurationId: "your-configuration-id-from-ai-launchpad",
  },
  {
    resourceGroup: process.env.RESOURCE_GROUP,
  },
);
```

This approach decouples your application logic from your prompt engineering. You can update prompts, adjust model parameters, or change filtering rules in SAP AI Launchpad without redeploying your application.

### Option 2: JSON Configuration in Code

For more control and the ability to version your configuration alongside your code, you can define the orchestration configuration directly in TypeScript/JavaScript:

```javascript
import { OrchestrationClient } from "@sap-ai-sdk/orchestration";

const orchestrationClient = new OrchestrationClient({
  promptTemplating: {
    model: {
      name: process.env.MODEL_NAME!,
      params: {
        temperature: 0.1,
        max_tokens: 1000,
        frequency_penalty: 0,
        presence_penalty: 0
      }
    },
    prompt: {
      template: [
        {
          role: "system",
          content: "You are a helpful assistant that answers questions based on provided context."
        },
        {
          role: "user",
          content: "{{?input}}"
        }
      ]
    }
  },
  filtering: {
    input: {
      filters: [
        {
          type: "azure_content_safety",
          config: {
            Hate: 0,
            SelfHarm: 0,
            Sexual: 0,
            Violence: 0
          }
        }
      ]
    },
    output: {
      filters: [
        {
          type: "azure_content_safety",
          config: {
            Hate: 0,
            SelfHarm: 0,
            Sexual: 0,
            Violence: 0
          }
        }
      ]
    }
  }
}, {
  resourceGroup: process.env.RESOURCE_GROUP
});
```

**Understanding the Configuration:**

- **Model Parameters**: Setting `temperature` to 0.1 makes responses more consistent and factual, which is perfect for RAG where you want the LLM to stick closely to the provided context.
- **Template Placeholders**: The `{{?input}}` syntax (note the `?`) marks template parameters. The `?` is required - it tells the orchestration service this is a variable that'll be replaced at runtime.
- **Content Filtering**: Azure Content Safety filters protect against harmful content in both user inputs and LLM outputs. Setting these to 0 means you want the strictest filtering.

## Building the RAG flow

With the supporting pieces in place, the next step is to build the full RAG flow that handles user queries.

### Why grounding is important

Before getting into the implementation, it helps to be explicit about why grounding matters in a RAG system.

**The Hallucination Problem**

LLMs are incredibly good at generating fluent, convincing text. The problem? They're also incredibly good at making stuff up. Ask GPT-4 about a topic it doesn't know, and it'll confidently give you an answer that sounds authoritative but is completely wrong. In enterprise applications, this is unacceptable.

**What Grounding Does**

Grounding anchors the LLM's responses to actual source material. Instead of relying on what the model learned during training (which could be outdated, biased, or just plain wrong), grounding forces the model to base its answers on specific documents you provide.

Think of it like this:

- **Without grounding**: "Hey LLM, what's our company's vacation policy?" → LLM makes an educated guess based on typical policies
- **With grounding**: "Hey LLM, here are the exact paragraphs from our HR handbook. Based on these, what's our vacation policy?" → LLM reads the actual policy and answers

**Why SAP's Grounding Service Matters**

Manual retrieval is still an option, and a later section covers that approach as well. SAP's document grounding service adds several advantages:

1. **Automatic retrieval**: The grounding service handles the vector search for you. You don't need to manually embed the query, search the vector store, and format results.

2. **Optimized chunking**: It knows how to intelligently select and combine document chunks to stay within token limits while maximizing relevant context.

3. **Source attribution**: The service tracks which documents were used, making it easy to provide citations and build user trust.

4. **Consistent formatting**: It standardizes how context is presented to the LLM, which improves response quality.

5. **Built-in filtering**: You can configure the grounding pipeline in AI Launchpad to only search specific document repositories or apply metadata filters.

**The Trust Factor**

In production RAG systems, users need to verify answers. When your legal team asks about contract clauses or your support team looks up technical specifications, "the AI said so" isn't good enough. Grounding lets you return not just the answer, but the exact source documents that informed it.

```javascript
// Response with grounding
{
  "answer": "The warranty period is 24 months from date of purchase.",
  "sources": [
    {
      "document": "Product_Warranty_Policy_v2.3.pdf",
      "section": "Section 4.1 - Standard Warranty Terms",
      "confidence": 0.94
    }
  ]
}
```

Now users can verify the answer against the source. That turns the RAG system from a black box into something they can inspect and trust.

**When Grounding May Not Be Necessary**

Grounding is not an all-or-nothing choice. You can still ground a response while asking the model to be conversational, creative, or on-brand. It's simply less useful when:

- The question is about general knowledge and your own documents add no meaningful value
- You want unconstrained brainstorming or ideation rather than an answer anchored to source material
- Performance or cost matters more than document-backed accuracy for that interaction
- You do not yet have a relevant document set, so retrieval would add noise instead of useful context

For enterprise RAG use cases, grounding is usually essential whenever accuracy, traceability, and source attribution matter.

### Setting up the grounding configuration

For RAG with the SAP Cloud SDK for AI, we use the grounding capability built into the `OrchestrationClient`:

```javascript
import { OrchestrationClient } from "@sap-ai-sdk/orchestration";

const groundingClient = new OrchestrationClient({
  promptTemplating: {
    model: {
      name: process.env.MODEL_NAME!,
      params: {
        temperature: 0.1,
        max_tokens: 1000
      }
    },
    prompt: {
      template: [
        {
          role: "system",
          content: "Use the following context to answer the question:\n{{?groundingOutput}}"
        },
        {
          role: "user",
          content: "{{?user_question}}"
        }
      ]
    }
  },
  grounding: {
    type: "document_grounding_service",
    config: {
      filters: [
        {
          id: "vector",
          data_repository_type: "vector",
          data_repositories: [process.env.GROUNDING_PIPELINE_ID!],
          search_config: {
            max_chunk_count: 5
          }
        }
      ],
      placeholders: {
        input: ["user_question"],
        output: "groundingOutput"
      }
    }
  }
}, {
  resourceGroup: process.env.RESOURCE_GROUP
});
```

**Key points:**

- `{{?user_question}}` gets replaced with the user's query
- `{{?groundingOutput}}` gets automatically populated with the retrieved document chunks
- The grounding pipeline ID comes from SAP AI Launchpad
- `max_chunk_count: 5` retrieves the top 5 most similar chunks

### Implementing the RAG query function

Here's the complete implementation:

```javascript
export async function askQuestionWithRAG(userQuery: string): Promise<{
  answer: string;
  sources: string[];
}> {
  try {
    const response = await groundingClient.chatCompletion({
      placeholderValues: {
        user_question: userQuery
      }
    });

    const answer = response.getContent() ?? "No response received.";

    const sources = response.moduleResults?.grounding
      ?.map((doc: any) => doc.id || doc.document_name)
      .filter(Boolean) || [];

    return {
      answer,
      sources
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("❌ RAG query failed:", errorMessage);
    throw new Error(`Failed to get grounded answer: ${errorMessage}`);
  }
}
```

### Alternative: Manual vector search

If you prefer more control over the retrieval process, you can manually query the HANA vector engine:

```javascript
import { AzureOpenAiEmbeddingClient } from "@sap-ai-sdk/langchain";

export async function manualRAGQuery(userQuery: string) {
  // Step 1: Embed the query
  const embeddingClient = new AzureOpenAiEmbeddingClient({
    modelName: "text-embedding-3-small",
    maxRetries: 0,
    resourceGroup: process.env.RESOURCE_GROUP
  });

  const queryEmbedding = await embeddingClient.embedQuery(userQuery);

  // Step 2: Search HANA
  const similarChunks = await SELECT.from(DocumentSplit)
    .columns('text_chunk', 'metadata')
    .where(`COSINE_SIMILARITY(embedding, TO_REAL_VECTOR('[${queryEmbedding}]')) > 0.7`)
    .orderBy(`COSINE_SIMILARITY(embedding, TO_REAL_VECTOR('[${queryEmbedding}]')) desc`)
    .limit(5);

  // Step 3: Build context
  const context = similarChunks
    .map(chunk => chunk.text_chunk)
    .join('\n\n---\n\n');

  // Step 4: Get LLM response
  const orchestrationClient = new OrchestrationClient({
    promptTemplating: {
      model: {
        name: process.env.MODEL_NAME!,
        params: { temperature: 0.1, max_tokens: 1000 }
      }
    }
  }, {
    resourceGroup: process.env.RESOURCE_GROUP
  });

  const response = await orchestrationClient.chatCompletion({
    messages: [
      {
        role: "system",
        content: `Answer based on this context:\n\n${context}`
      },
      {
        role: "user",
        content: userQuery
      }
    ]
  });

  return {
    answer: response.getContent() ?? "No response received.",
    sources: similarChunks.map(chunk => chunk.metadata)
  };
}
```

## Exposing through CAP

Here's how to expose the RAG functionality through a CAP OData service:

**Service Definition (srv/ai-service.cds):**

```cds
service AIService {
  action askQuestion(question: String) returns {
    answer: String;
    sources: array of String;
  };
}
```

**Service Implementation (srv/ai-service.js):**

```javascript
const { askQuestionWithRAG } = require("./rag-implementation");

module.exports = class AIService extends cds.ApplicationService {
  async init() {
    this.on("askQuestion", async (req) => {
      const { question } = req.data;

      if (!question) {
        req.error(400, "Question parameter is required");
      }

      try {
        const result = await askQuestionWithRAG(question);
        return result;
      } catch (error) {
        console.error("Error processing question:", error);
        req.error(500, "Failed to process your question. Please try again.");
      }
    });

    await super.init();
  }
};
```

Now users can call your RAG service:

```http
POST /odata/v4/ai/askQuestion
Content-Type: application/json

{
  "question": "What are the safety procedures for operating the CNC-500 machine?"
}
```

## Best practices for production

### 1. Choose the right chunk size

The chunk size significantly impacts retrieval quality:

- **Small chunks (200-400 tokens)**: More precise matching but may lack context
- **Medium chunks (400-800 tokens)**: Good balance for most use cases
- **Large chunks (800-1000 tokens)**: More context but less precise

Always include overlap (50-100 tokens) to ensure important information isn't split.

### 2. Implement fallback logic

```javascript
if (similarChunks.length === 0 || similarChunks[0].similarity < 0.6) {
  return {
    answer:
      "I don't have enough information to answer this question confidently.",
    sources: [],
    confidence: "low",
  };
}
```

### 3. Return source citations

Build trust by showing users where the information came from:

```javascript
return {
  answer: response.getContent(),
  sources: similarChunks.map((chunk) => ({
    document: chunk.metadata,
    relevanceScore: chunk.similarity,
    excerpt: chunk.text_chunk.substring(0, 100) + "...",
  })),
};
```

### 4. Cache frequently asked questions

```javascript
const cache = new Map();

export async function cachedRAGQuery(userQuery: string) {
  const cacheKey = userQuery.toLowerCase().trim();

  if (cache.has(cacheKey)) {
    console.log('✅ Returning cached result');
    return cache.get(cacheKey);
  }

  const result = await askQuestionWithRAG(userQuery);
  cache.set(cacheKey, result);

  return result;
}
```

### 5. Handle edge cases

```javascript
// Check for empty queries
if (!userQuery || userQuery.trim().length < 3) {
  throw new Error("Query is too short. Please provide more details.");
}

// Limit query length
if (userQuery.length > 500) {
  throw new Error("Query is too long. Please keep it under 500 characters.");
}
```

## Production considerations

**Error Handling**: Implement proper error handling for embedding failures, vector search timeouts, and LLM API errors.

**Performance Optimization**:

- Cache frequently embedded queries
- Use connection pooling for database access
- Batch document processing

**Cost Management**:

- Monitor token usage for embeddings and LLM completions
- Implement rate limiting
- Set up usage alerts

**Quality Monitoring**:

- Log similarity scores
- Implement user feedback mechanisms
- A/B test different chunk sizes

**Security**:

- Implement proper authentication and authorization
- Audit access to sensitive documents
- Consider data residency requirements

## Wrapping up

This 3-part series walked through a complete RAG application on SAP BTP. It covered:

**Part 1**: The fundamentals of RAG, vector embeddings, and SAP AI services  
**Part 2**: Building a vector store with CAP and HANA Cloud  
**Part 3**: Implementing the RAG flow with orchestration and grounding

The key takeaways:

- **SAP HANA Cloud's vector engine** integrates seamlessly with your existing HANA instances
- **The SAP Cloud SDK for AI** handles the complexity of connecting to different LLM providers
- **The orchestration service** gives you flexible control over your RAG workflows
- **Production readiness** requires error handling, caching, monitoring, and security

RAG is rapidly evolving with new techniques emerging regularly. The foundation in this series gives you the flexibility to adopt these advanced techniques as they mature.

## Resources

- [SAP AI Core Documentation](https://help.sap.com/docs/sap-ai-core)
- [SAP HANA Cloud Vector Engine Guide](https://help.sap.com/docs/hana-cloud-database/sap-hana-cloud-sap-hana-database-vector-engine-guide/)
- [SAP Cloud SDK for AI](https://github.com/SAP/ai-sdk-js)
- [CAP Documentation](https://cap.cloud.sap/docs/)
- [LangChain Documentation](https://js.langchain.com/docs/)
