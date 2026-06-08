---
title: "RAG on SAP BTP, Part 2: Building the Vector Store"
date: 2026-02-08
draft: false
permalink: /blog/posts/2026/02/08/building-rag-applications-on-sap-btp-part-2-creating-your-vector-store/
series:
  key: rag-on-sap-btp
  title: Building RAG Applications on SAP BTP
  part: 2
  label: Creating Your Vector Store
tags:
  - ai
  - sap
  - rag
  - hana
  - cap
description: A walkthrough of document chunking, embedding generation, and vector storage in SAP HANA Cloud with CAP.
---

# Introduction

> NOTE: This is Part 2 of a 3-part series. If you haven't read [Part 1](/blog/2026-02-06-rag-on-sap-btp-part1), start there to understand the RAG fundamentals.

In Part 1, we covered the theory behind RAG and the SAP services we'll use. Now it's time to get our hands dirty and build the actual vector store. We'll set up connections to SAP AI Core and HANA Cloud, process documents into chunks, generate embeddings, and store everything in HANA's vector engine.

## Setting up your project

The following sections assume you already have a CAP application created with a database schema defined. If you don't have one yet, you'll want to create that first before diving into the RAG implementation.

### Connecting your application to SAP AI Core

To establish a connection from your CAP application to the AI service instances within SAP BTP, you need to set up a connection configuration. With the SAP Cloud SDK for AI, you have two options:

For testing and local development, you can configure a Cloud Foundry service key for SAP AI Core in your .env file or as an environment variable. The SDK will parse the service key to interact with AI Core. This setup lets you test locally with deployments that exist in SAP BTP.

For production, you'll want to create a binding between your application and the SAP AI Core service instance. The binding is more secure since it's not exposing authentication details in clear text.

