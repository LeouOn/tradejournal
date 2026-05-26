# Antigravity Quantitative Trading Journal

An advanced, AI-integrated local trading journal designed for quantitative and discretionary traders. It emphasizes mathematical discipline, execution reconciliation, and behavioral auditing via an integrated local LLM (LM Studio).

## 🚀 Features Currently Implemented

### 1. Core Data Engine & Analytics
- **Prisma SQLite Backend**: Zero-setup, localized persistence for maximum privacy.
- **Deep Metrics Calculation**: Tracks Win Rate, Profit Factor, R-Multiple Expectancy, Max Drawdown, and gamifies performance into a unified "Zella Score" (0-100).
- **Behavioral Tagging**: Track setups (e.g., Breakout, Mean Reversion), Biases (Long/Short/Range), and emotional errors (FOMO, Revenge Trading). Calculate the "Cost of Indiscipline".

### 2. Statement Reconciliation
- **Ironbeam Integration**: Paste raw statement logs. The backend reconciles manual entries against broker executions, highlighting **Slippage**, **Ghost Trades** (unjournaled impulsive trades), and **Orphan Trades** (manifested but unfilled).

### 3. AI Behavioral Coach (Local LLM)
- **LM Studio Integration**: Uses an OpenAI-compatible SDK pointing to `http://localhost:1234/v1`.
- **RAG Context**: The backend automatically generates semantic vector embeddings of trade notes. When you chat with the coach, it retrieves relevant past trades and embeds your core mathematical stats.
- **Natural Language Trade Entry**: The LLM uses function/tool calling (`log_trade`). You can tell it "I went long 2 NQ at 18000" and it will automatically execute the trade insertion in the database.
- **Persistent Memory**: Full chat history and model selection.

### 4. Marketpulse API & Integrations
- **Daily Chart Gallery**: Upload and store high-resolution Base64 TradingView screenshots locally for historical reference.
- **External API Router**: Located at `/api/external/v1`, secured via API Key. Exposes endpoints for an external "Marketpulse" dashboard to pull live equity curves, Zella scores, and AI summaries.

## 🛠 Tech Stack
- **Frontend**: React (Vite), CSS Modules, Lucide Icons, Recharts.
- **Backend**: Node.js, Express, Prisma ORM, SQLite.
- **AI/ML**: OpenAI NodeJS SDK (pointed to local LM Studio).

## 🚦 Getting Started

1. **Install Dependencies**:
   ```bash
   cd backend && npm install
   cd ../frontend && npm install
   ```

2. **Database Setup**:
   ```bash
   cd backend
   npx prisma generate
   npx prisma db push
   ```

3. **Run Development Servers**:
   You can run both concurrently from the root or in separate terminals:
   - Backend: `cd backend && npm run dev` (Runs on `http://localhost:5000`)
   - Frontend: `cd frontend && npm run dev` (Runs on `http://localhost:5173`)

4. **AI Configuration**:
   Ensure LM Studio is running its local server on port `1234`. The backend will automatically detect it and query available models.
