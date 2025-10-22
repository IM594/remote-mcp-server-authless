import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import OpenAI from "openai";

// Define our MCP agent with tools
export class MyMCP extends McpAgent {
  server = new McpServer({
    name: "File Search Assistant",
    version: "1.0.0",
  });

  async init() {
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
          // Check if API key is available
          const apiKey = (globalThis as any).OPENAI_API_KEY;
          if (!apiKey) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: OPENAI_API_KEY environment variable is not set",
                },
              ],
            };
          }

          // Initialize OpenAI client
          const openai = new OpenAI({
            apiKey: apiKey,
          });

          // System prompt for detailed responses
          const systemPrompt = `Generate a detailed, rich, and information-dense response to any given query or topic, focusing on providing as much original and granular detail as possible. Your objective is to output content that maximizes raw material, background, evidence, and specific facts, rather than summarizing, paraphrasing, or condensing. The user will use your output as input for another AI system to summarize, so prioritize maximal breadth and depth in your content.

Output format:

- Structure your answer in an organized list or multi-paragraph format (not in code blocks).
- Each relevant idea, fact, or subpoint should be developed as fully as possible, with concrete examples, context, and factual evidence wherever possible.
- Avoid summarizing, generalizing, or drawing conclusions—provide primary details and raw material only.
- Do not use bullet points or numbered lists if the topic requires narrative expansion; use paragraphs as appropriate to maximize raw content volume.
- Do not include any meta-comments, "as an AI language model," or restate user instructions.

If the topic is particularly broad, ensure coverage of all relevant subtopics, and expand each section with different aspects, data, and anecdotes. For narrowly focused requests, maximize the level of detail and cite specific facts or event timelines.

Your primary goal is to generate as much original, factual, and detailed content as possible, without summarizing.`;

          // Combine all queries into one request
          const combinedQuery = queries.join("\n\n");

          // Use the responses API as specified
          const response = await openai.responses.create({
            model: "gpt-4o-mini",
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
            temperature: 1,
            max_output_tokens: 2048,
            top_p: 1,
            store: true,
            include: ["web_search_call.action.sources"],
          });

          // Extract the response content
          const apiResponse = response as any;
          if (apiResponse.response?.content) {
            const content = apiResponse.response.content;
            let responseText = "";

            // Handle different content types
            for (const item of content) {
              if (item.type === "text") {
                responseText += item.text || "";
              }
            }

            if (responseText) {
              return {
                content: [
                  {
                    type: "text",
                    text: responseText,
                  },
                ],
              };
            }
          }

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
