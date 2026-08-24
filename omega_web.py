#!/usr/bin/env python3
"""Omega Web UI - Flask backend reusing the omega1 engine."""

import json
import re
from pathlib import Path

from flask import Flask, jsonify, render_template, request

import omega1 as engine

app = Flask(__name__)

API_KEY = engine.get_api_key()
META_FILE = engine.OMEGA_DIR / "meta.json"


def load_meta():
    if META_FILE.exists():
        return json.loads(META_FILE.read_text())
    return {"pins": [], "tags": {}}


def save_meta(meta):
    engine.OMEGA_DIR.mkdir(parents=True, exist_ok=True)
    META_FILE.write_text(json.dumps(meta, indent=2))


def msg(role, title, markdown):
    return {"role": role, "title": title, "markdown": markdown}


def fetch_image_url(query):
    """Fetch an image URL for a given query using web search."""
    try:
        resp = engine.requests.get(
            "https://api.unsplash.com/search/photos",
            params={"query": query, "per_page": 1, "client_id": "_UNSPLASH_ACCESS_KEY_"},
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            if data.get("results"):
                return data["results"][0]["urls"]["regular"]
    except Exception:
        pass
    
    # Fallback: try to extract image from web search results
    try:
        results = engine.web_search(query + " image")
        import re
        img_pattern = r'https?://[^\s<>"]+\.(?:jpg|jpeg|png|webp|gif)'
        for result in results:
            if isinstance(result, dict):
                text = str(result)
            else:
                text = str(result)
            matches = re.findall(img_pattern, text, re.IGNORECASE)
            if matches:
                return matches[0]
    except Exception:
        pass
    
    return None


def get_state():
    meta = load_meta()
    ideas = []
    if engine.IDEAS_DIR.exists():
        for p in sorted(engine.IDEAS_DIR.glob("*.md")):
            n = 0
            sf = engine.SESSIONS_DIR / f"{p.stem}.json"
            if sf.exists():
                n = len([m for m in json.loads(sf.read_text()) if m["role"] == "user"])
            ideas.append({
                "slug": p.stem,
                "qa": n,
                "pinned": p.stem in meta.get("pins", []),
                "tags": meta.get("tags", {}).get(p.stem, []),
            })
    research = [p.stem for p in sorted((engine.OMEGA_DIR / "research").glob("*.md"))] \
        if (engine.OMEGA_DIR / "research").exists() else []
    re_ideas = [p.stem for p in sorted((engine.OMEGA_DIR / "re-ideas").glob("*.md"))] \
        if (engine.OMEGA_DIR / "re-ideas").exists() else []
    total_qa = sum(i["qa"] for i in ideas)
    return {"ideas": ideas, "research": research, "re_ideas": re_ideas, "model": engine.MODEL,
            "stats": {"ideas": len(ideas), "research": len(research),
                      "re_ideas": len(re_ideas), "qa": total_qa}}


def _note_dir(kind):
    dirs = {"ideas": engine.IDEAS_DIR,
            "research": engine.OMEGA_DIR / "research",
            "re-ideas": engine.OMEGA_DIR / "re-ideas"}
    return dirs.get(kind)


@app.route("/api/note/<kind>/<name>")
def note(kind, name):
    d = _note_dir(kind)
    f = d / f"{engine.slugify(name)}.md" if d else None
    if not f or not f.exists():
        return jsonify({"error": "not found"}), 404
    return jsonify({"name": f.stem, "markdown": f.read_text()})


@app.route("/api/note/<kind>/<name>/download")
def note_download(kind, name):
    from flask import send_file
    d = _note_dir(kind)
    f = d / f"{engine.slugify(name)}.md" if d else None
    if not f or not f.exists():
        return jsonify({"error": "not found"}), 404
    return send_file(f, as_attachment=True, download_name=f"{f.stem}.md")


@app.route("/api/note/<kind>/<name>", methods=["DELETE"])
def note_delete(kind, name):
    d = _note_dir(kind)
    f = d / f"{engine.slugify(name)}.md" if d else None
    if not f or not f.exists():
        return jsonify({"error": "not found"}), 404
    f.unlink()
    if kind == "ideas":
        sf = engine.SESSIONS_DIR / f"{f.stem}.json"
        if sf.exists():
            sf.unlink()
        meta = load_meta()
        if f.stem in meta.get("pins", []):
            meta["pins"].remove(f.stem)
        meta.get("tags", {}).pop(f.stem, None)
        save_meta(meta)
    return jsonify({"ok": True, "state": get_state()})


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/state")
def state():
    return jsonify(get_state())


@app.route("/api/new", methods=["POST"])
def new_idea():
    name = (request.json or {}).get("idea", "").strip()
    if not name:
        return jsonify({"error": "idea name required"}), 400
    slug = engine.slugify(name)
    idea_file = engine.IDEAS_DIR / f"{slug}.md"
    if idea_file.exists():
        return jsonify({"error": f"'{name}' already exists", "slug": slug}), 409
    web = engine.format_web_results(engine.web_search(name))
    prompt = (
        f"Research the topic/concept: '{name}'. Produce a markdown research document "
        "with EXACTLY these sections, each starting with '## ' :\n"
        "## Introduction  (what the topic/idea is about)\n"
        "## More Details  (extra important details)\n"
        "## Supported / Related Topics  (bulleted list)\n"
        "## How It Is Formally Used / Implemented\n"
        "## How I Can Implement It  (practical steps for a developer)\n"
        "## What Projects I Can Build With This Concept  (project ideas)\n"
        "## Resources  (links: docs, GitHub repos, YouTube videos - use the live web results "
        "below when relevant, plus your own knowledge)\n\n"
        f"Live web results for this topic:\n{web}\n\n"
        "Output ONLY the sections after the main title."
    )
    body = engine.ask_llm_or_error(API_KEY, [{"role": "user", "content": prompt}])
    
    # Fetch an image for the document
    image_url = fetch_image_url(name)
    image_section = ""
    if image_url:
        image_section = f"\n\n![{name}]({image_url})\n\n---\n"
    
    idea_file.write_text(f"# {name}\n{image_section}\n{body}\n")
    return jsonify({"slug": slug, "markdown": body, "state": get_state()})


@app.route("/api/session/<slug>")
def session_history(slug):
    idea_file = engine.IDEAS_DIR / f"{slug}.md"
    if not idea_file.exists():
        return jsonify({"error": "not found"}), 404
    history = engine.load_session(slug)
    messages = [msg(m["role"], "", m["content"]) for m in history if m["role"] != "system"]
    return jsonify({"slug": slug, "doc": idea_file.read_text(), "messages": messages})


@app.route("/api/ask", methods=["POST"])
def ask():
    data = request.json or {}
    slug, q = data.get("slug", ""), (data.get("question") or "").strip()
    if not slug or not q:
        return jsonify({"error": "slug and question required"}), 400
    idea_file = engine.IDEAS_DIR / f"{slug}.md"
    if not idea_file.exists():
        return jsonify({"error": "not found"}), 404
    history = engine.load_session(slug)
    if not history:
        doc = idea_file.read_text()
        history = [{
            "role": "system",
            "content": (
                "You are Omega, a research assistant. The user has a saved research document "
                f"about '{slug}':\n\n---\n{doc}\n---\n"
                "Answer questions primarily from this document. If info is missing or may be "
                "outdated, say so and supplement with your own knowledge. Be concise but thorough."
            ),
        }]
    history.append({"role": "user", "content": q})
    web = engine.format_web_results(engine.web_search(q))
    grounded = history[:-1] + [{
        "role": "user",
        "content": f"{q}\n\n[Live web results that may help - cite links when used]:\n{web}",
    }]
    answer = engine.ask_llm_or_error(API_KEY, grounded)
    history.append({"role": "assistant", "content": answer})
    engine.save_session(slug, history)
    return jsonify({"answer": answer, "state": get_state()})


@app.route("/api/research", methods=["POST"])
def research():
    topic = (request.json or {}).get("topic", "").strip()
    if not topic:
        return jsonify({"error": "topic required"}), 400
    query = engine.clean_query(topic)
    papers = engine.fetch_papers(query)
    md = engine.format_papers(papers)
    research_dir = engine.OMEGA_DIR / "research"
    research_dir.mkdir(exist_ok=True)
    path = research_dir / f"{engine.slugify(topic)}.md"
    path.write_text(engine.PAPERS_TEMPLATE.format(topic=topic, papers=md))
    return jsonify({"query": query, "markdown": md, "state": get_state()})


@app.route("/api/re-idea", methods=["POST"])
def re_idea():
    description = (request.json or {}).get("description", "").strip()
    if not description:
        return jsonify({"error": "description required"}), 400
    understanding = engine.ask_llm_or_error(API_KEY, [{
        "role": "user",
        "content": (
            "Restate the following project/product idea clearly in short bullet points, "
            "capturing what it does, who it's for and its core value. Then add a line "
            "'Potential gaps:' listing anything ambiguous.\n\nIdea:\n" + description
        ),
    }])
    slug = engine.slugify(description[:50])
    return jsonify({"understanding": understanding, "slug": slug})


@app.route("/api/re-idea/confirm", methods=["POST"])
def re_idea_confirm():
    data = request.json or {}
    description = data.get("description", "").strip()
    understanding = data.get("understanding", "").strip()
    if not description or not understanding:
        return jsonify({"error": "description and understanding required"}), 400
    ideas_dir = engine.OMEGA_DIR / "re-ideas"
    ideas_dir.mkdir(exist_ok=True)
    slug = engine.slugify(description[:50])
    path = ideas_dir / f"{slug}.md"
    path.write_text(f"# Idea\n\n{description}\n\n# Understanding\n\n{understanding}\n")
    papers = engine.fetch_papers(description)
    papers_md = engine.format_papers(papers)
    papers_path = ideas_dir / f"{slug}-papers.md"
    papers_path.write_text(engine.PAPERS_TEMPLATE.format(topic=description, papers=papers_md))
    return jsonify({"slug": slug, "papers": papers_md, "state": get_state()})


@app.route("/api/github10", methods=["POST"])
def github10():
    repos = engine.fetch_github_trending()
    real = [r for r in repos if r["url"]]
    if not real:
        return jsonify({"error": repos[0]["full_name"]}), 502
    out = engine.describe_repos_with_llm(API_KEY, real)
    return jsonify({"markdown": out})


@app.route("/api/trend", methods=["POST"])
def trend():
    field = (request.json or {}).get("field", "").strip()
    if not field:
        return jsonify({"error": "field required"}), 400
    query = engine.clean_query(field)
    try:
        resp = engine.requests.get(
            engine.GITHUB_SEARCH_URL,
            params={"q": query, "sort": "stars", "order": "desc", "per_page": 10},
            headers={"User-Agent": "Omega research tool", "Accept": "application/vnd.github+json"},
            timeout=30,
        )
        resp.raise_for_status()
        items = resp.json().get("items", [])
    except engine.requests.RequestException:
        items = []
    descs = [f"{r['full_name']} {(r.get('description') or '')}" for r in items]
    papers = engine.fetch_papers(query, max_results=10)
    shown = [p for p in papers if p["url"]][:5]

    md = ["**GitHub — top repos in this field**", ""]
    for idx in engine.nlp_relevance(field, descs):
        r = items[idx]
        md.append(f"**{r['full_name']}** `{r['stargazers_count']} ★`")
        md.append(f"<{r['html_url']}>")
        md.append("")
    md.append("**arXiv — recent papers**")
    md.append("")
    for p in shown:
        md.append(f"* [{p['title']}]({p['url']})")
    repos_md = "\n".join(md)

    repo_names = ", ".join(items[i]["full_name"] for i in engine.nlp_relevance(field, descs)[:5]) if items else "n/a"
    paper_titles = "; ".join(p["title"] for p in shown[:5])
    analysis = engine.ask_llm_or_error(API_KEY, [{
        "role": "user",
        "content": (
            f"For someone tracking the '{field}' field, give a short analysis:\n"
            "1. What these trending repos signal\n2. What the recent papers focus on\n"
            "3. One concrete project idea at the intersection. Be concise.\n\n"
            f"Trending repos: {repo_names}\nRecent papers: {paper_titles}"
        )}])
    return jsonify({"repos": repos_md, "analysis": analysis})


@app.route("/api/hn", methods=["POST"])
def hn():
    topic = (request.json or {}).get("topic", "").strip()
    if not topic:
        return jsonify({"error": "topic required"}), 400
    query = engine.clean_query(topic)
    try:
        resp = engine.requests.get(
            engine.HN_ALGOLIA_URL,
            params={"query": query, "tags": "story", "hitsPerPage": 20},
            timeout=30,
        )
        resp.raise_for_status()
        hits = [h for h in resp.json().get("hits", []) if h.get("title")]
    except engine.requests.RequestException as e:
        return jsonify({"error": str(e)}), 502
    if not hits:
        return jsonify({"markdown": "No stories found."})
    texts = [f"{h['title']} {(h.get('story_text') or h.get('comment_text') or '')}" for h in hits]
    q_kw = set(engine.extract_keywords(topic))
    ranked = sorted(
        range(len(hits)),
        key=lambda i: (-len(q_kw & set(engine.extract_keywords(texts[i]))),
                       -(hits[i].get("points") or 0)),
    )
    md = ["**Top discussions**", ""]
    for i in ranked[:10]:
        h = hits[i]
        url = h.get("url") or f"https://news.ycombinator.com/item?id={h['objectID']}"
        md.append(f"**{h['title']}**  `{h.get('points') or 0} pts · {h.get('num_comments') or 0} comments`")
        md.append(f"<{url}>")
        snippet = engine.summarize_text(texts[i], 1)
        if snippet and snippet != texts[i][:400]:
            md.append(f"> {snippet[:200]}")
        md.append("")
    return jsonify({"query": query, "markdown": "\n".join(md)})


@app.route("/api/sum", methods=["POST"])
def sum_idea():
    slug = (request.json or {}).get("slug", "").strip()
    idea_file = engine.IDEAS_DIR / f"{slug}.md"
    if not slug or not idea_file.exists():
        return jsonify({"error": "not found"}), 404
    summary = engine.ask_llm_or_error(API_KEY, [{
        "role": "user",
        "content": (
            "Summarize this research document in one page max: a 3-4 line TL;DR, then "
            "key points as bullets, then 'Worth building:' with the best project idea "
            "from it.\n\n" + idea_file.read_text()
        ),
    }])
    return jsonify({"markdown": summary})


@app.route("/api/roadmap", methods=["POST"])
def roadmap():
    slug = (request.json or {}).get("slug", "").strip()
    idea_file = engine.IDEAS_DIR / f"{slug}.md"
    if not slug or not idea_file.exists():
        return jsonify({"error": "not found"}), 404
    out = engine.ask_llm_or_error(API_KEY, [{
        "role": "user",
        "content": (
            "Based on this research document, create a practical step-by-step roadmap to "
            "build the best project from it. Format:\n"
            "**Goal:** one line\n"
            "Then numbered phases (1., 2., ...) each with: what to do, tools/libs to use, "
            "and a concrete 'done when:' checkpoint. Keep it realistic for one developer.\n\n"
            + idea_file.read_text()
        ),
    }])
    return jsonify({"markdown": out})


@app.route("/api/compare", methods=["POST"])
def compare():
    data = request.json or {}
    a, b = data.get("a", "").strip(), data.get("b", "").strip()
    sa, sb = engine.slugify(a), engine.slugify(b)
    fa, fb = engine.IDEAS_DIR / f"{sa}.md", engine.IDEAS_DIR / f"{sb}.md"
    if not fa.exists() or not fb.exists():
        return jsonify({"error": "both ideas must exist"}), 404
    out = engine.ask_llm_or_error(API_KEY, [{
        "role": "user",
        "content": (
            "Compare these two research documents. Format:\n"
            "## Overview (one line each)\n## Comparison table (markdown: criteria rows - "
            "learning value, build difficulty, usefulness, novelty)\n## Verdict: which to "
            "pick first and why (2-3 lines)\n\n"
            f"### Document A: {sa}\n{fa.read_text()}\n\n"
            f"### Document B: {sb}\n{fb.read_text()}"
        ),
    }])
    return jsonify({"markdown": out})


@app.route("/api/find")
def find():
    term = (request.args.get("q") or "").strip().lower()
    if not term:
        return jsonify({"error": "q required"}), 400
    matches = []
    dirs = [engine.IDEAS_DIR]
    rd = engine.OMEGA_DIR / "research"
    if rd.exists():
        dirs.append(rd)
    for d in dirs:
        if not d.exists():
            continue
        for f in sorted(d.glob("*.md")):
            label = f.stem if d == engine.IDEAS_DIR else f"research/{f.stem}"
            for i, line in enumerate(f.read_text().splitlines(), 1):
                if term in line.lower():
                    matches.append({"note": label, "line": i, "text": line.strip()})
    return jsonify({"matches": matches[:50]})


@app.route("/api/pin", methods=["POST"])
def pin_idea():
    slug = (request.json or {}).get("slug", "").strip()
    if not slug:
        return jsonify({"error": "slug required"}), 400
    meta = load_meta()
    pins = meta.get("pins", [])
    if slug in pins:
        pins.remove(slug)
    else:
        pins.append(slug)
    meta["pins"] = pins
    save_meta(meta)
    return jsonify({"ok": True, "pinned": slug in pins, "state": get_state()})


@app.route("/api/tag", methods=["POST"])
def tag_idea():
    data = request.json or {}
    slug = data.get("slug", "").strip()
    tag = data.get("tag", "").strip().lower()
    action = data.get("action", "add")
    if not slug or not tag:
        return jsonify({"error": "slug and tag required"}), 400
    meta = load_meta()
    tags = meta.get("tags", {})
    idea_tags = tags.get(slug, [])
    if action == "add" and tag not in idea_tags:
        idea_tags.append(tag)
    elif action == "remove" and tag in idea_tags:
        idea_tags.remove(tag)
    tags[slug] = idea_tags
    meta["tags"] = tags
    save_meta(meta)
    return jsonify({"ok": True, "tags": idea_tags, "state": get_state()})


@app.route("/api/export-all")
def export_all():
    parts = []
    if engine.IDEAS_DIR.exists():
        for f in sorted(engine.IDEAS_DIR.glob("*.md")):
            parts.append(f"# {f.stem}\n\n{f.read_text()}\n\n---\n")
    rd = engine.OMEGA_DIR / "research"
    if rd.exists():
        for f in sorted(rd.glob("*.md")):
            parts.append(f"# research/{f.stem}\n\n{f.read_text()}\n\n---\n")
    ri = engine.OMEGA_DIR / "re-ideas"
    if ri.exists():
        for f in sorted(ri.glob("*.md")):
            parts.append(f"# re-ideas/{f.stem}\n\n{f.read_text()}\n\n---\n")
    return jsonify({"markdown": "\n".join(parts)})


if __name__ == "__main__":
    print("Omega Web UI → http://localhost:5000")
    app.run(debug=False, port=5000)
