# Maximizing Value with AI Assistant (Free Tier Guide)

Using an AI coding assistant efficiently, especially on a free tier or with usage limits, requires a strategic approach. By managing context and providing clear instructions, you can get high-quality results while minimizing token usage and requests.

## 1. Be Specific and Context-Aware
*   **Narrow Your Scope**: Instead of asking "fix my app," specify the problem: "The Vue component `Calculator.js` is not reacting to changes in `market.methods.js`."
*   **Provide Only Necessary Context**: Avoid pasting entire files if the issue is localized to a single function. If the AI has workspace access, just mention the file names and line numbers. 
*   **Batch Your Requests**: Instead of sending 5 small, incremental requests, group them logically into one prompt. For example: "1) Fix the bug in function A. 2) Refactor function B to use ES6 modules. 3) Add comments to both."

## 2. Leverage System Capabilities Effectively
*   **Let the AI Read the Files**: Since the AI can read your workspace, you don't need to copy-paste code. Simply say, "Look at `assets/js/services/rates.service.js` and optimize the fetch method."
*   **Use the AI for Planning First**: Before asking the AI to write a large chunk of code, ask it to outline a plan or architecture. Once you approve the plan, ask it to implement the specific steps. This prevents the AI from going down the wrong path and wasting usage limits.
*   **Review Generated Artifacts**: When the AI creates an architecture document or an implementation plan (like `plan.md`), read it thoroughly and provide targeted feedback.

## 3. Effective Debugging
*   **Share Error Messages**: Provide the exact stack trace or error message you're seeing in the console.
*   **Describe Expected vs. Actual Behavior**: "When I click 'Calculate', I expect the total to be 500, but I get NaN."
*   **Isolate the Issue**: If you have a complex bug, try to reproduce it in a minimal, isolated function before asking the AI to solve it across the entire codebase.

## 4. Managing Token Usage (The "Invisible" Limit)
*   **Close Unnecessary Files**: Some AI environments send the contents of your open editor tabs as context. Close files you aren't actively working on to save tokens and keep the AI focused.
*   **Clean Up Your Chat History**: If a conversation gets too long or goes off-topic, start a new chat session. A long chat history consumes a massive amount of context tokens with every new message.
*   **Ask for Explanations Only When Needed**: If you just need the code, specify "Just provide the code, no explanation needed." Conversely, if you're learning, ask for detailed comments instead of a conversational essay.

## 5. Ideal Workflow Example
1.  **Start:** "I want to add a feature X to file Y. Here is my general idea..."
2.  **AI Plans:** The AI provides a plan.
3.  **Refine:** "The plan looks good, but let's change step 2 to use approach Z."
4.  **Execute:** "Please implement step 1 and 2 of the updated plan."
5.  **Verify:** Test the code locally. If it fails, provide the error. If it succeeds, proceed to the next steps.
