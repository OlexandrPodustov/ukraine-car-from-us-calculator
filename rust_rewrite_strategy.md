# Rust Rewrite Strategy & Tradeoffs

## Executive Summary
This document explores the strategic implications, architectural approaches, and tradeoffs of rewriting the `ukraine-car-from-us-calculator` project from a JavaScript/Vue application to Rust. 

Since the current project is a frontend, client-side calculator, a Rust rewrite would primarily leverage **WebAssembly (Wasm)** for the frontend, or pivot to a **Client-Server architecture** with a Rust backend API.

---

## Architectural Approaches

### Approach 1: Rust + WebAssembly (Client-Side)
Using frameworks like **Yew**, **Dioxus**, or **Leptos**, the entire calculator logic and UI rendering is written in Rust, compiled to WebAssembly, and executed in the user's browser.

**Best for:** Keeping the application as a standalone, serverless frontend while gaining extreme performance and type safety.

### Approach 2: Rust Backend API + Lightweight JS Frontend (Client-Server)
Moving the heavy lifting (auction parsing, rate calculations, market lookup) to a Rust server (using **Axum** or **Actix-Web**). The frontend remains HTML/JS/Vue but becomes a "dumb" client that simply sends inputs to the Rust API and displays the JSON response.

**Best for:** Protecting proprietary calculation formulas, securely integrating with third-party APIs (like real-time currency rates or auction databases without exposing API keys), and separating concerns.

---

## Tradeoffs

### 🟢 Advantages of Rewriting in Rust

1.  **Rock-Solid Reliability & Type Safety**
    *   Rust's strict compiler and borrow checker eliminate entire classes of bugs (null pointer dereferences, unhandled undefined states).
    *   Complex calculation logic (e.g., custom duty formulas, fluctuating exchange rates, auction fee tiers) becomes heavily typed and inherently safer than JavaScript's dynamic types.

2.  **Performance & Efficiency**
    *   WebAssembly executes at near-native speeds. If the calculator parses large datasets (like vast auction histories or complex market lookups), Rust will handle it exponentially faster than JavaScript.
    *   If using a Rust backend, the memory footprint and CPU usage will be remarkably low, reducing server hosting costs.

3.  **Maintainability & Ecosystem**
    *   Cargo (Rust's package manager) is exceptionally reliable compared to npm. Dependency resolution is deterministic, and you won't suffer from "left-pad" scenarios or obscure ES6 vs CommonJS module loading errors (which the project has encountered in the past).
    *   Built-in testing and documentation frameworks.

4.  **Security**
    *   If moving logic to a backend, you hide your business logic. 
    *   Rust's memory safety prevents common vulnerabilities.

### 🔴 Disadvantages & Risks (The "Gotchas")

1.  **Over-Engineering for a "Simple" Calculator**
    *   If the app is purely a stateless mathematical calculator, rewriting it in Rust might be akin to using a sledgehammer to crack a nut. 
    *   JavaScript, especially with Vue, is highly optimized for DOM manipulation and simple reactivity. Rust/Wasm frameworks still have to bridge to the DOM, which has a slight overhead.

2.  **Steep Learning Curve & Development Velocity**
    *   Rust's learning curve is notoriously steep. Time spent fighting the borrow checker could slow down the initial delivery of new features compared to rapid JS/Vue prototyping.

3.  **Bundle Size (WebAssembly)**
    *   A compiled Wasm binary might initially be larger than the equivalent minified JavaScript. While Wasm parses quickly, the initial network download time could increase slightly for users on slow mobile networks in Ukraine.

4.  **UI/UX Ecosystem Limitations**
    *   The JavaScript UI ecosystem (component libraries, chart libraries, animations) is massive. While Rust's frontend ecosystem (Yew, Leptos) is growing fast, you might find yourself writing raw CSS or JS interop code for complex UI widgets that you could have just imported via npm in Vue.

---

## Strategic Recommendation

**Phase 1: Hybrid Approach (Rust via WebAssembly for Core Logic)**
Instead of a "Big Bang" rewrite, keep the Vue.js frontend for UI and reactivity, but extract the core, complex calculation logic (`rates.service.js`, `auction-parser.service.js`, `market-lookup.service.js`) into a Rust library compiled to WebAssembly (using `wasm-pack`). 

*   **Why?** You get the UI development speed of Vue alongside the mathematical precision, speed, and safety of Rust.

**Phase 2: Full Rewrite (If Justified)**
If the application needs to evolve into a SaaS product with user accounts, stored histories, and secure payment processing, transition to a Rust Backend (Axum/Actix) to handle the database and API, keeping a lightweight frontend.
