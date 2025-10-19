🧠 SubSync — The Emotionally Intelligent AI Subtitle & Video Insight Engine
SubSync transforms ordinary videos into intelligent, interactive learning companions.
Built for educators, researchers, and lifelong learners, it goes far beyond traditional captioning — combining AI-driven transcription, emotional understanding, semantic search, and cognitive video summarization into a single, elegant platform.
🚀 Features
🎬 1. Auto-Subtitle Generation
Upload any .mp4, .webm, or .mov file and instantly receive:
Accurate subtitles with timestamps (≤12% WER in clear audio)
Downloadable .srt file
Context-preserving transcript view
🧠 Powered by fine-tuned OpenAI Whisper for precision speech recognition.
💓 2. Emotional Analysis
SubSync doesn’t just transcribe — it feels.
A trained Logistic Regression ML model detects emotional tone throughout the video, allowing viewers to understand the speaker’s affective state in real time.
Example: Detects shifts like “confident → neutral → excited” through audio cues.
🔍 3. Semantic Video Search
Find exactly where something was said.
Using vector embeddings stored in MongoDB Atlas, SubSync allows you to search conceptually rather than literally.
Example: Search “neural networks” and jump to every section where the lecturer discussed related concepts like “backpropagation” or “perceptrons.”
(Vector DB can also be configured with Supabase or other embedding stores.)
🧩 4. Study Mode — Cognitive Video Mapping
An innovative learning feature that generates a semantic map of the video, combining:
Transcript-based summary (LLM — Mistral 7B fine-tuned)
OCR-based visual context from key frames (selective-frame extraction algorithm)
NLP-driven tag extraction for topic labeling
All this merges into a textual map — a bird’s-eye view of the entire video that helps you understand the structure, key ideas, and flow at a glance.
Imagine opening a 2-hour lecture and instantly seeing a mini “mind map” of everything it contains.
🧰 Tech Stack
Layer	Technology
Frontend	HTML / CSS / JS (Flask templates)
Backend	Flask (Python)
Speech Recognition	OpenAI Whisper (fine-tuned)
Emotion Detection	Logistic Regression (custom ML model)
Semantic Search	MongoDB Atlas Vector Search / Supabase embeddings
Summarization	Mistral 7B fine-tuned LLM
Visual Context Extraction	OCR on selected key frames
Other AI Features	OpenAI Vision API, WhisperAI
🧪 System Workflow
Upload Video → Extract audio → Generate transcript (Whisper).
Emotion Detection → Logistic Regression model analyzes tone.
Embedding Generation → Convert transcript segments into vectors (for search).
Semantic Search Layer → Query embeddings via MongoDB vector index.
OCR & Visual Context → Extract key frames → Run OCR → Merge with transcript.
Summary Generation → LLM (Mistral 7B) synthesizes context + visuals.
Cognitive Map → Generate tags + textual map + downloadable summary.
🧱 Architecture Overview
┌──────────────────────────┐
│        Frontend          │
│  Upload video, search UI │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│         Flask API        │
│ Speech → Emotion → Vector│
│ OCR → LLM Summary → Map  │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│       MongoDB Atlas      │
│ Vector + Metadata + User │
└──────────────────────────┘
📦 Installation
git clone https://github.com/<your-username>/subsync.git
cd subsync
pip install -r requirements.txt
python app.py
Ensure your .env contains:
OPENAI_API_KEY=<your OpenAI key>
Then open:
http://127.0.0.1:7746/
📊 Example Use Cases
Students — auto-generate subtitles + summaries for lectures
Educators — analyze teaching tone & engagement
Researchers — semantic video search across hours of data
Content creators — auto-caption emotionally aware videos
🏆 Achievements
Built for Hackathon 2025 — Auto Caption Challenge
🥇 Winner (1st Place) for Innovation & Emotional AI Integration.
💫 Vision
SubSync isn’t just a subtitle generator — it’s a step toward cognitive media comprehension, bridging human emotion, language, and visual context into a unified understanding of video content.
✨ Author
Ayaan Hussain
AI/ML Researcher • Data Scientist • Deep Learning Enthusiast
