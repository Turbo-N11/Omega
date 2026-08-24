# Omega

> **Omega is a research tool for exploring the web, investigating topics, and organizing information through AI-powered research workflows.**

<p align="center">
  <img src="images/home.png" alt="Omega" width="800">
</p>

---

## Overview

**Omega** is a research-focused tool designed to make web research faster, more organized, and easier to navigate.

It brings web research, AI-assisted analysis, useful research sources, and session management into a single workflow — so you can research a topic without constantly switching between different tools.

Omega can be used through both its **terminal interface** and **web interface**, making it suitable for quick investigations as well as longer research sessions.
Features
🔎 Web Research — Search and investigate topics using online sources.
🤖 AI Research Assistant — Ask questions and get AI-assisted explanations.
📰 Hacker News — Browse and explore current discussions and stories.
🐙 GitHub Trending — Discover trending repositories.
📚 Research Sessions — Keep research organized across sessions.
💬 Chat History — Save and revisit previous conversations.
📥 Downloads — Export research and session information.
🌐 Web Interface — Modern browser-based interface for Omega.
🖥️ TUI Support — Continue using Omega directly from the terminal.
🌓 Dark & Light Themes — Designed with distinct, polished color palettes rather than simple black/white themes.

Screenshots

Add your screenshots to the images/ directory and update the filenames below.

<table> <tr> <td><img src="images/screenshot-1.png" alt="Omega Screenshot 1"></td> <td><img src="images/screenshot-2.png" alt="Omega Screenshot 2"></td> </tr> <tr> <td><img src="images/screenshot-3.png" alt="Omega Screenshot 3"></td> <td><img src="images/screenshot-4.png" alt="Omega Screenshot 4"></td> </tr> </table>

Installation

Clone the repository:

git clone https://github.com/YOUR_USERNAME/omega-research.git
cd omega-research

Create a virtual environment:

python -m venv .venv
source .venv/bin/activate

Install the dependencies:

pip install -r requirements.txt

Configuration

Omega can use an OpenRouter API key for its AI functionality.

Set your API key as an environment variable:

export OPENROUTER_API_KEY="your-api-key"

You can also configure the project according to the configuration system already included with your installation.

Running Omega

Web Interface

Start the web application:

python omega_web.py

Then open:

http://localhost:5000

Terminal Interface

Run Omega from the terminal:

python omega.py

The available commands can be viewed from within Omega.

Example Commands

Some of the available functionality includes:

/github-10

Fetch trending GitHub repositories.

/hn

Explore Hacker News discussions.

/save

Save the current research session.

/back

Return from the current session.

You can also interact with Omega naturally by asking research questions.

Project Structure

Omega/
├── omega.py
├── omega_web.py
├── requirements.txt
├── README.md
├── templates/
├── static/
├── images/
└── ...

The exact structure may vary depending on the version of Omega you're using.

Web UI

The web interface is designed around a research-oriented workflow rather than a generic chatbot layout.

It provides dedicated areas for:

Research conversations
Research results
Sources
Sessions
Omega utilities
Downloads
Theme customization

The interface supports both dark and light visual themes while maintaining strong contrast and readable typography.

Tech Stack

Python
Flask
OpenRouter
HTML / CSS / JavaScript
Rich
Web APIs
GitHub / Hacker News research sources

Roadmap

Potential improvements for Omega include:

 More research sources
 Better source extraction
 Automatic research summaries
 Citation management
 Local LLM support
 Ollama integration
 More export formats
 Improved research history
 Custom AI models/providers
 Advanced research workflows

Contributing

Contributions, ideas, and improvements are welcome.

Fork the repository.
Create a feature branch.
git checkout -b feature/my-feature
Make your changes.
Commit them.
git commit -m "Add my feature"
Push the branch and open a pull request.

## License

Omega is licensed under the [MIT License](LICENSE).

<p align="center"> <b>Omega Research</b><br> Research smarter. Explore deeper. </p>
