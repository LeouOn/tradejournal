import os
import sys
import json
import datetime
import numpy as np
import pandas as pd
import requests
import yfinance as yf
from sklearn.preprocessing import StandardScaler
from hmmlearn.hmm import GaussianHMM
from dotenv import load_dotenv

# Load env file from backend or local
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", "backend", ".env"))

BACKEND_URL = "http://localhost:5000/api/market/regime"
FRED_API_KEY = os.getenv("FRED_API_KEY", "")

def get_fred_data(series_id, start_date, end_date):
    """
    Fetches series from FRED API. Falls back to mock data if key is missing.
    """
    if FRED_API_KEY:
        url = f"https://api.stlouisfed.org/fred/series/observations?series_id={series_id}&api_key={FRED_API_KEY}&file_type=json&observation_start={start_date}&observation_end={end_date}"
        try:
            r = requests.get(url, timeout=10)
            if r.status_code == 200:
                data = r.json()
                obs = data.get("observations", [])
                dates = [o["date"] for o in obs]
                values = []
                for o in obs:
                    try:
                        values.append(float(o["value"]))
                    except ValueError:
                        values.append(np.nan)
                df = pd.DataFrame({"Date": pd.to_datetime(dates), series_id: values})
                df = df.dropna().set_index("Date")
                return df
        except Exception as e:
            print(f"Error fetching {series_id} from FRED: {e}. Falling back to mock data.")

    # Mock Data Fallback: Generate reasonable rates based on date
    print(f"FRED Key not found or error. Generating mock history for {series_id}...")
    dr = pd.date_range(start=start_date, end=end_date, freq="D")
    df = pd.DataFrame(index=dr)
    df.index.name = "Date"

    if series_id == "FEDFUNDS":
        # Simulate Fed interest rates over time (low in 2020/2021, rising in 2022/2023, high in 2024-2026)
        vals = []
        for d in dr:
            if d.year <= 2021:
                vals.append(0.1 + np.random.normal(0, 0.02))
            elif d.year == 2022:
                # ramp up from 0.1 to 4.25
                frac = (d.month - 1) / 11
                vals.append(0.1 + frac * 4.15 + np.random.normal(0, 0.05))
            elif d.year == 2023:
                # ramp up from 4.25 to 5.25
                frac = (d.month - 1) / 11
                vals.append(4.25 + frac * 1.0 + np.random.normal(0, 0.02))
            else:
                vals.append(5.25 + np.random.normal(0, 0.01))
        df[series_id] = vals
    elif series_id == "CPIAUCSL":
        # Simulate CPI YoY Inflation rate
        vals = []
        for d in dr:
            if d.year <= 2020:
                vals.append(1.5 + np.random.normal(0, 0.1))
            elif d.year == 2021:
                vals.append(4.5 + np.random.normal(0, 0.2))
            elif d.year == 2022:
                # Inflation spike peaking in June 2022 at ~9%
                month_factor = np.sin((d.month / 12) * np.pi)
                vals.append(7.5 + month_factor * 1.5 + np.random.normal(0, 0.2))
            elif d.year == 2023:
                vals.append(4.0 + np.random.normal(0, 0.15))
            else:
                vals.append(2.8 + np.random.normal(0, 0.05))
        df[series_id] = vals
    else:
        df[series_id] = 1.0

    return df

