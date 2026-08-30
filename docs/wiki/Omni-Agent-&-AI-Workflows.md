# Omni-Agent & AI Workflows

The **Omni-Agent** is BOZ's multi-perspective conversational intelligence core. It acts as an autonomous market analyst capable of selecting domain-specific tools, synthesizing conflicting market signals, and generating structured verdicts with transparent reasoning.

---

## 🤖 Multi-Perspective Synthesis Loop

`mermaid
flowchart TD
    Prompt[User Market Query or Analysis Request] --> Router[Omni-Agent Intent Router]
    
    subgraph Tool Calling & Evidence Gathering
        Router --> T1[get_market_quote]
        Router --> T2[get_technical_indicators]
        Router --> T3[get_macro_regime]
        Router --> T4[get_news_and_sentiment]
        Router --> T5[calculate_risk_reward]
    end

    subgraph Analytical Perspectives
        T1 & T2 --> P1[Quantitative & Structural Analyst]
        T3 --> P2[Macroeconomic Regime Analyst]
        T4 --> P3[Sentiment & Crowd Psychology Analyst]
        T5 --> P4[Risk & Trade Execution Manager]
    end

    P1 & P2 & P3 & P4 --> Synthesis[Reflection & Synthesis Engine]
    Synthesis --> Output[Consolidated Action, Conviction, Key Levels & Invalidation Criteria]
`

---

## 🛠️ Supported AI Backends

BOZ is provider-agnostic and supports major AI inference providers through standard OpenAI-compatible API schemas:

| Provider | Configuration Key | Default Model | Description |
|---|---|---|---|
| **GitHub Models** | GITHUB_TOKEN | gpt-4o | Built-in free inference tier for GitHub developers. |
| **NVIDIA NIM** | NVIDIA_API_KEY | meta/llama-3.3-70b-instruct | High-throughput, accelerated cloud inference. |
| **Ollama (Local)** | OLLAMA_BASE_URL | llama3 / qwen2.5 | 100% private, offline inference running on your local machine. |
| **OpenAI** | OPENAI_API_KEY | gpt-4o-mini / gpt-4o | Standard direct OpenAI API integration. |
| **Custom / OpenAI-Compatible** | OPENAI_BASE_URL | Configurable | Compatible with vLLM, LM Studio, Groq, Together AI, and OpenRouter. |

---

## 🔍 Conversational Workflows

1. **Free-Form Queries**: Ask conversational questions like *"What is the momentum outlook for BBCA.JK after earnings?"* or *"Analyze BTC-USD with 4-hour support levels."*
2. **Preset Research Actions**: One-click quick actions for Macro Health Check, Crypto Breadth, and Top IDX Breakout Candidates.
3. **Session Retention**: Retains recent conversation context and analysis history for follow-up trade adjustments and thesis stress-testing.
