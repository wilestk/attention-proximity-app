"""
app.py - Flask wrapper for the Proximity Score pipeline.
Loads the model once at startup; exposes POST /score.
Run with: python app.py  (or use run.py in the parent directory)
"""

from flask import Flask, request, jsonify
from scorer import load_model, score_text, is_ready

app = Flask(__name__)


@app.route("/health", methods=["GET"])
def health():
    if is_ready():
        return jsonify({"status": "ready"})
    return jsonify({"status": "loading"}), 503


@app.route("/score", methods=["POST"])
def score():
    data = request.get_json(force=True)
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "text field is required"}), 400
    try:
        result = score_text(text)
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    load_model()
    app.run(host="127.0.0.1", port=5000, debug=False)
