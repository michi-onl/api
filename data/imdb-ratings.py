import csv
import json
from pathlib import Path

here = Path(__file__).parent
rows = []

with open(here / "imdb-ratings.csv", newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        rows.append({
            "title": row["Title"],
            "rating": int(row["Your Rating"]),
            "date": row["Date Rated"],
            "imdbId": row["Const"],
        })

with open(here / "imdb-ratings.json", "w", encoding="utf-8") as f:
    json.dump(rows, f, indent=2, ensure_ascii=False)
    f.write("\n")

print(f"Wrote {len(rows)} ratings to imdb-ratings.json")