I recommend having the [Cloud Foundry (CF) CLI](https://developers.sap.com/tutorials/cp-cf-download-cli.html) installed locally. You'll use it to create the binding between your CAP application and SAP AI Core. First, you'll need your landscape URL - you can find this in your SAP BTP Cloud Foundry instance. It should look something like: `https://api.cf.us10.hana.ondemand.com`.

```bash
cf login -a <landscape-url> --sso
```

After logging into the correct landscape, you can proceed with the binding. You need to specify which AI Core instance you want to connect to:

```bash
cds bind -2 <AI Core instance name>
```

This will create a new service key for SAP AI Core and configure it within your project. It's basically the same as the .env approach with one major difference it creates a proper binding by generating a fresh service key, rather than having a service key sitting in clear text in your configuration.

### Connecting your application to SAP HANA Cloud

The process is the same as with SAP AI Core: create a binding to a [HANA deployment infrastructure (HDI)](https://help.sap.com/docs/SAP_HANA_PLATFORM/4505d0bdaf4948449b7f7379d24d0f0d/e28abca91a004683845805efc2bf967c.html) container. Start by logging into your SAP BTP Cloud Foundry landscape. If you do not already have a dedicated HDI container, create one:

```bash
cf create-service hana hdi-shared <define-your-own-hdi-container-name>
```

Creating the HDI container takes some time. You can monitor the process using the following command:

```bash
cf service <use-your-own-hdi-container-name>
```

You can always use the CF CLI to list all service instances as well:

```bash
cf services
```

The HDI container is created, but your CAP application isn't configured yet to use SAP HANA Cloud as persistence. You can simply change that by telling CAP to use SAP HANA Cloud:

```bash
cds add hana --for hybrid
```

The profile hybrid relates to the hybrid testing scenario, which allows you to run your CAP service on localhost but use a real connection to a running SAP HANA Cloud instance. This is not a requirement. You could execute `cds add hana` to have the default production scenario.

Within your `package.json` file, you can see that there is a new section being added:

```json
"cds": {
    "requires": {
      "[hybrid]": {
            "db":"hana"
      }
    }
  }
```

At this point, your CAP application knows that you want to use an SAP HANA database for persistence, but it doesn't yet know which database instance to use and has no connection. You'll need to bind your application to the SAP HANA Cloud instance configured on SAP BTP. When you bind your application, a service key is issued to authenticate against that instance.

```bash
cds bind -2 <use-your-own-hdi-container-name>
```

You can deploy your database schema very easily to SAP HANA Cloud using the CDS CLI but first build the project:

```bash
cds build --production
```

Now deploy it:

```bash
cds deploy --to hana:<use-your-own-HDI-container-name> --auto-undeploy
```

The `--auto-undeploy` argument causes the database to adjust to the new runtime definition of your database artifacts.

## Document chunking and embedding

Here's how the complete flow works from raw text to stored vectors:

```
┌─────────────────┐
│ 📄 Text Document │
│  (myfile.txt)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  🔄 TextLoader  │
│   (LangChain)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 📚 Full Document│
│  (single string)│
└────────┬────────┘
         │
         ▼
┌─────────────────────┐
│  ✂️ Text Splitter   │
│  chunk_size: 500    │
│  chunk_overlap: 50  │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  📝 Chunks Array    │
│  ["chunk1", "chunk2"│
│   "chunk3", ...]    │
└────────┬────────────┘
         │
         ▼
┌─────────────────────────┐
│   🧠 Embedding Model    │
│ text-embedding-ada-002  │
│    (via SAP AI Core)    │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  🔢 Vector Embeddings   │
│   [[0.123, -0.456, ...],│
│    [0.789, 0.234, ...]] │
│   dimension: 1536       │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│ 🗄️ HANA Vector Engine   │
│   VECTOR(1536) column   │
│  + similarity search    │
└─────────────────────────┘
```

Each text document goes through these stages: loading, chunking into manageable pieces, converting chunks to vector embeddings, and finally storing those vectors in HANA Cloud's vector engine for similarity search.

### Loading documents

Usually, you wouldn't embed documents directly from within your CAP application, you'd do it directly on the vector engine itself. But in case you need to do the embedding from within your codebase, here's how.

You'll want to use some npm packages for loading documents, splitting them into chunks, and embedding them through an embedding model.

To load different documents, you can use different loaders. If your documents are stored locally, you can simply use LangChain's `TextLoader`:

```javascript
import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
```

Of course, there are many different loaders available from LangChain. If you're interested, check out the [official documentation](https://docs.langchain.com/oss/javascript/integrations/document_loaders).

Most of the time, these documents will be stored in a database somewhere. You can simply read them from the database and process them with the text splitter afterwards.

For now, we assume that the documents are stored locally:

```javascript
const loader = new TextLoader(path.resolve("db/data/demo_grounding.txt"));
const document = await loader.load();
```

### Splitting into chunks

To split the text into meaningful chunks, you can use the `RecursiveCharacterTextSplitter`:

```javascript
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
```

You'll configure the text splitter depending on the format of your documents. Ideally, your documents are in markdown format or structured by paragraphs and chapters so you can split them by their existing structure. Here's an example configuration:

```javascript
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 400, // Aim for ~400 characters/tokens
  chunkOverlap: 50, // Include 50 chars of overlap to maintain context
  separators: ["\n\n", "\n", ".", " ", ""], // Recursive priority: break by paragraph > line > sentence > word > char
});
```

Now execute the splitting of the documents:

```javascript
const splitDocuments = await splitter.splitDocuments(document);
```

The objects returned by the text splitter are JSON objects that hold values under the key pageContent. These values are the text chunks. You need to extract these values to pass them to the embedding client.

```javascript
const textSplits = [];
for (const chunk of splitDocuments) {
  textSplits.push(chunk.pageContent);
}
```

### Creating embeddings

You need a way to feed the document splits to the embedding model. SAP provides the SAP Cloud SDK for AI which lets you use LangChain APIs enhanced with SAP functionality like connectivity to SAP AI Launchpad. You'll create an `AzureOpenAiEmbeddingClient` that can automatically connect to SAP AI Launchpad using a service binding or your .env file.

First, import the embedding client:

```javascript
import { AzureOpenAiEmbeddingClient } from "@sap-ai-sdk/langchain";
```

Now fire up the embedding process with an embedding model defined:

```javascript
const embeddingClient = new AzureOpenAiEmbeddingClient({
  modelName: "text-embedding-3-small",
  maxRetries: 0,
  resourceGroup: "Your-resource-group-on-AI-Launchpad",
});

const embeddings = await embeddingClient.embedDocuments(textSplits);
```

Make sure the resource group name is correct and that you've configured the embedding model in that specific resource group.

Now you can insert the embeddings, document splits, and metadata into the database.

## Storing in SAP HANA's vector engine

### Defining the database schema

Your database schema can follow the following entity definition:

```cds
entity DocumentSplit : cuid, managed {
    metadata    : LargeString;
    text_chunk : LargeString;
    embedding   : Vector(1536);
}
```

The entity defines three fields:

- **metadata**: Stores the path to the information document.
- **text_chunk**: Stores the individually created text chunks.
- **embedding**: Stores the encoded vector embeddings created by an embedding model.

The important part here is that the embedding itself is defined as a `Vector`. You can see that the vector has a vector space dimension defined (1536 in this case).

### Inserting the data

Next, iterate over all embeddings and prepare them for database insertion:

```javascript
let embeddingEntries = [];
for (const [index, embedding] of embeddings.entries()) {
  const embeddingEntry = {
    metadata: splitDocuments[index].metadata.source,
    text_chunk: splitDocuments[index].pageContent,
    embedding: `[${embedding}]`,
  };
  embeddingEntries.push(embeddingEntry);
}
```

This newly created entity can simply be inserted into the database:

```javascript
await INSERT.into(DocumentSplit).entries(embeddingEntries);
```

> NOTE: In case you want to expose the vector embeddings via OData I must warn you; OData doesn't know the type `Vector`. That being said you must exclude the `embedding` field from the service to avoid a runtime error.

```cds
entity DocumentChunk as projection on db.DocumentChunk
  excluding {
      embedding
  }
```

## Testing your vector store

Once you've inserted your documents, you can test the vector search functionality. Here's a quick example:

```javascript
import { AzureOpenAiEmbeddingClient } from "@sap-ai-sdk/langchain";

const testQuery = "How do I repair the machine?";

// Embed the test query
const embeddingClient = new AzureOpenAiEmbeddingClient({
  modelName: "text-embedding-3-small",
  maxRetries: 0,
  resourceGroup: process.env.RESOURCE_GROUP,
});

const queryEmbedding = await embeddingClient.embedQuery(testQuery);

// Search for similar chunks
const results = await SELECT.from(DocumentSplit)
  .columns("text_chunk", "metadata")
  .where(
    `COSINE_SIMILARITY(embedding, TO_REAL_VECTOR('[${queryEmbedding}]')) > 0.7`,
  )
  .orderBy(
    `COSINE_SIMILARITY(embedding, TO_REAL_VECTOR('[${queryEmbedding}]')) desc`,
  )
  .limit(3);

console.log("Top matching chunks:", results);
```

If you see results coming back with similarity scores above 0.7, your vector store is working.

## What's next?

Part 3 brings the full RAG flow together with the SAP Cloud SDK for AI's orchestration and grounding services. It covers how to:

- Configure the orchestration service
- Implement grounding with your vector store
- Expose the RAG flow through a CAP OData service
- Implement best practices for production

## Resources

- [LangChain Document Loaders](https://docs.langchain.com/oss/javascript/integrations/document_loaders)
- [SAP Cloud SDK for AI - LangChain Package](https://github.com/SAP/ai-sdk-js/tree/main/packages/langchain)
- [SAP HANA Cloud Vector Engine Guide](https://help.sap.com/docs/hana-cloud-database/sap-hana-cloud-sap-hana-database-vector-engine-guide/)
- [CAP Documentation](https://cap.cloud.sap/docs/)
