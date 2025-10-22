import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import OpenAI from "openai";
import { env } from "cloudflare:workers";

// Define our MCP agent with tools
export class MyMCP extends McpAgent {
  server = new McpServer({
    name: "File Search Assistant",
    version: "1.0.0",
  });

  async init() {
    // Vector store search tool
    this.server.tool(
      "vector_store_search",
      {
        query: z
          .array(z.string())
          .describe("Array of query strings to search in the vector store"),
      },
      async ({ query }) => {
        try {
          // Vector store ID from the example
          const vectorStoreId = "vs_68ef41d52fe081919cbf5338c6cfa507";
          const apiKey = env.OPENAI_API_KEY;

          // Prepare the request body
          const requestBody = {
            query: query,
            max_num_results: 10,
          };

          // Make direct API call to OpenAI vector store search
          const response = await fetch(
            `https://api.openai.com/v1/vector_stores/${vectorStoreId}/search`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(requestBody),
            }
          );

          if (!response.ok) {
            throw new Error(`Vector store search failed: ${response.status} ${response.statusText}`);
          }

          const result = await response.json();

          // Return the raw response as stringified JSON
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          console.error("Vector store search error:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error searching vector store: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );

    // OpenAI detailed response tool
    this.server.tool(
      "file_search_assistant",
      {
        queries: z
          .array(z.string())
          .describe(
            "Array of queries or topics to generate detailed responses for"
          ),
      },
      async ({ queries }) => {
        try {
          // Initialize OpenAI client
          const openai = new OpenAI({
            apiKey: env.OPENAI_API_KEY,
          });

          // System prompt for maximal fidelity fact extraction
          const systemPrompt = `**Your sole function is to act as a direct, maximally reliable conduit for providing raw, factual information from source documents to another AI system.** **Your performance is measured by the sheer volume and fidelity of individual, precisely cited facts you extract.** Do not process, summarize, organize, interpret, rephrase, generalize, or merge any information—simply extract and supply the original content in the most direct and faithful way possible.

**Your absolute only task is to deliver *every single* explicit, unaltered factual detail exactly as found in the sourced materials, with each minimal factual unit accompanied by a precise, explicit citation for every detail. Never skip, add, omit, or modify any detail, no matter how minor or tangential it may seem.** Omit only the content that is *not* directly and fully supported by the source.

- **Never summarize, paraphrase, or reframe any information.**
- **Never organize, connect, or group facts beyond their exact appearance or order in the source.**
- **Do not process, reason, or draw conclusions—just transmit original facts with full traceability.**
- **MANDATORY: Extract every single piece of factual data, including specific dates, numbers, proper nouns, modifiers, and parenthetical details.** **The goal is maximal detail, not just core concepts.**

**Citation Format (attach to every fact, always):**
- "filename.ext": Exact file containing the fact.
- X%: Confidence (90–100% for verbatim; 70–89% if present but not quoted exactly).
- "precise_path_or_section": Specific page, section, paragraph, line number, or ID.
- "direct_quote_from_document": **The exact minimal phrase/sentence/clause that constitutes the fact.**

# Steps

1.  **Exhaustive Extraction:** For *every* piece of factual information, even a minor modifier or secondary detail, extract it as the **minimal verifiable factual unit (MVFU)** verbatim (or as close as strictly possible), without modifying its wording, scope, or meaning.
2.  **Mandatory Citation:** After *each* MVFU, append an explicit citation in the exact format given.
3.  **Strict Omission Rule:** If a fact cannot be cited precisely and directly per above (i.e., if its original wording is lost or its location is vague), **it must be strictly omitted.**
4.  **Literal Sequence:** Do not group, order, or present data except in the literal, sequential order encountered in the source material. **Preserve the document's flow and presentation exactly.**

# Output Format

- Respond in plain text.
- Each line or bullet point **MUST** represent a **single, minimal, precisely cited fact (MVFU)**, exactly as in the source. **(Do not merge facts; break them down to their smallest unit).**
- Attach the citation immediately following each fact in the specified format.
- Do not add headings, summaries, or structure unless directly and explicitly present in the source (if headings exist, replicate as in the document, otherwise omit).
- Output must be **maximally literal and exhaustive**, with **zero** inference, paraphrasing, or interpretation.

# Examples
Example (when copying directly from a source document):
- The company was founded in 2010 .
- on January 15 .
- The first office was opened in New York City .
- in Manhattan, NY .
(Real examples should include all available facts from the document, copied in the same order and language as the source. Do not organize or summarize.)

# Notes

- **The primary directive is MAXIMAL DETAIL.** **Extract the maximum possible number of individual, citable facts.**
- Do not add, summarize, interpret, generalize, or synthesize any information.
- Do not restructure or reformat unless strictly replicating the original presentation in the source.
- Exclude any assertion not fully and explicitly supported with the precise citation required.
- You do not need to process or curate the information—just transfer it directly and faithfully.

**REMINDER:** Your ONLY role is to deliver **raw, directly sourced, fully traceable, and exhaustively detailed facts**, attached with precise citations, for use by downstream AI systems. **Do not process or organize in any way—simply provide maximal fidelity data exactly as found.**`;

          // Combine all queries into one request
          const combinedQuery = queries.join("\n\n");

          // Use the responses API as specified
          const response = await openai.responses.create({
            model: "gpt-4.1-mini",
            input: [
              {
                role: "system",
                content: [
                  {
                    type: "input_text",
                    text: systemPrompt,
                  },
                ],
              },
              {
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: combinedQuery,
                  },
                ],
              },
            ],
            text: {
              format: {
                type: "text",
              },
            },
            reasoning: {},
            tools: [
              {
                type: "file_search",
                vector_store_ids: ["vs_68ef41d52fe081919cbf5338c6cfa507"],
              },
            ],
            tool_choice: {
              type: "file_search",
            },
            temperature: 0.7,
            max_output_tokens: 2048,
            top_p: 1,
            store: true,
            include: ["web_search_call.action.sources"],
          });

          // Extract the response content
          const apiResponse = response as any;
          
          // Log the full response structure for debugging
          console.log("OpenAI API Response:", JSON.stringify(apiResponse, null, 2));
          console.log("Response keys:", Object.keys(apiResponse));
          
          // Check if we have output_text field (convenient field)
          if (apiResponse.output_text) {
            console.log("Found output_text:", apiResponse.output_text);
            return {
              content: [
                {
                  type: "text",
                  text: apiResponse.output_text,
                },
              ],
            };
          } else {
            console.log("No output_text field found");
          }

          // Check output array structure
          console.log("Checking output array:", {
            hasOutput: !!apiResponse.output,
            outputLength: apiResponse.output?.length,
            outputType: typeof apiResponse.output
          });

          if (apiResponse.output && apiResponse.output.length > 0) {
            const output = apiResponse.output[0];
            console.log("First output item:", JSON.stringify(output, null, 2));
            console.log("First output keys:", Object.keys(output));
            
            if (output.content && output.content.length > 0) {
              const content = output.content;
              console.log("Content array:", JSON.stringify(content, null, 2));
              console.log("Content length:", content.length);
              console.log("Content types:", content.map((item: any) => ({ type: item.type, hasText: !!item.text })));
              
              let responseText = "";

              // Handle different content types
              for (const item of content) {
                console.log("Processing content item:", { type: item.type, hasText: !!item.text });
                if (item.type === "output_text") {
                  console.log("Found output_text item:", item.text);
                  responseText += item.text || "";
                }
              }

              console.log("Final responseText:", { length: responseText.length, preview: responseText.substring(0, 200) });

              if (responseText) {
                return {
                  content: [
                    {
                      type: "text",
                      text: responseText,
                    },
                  ],
                };
              } else {
                console.log("No responseText found after processing content");
              }
            } else {
              console.log("No content array or empty content:", {
                hasContent: !!output.content,
                contentLength: output.content?.length
              });
            }
          } else {
            console.log("No output array or empty output:", {
              hasOutput: !!apiResponse.output,
              outputLength: apiResponse.output?.length
            });
          }

          console.log("Returning default error message");
          return {
            content: [
              {
                type: "text",
                text: "No response content received from OpenAI API",
              },
            ],
          };
        } catch (error) {
          console.error("OpenAI API error:", error);
          return {
            content: [
              {
                type: "text",
                text: `Error calling OpenAI API: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
          };
        }
      }
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/sse" || url.pathname === "/sse/message") {
      return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
    }

    if (url.pathname === "/mcp") {
      return MyMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
};
