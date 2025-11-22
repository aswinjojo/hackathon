import requests
import csv
from datetime import datetime, timedelta
import time

API_KEY = "a191032c13a54587b28066cb90fd76af"
BASE_URL = "https://api.gridstatus.io/v1/datasets/ercot_real_time_system_conditions/query"
OUTPUT_CSV = "ercot_streamed_data.csv"

MONTHS = ["2024-06", "2024-07", "2024-08"]
GAP = 5  # days per API call


def fetch_interval(start_time, end_time, csv_writer, wrote_header_flag):
    """Fetch data for one interval and stream output to CSV immediately."""
    print(f"\nFetching {start_time} → {end_time}")

    cursor = None

    while True:
        params = {
            "start_time": start_time,
            "end_time": end_time,
            "timezone": "market",
        }
        if cursor:
            params["cursor"] = cursor

        headers = {"x-api-key": API_KEY}

        # Retry until success (no fixed 20 sec delay)
        while True:
            try:
                response = requests.get(BASE_URL, params=params, headers=headers, timeout=120)
                if response.status_code == 200:
                    break
                else:
                    print(f" API returned {response.status_code}. Retrying in 5 sec...")
                    time.sleep(5)
            except Exception as e:
                print(f" Network error {e}, retrying in 5 sec...")
                time.sleep(5)

        json_data = response.json()
        data = json_data.get("data", [])

        if data:
            # Write header once
            if not wrote_header_flag[0]:
                csv_writer.writeheader()
                wrote_header_flag[0] = True

            # Stream write row-by-row
            for row in data:
                csv_writer.writerow(row)

        meta = json_data.get("meta", {})
        if not meta.get("hasNextPage"):
            break

        cursor = meta.get("cursor")
        print("  -> Fetching next page...")


def generate_intervals():
    """Generate 5-day intervals for June, July, August 2024."""
    intervals = []

    for month in MONTHS:
        year, m = month.split("-")
        start = datetime(int(year), int(m), 1)

        # End of month
        if m == "12":
            next_month = datetime(int(year) + 1, 1, 1)
        else:
            next_month = datetime(int(year), int(m) + 1, 1)
        end_of_month = next_month - timedelta(days=1)

        current = start
        while current <= end_of_month:
            interval_start = current.strftime("%Y-%m-%d")
            interval_end = min(current + timedelta(days=GAP - 1), end_of_month).strftime("%Y-%m-%d")

            intervals.append((interval_start, interval_end))
            current += timedelta(days=GAP)

    return intervals


def main():
    print("Preparing intervals...\n")
    intervals = generate_intervals()

    wrote_header_flag = [False]  # mutable flag to track header write

    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        csv_writer = None

        # CSV writer created after first row
        for start, end in intervals:
            if csv_writer is None:
                # Create writer using first interval's columns dynamically
                # Make a small trial request only to extract header
                temp_params = {
                    "start_time": start,
                    "end_time": end,
                    "timezone": "market"
                }
                headers = {"x-api-key": API_KEY}
                trial = requests.get(BASE_URL, params=temp_params, headers=headers).json()
                columns = list(trial["data"][0].keys())
                csv_writer = csv.DictWriter(f, fieldnames=columns)

            fetch_interval(start, end, csv_writer, wrote_header_flag)

    print(f"\nDONE! Streamed CSV saved as: {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
