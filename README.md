
# SubSyncAI 🧠
### The Emotionally Intelligent AI Subtitle & Video Insight Engine

> 🏆 1st Place — Exypnos 2025 Hackathon (Auto Caption Challenge) | La Martiniere for Boys

SubSync turns any video into an interactive learning companion. Built way beyond the hackathon brief — it doesn't just caption, it understands: transcribing speech, detecting emotion, semantically searching content, and generating cognitive maps of entire lectures.

---

## Why SubSync?

Most captioning tools stop at text. SubSync asks a deeper question: *what if your video could think?*

A student opens a 2-hour lecture. Instead of scrubbing through it blindly, SubSync gives them a mind map of everything it contains, lets them search *concepts* not just keywords, and tells them when the lecturer was most engaged. That's the difference.

---

## Features

### 🎬 Auto-Subtitle Generation
Upload `.mp4`, `.webm`, or `.mov` and receive:
- Accurate subtitles with timestamps (≤12% WER on clear audio)
- Downloadable `.srt` file
- Full context-preserving transcript

Powered by a **fine-tuned OpenAI Whisper** model trained for precision speech recognition.

### 💓 Emotional Analysis
A custom-trained **Logistic Regression model** detects the speaker's emotional tone in real time — tracking shifts like `confident → neutral → excited` through audio cues. SubSync doesn't just hear what was said. It understands how it was said.

### 🔍 Semantic Video Search
Search *concepts*, not keywords. Using **vector embeddings stored in MongoDB Atlas**, SubSync finds every moment in a video related to your query — even if the exact words were never used.

> Search "neural networks" → jumps to every segment discussing backpropagation, perceptrons, and gradient descent.

(Compatible with Supabase or any embedding store.)

### 🧩 Study Mode — Cognitive Video Mapping
The flagship feature. SubSync generates a full semantic map of any video by combining:
- **Transcript summarisation** via fine-tuned Mistral 7B LLM
- **Visual context extraction** via OCR on selectively sampled key frames
- **NLP-driven topic tagging** for structured labelling

The result: a bird's-eye view of any video's structure, ideas, and flow — generated instantly.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML / CSS / JS (Flask templates) |
| Backend | Flask (Python) |
| Speech Recognition | OpenAI Whisper (fine-tuned) |
| Emotion Detection | Logistic Regression (custom trained) |
| Semantic Search | MongoDB Atlas Vector Search |
| Summarisation | Mistral 7B (fine-tuned) |
| Visual Context | OCR on selective key frames |
| Additional AI | OpenAI Vision API |

---

## System Workflow

Upload Video
→ Extract audio → Whisper transcription
→ Logistic Regression emotion analysis
→ Segment embeddings → MongoDB vector index
→ Key frame extraction → OCR → visual context
→ Mistral 7B synthesis → cognitive map + summary

---

## Installation
```bash
git clone https://github.com/ayaanhussainsyed/SubSyncAI.git
cd SubSyncAI
pip install -r requirements.txt
python app.py
```

Add your API key to `.env`:
OPENAI_API_KEY=your_key_here 

Then open: `http://127.0.0.1:7746/`

---

## Who is this for?

- **Students** — auto-summarise and semantically search any lecture
- **Educators** — analyse teaching tone and student engagement signals
- **Researchers** — search hours of recorded content by concept
- **Content creators** — emotionally aware auto-captioning

---

## Author

**Syed Ayaan Hussain**  
AI/ML Researcher · Deep Learning · Information Retrieval  · Agentic RAG
[GitHub](https://github.com/ayaanhussainsyed) · [LinkedIn]([https://linkedin.com/in/your-profile](https://www.linkedin.com/in/syed-hussain-b6a95a36b/))