def main():
    print("Initializing Market Regime Classification Pipeline...")

    # Set temporal window: 5 years of historical data for model convergence
    end_date = datetime.date.today()
    start_date = end_date - datetime.timedelta(days=5 * 365)

    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")

    print(f"Downloading historical index data from Yahoo Finance ({start_str} to {end_str})...")
    try:
        spx = yf.download("^SPX", start=start_str, end=end_str)
        vix = yf.download("^VIX", start=start_str, end=end_str)
    except Exception as e:
        print(f"Critical error downloading data from Yahoo Finance: {e}")
        sys.exit(1)

    if spx.empty or vix.empty:
        print("Error: Incomplete data downloaded.")
        sys.exit(1)

    # Align DataFrames
    # Yahoo returns multi-index columns depending on pandas/yfinance version. Flatten if needed.
    if isinstance(spx.columns, pd.MultiIndex):
        spx.columns = spx.columns.get_level_values(0)
    if isinstance(vix.columns, pd.MultiIndex):
        vix.columns = vix.columns.get_level_values(0)

    df_spx = spx[["Close"]].rename(columns={"Close": "SPX_Close"})
    df_vix = vix[["Close"]].rename(columns={"Close": "VIX_Close"})
    
    merged = pd.merge(df_spx, df_vix, left_index=True, right_index=True, how="inner")
    
    # Check index name and flatten values
    merged.index = pd.to_datetime(merged.index)

    print("Engineering features...")
    # Calculate log returns of SPX
    merged["SPX_Return"] = np.log(merged["SPX_Close"] / merged["SPX_Close"].shift(1))
    
    # Calculate 200 SMA of SPX and distance
    merged["SPX_200SMA"] = merged["SPX_Close"].rolling(window=200).mean()
    merged["Dist_200SMA"] = (merged["SPX_Close"] - merged["SPX_200SMA"]) / merged["SPX_200SMA"]
    
    # Calculate Volatility indicators
    # SPX 20-day ATR ratio to price
    high = spx["High"]
    low = spx["Low"]
    close = spx["Close"]
    tr = pd.concat([high - low, (high - close.shift(1)).abs(), (low - close.shift(1)).abs()], axis=1).max(axis=1)
    atr = tr.rolling(window=20).mean()
    merged["ATR_Ratio"] = (atr / merged["SPX_Close"]).astype(float)
    
    # Drop rows with NaN due to lag indicators (200 SMA)
    data_clean = merged.dropna()

    # Features for HMM
    # We cluster on: SPX Daily Return, VIX Close Level, Dist_200SMA, ATR_Ratio
    features = ["SPX_Return", "VIX_Close", "Dist_200SMA", "ATR_Ratio"]
    X = data_clean[features].values

    print(f"Training Hidden Markov Model on {len(X)} daily data records...")
    # Standardize features for HMM
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # Define 4-State Gaussian HMM
    # covariance_type="full" allows capturing correlation structures between indices and returns
    model = GaussianHMM(n_components=4, covariance_type="full", n_iter=100, random_state=42)
    model.fit(X_scaled)
    
    # Predict hidden states
    hidden_states = model.predict(X_scaled)
    data_clean = data_clean.copy()
    data_clean["State"] = hidden_states

    # Dynamic State Labeling: HMM assigns state indices randomly.
    # We sort states based on average VIX level and SPX return to assign human names.
    state_means = []
    for i in range(4):
        state_data = data_clean[data_clean["State"] == i]
        mean_vix = float(state_data["VIX_Close"].mean())
        mean_return = float(state_data["SPX_Return"].mean())
        state_means.append({"state_idx": i, "mean_vix": mean_vix, "mean_return": mean_return})

    # Sort primarily by Volatility (VIX) and secondarily by returns
    state_means.sort(key=lambda s: s["mean_vix"])
    
    # Labeling scheme:
    # 0, 1 -> Lower Volatility (Bullish / Stable)
    # 2, 3 -> Higher Volatility (Bearish / Volatile)
    state_names = {}
    
    # State 0 (lowest VIX): Stable Bullish
    state_names[state_means[0]["state_idx"]] = "Bullish - Low Volatility"
    
    # State 1 (2nd lowest VIX): Healthy Chop / Reversal
    if state_means[1]["mean_return"] >= 0:
        state_names[state_means[1]["state_idx"]] = "Bullish - High Volatility"
    else:
        state_names[state_means[1]["state_idx"]] = "Bearish - Low Volatility"

    # State 2 (3rd VIX): Bearish / Volatile
    if state_means[2]["mean_return"] >= 0:
        state_names[state_means[2]["state_idx"]] = "Bullish - High Volatility"
    else:
        state_names[state_means[2]["state_idx"]] = "Bearish - Low Volatility"

    # State 3 (highest VIX): High Volatility Catastrophe / Revenge regimes
    state_names[state_means[3]["state_idx"]] = "Bearish - High Volatility"

    # Print state mappings
    print("\nModel Converged! Discovered Regime Mappings:")
    for idx, name in state_names.items():
        vix_avg = data_clean[data_clean["State"] == idx]["VIX_Close"].mean()
        ret_avg = data_clean[data_clean["State"] == idx]["SPX_Return"].mean() * 100
        print(f" - State {idx} -> \"{name}\" (Avg VIX: {float(vix_avg):.2f}, Avg Return: {float(ret_avg):.4f}%)")

    # Extract current state details
    current_row = data_clean.iloc[-1]
    current_state_idx = int(current_row["State"])
    current_regime = state_names[current_state_idx]
    current_vix = float(current_row["VIX_Close"])
    
    spx_close = float(current_row["SPX_Close"])
    spx_200 = float(current_row["SPX_200SMA"])
    spx_trend = "ABOVE_200SMA" if spx_close >= spx_200 else "BELOW_200SMA"

    # Fetch FRED macroeconomic variables
    # Fed Funds rate
    fed_df = get_fred_data("FEDFUNDS", start_str, end_str)
    current_fed = 5.25 # standard fallback
    if not fed_df.empty:
        current_fed = float(fed_df.iloc[-1]["FEDFUNDS"])

    print(f"\nCurrent Market State Classified:")
    print(f" - Regime Type: {current_regime}")
    print(f" - S&P 500 Close: {spx_close:.2f} ({spx_trend})")
    print(f" - VIX Volatility index: {current_vix:.2f}")
    print(f" - Fed Funds Rate: {current_fed:.2f}%")

    # Post results to Express server
    payload = {
      "regime_type": current_regime,
      "vix_level": current_vix,
      "fed_funds_rate": current_fed,
      "spx_trend": spx_trend
    }

    try:
        r = requests.post(BACKEND_URL, json=payload, timeout=5)
        if r.status_code == 200:
            print("\nSuccessfully posted latest market regime coordinates to backend API!")
        else:
            print(f"\nBackend API returned status code {r.status_code}: {r.text}")
    except Exception as e:
        print(f"\nCould not connect to backend server on {BACKEND_URL} to publish regime shift: {e}")

if __name__ == "__main__":
    # Standard script run or --test validation run
    main()
